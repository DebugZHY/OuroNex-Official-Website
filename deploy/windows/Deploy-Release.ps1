#requires -Version 5.1
<#
.SYNOPSIS
    Stages a new OuroNex release and, when asked, switches the `current` junction.

.DESCRIPTION
    Deployment layout (fixed by docs\WINDOWS_SERVER_DEPLOYMENT.md):

        <DeploymentRoot>\
            releases\<ReleaseName>\
                app\        Django project (backend\manage.py, backend\backend\wsgi.py)
                public\     public package produced by Build-PublicSite.ps1
                release.json
            current         junction -> releases\<ReleaseName>
            shared\
                config\.env     operator-owned, never touched by this helper
                data\           SQLite database, never touched by this helper
                logs\           service logs
                backups\        SQLite backups
                venv\           python virtual environment (operator-created)

    Guarantees:
      * a new release directory is never reused: an existing
        releases\<ReleaseName> stops the run, so a rollback target cannot be
        destroyed by redeploying the same name;
      * shared\ is only created when missing. No file inside shared\ is ever
        created, copied, deleted or overwritten - the database, .env and logs
        survive every release;
      * the staged tree is validated first (app + public package present) and
        rejected if it contains a database, .env, __pycache__ or repository
        folders, so secrets and data cannot be shipped inside a release;
      * -WhatIf (alias -DryRun) validates everything and prints the plan without
        creating a single directory or file;
      * this helper never stops/starts the service, never runs migrations and
        never collects static files: those stay explicit operator commands;
      * `current` is only replaced when it is a junction created for that purpose.
        A real directory named current is refused and left untouched.

    Exit codes: 0 = staged/activated, 1 = invalid input/refused, 2 = verification failed.

.EXAMPLE
    PS> .\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName 20261031-0400 `
            -StagedReleasePath D:\build\ouronex-20261031-0400 -WhatIf

.EXAMPLE
    PS> .\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName 20261031-0400 `
            -StagedReleasePath D:\build\ouronex-20261031-0400 -Activate

.EXAMPLE
    # Roll back to the previous release without touching files
    PS> .\Deploy-Release.ps1 -DeploymentRoot D:\OuroNex -ReleaseName 20261030-2300 -ActivateOnly
#>
[CmdletBinding()]
param(
    # Deployment root that contains releases\, current and shared\.
    [Parameter(Mandatory = $true)]
    [string]$DeploymentRoot,

    # Release name, normally a timestamp such as 20261031-0400.
    [Parameter(Mandatory = $true)]
    [string]$ReleaseName,

    # Directory that already contains app\ and public\ for this release.
    [string]$StagedReleasePath,

    # Validate and print the plan, then exit without changing anything.
    [Alias('DryRun')]
    [switch]$WhatIf,

    # After staging a new release, switch the current junction to it.
    [switch]$Activate,

    # Switch current to an existing release only (used for rollback).
    [switch]$ActivateOnly
)

$ErrorActionPreference = 'Stop'

$script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Stop-Deploy {
    param([string]$Message, [int]$Code = 1)
    [Console]::Error.WriteLine("DEPLOY-RELEASE ERROR: $Message")
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

function Write-Plan {
    param([string]$Text)
    Write-Host "  [plan] $Text" -ForegroundColor Yellow
}

function Invoke-Cmd {
    param([string]$CommandLine)
    $output = & cmd.exe /c $CommandLine 2>&1 | Out-String
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = $output }
}

# ------------------------------------------------------------------- validate
if ($ReleaseName -notmatch '^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$') {
    Stop-Deploy "ReleaseName must be 1-64 characters of letters, digits, dot, dash or underscore and must start with a letter or digit (got '$ReleaseName')" 1
}

$rootFull = Resolve-FullPath -Path $DeploymentRoot -BasePath (Get-Location).ProviderPath
if (Test-Path -LiteralPath $rootFull -PathType Leaf) {
    Stop-Deploy "deployment root is a file, not a directory: $rootFull" 1
}
if (-not (Test-Path -LiteralPath $rootFull -PathType Container)) {
    Stop-Deploy "deployment root does not exist: $rootFull (create the deployment root before staging a release)" 1
}
if (Test-PathInside -Candidate $rootFull -Parent $script:RepoRoot) {
    Stop-Deploy "deployment root must not be inside the repository: $rootFull" 1
}

