# OuroNex on Windows Server 2022 - Deployment Runbook

Status: **project-side assets only.** This document describes the single
deployment route and the commands an operator runs on the server. Nothing in this
repository has installed IIS, ARR, URL Rewrite, a Windows service, a firewall rule,
a DNS record or a certificate, and no step below has been executed against a real
server. Treat every command as an operator action on the target machine.

Assets in this repository:

| Path | Purpose |
| --- | --- |
| `.env.example` | Placeholder-only settings template used to create the shared config |
| `deploy/windows/Build-PublicSite.ps1` | Copies ONLY `package-manifest.json` `files[].path` entries into a fresh public package |
| `deploy/windows/Backup-SqliteDatabase.ps1` | Verified online SQLite backup wrapper |
| `deploy/windows/sqlite_online_backup.py` | SQLite backup API implementation used by the wrapper |
| `deploy/windows/Start-OuroNex.ps1` | The one launcher: loads and validates the shared `.env`, runs Waitress on loopback |
| `deploy/windows/waitress_app.py` | Waitress entry point used by the launcher |
| `deploy/windows/Deploy-Release.ps1` | Release staging/activation with `-WhatIf` and no-overwrite protection |
| `deploy/windows/ouronex-service.xml` | Example WinSW service definition (not installed) |

All scripts are non-elevated by design, run on Windows PowerShell 5.1 or PowerShell
7, and exit non-zero with a clear message when a prerequisite or path is missing or
an effect cannot be verified.

---

## 1. Target architecture (one route)

```
                  https://<internal-hostname>/        (later: https://<public-hostname>/)
client browser -> IIS 443 (TLS termination, ARR + URL Rewrite)
                    |
                    +-- /static/*  -> IIS virtual directory "Static"
                    |                 -> D:\OuroNex\current\app\backend\staticfiles
                    |                 (stop-processing static rule, never proxied)
                    |
                    +-- everything else -> ARR proxy -> http://127.0.0.1:8000/...
                                             |
                                             v
                                   Waitress (loopback only) -> Django
                                     - public pages from current\public (manifest allowlist)
                                     - /health/, /admin/, /api/v1/..., login/register/dashboard
```

What each layer owns:

- **IIS** is the only public listener. Its site root is the stable, otherwise
  empty folder `D:\OuroNex\shared\iis`, which holds the persistent `web.config`
  with the rewrite rules. IIS never serves the release tree directly.
- **`/static/`** is the sole exception to proxying. It is an IIS virtual directory
  named `Static` pointing at `D:\OuroNex\current\app\backend\staticfiles`, filled by
  `collectstatic` in each release. A stop-processing static rule placed **before**
  the proxy rule serves it from IIS and leaves Django out of the path.
- **Everything else** is proxied to Waitress on `127.0.0.1:8000`. That covers the
  public pages, `/health/`, `/admin/`, `/api/v1/...` and the account pages.
- **Django** serves the public website from `current\public` through the
  manifest-allowlisted public view: only paths listed in
  `current\app\package-manifest.json` are readable, and every private, deleted,
  traversal or unknown path is a 404. The production settings resolve the public
  root to `current\public` while the manifest stays in the app tree, which is why
  the release layout keeps those two directories separate.
- **Waitress** binds `127.0.0.1` only. The launcher and the Waitress entry point
  refuse any other bind address, so `X-Forwarded-Proto` can only come from the
  local IIS/ARR process.

Rules that keep this safe:

- One launcher, one service command, one web route. Do not add a second start
  script, a second web server, a second site root or a second proxy rule set.
- IIS serves `current\public` only through Django. Do not point an IIS virtual
  directory or static rule at `current\public`, the release tree or the repository:
  that would bypass the manifest allowlist.
