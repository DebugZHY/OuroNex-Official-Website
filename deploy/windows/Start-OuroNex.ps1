#requires -Version 5.1
<#
.SYNOPSIS
    Loads the shared OuroNex environment file, validates it fail-closed, and runs
    the application with Waitress on loopback for WinSW/NSSM to supervise.

.DESCRIPTION
    This is the one and only application launcher. A service wrapper such as WinSW
    (see ouronex-service.xml) or NSSM runs exactly this file; nothing else starts
    the site in production.

    Sequence:
      1. read KEY=VALUE pairs from the shared .env (never prints values);
      2. validate the OURONEX_* settings (production fails closed);
      3. export the values to the child process only;
      4. verify python, Waitress, Django and the application directory;
      5. run deploy\windows\waitress_app.py bound to 127.0.0.1 in the foreground.

    -CheckOnly performs steps 1-4 and exits 0 without binding a socket, which is
    the recommended preflight before restarting the service.

    Exit codes: 0 = served until stopped, or preflight passed, 1 = invalid input,
                2 = configuration/verification failure.

.EXAMPLE
    PS> .\Start-OuroNex.ps1 -ConfigFile D:\OuroNex\shared\config\.env -CheckOnly

.EXAMPLE
    PS> .\Start-OuroNex.ps1 -ConfigFile D:\OuroNex\shared\config\.env `
            -AppRoot D:\OuroNex\current\app\backend `
            -PythonExe D:\OuroNex\shared\venv\Scripts\python.exe
#>
[CmdletBinding()]
param(
    # Shared environment file, for example D:\OuroNex\shared\config\.env.
    [Parameter(Mandatory = $true)]
    [string]$ConfigFile,

    # Python interpreter of the application virtual environment.
    [string]$PythonExe,

    # Loopback port IIS/ARR proxies to. Never exposed directly.
    [ValidateRange(1, 65535)]
    [int]$Port = 8000,

    # Waitress worker threads.
    [ValidateRange(1, 256)]
    [int]$Threads = 8,

    # Release backend directory (contains manage.py and backend\wsgi.py).
    # Defaults to the repository backend directory next to this script.
    [string]$AppRoot,

    # Validate everything and exit 0 without starting Waitress.
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'

$script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:EntryPoint = Join-Path $PSScriptRoot 'waitress_app.py'
$script:BindHost = '127.0.0.1'

# Local health probe. Production enables SECURE_SSL_REDIRECT, so a plain loopback
# request is answered with a redirect to https and looks like a failure. Send the
# headers IIS sends so the probe sees the same request the public site sees.
$script:HealthCommand = 'curl.exe -sS -H "Host: 127.0.0.1" -H "X-Forwarded-Proto: https" http://' + $script:BindHost + ':' + $Port + '/health/'

function Stop-Launch {
    param([string]$Message, [int]$Code = 2)
    [Console]::Error.WriteLine("START-OURONEX ERROR: $Message")
    exit $Code
}

function Resolve-FullPath {
    param([string]$Path, [string]$BasePath)
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'path is empty' }
    if (-not [System.IO.Path]::IsPathRooted($Path)) { $Path = Join-Path $BasePath $Path }
    return [System.IO.Path]::GetFullPath($Path)
}

