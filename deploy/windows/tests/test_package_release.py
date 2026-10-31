"""Black-box tests for package-release.cmd and scripts/Package-Release.ps1.

The packager is driven exactly as a user would: the real .cmd is launched with
cmd.exe and OURONEX_NO_PAUSE=1 so the pause branch cannot block the run.
Fixtures are throwaway copies of the working tree under D:/tmp (or TEMP) so the
real repository content is never modified.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
import uuid
import zipfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
PACKAGER_CMD = REPO_ROOT / "package-release.cmd"
PACKAGER_PS1 = REPO_ROOT / "scripts" / "Package-Release.ps1"
PUBLIC_BUILDER = REPO_ROOT / "deploy" / "windows" / "Build-PublicSite.ps1"
DEPLOYER = REPO_ROOT / "deploy" / "windows" / "Deploy-Release.ps1"

EDIT_RELATIVE = "assets/home.css"
EDIT_MARKER = "packaged-working-tree-edit-"
ENV_CANARY_VALUE = "OURONEX_CANARY_SECRET=must-never-ship"

TMP_BASE = Path("D:/tmp") if Path("D:/tmp").is_dir() else Path(tempfile.gettempdir())

FORBIDDEN_DIR_SEGMENTS = {
    ".git",
    ".github",
    "_scratch",
    "__pycache__",
    "node_modules",
    "logs",
    "backups",
    "venv",
    ".venv",
}
FORBIDDEN_SUFFIXES = (
    ".sqlite3",
    ".sqlite3-wal",
    ".sqlite3-shm",
    ".sqlite",
    ".db",
    ".pyc",
    ".pyo",
    ".log",
    ".bak",
)


def _decode(raw: bytes) -> str:
    for encoding in ("utf-8", "cp1252", "mbcs"):
        try:
            return raw.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return raw.decode("utf-8", "replace")


def _run_packager(repo, output_dir=None, args=()):
    env = os.environ.copy()
    env.pop("OURONEX_RELEASE_OUTPUT", None)
    env.pop("OURONEX_RELEASE_SOURCE", None)
    env["OURONEX_NO_PAUSE"] = "1"
    if output_dir is not None:
        env["OURONEX_RELEASE_OUTPUT"] = str(output_dir)
    argv = ["cmd.exe", "/c", str(PACKAGER_CMD), "-RepoRoot", str(repo)]
    argv.extend(args)
    proc = subprocess.run(
        argv,
        cwd=str(REPO_ROOT),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=900,
        env=env,
    )
    return proc, _decode(proc.stdout), _decode(proc.stderr)


def _make_fixture(label):
    base = Path(TMP_BASE) / f"ouronex-pack-{label}-{uuid.uuid4().hex[:10]}"
    repo = base / "repo"
    ignore = shutil.ignore_patterns(
        ".git", "_scratch", "__pycache__", "*.pyc", "NUL", "Thumbs.db", ".DS_Store"
    )
    shutil.copytree(REPO_ROOT, repo, ignore=ignore)
    return base, repo


def _plant_canaries(repo):
    (repo / ".env").write_text(ENV_CANARY_VALUE + "\n", encoding="utf-8")
    (repo / ".env.production").write_text(ENV_CANARY_VALUE + "\n", encoding="utf-8")
    (repo / "backend" / ".env.local").write_text(ENV_CANARY_VALUE + "\n", encoding="utf-8")
    (repo / "db.sqlite3").write_bytes(b"SQLite format 3\x00canary-root-database")
    scratch = repo / "_scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    (scratch / "agent-note.txt").write_text("scratch must not ship\n", encoding="utf-8")
    cache = repo / "scripts" / "__pycache__"
    cache.mkdir(parents=True, exist_ok=True)
    (cache / "packaging_probe.cpython-312.pyc").write_bytes(b"\x00canary-bytecode")
    logs = repo / "logs"
    logs.mkdir(exist_ok=True)
    (logs / "service.log").write_text("canary log line\n", encoding="utf-8")
    backups = repo / "backups"
    backups.mkdir(exist_ok=True)
    (backups / "ouronex-backup.sqlite3").write_bytes(b"canary backup database")


def _zip_names(zip_path):
    with zipfile.ZipFile(zip_path) as archive:
        return [name.replace("\\", "/") for name in archive.namelist()]


def _zip_read(zip_path, member):
    with zipfile.ZipFile(zip_path) as archive:
        return archive.read(member)


def _release_zips(out_dir, exclude=()):
    skipped = {name.lower() for name in exclude}
    return sorted(
        path
        for path in Path(out_dir).glob("OuroNex-release-*.zip")
        if path.name.lower() not in skipped
    )


def _single_zip(out_dir, exclude=()):
    found = _release_zips(out_dir, exclude)
    if len(found) != 1:
        raise AssertionError(f"expected exactly one release zip in {out_dir}, found {found}")
    return found[0]


def _require_packager_files(cls):
    if not PACKAGER_CMD.is_file():
        raise AssertionError(f"packager entry point missing: {PACKAGER_CMD}")
    if not PACKAGER_PS1.is_file():
        raise AssertionError(f"packager implementation missing: {PACKAGER_PS1}")


def _forbidden_hits(names):
    hits = []
    for name in names:
        parts = name.split("/")
        base = parts[-1].lower()
        segments = {part.lower() for part in parts}
        if base == ".env" or (base.startswith(".env.") and base != ".env.example"):
            hits.append(f"{name}: environment file")
            continue
        if base.endswith(FORBIDDEN_SUFFIXES):
            hits.append(f"{name}: forbidden suffix")
            continue
        bad = segments & FORBIDDEN_DIR_SEGMENTS
        if bad:
            hits.append(f"{name}: forbidden directory {sorted(bad)}")
    return hits


class ReleasePackagingTest(unittest.TestCase):
    """The zero-exit path: a verified archive built from working-tree content."""

    @classmethod
    def setUpClass(cls):
        _require_packager_files(cls)

        cls.base, cls.repo = _make_fixture("ok")
        cls.out_dir = cls.base / "out"
        cls.out_dir.mkdir()
        cls.sentinel = cls.out_dir / "OuroNex-release-19990101-000000.zip"
        cls.sentinel.write_bytes(b"pre-existing operator artifact")

        _plant_canaries(cls.repo)

        cls.edit_marker = EDIT_MARKER + uuid.uuid4().hex[:12]
        edited = cls.repo / EDIT_RELATIVE
        cls.edited_bytes = (
            edited.read_bytes().rstrip(b"\n")
            + b"\n/* "
            + cls.edit_marker.encode("ascii")
            + b" */\n"
        )
        edited.write_bytes(cls.edited_bytes)

        cls.manifest_before = (cls.repo / "package-manifest.json").read_bytes()
        cls.source_manifest = json.loads(cls.manifest_before)
        cls.source_paths = [entry["path"] for entry in cls.source_manifest["files"]]

        cls.proc, cls.stdout, cls.stderr = _run_packager(cls.repo, cls.out_dir)
        cls.zip_path = _single_zip(cls.out_dir, exclude={cls.sentinel.name})
        cls.names = _zip_names(cls.zip_path)

    @classmethod
    def tearDownClass(cls):
        # The successful artifact is kept on disk on purpose; only the failure
        # fixtures of the other test classes are thrown away.
        pass

    def test_returns_zero_and_reports_absolute_path_and_sha256(self):
        self.assertEqual(
            self.proc.returncode,
            0,
            msg=f"stdout:\n{self.stdout}\nstderr:\n{self.stderr}",
        )
        zip_path = self.zip_path
        self.assertTrue(zip_path.is_absolute())
        self.assertRegex(zip_path.name, r"^OuroNex-release-\d{8}-\d{6}")
        self.assertIn(str(zip_path), self.stdout)
        digest = hashlib.sha256(zip_path.read_bytes()).hexdigest()
        self.assertIn(digest, self.stdout.lower())

    def test_archive_reopens_and_has_app_and_public_roots(self):
        self.assertIsNone(zipfile.ZipFile(self.zip_path).testzip())
        roots = {name.split("/")[0] for name in self.names}
        self.assertIn("app", roots)
        self.assertIn("public", roots)
        for name in ("app/backend/manage.py", "app/backend/backend/wsgi.py"):
            self.assertIn(name, self.names)
        self.assertIn("public/index.html", self.names)
        self.assertIn("app/.env.example", self.names)
        self.assertGreater(len(self.names), 50)

    def test_working_tree_edit_reaches_app_and_public(self):
        for member in (f"app/{EDIT_RELATIVE}", f"public/{EDIT_RELATIVE}"):
            self.assertIn(member, self.names)
            self.assertIn(self.edit_marker, _zip_read(self.zip_path, member).decode("utf-8"))

    def test_staged_manifest_refreshed_without_adding_paths(self):
        staged_manifest = json.loads(_zip_read(self.zip_path, "app/package-manifest.json"))
        staged_paths = [entry["path"] for entry in staged_manifest["files"]]
        self.assertEqual(sorted(staged_paths), sorted(self.source_paths))

        public_bytes = _zip_read(self.zip_path, f"public/{EDIT_RELATIVE}")
        expected = hashlib.sha256(public_bytes).hexdigest()
        entry = next(e for e in staged_manifest["files"] if e["path"] == EDIT_RELATIVE)
        self.assertEqual(entry["sha256"].lower(), expected)
        self.assertEqual(entry["bytes"], len(public_bytes))

        for item in staged_manifest["files"]:
            app_bytes = _zip_read(self.zip_path, f"app/{item['path']}")
            self.assertEqual(
                item["sha256"].lower(),
                hashlib.sha256(app_bytes).hexdigest(),
                msg=f"staged manifest hash not refreshed for {item['path']}",
            )
            self.assertEqual(item["bytes"], len(app_bytes))

    def test_working_manifest_is_untouched(self):
        self.assertEqual((self.repo / "package-manifest.json").read_bytes(), self.manifest_before)

    def test_secrets_databases_and_scratch_are_absent(self):
        self.assertEqual(_forbidden_hits(self.names), [])
        bases = {name.split("/")[-1].lower() for name in self.names}
        for canary in ("db.sqlite3", "agent-note.txt", "service.log", "ouronex-backup.sqlite3"):
            self.assertNotIn(canary, bases)
        self.assertNotIn("packaging_probe.cpython-312.pyc", bases)

    def test_extracted_archive_is_a_valid_staged_release(self):
        extracted = self.base / "extracted"
        with zipfile.ZipFile(self.zip_path) as archive:
            archive.extractall(extracted)
        deployment_root = self.base / "deployment-root"
        deployment_root.mkdir(exist_ok=True)
        proc = subprocess.run(
            [
                "powershell",
                "-NoLogo",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
                str(DEPLOYER),
                "-DeploymentRoot",
                str(deployment_root),
                "-ReleaseName",
                "20260101-000000",
                "-StagedReleasePath",
                str(extracted),
                "-WhatIf",
            ],
            cwd=str(REPO_ROOT),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=300,
        )
        output = _decode(proc.stdout) + _decode(proc.stderr)
        self.assertEqual(proc.returncode, 0, msg=output)
        self.assertIn("WhatIf complete", output)

    def test_second_run_never_destroys_the_first_archive(self):
        first_bytes = self.zip_path.read_bytes()
        proc, stdout, stderr = _run_packager(self.repo, self.out_dir)
        self.assertEqual(proc.returncode, 0, msg=f"{stdout}\n{stderr}")
        archives = _release_zips(self.out_dir)
        names = {path.name for path in archives}
        self.assertIn(self.zip_path.name, names)
        self.assertIn(self.sentinel.name, names)
        self.assertEqual(self.sentinel.read_bytes(), b"pre-existing operator artifact")
        self.assertEqual(self.zip_path.read_bytes(), first_bytes)
        fresh = names - {self.zip_path.name, self.sentinel.name}
        self.assertEqual(len(fresh), 1, msg=f"unexpected archives: {sorted(names)}")


class DefaultOutputDirectoryTest(unittest.TestCase):
    """OURONEX_RELEASE_OUTPUT unset: the default output directory is used."""

    @classmethod
    def setUpClass(cls):
        _require_packager_files(cls)
        cls.base, cls.repo = _make_fixture("default")
        cls.proc, cls.stdout, cls.stderr = _run_packager(cls.repo)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.base, ignore_errors=True)

    def test_defaults_to_d_tmp_and_reports_the_archive(self):
        self.assertEqual(
            self.proc.returncode, 0, msg=f"stdout:\n{self.stdout}\nstderr:\n{self.stderr}"
        )
        expected_parent = (
            Path("D:/tmp") if Path("D:/tmp").is_dir() else Path(tempfile.gettempdir())
        )
        printed = re.findall(r"[A-Za-z]:[^\r\n\"]*OuroNex-release-[0-9-]+\.zip", self.stdout)
        self.assertTrue(printed, msg=f"no absolute archive path printed:\n{self.stdout}")
        produced = Path(printed[0].strip())
        self.assertEqual(produced.parent, expected_parent)
        self.assertTrue(produced.is_file())
        self.assertIn(hashlib.sha256(produced.read_bytes()).hexdigest(), self.stdout.lower())


class MissingContentFailureTest(unittest.TestCase):
    """A manifest-listed file that is missing must fail loudly, not silently."""

    @classmethod
    def setUpClass(cls):
        _require_packager_files(cls)
        cls.base, cls.repo = _make_fixture("missing")
        cls.out_dir = cls.base / "out"
        cls.out_dir.mkdir()
        cls.removed = "index.html"
        (cls.repo / cls.removed).unlink()
        cls.proc, cls.stdout, cls.stderr = _run_packager(cls.repo, cls.out_dir)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.base, ignore_errors=True)

    def test_failure_is_nonzero_and_claims_no_success(self):
        self.assertNotEqual(self.proc.returncode, 0)
        combined = (self.stdout + self.stderr).lower()
        self.assertIn("error", combined)
        self.assertIn(self.removed, combined)
        self.assertNotIn("release package ready", combined)
        self.assertEqual(_release_zips(self.out_dir), [])


if __name__ == "__main__":
    unittest.main()