- The public package contains only manifest paths. The app tree (backend,
  `deploy\`, `docs\`, scratch folders, `.env`, SQLite file, translation
  dictionaries) is never a web root.
- User data lives in `shared\` and is never copied into a release, so an update
  cannot delete accounts, tokens or usage records.

---

## 2. Prerequisites

Server (checked once by the operator):

- Windows Server 2022 with RDP access and an administrator account.
- Python 3.12 or newer (64-bit): the pinned Django 6.1.2 requires Python 3.12 or
  newer, and `backend/requirements.txt` also pins waitress.
- IIS with the **ARR** (Application Request Routing) and **URL Rewrite** modules.
- GoDaddy account access for the public DNS zone (later stage only).
- A management plan for the internal hostname: internal DNS `A` record, or a
  client `hosts` entry while the internal DNS zone does not exist yet.
- Free space for `releases\` (one tree per release) and `shared\backups\`.
- A dedicated low-privilege service account. The service never needs
  administrative rights; see the ACL guidance in section 3.

Project-side prerequisites:

- `package-manifest.json` is current (the builder refuses stale hashes and
  refuses any path that is not in the allowlist).
- `backend/requirements.txt` provides Django and waitress. The launcher fails with
  the exact install command when waitress is missing.
- The production settings read the `OURONEX_*` names listed in `.env.example`.
  Unknown names are reported as warnings by the launcher.

---

## 3. Directory layout

```
D:\OuroNex\                              <- DeploymentRoot (example; any fixed path works)
  releases\
    20261031-0400\                       <- immutable release, created by Deploy-Release.ps1
      app\                               <- repository tree: package-manifest.json, backend\, deploy\, requirements
      public\                            <- manifest-only public package, served by Django
      release.json                       <- release metadata written by the helper
  current -> releases\20261031-0400      <- junction, the only path the service and IIS use
  shared\
    config\.env                          <- operator-owned settings, never copied into a release
    data\ouronex.sqlite3                 <- OURONEX_DB_PATH, the only database
    logs\                                <- service/wrapper logs
    backups\                             <- SQLite backups (timestamped, never overwritten)
    venv\                                <- python virtual environment (operator-created)
    iis\web.config                       <- persistent IIS rules, outside every release
```

- `releases\<name>` is write-once: `Deploy-Release.ps1` refuses to reuse a name,
  which is what makes rollback-by-switching possible.
- `current` is a directory junction. The helper replaces it only when it is a
  junction; a real directory named `current` is refused and left untouched.
- `shared\` is only created when missing. No script writes, copies, deletes or
  overwrites a file inside `shared\`; migrations and the backup helper are the only
  things that create database/backup files there.
- `shared\iis` is the IIS site root and holds only `web.config`. It is outside
  every release, so activating a release does not touch IIS configuration.
- `current\app\backend\staticfiles` is the `/static/` target. Because the IIS
  virtual directory points at the `current` path, activating a release switches
  the static files at the same time as the code.
- Put the virtual environment in `shared\venv` so releases never own a Python
  installation and `pip install` is not repeated per release.

Access control (elevated operator action; least privilege, no administrator
rights for the service account):

```powershell
# Service account: read config, modify data/logs/backups, read+execute releases and venv.
icacls D:\OuroNex\shared\config   /grant "svc-ouronex:(OI)(CI)RX"
icacls D:\OuroNex\shared\config\.env /inheritance:r /grant "svc-ouronex:R" /grant "Administrators:F"
icacls D:\OuroNex\shared\data     /grant "svc-ouronex:(OI)(CI)M"
icacls D:\OuroNex\shared\logs     /grant "svc-ouronex:(OI)(CI)M"
icacls D:\OuroNex\shared\backups  /grant "svc-ouronex:(OI)(CI)M"
icacls D:\OuroNex\shared\venv     /grant "svc-ouronex:(OI)(CI)RX"
icacls D:\OuroNex\releases        /grant "svc-ouronex:(OI)(CI)RX"
# The IIS worker account only needs read access to the static files.
icacls D:\OuroNex\releases        /grant "IIS_IUSRS:(OI)(CI)RX"
```

---

## 4. Hostnames: internal now, public later

Stage 1 - internal hostname (LAN only):

1. Choose `<internal-hostname>` (for example a name in the corporate zone).
2. Publish it in internal DNS, or add it to each client `hosts` file while no
   internal zone exists:
   `C:\Windows\System32\drivers\etc\hosts` -> `<server-ip>  <internal-hostname>`.
3. In the shared `.env`:

   ```ini
   OURONEX_ENV=production
   OURONEX_ALLOWED_HOSTS=<internal-hostname>,127.0.0.1
   OURONEX_CSRF_TRUSTED_ORIGINS=https://<internal-hostname>
   ```

4. IIS site binding: `https` on port 443 with host header `<internal-hostname>`.
5. Verify with the loopback and public checks in section 10.

Stage 2 - public hostname (later):

1. Obtain a certificate for `<public-hostname>` **first** (section 5). Issuing it
   later leaves an outage window on the public name.
2. Add the DNS record at GoDaddy: `A` `<public-hostname>` -> public IP address.
   Keep the internal record so LAN clients still resolve locally.
3. Add the public name to the config, keeping the internal one:

   ```ini
   OURONEX_ALLOWED_HOSTS=<internal-hostname>,<public-hostname>,127.0.0.1
   OURONEX_CSRF_TRUSTED_ORIGINS=https://<internal-hostname>,https://<public-hostname>
   ```

4. Add a second IIS binding/certificate for `<public-hostname>`.
5. Stop the service, run the launcher with `-CheckOnly`, start the service again,
   then repeat the verification checklist. Never add `*` to
   `OURONEX_ALLOWED_HOSTS`; the launcher rejects it.

Keep one database and one application behind both names, so accounts created on
the internal name keep working on the public one.

---

## 5. HTTPS certificate with GoDaddy DNS-01

The internal hostname is not reachable from the internet, so DNS-01 validation is
the practical option, and it is also the least disruptive for the public name
(no inbound port 80 requirement).

Operator procedure (elevated, on the server; nothing below is automated here):

1. Install a DNS-01 capable ACME client, for example **win-acme** (`wacs.exe`).
2. Create a GoDaddy API key limited to DNS record management for the zone, and
   store it in Windows Credential Manager or a win-acme secrets store. Do not put
   it in `shared\config\.env`, in the repository or in the service definition.
3. Request the certificate with DNS-01 validation:

   ```powershell
   # interactive win-acme wizard; choose:
   #   M) Create certificate (full options)
   #   host: <internal-hostname>
   #   validation: dns-01 via the GoDaddy plugin/script
   #   store: PEM/PFX + install into IIS
   ```

4. Bind the certificate to the IIS `https`/443 binding for that hostname.
5. Schedule win-acme's renewal task and test it once with `--renew --force`
   (a renewal failure must be visible in monitoring).
6. Only after HTTPS is proven end to end, consider
   `OURONEX_SECURE_HSTS_SECONDS` (for example `31536000`). Keep it `0` until then:
   the launcher warns when HSTS is enabled, and an HSTS mistake is hard to reverse
   for clients.

`X-Forwarded-Proto` must reach the application, otherwise Django treats proxied
HTTPS requests as HTTP and CSRF/secure-cookie checks fail. Section 6 sets the
header in the IIS proxy rule; the launcher keeps Waitress on loopback so only IIS
can supply it.

---

## 6. IIS + ARR + URL Rewrite

Persistent IIS configuration lives in `D:\OuroNex\shared\iis\web.config`, outside
every release. Never add `web.config` to a release directory or to the public
package.

1. Install ARR and URL Rewrite, then enable proxying at server level (IIS Manager
   -> server node -> *Application Request Routing Cache* -> *Server Proxy Settings*
   -> *Enable proxy*). Elevated equivalent:

   ```powershell
   & "$env:SystemRoot\System32\inetsrv\appcmd.exe" set config `
       -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /commit:apphost
   ```

2. Create an application pool with **No Managed Code**, then a site whose physical
   root is `D:\OuroNex\shared\iis` and whose only binding is `https`/443 for the
   hostname. The folder stays empty apart from `web.config`; it is a stable anchor
   for the rules, not a document root for the site content.

3. Add the `/static/` virtual directory (elevated operator action; the path uses
   `current`, so every activation switches the files automatically):

   ```powershell
   & "$env:SystemRoot\System32\inetsrv\appcmd.exe" add vdir `
       /app.name:"OuroNex/" /path:"/static" `
       /physicalPath:"D:\OuroNex\current\app\backend\staticfiles"
   ```

4. Allow the proxy header server variables, then write the rules. Order matters:
   the static rule has `stopProcessing="true"`, so `/static/` never reaches ARR,
   and the proxy rule handles every other request.

   ```xml
   <!-- applicationHost.config: allow the headers the proxy rule sets -->
   <rewrite>
     <allowedServerVariables>
       <add name="HTTP_X_FORWARDED_PROTO" />
       <add name="HTTP_X_FORWARDED_HOST" />
       <add name="HTTP_X_FORWARDED_FOR" />
     </allowedServerVariables>
   </rewrite>
   ```

   ```xml
   <!-- D:\OuroNex\shared\iis\web.config -->
   <configuration>
     <system.webServer>
       <rewrite>
         <rules>
           <!-- 1. /static/ is served by IIS through the Static virtual directory. -->
           <rule name="OuroNex static files" stopProcessing="true">
             <match url="^static/(.*)$" />
             <action type="Rewrite" url="static/{R:1}" />
           </rule>
           <!-- 2. Everything else goes to Waitress on loopback. -->
           <rule name="OuroNex reverse proxy" stopProcessing="true">
             <match url="(.*)" />
             <action type="Rewrite" url="http://127.0.0.1:8000/{R:1}" />
             <serverVariables>
               <set name="HTTP_X_FORWARDED_FOR" value="{REMOTE_ADDR}" />
               <set name="HTTP_X_FORWARDED_PROTO" value="https" />
               <set name="HTTP_X_FORWARDED_HOST" value="{HTTP_HOST}" />
             </serverVariables>
           </rule>
         </rules>
       </rewrite>
     </system.webServer>
   </configuration>
   ```

   The explicit `X-Forwarded-For` assignment prevents a client from supplying an
   arbitrary leftmost address for throttling. ARR may append its peer address;
   keep the assignment so the chain starts with the actual IIS client. The
   application accepts forwarded client IPs only from configured proxy addresses.
   `X-Forwarded-Proto` is safe because Waitress is bound to loopback and only IIS
   can reach it.

5. Firewall (elevated operator action; no rule is created by this repository):

   ```powershell
   New-NetFirewallRule -DisplayName 'OuroNex HTTPS 443' -Direction Inbound `
       -Protocol TCP -LocalPort 443 -Action Allow -Profile Domain,Private
   # Do NOT create an inbound rule for 8000. If one exists, remove it:
   Get-NetFirewallRule | Where-Object DisplayName -like '*8000*'
   # Restrict RDP to the management subnet instead of allowing it everywhere.
   ```

6. Health checks:

   - loopback: the launcher prints the `curl.exe` command with
     `Host: 127.0.0.1` and `X-Forwarded-Proto: https`; it must return the JSON
     health response.
   - through IIS: `https://<hostname>/health/` must return the same JSON.
   - static exception: `https://<hostname>/assets/site.css` must come from the
     public package through Django, while `/static/admin/css/base.css` must come
     from IIS and must not appear in the Waitress log.

---

## 7. Python environment and the application service

Once per server:

```powershell
# 1. Virtual environment in shared, so releases never own Python packages.
& python -m venv D:\OuroNex\shared\venv
& D:\OuroNex\shared\venv\Scripts\python.exe -m pip install --upgrade pip
& D:\OuroNex\shared\venv\Scripts\python.exe -m pip install `
      -r D:\OuroNex\current\app\backend\requirements.txt
```

Create the shared settings once, outside the repository:

```powershell
New-Item -ItemType Directory -Force -Path D:\OuroNex\shared\config | Out-Null
Copy-Item D:\OuroNex\current\app\.env.example D:\OuroNex\shared\config\.env
notepad D:\OuroNex\shared\config\.env      # replace every <placeholder>, never commit it
```

The launcher rejects any value that still looks like a template placeholder
(`<...>`), and it refuses to start until the real value is present. It prints a
non-sensitive summary (`secret key: set, N characters, value hidden`) and the
loopback health command; it never prints a setting value.

Install the service with WinSW (elevated; the XML is an example, not an installed
service), running it under the dedicated account from section 3:

```powershell
# Copy winsw.exe next to a copy of the example, then edit id/arguments/paths.
Copy-Item D:\OuroNex\current\app\deploy\windows\ouronex-service.xml D:\OuroNex\OuroNex.xml
notepad D:\OuroNex\OuroNex.xml
& D:\OuroNex\winsw.exe install D:\OuroNex\OuroNex.xml
# Keep the service stopped until the first deployment in section 8 is complete.
```

NSSM equivalent (same single launcher, same arguments):

```powershell
nssm install OuroNex C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe `
  "-NoProfile -ExecutionPolicy Bypass -File ""D:\OuroNex\current\app\deploy\windows\Start-OuroNex.ps1"" -ConfigFile ""D:\OuroNex\shared\config\.env"" -AppRoot ""D:\OuroNex\current\app\backend"" -PythonExe ""D:\OuroNex\shared\venv\Scripts\python.exe"" -Port 8000 -Threads 8"
nssm set OuroNex AppDirectory D:\OuroNex\current\app
nssm set OuroNex AppStdout D:\OuroNex\shared\logs\stdout.log
nssm set OuroNex AppStderr D:\OuroNex\shared\logs\stderr.log
nssm set OuroNex ObjectName ".\svc-ouronex"
```

Do not point the service at a repository checkout, do not run
`manage.py runserver` in production, and do not run the service as an
administrator.

---

## 8. First deployment

Run these commands from the repository root on the build machine. The release is
staged and activated first because every later step reads `current`; nothing starts
the service until the preflight checks pass.

```powershell
$Release = '20261031-0400'
$Stage   = "D:\build\$Release"

# 1. Stage the release; nothing under D:\OuroNex is serving yet.
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
New-Item -ItemType Directory -Path D:\OuroNex -Force | Out-Null
robocopy D:\Development\OuroNex-Official-Website "$Stage\app" /E `
    /XD .git _scratch __pycache__ .venv venv staticfiles exports `
    /XF db.sqlite3 .env *.pyc NUL CON PRN AUX
if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }

.\deploy\windows\Build-PublicSite.ps1 -Destination "$Stage\public" `
    -ReportPath "D:\build\$Release-public-report.json"
if ($LASTEXITCODE -ne 0) { throw "public package build failed: $LASTEXITCODE" }

.\deploy\windows\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName $Release `
    -StagedReleasePath $Stage -WhatIf
if ($LASTEXITCODE -ne 0) { throw "release dry run failed: $LASTEXITCODE" }
.\deploy\windows\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName $Release `
    -StagedReleasePath $Stage
if ($LASTEXITCODE -ne 0) { throw "release staging failed: $LASTEXITCODE" }

# 2. Activate it: this creates shared\config|data|logs|backups and current.
.\deploy\windows\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName $Release -ActivateOnly
if ($LASTEXITCODE -ne 0) { throw "activation failed: $LASTEXITCODE" }

# 3. Python environment in shared\venv with the release requirements.
& python -m venv D:\OuroNex\shared\venv
if ($LASTEXITCODE -ne 0) { throw "venv creation failed: $LASTEXITCODE" }
$py = 'D:\OuroNex\shared\venv\Scripts\python.exe'
& $py -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "pip upgrade failed: $LASTEXITCODE" }
& $py -m pip install -r D:\OuroNex\current\app\backend\requirements.txt
if ($LASTEXITCODE -ne 0) { throw "requirements install failed: $LASTEXITCODE" }