function Test-PathInside {
    param([string]$Candidate, [string]$Parent)
    $c = $Candidate.TrimEnd('\', '/')
    $p = $Parent.TrimEnd('\', '/')
    if ($c -eq $p) { return $true }
    return $c.StartsWith($p + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-RealPath {
    # Resolve a path through existing junctions (notably current) when possible.
    # The Python preflight remains the final authority for path safety.
    param([string]$Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    $existing = $full
    $parts = New-Object System.Collections.Generic.List[string]
    while (-not (Test-Path -LiteralPath $existing)) {
        $parent = Split-Path -Parent $existing
        if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $existing) { return $full }
        $parts.Insert(0, (Split-Path -Leaf $existing))
        $existing = $parent
    }
    $item = Get-Item -LiteralPath $existing -Force
    $targetProperty = $item.PSObject.Properties['Target']
    $resolved = $existing
    if ($null -ne $targetProperty -and -not [string]::IsNullOrWhiteSpace([string]$targetProperty.Value)) {
        $resolved = [string]$targetProperty.Value
    }
    foreach ($part in $parts) { $resolved = Join-Path $resolved $part }
    return [System.IO.Path]::GetFullPath($resolved)
}

function Test-PositiveInteger {
    param([string]$Value)
    $parsed = 0
    return ([int]::TryParse($Value, [ref]$parsed) -and $parsed -gt 0)
}

function Test-NonNegativeInteger {
    param([string]$Value)
    $parsed = 0
    return ([int]::TryParse($Value, [ref]$parsed) -and $parsed -ge 0)
}

function Test-PositiveNumber {
    param([string]$Value)
    if ($Value -notmatch '^[0-9]+(\.[0-9]+)?$') { return $false }
    $parsed = 0.0
    return ([double]::TryParse($Value, [ref]$parsed) -and $parsed -gt 0)
}

function Read-EnvFile {
    param([string]$Path)
    $values = [ordered]@{}
    $lineNumber = 0
    foreach ($line in (Get-Content -LiteralPath $Path -Encoding UTF8)) {
        $lineNumber++
        $trimmed = $line.Trim()
        if ($trimmed -eq '') { continue }
        if ($trimmed.StartsWith('#')) { continue }
        if ($trimmed -match '^export\s+') {
            throw "line ${lineNumber}: remove the 'export ' prefix; the file must contain plain KEY=VALUE lines"
        }
        if ($trimmed -notmatch '^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$') {
            throw "line ${lineNumber} is not a KEY=VALUE pair"
        }
        $key = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        if ($values.Contains($key)) {
            throw "line ${lineNumber}: duplicate key $key; keep exactly one line per key"
        }
        $values[$key] = $value
    }
    return $values
}

# ------------------------------------------------------------------ config file
if (-not (Test-Path -LiteralPath $script:EntryPoint -PathType Leaf)) {
    Stop-Launch "entry point missing: $script:EntryPoint (deploy\windows must be kept together)" 1
}
$configFull = Resolve-FullPath -Path $ConfigFile -BasePath (Get-Location).ProviderPath
if (-not (Test-Path -LiteralPath $configFull -PathType Leaf)) {
    Stop-Launch "config file not found: $configFull (pass -ConfigFile with the shared .env, for example D:\OuroNex\shared\config\.env)" 1
}
try {
    $values = Read-EnvFile -Path $configFull
}
catch {
    Stop-Launch "config file cannot be read: $configFull ($($_.Exception.Message))" 1
}

$problems = New-Object System.Collections.Generic.List[string]
$warnings = New-Object System.Collections.Generic.List[string]

function Get-Value {
    param([string]$Key, [string]$Default = '')
    if ($values.Contains($Key)) { return $values[$Key] }
    return $Default
}

function Get-OptionalValue {
    # Returns $null when the key is absent, so optional numeric keys keep their
    # documented defaults instead of being validated as empty strings.
    param([string]$Key)
    if ($values.Contains($Key)) { return $values[$Key] }
    return $null
}

# --------------------------------------------------------------- settings checks
$envName = Get-Value -Key 'OURONEX_ENV' -Default 'development'
if ($envName -ne 'development' -and $envName -ne 'production') {
    $problems.Add("OURONEX_ENV must be 'development' or 'production' (found '$envName'); unknown values are rejected")
}
$isProduction = ($envName -eq 'production')

# A value such as <paste-50-or-more-random-characters-here> is template text, not a
# setting. Reject it by name before any length/format check so the operator is told
# what to fix instead of a misleading length error.
$placeholderKeys = New-Object System.Collections.Generic.List[string]
foreach ($key in $values.Keys) {
    if ($key -match '^OURONEX_' -and ([string]$values[$key]) -match '<[^<>]+>') {
        $placeholderKeys.Add($key)
        $problems.Add("$key still contains an unresolved <...> placeholder; replace it with the real value from your deployment notes (template text is never usable)")
    }
}
function Test-PlaceholderKey {
    param([string]$Key)
    return $placeholderKeys.Contains($Key)
}

$secretKey = Get-Value -Key 'OURONEX_SECRET_KEY' -Default ''
if ($isProduction -and -not (Test-PlaceholderKey 'OURONEX_SECRET_KEY')) {
    if ([string]::IsNullOrWhiteSpace($secretKey)) {
        $problems.Add('OURONEX_SECRET_KEY is required in production (value not shown)')
    }
    elseif ($secretKey.Length -lt 50) {
        $problems.Add("OURONEX_SECRET_KEY must be at least 50 characters in production (found $($secretKey.Length); value not shown)")
    }
    if ($secretKey -match 'django-insecure') {
        $problems.Add('OURONEX_SECRET_KEY still contains the development marker; generate a fresh production key (value not shown)')
    }
}

$allowedHosts = Get-Value -Key 'OURONEX_ALLOWED_HOSTS' -Default ''
if ($isProduction -and -not (Test-PlaceholderKey 'OURONEX_ALLOWED_HOSTS')) {
    if ([string]::IsNullOrWhiteSpace($allowedHosts)) {
        $problems.Add('OURONEX_ALLOWED_HOSTS is required in production (comma-separated hostnames, no wildcard)')
    }
    else {
        foreach ($hostEntry in ($allowedHosts -split ',')) {
            $h = $hostEntry.Trim()
            if ($h -eq '') { $problems.Add('OURONEX_ALLOWED_HOSTS contains an empty entry'); continue }
            if ($h.Contains('*')) { $problems.Add("OURONEX_ALLOWED_HOSTS must not contain a wildcard entry ('$h')") }
            elseif ($h -match '[/\\]' -or $h -match '^\w+://') { $problems.Add("OURONEX_ALLOWED_HOSTS entries must be bare hostnames or IPs, not URLs ('$h')") }
        }
        if (-not ($allowedHosts -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -eq '127.0.0.1' })) {
            $warnings.Add('OURONEX_ALLOWED_HOSTS does not list 127.0.0.1; the local health check will be rejected')
        }
    }
}

$csrfOrigins = Get-Value -Key 'OURONEX_CSRF_TRUSTED_ORIGINS' -Default ''
if ($isProduction -and -not (Test-PlaceholderKey 'OURONEX_CSRF_TRUSTED_ORIGINS')) {
    if ([string]::IsNullOrWhiteSpace($csrfOrigins)) {
        $problems.Add('OURONEX_CSRF_TRUSTED_ORIGINS is required in production (comma-separated https origins)')
    }
    else {
        foreach ($origin in ($csrfOrigins -split ',')) {
            $o = $origin.Trim()
            if ($o -eq '') { $problems.Add('OURONEX_CSRF_TRUSTED_ORIGINS contains an empty entry'); continue }
            if ($o -notmatch '^https://[A-Za-z0-9]([A-Za-z0-9.\-]*[A-Za-z0-9])?(:[0-9]{1,5})?$') {
                $problems.Add("OURONEX_CSRF_TRUSTED_ORIGINS entry must be an https origin without a path or wildcard ('$o')")
            }
            if ($o.Contains('*')) { $problems.Add("OURONEX_CSRF_TRUSTED_ORIGINS must not contain a wildcard ('$o')") }
        }
    }
}

# Resolve the app and complete release roots early so database checks cover
# both app\ and public\ inside the active release.
$appRootCandidate = $AppRoot
if ([string]::IsNullOrWhiteSpace($appRootCandidate)) { $appRootCandidate = Join-Path $script:RepoRoot 'backend' }
$releaseRoot = $null
$releaseRootLexical = $null
try {
    $appRootForCheck = Resolve-FullPath -Path $appRootCandidate -BasePath (Get-Location).ProviderPath
    $appRootReal = Resolve-RealPath -Path $appRootForCheck
    $releaseRoot = Split-Path -Parent (Split-Path -Parent $appRootReal)
    $releaseRootLexical = Split-Path -Parent (Split-Path -Parent $appRootForCheck)
}
catch {
    $releaseRoot = $null
    $releaseRootLexical = $null
}

$databasePath = Get-Value -Key 'OURONEX_DB_PATH' -Default ''
if ($isProduction -and -not (Test-PlaceholderKey 'OURONEX_DB_PATH')) {
    if ([string]::IsNullOrWhiteSpace($databasePath)) {
        $problems.Add('OURONEX_DB_PATH is required in production (absolute path to the SQLite file outside the repository)')
    }
    else {
        if (-not [System.IO.Path]::IsPathRooted($databasePath)) {
            $problems.Add("OURONEX_DB_PATH must be an absolute path (found a relative path: '$databasePath')")
        }
        else {
            $databaseFull = [System.IO.Path]::GetFullPath($databasePath)
            $databaseReal = $databaseFull
            try { $databaseReal = Resolve-RealPath -Path $databaseFull }
            catch { $databaseReal = $databaseFull }
            $insideRepository = (Test-PathInside -Candidate $databaseFull -Parent $script:RepoRoot) -or (Test-PathInside -Candidate $databaseReal -Parent $script:RepoRoot)
            if ($insideRepository) {
                $problems.Add("OURONEX_DB_PATH must be outside the repository; '$databaseReal' would be deleted by an update")
            }
            $insideRelease = ($releaseRoot -and (Test-PathInside -Candidate $databaseReal -Parent $releaseRoot)) -or ($releaseRootLexical -and (Test-PathInside -Candidate $databaseFull -Parent $releaseRootLexical))
            if ($insideRelease) {
                $problems.Add("OURONEX_DB_PATH must be outside the complete release root (app and public); '$databaseReal' would be deleted by an update (keep it in shared\data)")
            }
            if ($databaseFull -match '\\releases\\' -or $databaseReal -match '\\releases\\') {
                $problems.Add("OURONEX_DB_PATH must not live inside a release directory; keep the database in shared\data ('$databaseReal')")
            }
            $databaseDir = Split-Path -Parent $databaseFull
            if (-not (Test-Path -LiteralPath $databaseDir -PathType Container)) {
                $problems.Add("OURONEX_DB_PATH parent directory does not exist: $databaseDir (create shared\data first)")
            }
            if (Test-Path -LiteralPath $databaseFull -PathType Container) {
                $problems.Add("OURONEX_DB_PATH points at a directory, not a file: $databaseFull")
            }
        }
    }
}

$sqliteTimeout = Get-OptionalValue -Key 'OURONEX_SQLITE_TIMEOUT_SECONDS'
if (-not (Test-PlaceholderKey 'OURONEX_SQLITE_TIMEOUT_SECONDS') -and $null -ne $sqliteTimeout -and -not (Test-PositiveNumber $sqliteTimeout)) {
    $problems.Add("OURONEX_SQLITE_TIMEOUT_SECONDS must be a positive number (found '$sqliteTimeout')")
}

$tokenTtl = Get-OptionalValue -Key 'OURONEX_AUTH_TOKEN_TTL_SECONDS'
if (-not (Test-PlaceholderKey 'OURONEX_AUTH_TOKEN_TTL_SECONDS') -and $null -ne $tokenTtl -and -not (Test-PositiveInteger $tokenTtl)) {
    $problems.Add("OURONEX_AUTH_TOKEN_TTL_SECONDS must be a positive integer (found '$tokenTtl')")
}

$hsts = Get-OptionalValue -Key 'OURONEX_SECURE_HSTS_SECONDS'
if (-not (Test-PlaceholderKey 'OURONEX_SECURE_HSTS_SECONDS') -and $null -ne $hsts) {
    if (-not (Test-NonNegativeInteger $hsts)) {
        $problems.Add("OURONEX_SECURE_HSTS_SECONDS must be a non-negative integer (found '$hsts')")
    }
    elseif ([int]$hsts -gt 0) {
        $warnings.Add('OURONEX_SECURE_HSTS_SECONDS is above 0; enable HSTS only after HTTPS through IIS has been verified')
    }
}

$trustedProxies = Get-Value -Key 'OURONEX_TRUSTED_PROXY_IPS' -Default '127.0.0.1,::1'
if ($isProduction -and [string]::IsNullOrWhiteSpace($trustedProxies) -and -not (Test-PlaceholderKey 'OURONEX_TRUSTED_PROXY_IPS')) {
    $problems.Add('OURONEX_TRUSTED_PROXY_IPS must list the loopback proxy addresses (127.0.0.1,::1)')
}
else {
    foreach ($proxy in ($trustedProxies -split ',')) {
        $p = $proxy.Trim()
        if ($p -eq '') { continue }
        $address = $null
        if (-not [System.Net.IPAddress]::TryParse($p, [ref]$address)) {
            $problems.Add("OURONEX_TRUSTED_PROXY_IPS entry is not a valid IP address ('$p')")
        }
    }
    if (-not ($trustedProxies -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -eq '127.0.0.1' })) {
        $warnings.Add('OURONEX_TRUSTED_PROXY_IPS does not include 127.0.0.1; IIS ARR proxy headers will not be trusted')
    }
}

$maxAttempts = Get-OptionalValue -Key 'OURONEX_AUTH_MAX_ATTEMPTS'
if (-not (Test-PlaceholderKey 'OURONEX_AUTH_MAX_ATTEMPTS') -and $null -ne $maxAttempts -and -not (Test-PositiveInteger $maxAttempts)) {
    $problems.Add("OURONEX_AUTH_MAX_ATTEMPTS must be a positive integer (found '$maxAttempts')")
}
$authWindow = Get-OptionalValue -Key 'OURONEX_AUTH_WINDOW_SECONDS'
if (-not (Test-PlaceholderKey 'OURONEX_AUTH_WINDOW_SECONDS') -and $null -ne $authWindow -and -not (Test-PositiveInteger $authWindow)) {
    $problems.Add("OURONEX_AUTH_WINDOW_SECONDS must be a positive integer (found '$authWindow')")
}

$knownKeys = @(
    'OURONEX_ENV', 'OURONEX_SECRET_KEY', 'OURONEX_ALLOWED_HOSTS', 'OURONEX_CSRF_TRUSTED_ORIGINS',
    'OURONEX_DB_PATH', 'OURONEX_SQLITE_TIMEOUT_SECONDS', 'OURONEX_AUTH_TOKEN_TTL_SECONDS',
    'OURONEX_SECURE_HSTS_SECONDS', 'OURONEX_TRUSTED_PROXY_IPS', 'OURONEX_AUTH_MAX_ATTEMPTS',
    'OURONEX_AUTH_WINDOW_SECONDS'
)
foreach ($key in $values.Keys) {
    if ($key -notmatch '^OURONEX_') {
        $warnings.Add("ignoring non-OuroNex key '$key' in the config file")
    }
    elseif ($knownKeys -notcontains $key) {
        $warnings.Add("unrecognised OURONEX_ key '$key' is passed through without validation")
    }
}

if ($problems.Count -gt 0) {
    $detail = ($problems | ForEach-Object { "  - $_" }) -join [Environment]::NewLine
    [Console]::Error.WriteLine("START-OURONEX ERROR: configuration rejected ($($problems.Count) problem(s)); the service will not start:")
    [Console]::Error.WriteLine($detail)
    [Console]::Error.WriteLine('  see docs\WINDOWS_SERVER_DEPLOYMENT.md and .env.example; secret values are never printed')
    exit 2
}

# ------------------------------------------------------- export to the child
foreach ($key in $values.Keys) {
    if ($key -match '^OURONEX_') {
        Set-Item -Path ("Env:" + $key) -Value ([string]$values[$key])
    }
}

# ------------------------------------------------------------ python + layout
if ([string]::IsNullOrWhiteSpace($PythonExe)) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        Stop-Launch "python executable not found on PATH; pass -PythonExe with the application virtual environment (for example D:\OuroNex\shared\venv\Scripts\python.exe)" 1
    }
    $PythonExe = $pythonCommand.Source
}
else {
    $PythonExe = Resolve-FullPath -Path $PythonExe -BasePath (Get-Location).ProviderPath
    if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
        Stop-Launch "python executable not found: $PythonExe" 1
    }
}