$releasesDir = Join-Path $rootFull 'releases'
$releaseDir = Join-Path $releasesDir $ReleaseName
$sharedDir = Join-Path $rootFull 'shared'
$currentPath = Join-Path $rootFull 'current'

if (Test-Path -LiteralPath $releasesDir -PathType Leaf) {
    Stop-Deploy "releases path is a file, not a directory: $releasesDir" 1
}
if (Test-Path -LiteralPath $currentPath -PathType Leaf) {
    Stop-Deploy "current exists as a file; move it away before deploying: $currentPath" 1
}
if ($ActivateOnly -and -not (Test-Path -LiteralPath $releaseDir -PathType Container)) {
    Stop-Deploy "cannot activate: release does not exist: $releaseDir" 1
}

$sharedFolders = @('config', 'data', 'logs', 'backups')

if ($ActivateOnly) {
    $mode = 'activate only'
}
else {
    $mode = 'stage'
    if ([string]::IsNullOrWhiteSpace($StagedReleasePath)) {
        Stop-Deploy 'a staged release directory is required: pass -StagedReleasePath (or -ActivateOnly to switch an existing release)' 1
    }
    $stagedFull = Resolve-FullPath -Path $StagedReleasePath -BasePath (Get-Location).ProviderPath
    if (-not (Test-Path -LiteralPath $stagedFull -PathType Container)) {
        Stop-Deploy "staged release not found or not a directory: $stagedFull" 1
    }
    if (Test-PathInside -Candidate $stagedFull -Parent $rootFull) {
        Stop-Deploy "staged release must live outside the deployment root (no recursive copies): $stagedFull" 1
    }

    $requiredFiles = @(
        'app\backend\manage.py',
        'app\backend\backend\wsgi.py',
        'public\index.html'
    )
    $missing = @()
    foreach ($rel in $requiredFiles) {
        if (-not (Test-Path -LiteralPath (Join-Path $stagedFull $rel) -PathType Leaf)) { $missing += $rel }
    }
    if ($missing.Count -gt 0) {
        Stop-Deploy ("staged release is incomplete; missing " + ($missing -join ', ') + " (the app tree and the public package must both be staged)") 1
    }

    # Private data, secrets and VCS leftovers must never travel inside a release.
    # package-manifest.json and .env.example are intentionally allowed: they are
    # part of the public build tooling, not secrets.
    $forbiddenNames = @('db.sqlite3', '.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519')
    $forbiddenDirs = @('_scratch', '.git', '__pycache__', 'node_modules', 'logs', 'backups')
    # Windows device names cannot be copied into a release directory.
    $reservedNames = @('con', 'prn', 'aux', 'nul') + @(1..9 | ForEach-Object { "com$_" }) + @(1..9 | ForEach-Object { "lpt$_" })
    $violations = New-Object System.Collections.Generic.List[string]
    $reserved = New-Object System.Collections.Generic.List[string]
    foreach ($item in (Get-ChildItem -LiteralPath $stagedFull -Recurse -Force)) {
        $relative = $item.FullName.Substring($stagedFull.Length + 1)
        $name = $item.Name.ToLowerInvariant()
        if ($reservedNames -contains $item.BaseName.ToLowerInvariant()) {
            $reserved.Add($relative)
        }
        if ($forbiddenNames -contains $name) {
            $violations.Add("$relative (shared data or secret: $name)")
        }
        elseif ($name -like '*.sqlite3' -or $name -like '*.sqlite3-wal' -or $name -like '*.sqlite3-shm') {
            $violations.Add("$relative (database file)")
        }
        elseif ($name -like '.env.*' -and $name -ne '.env.example') {
            $violations.Add("$relative (environment file)")
        }
        elseif ($item.PSIsContainer -and ($forbiddenDirs -contains $name)) {
            $violations.Add("$relative (private folder: $name)")
        }
        elseif (-not $item.PSIsContainer -and ($name -like '*.pyc' -or $name -like '*.pyo')) {
            $violations.Add("$relative (bytecode)")
        }
    }
    if ($reserved.Count -gt 0) {
        Stop-Deploy ("staged release contains Windows reserved device names that cannot be copied: " + ($reserved -join ', ') + ". Exclude them in the staging copy (for example robocopy /XF NUL) or delete the leftovers.") 1
    }
    if ($violations.Count -gt 0) {
        Stop-Deploy ("staged release contains shared data, secrets or repository leftovers: " + ($violations -join '; ')) 1
    }

    if (Test-Path -LiteralPath $releaseDir) {
        Stop-Deploy "release already exists: $releaseDir (release directories are never overwritten; use a new release name, or -ActivateOnly to switch to an existing one)" 1
    }
}