# 4. Shared settings outside the repository; replace every <placeholder>.
Copy-Item D:\OuroNex\current\app\.env.example D:\OuroNex\shared\config\.env
notepad D:\OuroNex\shared\config\.env

# 5. Register the service and leave it stopped.
Copy-Item D:\OuroNex\current\app\deploy\windows\ouronex-service.xml D:\OuroNex\OuroNex.xml
notepad D:\OuroNex\OuroNex.xml      # edit paths, account and port
& D:\OuroNex\winsw.exe install D:\OuroNex\OuroNex.xml
# Do not start the service yet: the database and static files do not exist.

# 6. Create the database and static files with the service stopped.
Get-Content D:\OuroNex\shared\config\.env |
    Where-Object { $_ -match '^OURONEX_[A-Z0-9_]+=' } |
    ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "Env:$k" $v.Trim() }
$app = 'D:\OuroNex\current\app\backend'
& $py $app\manage.py check --deploy
if ($LASTEXITCODE -ne 0) { throw "check --deploy failed: $LASTEXITCODE" }
& $py $app\manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { throw "migrate failed: $LASTEXITCODE" }
& $py $app\manage.py collectstatic --noinput
if ($LASTEXITCODE -ne 0) { throw "collectstatic failed: $LASTEXITCODE" }
& $py $app\manage.py createsuperuser
if ($LASTEXITCODE -ne 0) { throw "createsuperuser failed: $LASTEXITCODE" }

