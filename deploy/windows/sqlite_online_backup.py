#!/usr/bin/env python3
"""Create a consistent online backup of the live OuroNex SQLite database.

The SQLite online backup API (``sqlite3.Connection.backup``) copies a consistent
snapshot while the web application keeps reading and writing, so no maintenance
window and no service stop is required.

Each run uses:

  * a per-destination lock file ``<destination>.lock`` created exclusively, so two
    cooperating helpers cannot work on the same backup file at once;
  * a unique temporary snapshot ``<destination>.tmp-<pid>-<random>`` in the
    destination directory, so concurrent runs never share a temp file;
  * atomic no-clobber publication: the verified snapshot is hard-linked to the
    destination (``os.link``) and only then is the temp name removed. A link fails
    with ``FileExistsError`` instead of replacing an existing backup, so a backup
    published by another run is preserved byte for byte;
  * an exclusive checksum sidecar ``<destination>.sha256`` created with
    ``O_CREAT | O_EXCL``, which also never overwrites.

The published file is verified with ``PRAGMA integrity_check`` and its schema is
compared with the live source schema. Temp files and the lock are removed on
success, failure and interrupt, and the live database is never written to or
deleted. Exit codes: 0 = verified backup published, 2 = failure.
"""

import argparse
import hashlib
import os
import sqlite3
import sys
import time
import uuid

LOCK_SUFFIX = ".lock"
SIDECAR_SUFFIX = ".sha256"
TEMP_INFIX = ".tmp-"


class LockBusyError(Exception):
    """The per-destination lock is already held by another backup process."""


def fail(message, code=2):
    sys.stdout.flush()
    print("SQLITE-BACKUP-ERROR: %s" % message, file=sys.stderr)
    sys.exit(code)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def same_path(first, second):
    """True when both names resolve to the same file, including case differences."""
    left = os.path.normcase(os.path.realpath(os.path.abspath(first)))
    right = os.path.normcase(os.path.realpath(os.path.abspath(second)))
    if left == right:
        return True
    try:
        return os.path.samefile(first, second)
    except (OSError, ValueError):
        return False


def lock_path_for(destination):
    return destination + LOCK_SUFFIX


def sidecar_path_for(destination):
    return destination + SIDECAR_SUFFIX


def unique_temp_path(destination):
    """Unique temporary snapshot name in the destination directory.

    The temp file must live on the destination filesystem so it can be hard-linked
    into place atomically.
    """
    directory = os.path.dirname(destination) or "."
    stem = os.path.basename(destination)
    return os.path.join(
        directory, "%s%s%d-%s" % (stem, TEMP_INFIX, os.getpid(), uuid.uuid4().hex)
    )


def acquire_lock(lock_path):
    """Create the per-destination lock exclusively, or raise LockBusyError."""
    try:
        handle = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise LockBusyError(lock_path)
    try:
        os.write(handle, ("pid=%d\n" % os.getpid()).encode("ascii"))
    finally:
        os.close(handle)


def release_file(path):
    """Best-effort removal of a temp, lock or sidecar file this process created."""
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def publish_no_clobber(temp_path, destination):
    """Atomically publish a verified snapshot without replacing an existing file.

    ``os.link`` fails with FileExistsError when the destination exists, which is
    the desired outcome: the caller keeps the existing backup. The temp name is
    removed only after the link succeeds.
    """
    os.link(temp_path, destination)
    os.remove(temp_path)