# ---------------------------------------------------------------- activate plan
$currentState = 'absent'
$currentTarget = $null
if (Test-Path -LiteralPath $currentPath) {
    $currentItem = Get-Item -LiteralPath $currentPath -Force
    if ($currentItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        $currentState = 'junction'
        $currentTarget = (@($currentItem.Target) -join ';')
    }
    else {
        $currentState = 'real-directory'
    }
}

# -------------------------------------------------------------------- dry run
if ($WhatIf) {
    Write-Host ''
    Write-Host "OuroNex release plan [$mode] (WhatIf: nothing will be created, copied or switched)" -ForegroundColor Cyan
    Write-Host "  deployment root : $rootFull"
    Write-Host "  release         : $ReleaseName"
    Write-Host "  release dir     : $releaseDir"
    if (-not $ActivateOnly) {
        Write-Host "  staged release  : $stagedFull"
        Write-Plan "create $releasesDir if missing"
        foreach ($folder in $sharedFolders) { Write-Plan "create $sharedDir\$folder if missing (existing files are never touched)" }
        Write-Plan "copy staged app\ and public\ into $releaseDir"
        Write-Plan "verify every copied file, then write $releaseDir\release.json"
    }
    if ($Activate -or $ActivateOnly) {
        if ($currentState -eq 'junction') { Write-Plan "remove the existing junction $currentPath (target stays on disk)" }
        if ($currentState -eq 'real-directory') {
            Write-Plan "REFUSE: $currentPath is a real directory; move it away first"
            Stop-Deploy "a dry run that would activate a release cannot continue: $currentPath is a real directory, not a junction. This helper never deletes it, so the activation would be unverifiable. Move it away manually, then rerun -ActivateOnly. No file, directory or junction was changed." 1
        }
        Write-Plan "create junction $currentPath -> $releaseDir"
    }
    Write-Plan 'NOT done by this helper: service stop/start, manage.py migrate, collectstatic'
    Write-Host ''
    Write-Host 'WhatIf complete: no file, directory, junction or service was changed.' -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------- stage copy
$copiedFiles = 0
if (-not $ActivateOnly) {
    Write-Host ''
    Write-Host "Staging release $ReleaseName into $releaseDir" -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $releasesDir)) {
        New-Item -ItemType Directory -Path $releasesDir -Force | Out-Null
    }
    foreach ($folder in $sharedFolders) {
        $sharedFolder = Join-Path $sharedDir $folder
        if (-not (Test-Path -LiteralPath $sharedFolder)) {
            New-Item -ItemType Directory -Path $sharedFolder -Force | Out-Null
            Write-Host "  created $sharedFolder"
        }
        else {
            Write-Host "  kept    $sharedFolder (existing content untouched)"
        }
    }

    try {
        Copy-Item -LiteralPath $stagedFull -Destination $releaseDir -Recurse -Force
    }
    catch {
        if (Test-Path -LiteralPath $releaseDir) {
            Remove-Item -LiteralPath $releaseDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Stop-Deploy "copy failed and the partial release was removed: $($_.Exception.Message)" 2
    }

    $stagedFiles = @(Get-ChildItem -LiteralPath $stagedFull -Recurse -File -Force)
    $releaseFiles = @(Get-ChildItem -LiteralPath $releaseDir -Recurse -File -Force)
    if ($releaseFiles.Count -ne $stagedFiles.Count) {
        Stop-Deploy "release verification failed: staged $($stagedFiles.Count) files but $($releaseFiles.Count) arrived" 2
    }
    foreach ($sourceFile in $stagedFiles) {
        $relative = $sourceFile.FullName.Substring($stagedFull.Length + 1)
        $target = Join-Path $releaseDir $relative
        if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
            Stop-Deploy "release verification failed: $relative is missing from the release" 2
        }
        if ((Get-Item -LiteralPath $target).Length -ne $sourceFile.Length) {
            Stop-Deploy "release verification failed: $relative has a different size after copying" 2
        }
    }
    $copiedFiles = $stagedFiles.Count

    $publicFiles = @(Get-ChildItem -LiteralPath (Join-Path $releaseDir 'public') -Recurse -File -Force).Count
    $totalBytes = ($releaseFiles | Measure-Object -Property Length -Sum).Sum
    $metadata = [ordered]@{
        release          = $ReleaseName
        stagedFrom       = $stagedFull
        createdAt        = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        files            = $copiedFiles
        publicFiles      = $publicFiles
        totalBytes       = $totalBytes
        sharedData       = 'stored outside the release in <DeploymentRoot>\shared (never copied)'
        stagedBy         = 'deploy/windows/Deploy-Release.ps1'
    }
    $metadataJson = $metadata | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText(
        (Join-Path $releaseDir 'release.json'),
        $metadataJson + "`n",
        (New-Object System.Text.UTF8Encoding($false))
    )
    Write-Host "  copied  $copiedFiles files ($publicFiles public) into $releaseDir"
    Write-Host "  verified all copied files and wrote release.json"
}