# 7. Preflight the exact release before anything serves traffic.
.\deploy\windows\Start-OuroNex.ps1 -CheckOnly -ConfigFile D:\OuroNex\shared\config\.env `
    -AppRoot D:\OuroNex\current\app\backend -PythonExe $py
if ($LASTEXITCODE -ne 0) { throw "preflight failed: $LASTEXITCODE" }

# 8. Start and verify.
Start-Service OuroNex
curl.exe -sS -H "Host: 127.0.0.1" -H "X-Forwarded-Proto: https" http://127.0.0.1:8000/health/
```

`Deploy-Release.ps1` rejects staged `db.sqlite3`, `.env`, `__pycache__`, `.git`,
`_scratch` and reserved device names, and `Build-PublicSite.ps1` copies only the
manifest paths with hash verification, refusing stale hashes, extra files and
non-empty destinations.

Two probes prove the route is coherent: `/` returns the public package index from
`current\public`, and a private path such as `/backend/settings.py`, `/.env` or
`/deploy/windows/Start-OuroNex.ps1` returns 404. If a private path returns
content, stop and fix the static configuration before exposing the site.

---

## 9. Update procedure (repeatable, no data loss)

One release name per update. Stage the new release first while the current release
keeps serving, then back up, stop, activate, install requirements, migrate,
refresh static files, preflight, start and verify. Never run migrations against the
old running service.