def write_sidecar_exclusive(sidecar_path, digest, backup_name):
    """Write the checksum sidecar, refusing to overwrite an existing one."""
    handle = os.open(sidecar_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(handle, "w", encoding="ascii", newline="\n") as stream:
            stream.write("%s  %s\n" % (digest, backup_name))
    except BaseException:
        release_file(sidecar_path)
        raise


def schema_signature(connection):
    rows = connection.execute(
        "SELECT type, name, COALESCE(sql, '') FROM sqlite_master ORDER BY type, name"
    ).fetchall()
    return tuple(tuple(row) for row in rows)


def table_names(connection):
    rows = connection.execute(
        "SELECT name FROM sqlite_master "
        "WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return tuple(row[0] for row in rows)


def table_counts(connection, names):
    counts = {}
    for name in names:
        quoted = '"%s"' % name.replace('"', '""')
        counts[name] = connection.execute("SELECT COUNT(*) FROM %s" % quoted).fetchone()[0]
    return counts


def verify_backup(path, expected_schema, expected_tables):
    """Return a summary dict, or exit non-zero when the snapshot is unusable."""
    if not os.path.isfile(path):
        fail("verification failed: the snapshot was not written to %s" % path)
    size = os.path.getsize(path)
    if size <= 0:
        fail("verification failed: the snapshot is empty: %s" % path)

    connection = sqlite3.connect(path)
    try:
        integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity.lower() != "ok":
            fail("verification failed: PRAGMA integrity_check returned %r for %s" % (integrity, path))
        pages = connection.execute("PRAGMA page_count").fetchone()[0]
        if pages <= 0:
            fail("verification failed: the snapshot reports %d database pages" % pages)
        schema = schema_signature(connection)
        if expected_schema and schema != expected_schema:
            fail(
                "verification failed: the snapshot schema differs from the live schema "
                "(a migration may be running; stop migrations and retry): %s" % path
            )
        tables = table_names(connection)
        if expected_tables and tables != expected_tables:
            fail(
                "verification failed: the snapshot tables differ from the live tables: %s" % path
            )
        counts = table_counts(connection, tables)
    finally:
        connection.close()
    return {
        "size": size,
        "pages": pages,
        "integrity": integrity,
        "tables": tables,
        "counts": counts,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Verified online SQLite backup for OuroNex.")
    parser.add_argument("--database", required=True, help="Live SQLite database file to copy.")
    parser.add_argument("--destination", required=True, help="Backup file to create (must not exist).")
    parser.add_argument("--timeout", type=float, default=30.0, help="SQLite busy timeout in seconds.")
    parser.add_argument("--retries", type=int, default=5, help="Attempts when the source is busy.")
    parser.add_argument("--retry-delay", type=float, default=1.0, help="Seconds between attempts.")
    args = parser.parse_args(argv)

    source = os.path.abspath(args.database)
    destination = os.path.abspath(args.destination)
    lock_path = lock_path_for(destination)
    sidecar = sidecar_path_for(destination)

    if not os.path.isfile(source):
        fail("database file not found: %s (check OURONEX_DB_PATH and the release you deploy)" % source)
    for label, candidate in (
        ("destination", destination),
        ("checksum sidecar", sidecar),
        ("lock", lock_path),
    ):
        if same_path(source, candidate):
            fail(
                "the %s path collides with the live database and is never used as a target: %s"
                % (label, candidate)
            )
    if os.path.exists(destination):
        fail("refusing to overwrite an existing backup: %s" % destination)
    if os.path.exists(sidecar):
        fail("refusing to overwrite an existing backup checksum: %s" % sidecar)

    parent = os.path.dirname(destination)
    if not parent:
        fail("destination has no parent directory: %s" % destination)
    if os.path.exists(parent) and not os.path.isdir(parent):
        fail("destination directory is a file, not a directory: %s" % parent)
    try:
        os.makedirs(parent, exist_ok=True)
    except OSError as exc:
        fail("destination directory cannot be created (%s): %s" % (parent, exc))
    if not os.path.isdir(parent):
        fail("destination directory is not available: %s" % parent)

    lock_message = (
        "another backup is already running for this destination (lock file: %s). "
        "Wait for it to finish; only after confirming that no backup process is "
        "active may a stale lock be removed manually, then retry." % lock_path
    )
    if os.path.exists(lock_path):
        fail(lock_message)
    lock_acquired = False
    temp_path = None
    timeout = max(1.0, float(args.timeout))
    attempts = max(1, int(args.retries))
    last_error = None

    try:
        try:
            acquire_lock(lock_path)
            lock_acquired = True
        except LockBusyError:
            fail(lock_message)
        except OSError as exc:
            fail("the backup lock cannot be created (%s): %s" % (lock_path, exc))

        source_connection = sqlite3.connect(source, timeout=timeout)
        try:
            source_connection.execute("PRAGMA busy_timeout = %d" % int(timeout * 1000))
            try:
                source_connection.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()
            except sqlite3.DatabaseError as exc:
                fail("source is not a readable SQLite database (%s): %s" % (source, exc))
            expected_schema = schema_signature(source_connection)
            expected_tables = table_names(source_connection)

            summary = None
            for attempt in range(1, attempts + 1):
                connection = None
                temp_path = unique_temp_path(destination)
                try:
                    connection = sqlite3.connect(temp_path, timeout=timeout)
                    source_connection.backup(connection, pages=-1, sleep=0.05)
                    connection.close()
                    connection = None
                    summary = verify_backup(temp_path, expected_schema, expected_tables)
                    last_error = None
                    break
                except sqlite3.OperationalError as exc:
                    last_error = exc
                    if connection is not None:
                        try:
                            connection.close()
                        except sqlite3.Error:
                            pass
                        connection = None
                    release_file(temp_path)
                    temp_path = None
                    if attempt < attempts:
                        time.sleep(max(0.0, float(args.retry_delay)))
        finally:
            source_connection.close()

        if last_error is not None or summary is None:
            fail(
                "backup failed after %d attempts; the database stayed busy/locked: %s"
                % (attempts, last_error)
            )

        try:
            publish_no_clobber(temp_path, destination)
            temp_path = None
        except FileExistsError:
            fail(
                "refusing to overwrite a backup that appeared while this run was working: %s "
                "(the existing file was not replaced)" % destination
            )
        except OSError as exc:
            fail("the backup cannot be published atomically at %s: %s" % (destination, exc))

        digest = sha256_file(destination)
        try:
            write_sidecar_exclusive(sidecar, digest, os.path.basename(destination))
        except FileExistsError:
            fail(
                "backup published at %s but a checksum sidecar already exists (%s); "
                "inspect both files manually, nothing was overwritten" % (destination, sidecar)
            )
        except OSError as exc:
            fail("backup checksum file cannot be written (%s): %s" % (sidecar, exc))
    finally:
        if temp_path:
            release_file(temp_path)
        if lock_acquired:
            release_file(lock_path)

    printed_counts = ",".join("%s=%d" % (name, count) for name, count in summary["counts"].items())
    print(
        "BACKUP-OK destination=%s bytes=%d sha256=%s integrity=%s pages=%d tables=%d rows=%s"
        % (
            destination,
            summary["size"],
            digest,
            summary["integrity"],
            summary["pages"],
            len(summary["tables"]),
            printed_counts,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())