if ([string]::IsNullOrWhiteSpace($AppRoot)) {
    $AppRoot = Join-Path $script:RepoRoot 'backend'
}
$appRootFull = Resolve-FullPath -Path $AppRoot -BasePath (Get-Location).ProviderPath
if (-not (Test-Path -LiteralPath $appRootFull -PathType Container)) {
    Stop-Launch "application directory not found: $appRootFull (pass -AppRoot with the release backend directory, for example D:\OuroNex\current\app\backend)" 1
}
if (-not (Test-Path -LiteralPath (Join-Path $appRootFull 'backend\wsgi.py') -PathType Leaf)) {
    Stop-Launch "release is incomplete: $appRootFull\backend\wsgi.py is missing" 1
}

# ------------------------------------------------------------- preflight check
$checkArgs = @(
    ('"' + $script:EntryPoint + '"'),
    '--check',
    '--host', $script:BindHost,
    '--port', "$Port",
    '--threads', "$Threads",
    '--app-root', ('"' + $appRootFull + '"')
) -join ' '

$checkInfo = New-Object System.Diagnostics.ProcessStartInfo
$checkInfo.FileName = $PythonExe
$checkInfo.Arguments = $checkArgs
$checkInfo.UseShellExecute = $false
$checkInfo.RedirectStandardOutput = $true
$checkInfo.RedirectStandardError = $true
$checkInfo.CreateNoWindow = $true
$checkInfo.WorkingDirectory = $PSScriptRoot
$checkProcess = New-Object System.Diagnostics.Process
$checkProcess.StartInfo = $checkInfo
try {
    [void]$checkProcess.Start()
}
catch {
    Stop-Launch "python could not be started ($PythonExe): $($_.Exception.Message)" 1
}
$checkErrTask = $checkProcess.StandardError.ReadToEndAsync()
$checkOut = $checkProcess.StandardOutput.ReadToEnd()
$checkProcess.WaitForExit()
$checkErr = $checkErrTask.Result
if ($checkProcess.ExitCode -ne 0) {
    $reason = ($checkErr + $checkOut).Trim()
    if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "preflight exited with code $($checkProcess.ExitCode) without a message" }
    Stop-Launch "preflight failed: $reason" 2
}