```powershell
$Release = Get-Date -Format 'yyyyMMdd-HHmm'
$Stage   = "D:\build\$Release"

# 1. Stage the new release (the running service is untouched).
New-Item -ItemType Directory -Path $Stage -Force | Out-Null
robocopy D:\Development\OuroNex-Official-Website "$Stage\app" /E `
    /XD .git _scratch __pycache__ .venv venv staticfiles exports `
    /XF db.sqlite3 .env *.pyc NUL CON PRN AUX
if ($LASTEXITCODE -ge 8) { throw "robocopy failed: $LASTEXITCODE" }
.\deploy\windows\Build-PublicSite.ps1 -Destination "$Stage\public" `
    -ReportPath "D:\build\$Release-public-report.json"
if ($LASTEXITCODE -ne 0) { throw "public package build failed: $LASTEXITCODE" }
.\deploy\windows\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName $Release `
    -StagedReleasePath $Stage -WhatIf
if ($LASTEXITCODE -ne 0) { throw "release dry run failed: $LASTEXITCODE" }
.\deploy\windows\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName $Release `
    -StagedReleasePath $Stage
if ($LASTEXITCODE -ne 0) { throw "release staging failed: $LASTEXITCODE" }

# 2. Back up the live database: this is the data rollback point.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
.\deploy\windows\Backup-SqliteDatabase.ps1 `
    -DatabasePath D:\OuroNex\shared\data\ouronex.sqlite3 `
    -Destination "D:\OuroNex\shared\backups\ouronex-$stamp.sqlite3" `
    -PythonExe D:\OuroNex\shared\venv\Scripts\python.exe
if ($LASTEXITCODE -ne 0) { throw "backup failed: $LASTEXITCODE" }

# 3. Stop the service before switching code or touching the schema.
Stop-Service OuroNex

# 4. Activate the staged release (junction switch only; shared data untouched).
.\deploy\windows\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName $Release -ActivateOnly
if ($LASTEXITCODE -ne 0) { throw "activation failed: $LASTEXITCODE" }

# 5. Install the new release requirements inside the stopped maintenance window.
$py  = 'D:\OuroNex\shared\venv\Scripts\python.exe'
$app = 'D:\OuroNex\current\app\backend'
& $py -m pip install -r "$app\requirements.txt"
if ($LASTEXITCODE -ne 0) { throw "requirements install failed: $LASTEXITCODE" }

# 6. Load the shared settings into this session (values are not printed).
Get-Content D:\OuroNex\shared\config\.env |
    Where-Object { $_ -match '^OURONEX_[A-Z0-9_]+=' } |
    ForEach-Object { $k, $v = $_ -split '=', 2; Set-Item "Env:$k" $v.Trim() }

# 7. Migrate with the old service already stopped.
& $py $app\manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { throw "migrate failed: $LASTEXITCODE" }

# 8. Refresh the static files for the new release.
& $py $app\manage.py collectstatic --noinput
if ($LASTEXITCODE -ne 0) { throw "collectstatic failed: $LASTEXITCODE" }

# 9. Preflight the new release before it serves traffic.
.\deploy\windows\Start-OuroNex.ps1 -CheckOnly -ConfigFile D:\OuroNex\shared\config\.env `
    -AppRoot D:\OuroNex\current\app\backend -PythonExe $py
