# OuroNex Deployment Guide

This guide covers local development and summarizes the production layout. The
operator procedure for Windows Server 2022, IIS, WinSW, certificates, updates,
backups and rollback is in [WINDOWS_SERVER_DEPLOYMENT.md](WINDOWS_SERVER_DEPLOYMENT.md).

## Local development

Requirements: Python 3.12 or newer (the pinned Django 6.1.2 requires it). The
pinned dependencies are in `backend/requirements.txt`.

```powershell
cd D:\Development\OuroNex-Official-Website
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
cd backend
..\.venv\Scripts\python.exe manage.py migrate
..\.venv\Scripts\python.exe manage.py runserver 8000
```

`scripts\dev.ps1` and `start-local.cmd` are development conveniences only. Do
not use `runserver` as the production service.

Local URLs:

- Home: `http://localhost:8000/`
- Login: `http://localhost:8000/login/`
- Register: `http://localhost:8000/register/`
- Dashboard: `http://localhost:8000/dashboard/`
- Token Usage: `http://localhost:8000/dashboard/usage/`
- Admin: `http://localhost:8000/admin/`
- Health: `http://localhost:8000/health/`

Development defaults use `backend/db.sqlite3`, local hosts and a development-only
secret. Create an administrator explicitly with `python manage.py createsuperuser`;
there is no default production administrator.

## Environment configuration

Only the documented `OURONEX_*` variables are read by the application. Copy
`.env.example` to a location outside the repository and replace every placeholder.
Never commit the resulting `.env`.

| Variable | Purpose |
| --- | --- |
| `OURONEX_ENV` | `development` or `production`; development is the local default |
| `OURONEX_SECRET_KEY` | Random production secret, at least 50 characters |
| `OURONEX_ALLOWED_HOSTS` | Comma-separated exact hostnames; no wildcard |
| `OURONEX_CSRF_TRUSTED_ORIGINS` | Exact HTTPS origins used by browser forms |
| `OURONEX_DB_PATH` | Absolute SQLite path outside code and public directories |
| `OURONEX_SQLITE_TIMEOUT_SECONDS` | SQLite busy timeout, default 30 |
| `OURONEX_SECURE_HSTS_SECONDS` | HSTS duration; keep 0 until HTTPS is verified |
| `OURONEX_TRUSTED_PROXY_IPS` | Proxy addresses allowed to supply forwarded client IPs |
| `OURONEX_AUTH_MAX_ATTEMPTS` | Failed authentication attempts per scope/IP window |
| `OURONEX_AUTH_WINDOW_SECONDS` | Authentication throttle window |
| `OURONEX_AUTH_TOKEN_TTL_SECONDS` | Bearer-token lifetime, default 30 days |

Production fails closed when required values are missing or unsafe. Secure
cookies, HTTPS redirects and proxy protocol handling are enabled there; local
development keeps non-secure cookies so `runserver` remains usable.

## Production layout

The supported route is IIS terminating HTTPS and proxying to Waitress on
`127.0.0.1:8000`. Gunicorn is not used on native Windows.

```text
D:\OuroNex\
  current -> releases\<release-name>
  releases\<release-name>\
    app\       application tree and package-manifest.json
    public\    files copied exclusively from the public manifest
  shared\
    config\.env
    data\ouronex.sqlite3
    logs\
    backups\
    venv\
    iis\
```

In production Django serves public files from `current\public`; the manifest
allowlist remains in `current\app`. The database, configuration, logs and backups
are never inside a release. IIS serves collected admin assets through the
`/static/` virtual directory described in the operator runbook.

Build the public package only after all public-file writers have stopped and the
manifest hashes are current:

```powershell
.\deploy\windows\Build-PublicSite.ps1 -Destination D:\build\release\public
```

The builder rejects stale hashes, extra files, private paths and non-empty output
directories. Do not copy the repository root into an IIS public directory.

## Authentication and browser security

- Django password validation is enabled for registration and password changes.
- The registration challenge is stored in the server-side session, compared once
  without case sensitivity and replaced after failures. The answer is not a
  hidden form value.
- Session-backed login, registration, profile, security and logout forms use CSRF
  tokens. Logout accepts POST only.
- Login `next` redirects allow local paths only.
- Web and Bearer login throttle repeated failures. Successful authentication
  clears the applicable failure scope. The defaults are 10 failures in 300 seconds.
- The existing JSON response schema for Session/Bearer authentication remains in
  [APPLICATION_AUTH_API.md](APPLICATION_AUTH_API.md). Bearer tokens are stored as
  SHA-256 hashes; plaintext is returned only when issued.

## Database and updates

SQLite remains the single-server database. Production requires an absolute path
outside both `app` and `public`. The busy timeout reduces short lock conflicts;
it does not make SQLite suitable for multiple application instances.

Use the online backup helper before every update or migration:

```powershell
.\deploy\windows\Backup-SqliteDatabase.ps1 `
  -DatabasePath D:\OuroNex\shared\data\ouronex.sqlite3 `
  -Destination D:\OuroNex\shared\backups\ouronex-<timestamp>.sqlite3
```

The helper uses SQLite's online backup API, verifies integrity and schema, and
refuses to overwrite an existing backup. Keep an off-server copy. Restore only
with the application service stopped; restoring an older backup discards later
writes.

A conservative update order is: stage the new release, back up the database, stop
the service, activate the new release, install its requirements, migrate, collect
static files, run preflight checks, start and verify. Never run migrations against
the old running service. The runbook also explains lock-file and temporary-file
handling for the online backup helper.
Code rollback does not require a database restore when no schema change occurred.
After a schema change, follow the runbook's database-restore trade-off instead of
assuming old code and new data are compatible.

## Verification

Run the project-side checks before staging a release:

```powershell
cd backend
python manage.py test
python manage.py check --deploy
python manage.py makemigrations --check --dry-run
```

`check --deploy` requires a complete production environment and a temporary
external database path; it does not use the production database. The full
operator checklist also covers real Waitress startup, IIS HTTPS, private-file
404 probes, login/CSRF, backups, service restart and rollback.