# ------------------------------------------------------------------ summary
$maskedSecret = 'not set'
if (-not [string]::IsNullOrWhiteSpace($secretKey)) {
    $maskedSecret = "set, $($secretKey.Length) characters, value hidden"
}
$databaseDisplay = if ([string]::IsNullOrWhiteSpace($databasePath)) { '(development default: backend\db.sqlite3)' } else { $databasePath }

Write-Host ''
Write-Host 'OuroNex launcher preflight' -ForegroundColor Cyan
Write-Host "  config file    : $configFull"
Write-Host "  OURONEX_ENV    : $envName"
Write-Host "  secret key     : $maskedSecret (never printed)"
Write-Host "  allowed hosts  : $(if ([string]::IsNullOrWhiteSpace($allowedHosts)) { '(default)' } else { $allowedHosts })"
Write-Host "  csrf origins   : $(if ([string]::IsNullOrWhiteSpace($csrfOrigins)) { '(none)' } else { $csrfOrigins })"
Write-Host "  database       : $databaseDisplay"
Write-Host "  bind           : $($script:BindHost):$Port (loopback only; IIS/ARR is the public listener)"
Write-Host "  threads        : $Threads"
Write-Host "  python         : $PythonExe"
Write-Host "  app root       : $appRootFull"
Write-Host "  health check   : $script:HealthCommand"
Write-Host '                   (the forwarded proto header is required: production redirects plain loopback HTTP to https)'
foreach ($line in ($checkOut -split "`r?`n")) {
    if ($line.Trim() -ne '') { Write-Host "  $($line.Trim())" }
}
if ($warnings.Count -gt 0) {
    foreach ($warning in $warnings) { Write-Host "  WARNING: $warning" -ForegroundColor Yellow }
}
if ($isProduction -and -not (Test-Path -LiteralPath $databasePath)) {
    Write-Host "  NOTE: the database file does not exist yet; run manage.py migrate before the first start." -ForegroundColor Yellow
}
Write-Host "Checks passed: $($values.Count) config value(s) validated; no secret value was printed." -ForegroundColor Green

if ($CheckOnly) {
    Write-Host '-CheckOnly: preflight complete, Waitress was not started.' -ForegroundColor Green
    exit 0
}

# -------------------------------------------------------------------- serve
Write-Host 'Starting Waitress (foreground; the service wrapper supervises this process).' -ForegroundColor Cyan
$serveArgs = @(
    ('"' + $script:EntryPoint + '"'),
    '--host', $script:BindHost,
    '--port', "$Port",
    '--threads', "$Threads",
    '--app-root', ('"' + $appRootFull + '"'),
    '--trusted-proxy', '127.0.0.1'
) -join ' '

$serveInfo = New-Object System.Diagnostics.ProcessStartInfo
$serveInfo.FileName = $PythonExe
$serveInfo.Arguments = $serveArgs
$serveInfo.UseShellExecute = $false
$serveInfo.CreateNoWindow = $true
$serveInfo.WorkingDirectory = $PSScriptRoot
$serveProcess = New-Object System.Diagnostics.Process
$serveProcess.StartInfo = $serveInfo
try {
    [void]$serveProcess.Start()
}
catch {
    Stop-Launch "python could not be started ($PythonExe): $($_.Exception.Message)" 1
}
$serveProcess.WaitForExit()
exit $serveProcess.ExitCode