if ($LASTEXITCODE -ne 0) { throw "preflight failed: $LASTEXITCODE" }

# 10. Start and verify.
Start-Service OuroNex
curl.exe -sS -H "Host: 127.0.0.1" -H "X-Forwarded-Proto: https" http://127.0.0.1:8000/health/
```

Then run the verification checklist in section 10. Never run migrations while the
previous release is still serving, and never skip the backup: a migration that
needs a rollback can only be undone with a pre-update snapshot. Release directories
stay on disk until deliberately archived, so rollback never needs a rebuild.

---

## 10. Verification checklist

Run after every start, certificate change or update:

| Check | Command | Expected |
| --- | --- | --- |
| Launcher preflight | `Start-OuroNex.ps1 ... -CheckOnly` | exit 0, `Checks passed`, secret hidden, health command printed |
| Waitress local | `curl.exe -sS -H "Host: 127.0.0.1" -H "X-Forwarded-Proto: https" http://127.0.0.1:8000/health/` | `{"status": "ok"}` without an HTTPS redirect |
| Site through IIS | `Invoke-WebRequest https://<internal-hostname>/ -UseBasicParsing` | 200, Home page from `current\public` |
| Public asset | `Invoke-WebRequest https://<internal-hostname>/assets/site.css -UseBasicParsing` | 200, `text/css` (served by Django) |
| Static exception | `Invoke-WebRequest https://<internal-hostname>/static/admin/css/base.css -UseBasicParsing` | 200 from IIS; no Waitress log line for it |
| Private file probe | request `/backend/settings.py`, `/.env`, `/deploy/windows/Start-OuroNex.ps1` | 404 for each |
| Root files | request `/sitemap.xml`, `/robots.txt`, `/site.webmanifest` | 200 from the manifest allowlist |
| Login/CSRF | log in through the browser form | success; a CSRF failure means `X-Forwarded-Proto` or `OURONEX_CSRF_TRUSTED_ORIGINS` is wrong |
| Redirect after login | open `/dashboard/` while signed out, then sign in | returns to the dashboard, not an external URL |
| Token API | `POST /api/v1/auth/login/` with a test account, then `GET /api/v1/auth/me/` with `Authorization: Bearer` | token, then the same account |
| Service restart | `Restart-Service OuroNex`, then re-check `/health/` | recovers automatically, `shared\logs` shows a clean start |
| Database location | `Get-Item $env:OURONEX_DB_PATH` | file under `shared\data`, not under `releases` or the repository |
| Public package | inspect `releases\<name>\public` and the build report | only manifest paths, `privateFilesAbsent: true` |

---

## 11. Backup

The database is the only stateful part of the site (accounts, bearer tokens,
token usage, subscriptions). Take a backup before every update, before any
migration, and on a schedule (Task Scheduler running the same command under the
service account; keep at least 14 daily copies off the server).

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
.\deploy\windows\Backup-SqliteDatabase.ps1 `
    -DatabasePath D:\OuroNex\shared\data\ouronex.sqlite3 `
    -Destination "D:\OuroNex\shared\backups\ouronex-$stamp.sqlite3" `
    -PythonExe D:\OuroNex\shared\venv\Scripts\python.exe
```

