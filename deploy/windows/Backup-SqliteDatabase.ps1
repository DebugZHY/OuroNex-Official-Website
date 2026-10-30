#requires -Version 5.1
<#
.SYNOPSIS
    Takes a verified online backup of the live OuroNex SQLite database.

.DESCRIPTION
    Wraps `sqlite_online_backup.py`, which uses the SQLite online backup API so the
    site keeps serving while the snapshot is taken. This wrapper adds the
    operational checks and reporting:

      * the live database file must exist and be readable;
      * the destination file must not exist (backups are never overwritten, so an
        old good backup cannot be destroyed by a newer failed run);
      * the backup is produced by the helper, which verifies PRAGMA
        integrity_check and the schema before publishing it atomically;
      * the wrapper independently re-verifies the published file size, the
        checksum sidecar and the recorded integrity result;
      * a missing Python interpreter, a missing path or an unverifiable backup
        fails with a non-zero exit code and a clear message.

    This script never starts, stops or restarts the service and never touches IIS,
    firewall, DNS or certificates.

    Exit codes: 0 = verified backup published, 1 = invalid input/refused,
                2 = backup or verification failed.

.EXAMPLE
    PS> $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    PS> .\Backup-SqliteDatabase.ps1 `
            -DatabasePath D:\OuroNex\shared\data\ouronex.sqlite3 `
            -Destination "D:\OuroNex\shared\backups\ouronex-$stamp.sqlite3" `
            -PythonExe D:\OuroNex\shared\venv\Scripts\python.exe
#>
[CmdletBinding()]
param(
    # Live SQLite database, normally the OURONEX_DB_PATH value of the running service.
    [Parameter(Mandatory = $true)]
    [string]$DatabasePath,

    # Backup file to create. The file must not exist yet.
    [Parameter(Mandatory = $true)]
    [string]$Destination,

    # Python interpreter that has the application environment (venv preferred).
    [string]$PythonExe,

    # SQLite busy timeout in seconds passed to the helper.
    [ValidateRange(1, 86400)]
    [int]$TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'

$script:Helper = Join-Path $PSScriptRoot 'sqlite_online_backup.py'

function Stop-Backup {
    param([string]$Message, [int]$Code = 1)
    [Console]::Error.WriteLine("BACKUP-SQLITE ERROR: $Message")
    exit $Code
}

function Resolve-FullPath {
    param([string]$Path, [string]$BasePath)
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'path is empty' }
    if (-not [System.IO.Path]::IsPathRooted($Path)) { $Path = Join-Path $BasePath $Path }
    return [System.IO.Path]::GetFullPath($Path)
}

if (-not (Test-Path -LiteralPath $script:Helper -PathType Leaf)) {
    Stop-Backup "helper script missing: $script:Helper (keep deploy\windows\sqlite_online_backup.py next to this wrapper)" 1
}

$databaseFull = Resolve-FullPath -Path $DatabasePath -BasePath (Get-Location).ProviderPath
if (-not (Test-Path -LiteralPath $databaseFull -PathType Leaf)) {
    Stop-Backup "database file not found: $databaseFull (check OURONEX_DB_PATH; a missing file is never created by the backup helper)" 1
}

$destinationFull = Resolve-FullPath -Path $Destination -BasePath (Get-Location).ProviderPath
if (Test-Path -LiteralPath $destinationFull) {
    Stop-Backup "refusing to overwrite an existing backup: $destinationFull (choose a new timestamped file name)" 1
}
if (Test-Path -LiteralPath "$destinationFull.sha256") {
    Stop-Backup "refusing to overwrite an existing backup checksum: $destinationFull.sha256" 1
}
if ($databaseFull -eq $destinationFull) {
    Stop-Backup "destination must differ from the live database: $destinationFull" 1
}
$destinationDir = Split-Path -Parent $destinationFull
if (Test-Path -LiteralPath $destinationDir -PathType Leaf) {
    Stop-Backup "destination directory is a file, not a directory: $destinationDir" 1
}

if ([string]::IsNullOrWhiteSpace($PythonExe)) {
    $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
    if (-not $pythonCommand) {
        Stop-Backup "python executable not found on PATH; pass -PythonExe with the application virtual environment (for example D:\OuroNex\shared\venv\Scripts\python.exe)" 1
    }
    $PythonExe = $pythonCommand.Source
}
else {
    $PythonExe = Resolve-FullPath -Path $PythonExe -BasePath (Get-Location).ProviderPath
    if (-not (Test-Path -LiteralPath $PythonExe -PathType Leaf)) {
        Stop-Backup "python executable not found: $PythonExe" 1
    }
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $PythonExe
$psi.Arguments = @(
    ('"' + $script:Helper + '"'),
    '--database', ('"' + $databaseFull + '"'),
    '--destination', ('"' + $destinationFull + '"'),
    '--timeout', "$TimeoutSeconds"
) -join ' '
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true
$psi.WorkingDirectory = $PSScriptRoot

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $psi
try {
    [void]$process.Start()
}
catch {
    Stop-Backup "python could not be started ($PythonExe): $($_.Exception.Message)" 1
}
$stderrTask = $process.StandardError.ReadToEndAsync()
$stdout = $process.StandardOutput.ReadToEnd()
$process.WaitForExit()
$stderr = $stderrTask.Result

if ($process.ExitCode -ne 0) {
    $reason = ($stderr + $stdout).Trim()
    if ([string]::IsNullOrWhiteSpace($reason)) { $reason = "helper exited with code $($process.ExitCode) without a message" }
    Stop-Backup "backup failed: $reason" 2
}

# ------------------------------------------------- independent post-checks
if (-not (Test-Path -LiteralPath $destinationFull -PathType Leaf)) {
    Stop-Backup "backup cannot be verified: no file was created at $destinationFull" 2
}
$backupItem = Get-Item -LiteralPath $destinationFull
if ($backupItem.Length -le 0) {
    Stop-Backup "backup cannot be verified: the file is empty: $destinationFull" 2
}
$sidecarPath = "$destinationFull.sha256"
if (-not (Test-Path -LiteralPath $sidecarPath -PathType Leaf)) {
    Stop-Backup "backup cannot be verified: missing checksum sidecar $sidecarPath" 2
}
$actualHash = (Get-FileHash -LiteralPath $destinationFull -Algorithm SHA256).Hash.ToLowerInvariant()
$recordedHash = ((Get-Content -LiteralPath $sidecarPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
if ($recordedHash -ne $actualHash) {
    Stop-Backup "backup cannot be verified: checksum sidecar ($recordedHash) does not match the file ($actualHash)" 2
}
if ($stdout -notmatch 'integrity=ok') {
    Stop-Backup "backup cannot be verified: the helper did not report a successful integrity check" 2
}

$rows = ''
if ($stdout -match 'rows=([^\r\n]*)') { $rows = $Matches[1].Trim() }
Write-Host ''
Write-Host 'SQLite backup verified.' -ForegroundColor Green
Write-Host "  source          : $databaseFull"
Write-Host "  backup          : $destinationFull"
Write-Host "  bytes           : $($backupItem.Length)"
Write-Host "  sha256          : $actualHash"
Write-Host "  checksum sidecar: $sidecarPath"
Write-Host '  integrity check : ok (online backup API, atomic rename)'
if ($rows) { Write-Host "  row counts      : $rows" }
Write-Host '  the live database and the service were not stopped, moved or modified by this backup.'

exit 0