# ------------------------------------------------------------------- activate
if ($Activate -or $ActivateOnly) {
    Write-Host ''
    Write-Host "Activating $ReleaseName" -ForegroundColor Cyan
    if ($currentState -eq 'real-directory') {
        Stop-Deploy "current is a real directory, not a junction; this helper never deletes it. Move $currentPath away manually, then rerun with -ActivateOnly. The release at $releaseDir is intact." 1
    }
    if ($currentState -eq 'junction') {
        $alreadyActive = $currentTarget -and ($currentTarget.TrimEnd('\') -eq $releaseDir.TrimEnd('\'))
        if ($alreadyActive) {
            Write-Host "  current already points at $releaseDir; nothing to switch"
        }
        else {
            $removed = Invoke-Cmd -CommandLine ('rmdir "' + $currentPath + '"')
            if ($removed.ExitCode -ne 0) {
                Stop-Deploy "could not remove the existing current junction ($currentPath): $($removed.Output.Trim())" 2
            }
        }
    }
    if (-not (Test-Path -LiteralPath $currentPath)) {
        $linked = Invoke-Cmd -CommandLine ('mklink /J "' + $currentPath + '" "' + $releaseDir + '"')
        if ($linked.ExitCode -ne 0) {
            Stop-Deploy "junction could not be created ($currentPath -> $releaseDir): $($linked.Output.Trim())" 2
        }
    }
    $activeItem = Get-Item -LiteralPath $currentPath -Force
    if (-not ($activeItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
        Stop-Deploy "activation cannot be verified: $currentPath is not a junction" 2
    }
    $activeTarget = (@($activeItem.Target) -join ';').TrimEnd('\')
    if ($activeTarget -ne $releaseDir.TrimEnd('\')) {
        Stop-Deploy "activation cannot be verified: $currentPath points at '$activeTarget' instead of '$releaseDir'" 2
    }
    Write-Host "  current -> $releaseDir (junction verified)" -ForegroundColor Green
}

# --------------------------------------------------------------- next steps
$pythonHint = '<DeploymentRoot>\shared\venv\Scripts\python.exe'
$step = 1
Write-Host ''
Write-Host 'Next steps (this helper did NOT change the service, the database or IIS):' -ForegroundColor Yellow
if (-not ($Activate -or $ActivateOnly)) {
    Write-Host "  ${step}. Activate  : .\Deploy-Release.ps1 -DeploymentRoot $rootFull -ReleaseName $ReleaseName -ActivateOnly"
    $step++
}
Write-Host "  ${step}. Preflight : .\Start-OuroNex.ps1 -ConfigFile $sharedDir\config\.env -AppRoot $currentPath\app\backend -PythonExe $pythonHint -CheckOnly"
$step++
Write-Host "  ${step}. Migrate   : & '$pythonHint' $currentPath\app\backend\manage.py migrate --noinput   (service stopped, shared .env loaded)"
$step++
Write-Host "  ${step}. Static    : & '$pythonHint' $currentPath\app\backend\manage.py collectstatic --noinput"
$step++
Write-Host "  ${step}. Start     : Start-Service OuroNex   (elevated operator action, or start the NSSM service)"
$step++
Write-Host "  ${step}. Verify    : curl.exe -sS -H \"Host: 127.0.0.1\" -H \"X-Forwarded-Proto: https\" http://127.0.0.1:8000/health/"
Write-Host ''
Write-Host "Release $ReleaseName is ready. shared\ data, config and logs were not modified." -ForegroundColor Green

exit 0