The helper uses the SQLite online backup API, so the site keeps serving. Each run
takes an exclusive `<destination>.lock`, writes a unique
`<destination>.tmp-<pid>-<random>` snapshot in `shared\backups`, verifies
`PRAGMA integrity_check` and the schema, then publishes the file atomically without
ever replacing an existing backup. The `.sha256` sidecar is created exclusively as
well, and a concurrent run fails instead of overwriting the winner. Copy backups
off the server; a backup on the same disk does not survive disk loss.

If a run stops with "another backup is already running" or "refusing to overwrite",
confirm that no backup process is running before touching anything:

```powershell
Get-Process python -ErrorAction SilentlyContinue |
    Select-Object Id, StartTime, Path
Get-ChildItem D:\OuroNex\shared\backups -Filter *.lock -Force
Get-ChildItem D:\OuroNex\shared\backups -Filter *.tmp-* -Force
```

Only after confirming that no backup process is active may a stale `.lock` file be
removed with `Remove-Item <destination>.lock`; a leftover `.tmp-*` snapshot from a
hard kill may be removed the same way. Never delete a backup file, its `.sha256`
sidecar or the live database to clear an error: a finished backup may be the only
good copy, and the live database is never a disposable artefact. Retry afterwards
with a new timestamped destination.

---

## 12. Restore

A restore replaces the live database, so it only happens with the service
stopped. Verify the checksum before use:

```powershell
Stop-Service OuroNex                    # elevated operator action
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$db      = 'D:\OuroNex\shared\data\ouronex.sqlite3'
$backup  = 'D:\OuroNex\shared\backups\ouronex-20261031-031500.sqlite3'

# 1. Prove the backup is the file that was taken.
$expected = ((Get-Content "$backup.sha256" -Raw).Trim() -split '\s+')[0]
$actual   = (Get-FileHash $backup -Algorithm SHA256).Hash
if ($expected -ne $actual) { throw 'backup checksum mismatch: do not use this file' }

# 2. Move the current database aside (never delete it in place).
Move-Item $db "$db.before-restore-$stamp"
if (Test-Path "$db-wal") { Move-Item "$db-wal" "$db.before-restore-$stamp-wal" }
if (Test-Path "$db-shm") { Move-Item "$db-shm" "$db.before-restore-$stamp-shm" }

# 3. Put the backup in place, then start and verify.
Copy-Item $backup $db
Start-Service OuroNex
```

Then run the verification checklist and check that accounts created before the
backup still exist. Keep the `.before-restore-*` files until the next clean backup;
delete them deliberately, never automatically.

Restore trade-off: everything written after the backup timestamp is lost. Choose
the newest backup that is verified and accepted by the business owner.

---

## 13. Rollback and trade-offs

Two situations, two procedures. Both stop the service before changing code or
data, and both keep the failed release directory on disk for inspection.

No schema change: roll back by switching the release only.

```powershell
Stop-Service OuroNex
.\deploy\windows\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName 20261030-2300 -ActivateOnly
.\deploy\windows\Start-OuroNex.ps1 -ConfigFile D:\OuroNex\shared\config\.env `
    -AppRoot D:\OuroNex\current\app\backend `
    -PythonExe D:\OuroNex\shared\venv\Scripts\python.exe -CheckOnly
Start-Service OuroNex
```

Schema change already applied: the service must stay stopped while the database is
restored, and only then may the previous release be activated. Restoring over a
running service corrupts the database or leaves the old code reading a schema it
cannot handle.

```powershell
Stop-Service OuroNex
# restore the pre-update backup exactly as in section 12 (stop is step zero),
# then activate the previous release:
.\deploy\windows\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName 20261030-2300 -ActivateOnly
.\deploy\windows\Start-OuroNex.ps1 -ConfigFile D:\OuroNex\shared\config\.env `
    -AppRoot D:\OuroNex\current\app\backend `
    -PythonExe D:\OuroNex\shared\venv\Scripts\python.exe -CheckOnly
Start-Service OuroNex
```

| Situation | Action | Data impact |
| --- | --- | --- |
| Code/page regression, no migration applied | stop, activate the previous release, preflight, start | none; database untouched |
| Migration applied, new code broken | stop, put the pre-update backup back, activate the previous release, preflight, start | writes after the backup are lost |
| Public page or asset problem only | stop, activate the previous release (its `public\` is self-contained), start | none |
| Bad setting in `.env` | edit `shared\config\.env`, run `-CheckOnly`, start | none |
| Broken new release | after rollback, delete that release directory deliberately; `shared\` is unaffected | none |

Trade-offs to accept explicitly:

- Keeping SQLite means one writer at a time. Long admin exports or heavy write
  bursts can hit the busy timeout (`OURONEX_SQLITE_TIMEOUT_SECONDS`). Backups are
  online and do not block readers, but a restore requires a short service stop.
- Release directories accumulate. Archive old releases after a verified update;
  never delete the release `current` points at or the one you would roll back to.
- Switching `current` restarts the service (in-flight requests fail). Schedule
  updates in a quiet window.
- The public package must be rebuilt per release; editing files inside a release
  makes it non-reproducible and breaks the manifest hash guarantee.

---

## 14. Security and operations checklist

- [ ] `OURONEX_ENV=production`, `OURONEX_SECRET_KEY` a fresh value generated on
      the server, never committed and never pasted into a ticket.
- [ ] `.env` readable only by the service account and administrators (`icacls`),
      stored in `shared\config`, outside every release.
- [ ] `OURONEX_ALLOWED_HOSTS` lists the real hostnames only, no wildcard.
- [ ] `OURONEX_CSRF_TRUSTED_ORIGINS` lists the exact HTTPS origins in use.
- [ ] `OURONEX_DB_PATH` points under `shared\data`, outside `releases`.
- [ ] Waitress bound to `127.0.0.1`; no inbound firewall rule for port 8000.
- [ ] IIS is the only public listener; ARR proxy enabled; `X-Forwarded-Proto`
      delivered (login/CSRF works over HTTPS); `/static/` served by IIS only.
- [ ] HSTS (`OURONEX_SECURE_HSTS_SECONDS`) still `0` until HTTPS is proven, then
      enabled deliberately.
- [ ] Certificates renew automatically; renewal failure is alerted.
- [ ] Backups exist, are verified, and at least one copy is off the server.
- [ ] `shared\logs` has a retention policy; logs contain no setting values.
- [ ] The release you would roll back to still exists on disk.
- [ ] `.env`, `db.sqlite3`, `backend/staticfiles`, `_scratch` never enter git and
      never enter a staged release (the helper rejects them).
- [ ] The service runs as the dedicated low-privilege account, not an
      administrator.

---

## 15. Troubleshooting

| Symptom | Likely cause | First check |
| --- | --- | --- |
| Service stops immediately | configuration rejected | run `Start-OuroNex.ps1 ... -CheckOnly`; the message names the offending `OURONEX_*` name, never its value |
| `still contains an unresolved <...> placeholder` | `.env` still holds template text | replace the placeholder with the real value, then preflight again |
| `waitress is not installed` | requirements not installed in `shared\venv` | `pip install -r ...\backend\requirements.txt` |
| `refusing to bind 0.0.0.0` | someone changed the bind address | keep `127.0.0.1`; IIS handles public traffic |
| IIS returns 502.3 | ARR proxy disabled, wrong port, or Waitress down | loopback health command on the server, ARR proxy setting |
| `/static/` returns 404 from IIS | virtual directory missing or pointing at an old path | `appcmd list vdir`, target `current\app\backend\staticfiles` |
| `/static/` requests appear in the Waitress log | static rule missing or placed after the proxy rule | rule order in `shared\iis\web.config` |
| 400 Bad Request from the app | host header not in `OURONEX_ALLOWED_HOSTS` | add the hostname, preflight, start |
| CSRF verification failed over HTTPS | `X-Forwarded-Proto` missing or origin not trusted | proxy rule server variable, `OURONEX_CSRF_TRUSTED_ORIGINS` |
| Login loop / cookie not set | secure cookie over a plain HTTP request | always use `https://<hostname>`, never the loopback URL in the browser |
| Local health probe returns a redirect | probe sent without `X-Forwarded-Proto: https` | use the launcher's printed `curl.exe` command |
| `database is locked` | long migration/backup or two writers | check service instances, `OURONEX_SQLITE_TIMEOUT_SECONDS`, running jobs |
| `database file not found` on backup | wrong `OURONEX_DB_PATH` | compare `.env` with `Get-Item`; the helper never creates the database |
| `manifest hash is stale` | source changed after the manifest was generated | regenerate `package-manifest.json`, rebuild the package |
| `release already exists` | reused release name | pick a new timestamp name; use `-ActivateOnly` to switch |
| `current is a real directory` | manual copy replaced the junction | move the directory away manually, then `-ActivateOnly` |

Logs: `shared\logs` (wrapper log plus stdout/stderr from the launcher).

---

## 16. Server-side steps that remain unexecuted

No item in this list was performed by this repository:

- Installing or configuring IIS, ARR, URL Rewrite, application pools, sites,
  bindings or the `/static/` virtual directory.
- Creating `shared\iis\web.config` or any rewrite rule.
- Creating, installing, starting, stopping or restarting the `OuroNex` service
  (WinSW or NSSM).
- Creating firewall rules, opening or closing ports, or changing RDP exposure.
- Creating or editing DNS records at GoDaddy or in an internal DNS zone, and
  editing client `hosts` files.
- Requesting, installing, binding or renewing TLS certificates, or enabling HSTS.
- Creating `D:\OuroNex`, `shared\venv`, the shared `.env`, backups or any
  production database, and running `migrate`, `collectstatic` or `check --deploy`
  against a server.
- Any elevated command, and any access to production settings.

The project-side scripts and this runbook are the preparation for those steps; the
first real deployment is an operator task on the target server.