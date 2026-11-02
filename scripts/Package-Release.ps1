#requires -Version 5.1
<#
.SYNOPSIS
    Packages the OuroNex working tree into a double-clickable release ZIP.

.DESCRIPTION
    Builds OuroNex-release-<timestamp>.zip with app\ and public\ at the archive
    root, so extracting the archive gives a directory that can be passed
    directly to deploy\windows\Deploy-Release.ps1 -StagedReleasePath.

    What the packager does:
      * copies the current working tree (including uncommitted edits) into a
        scratch app\ tree, skipping VCS data, scratch folders, caches, virtual
        environments, logs, backups, databases, real .env files and the
        packaging output itself; .env.example is kept;
      * refreshes only the bytes/sha256 values of paths that are already listed
        in package-manifest.json, inside the staged copy. The working manifest
        is never written and no public path is ever added;
      * builds public\ with deploy\windows\Build-PublicSite.ps1 from the staged
        copy, so the public package matches the staged manifest;
      * writes the archive, then reopens it and verifies the required app\ and
        public\ entries plus the absence of secrets, databases and scratch data.

    Nothing in the repository or in the output folder is deleted or
    overwritten: work and archive names are timestamped and made unique.

    Exit codes: 0 = archive built and verified, 1 = invalid input,
                2 = verification failed.

.EXAMPLE
    PS> .\scripts\Package-Release.ps1

.EXAMPLE
    PS> $env:OURONEX_RELEASE_OUTPUT = 'D:\build'; .\scripts\Package-Release.ps1
#>
[CmdletBinding()]
param(
    # Repository root to package. Defaults to the folder above scripts\.
    [string]$RepoRoot,

    # Folder that receives the archive and the scratch tree.
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'

$script:ExcludedDirNames = @(
    '.git', '.github', '.svn', '_scratch', '__pycache__', 'node_modules',
    '.venv', 'venv', 'env', 'virtualenv', '.pytest_cache', '.mypy_cache',
    '.ruff_cache', '.cache', 'logs', 'backups', 'staticfiles', 'exports',
    'outbox', '.idea', '.vscode'
)
$script:ExcludedFileNames = @(
    '.env', '.netrc', 'id_rsa', 'id_ed25519', 'db.sqlite3', 'Thumbs.db',
    '.DS_Store'
)
$script:ExcludedExtensions = @(
    '.pyc', '.pyo', '.pyd', '.log', '.bak', '.tmp', '.sqlite3', '.sqlite',
    '.sqlite3-wal', '.sqlite3-shm', '.db', '.db3', '.pem', '.key', '.pfx'
)
$script:ForbiddenZipExtensions = @(
    '.sqlite3', '.sqlite3-wal', '.sqlite3-shm', '.sqlite', '.db', '.db3',
    '.pyc', '.pyo', '.log', '.bak'
)
$script:ReservedNames = @('con', 'prn', 'aux', 'nul') +
    @(1..9 | ForEach-Object { "com$_" }) +
    @(1..9 | ForEach-Object { "lpt$_" })

function Stop-Package {
    param([string]$Message, [int]$Code = 2)
    [Console]::Error.WriteLine("PACKAGE-RELEASE ERROR: $Message")
    exit $Code
}

function Test-PathInside {
    param([string]$Candidate, [string]$Parent)
    $c = $Candidate.TrimEnd('\', '/')
    $p = $Parent.TrimEnd('\', '/')
    if ($c -eq $p) { return $true }
    return $c.StartsWith($p + '\', [System.StringComparison]::OrdinalIgnoreCase)
}

function Resolve-FullPath {
    param([string]$Path, [string]$BasePath)
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'path is empty' }
    if (-not [System.IO.Path]::IsPathRooted($Path)) { $Path = Join-Path $BasePath $Path }
    return [System.IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
}

function Test-ExcludedDirectory {
    param([string]$Name)
    return ($script:ExcludedDirNames -contains $Name.ToLowerInvariant())
}

function Test-ExcludedFile {
    param([string]$Name)
    $lower = $Name.ToLowerInvariant()
    if ($script:ReservedNames -contains $lower) { return $true }
    if ($lower -eq '.env.example') { return $false }
    if ($lower -like 'ouronex-release-*') { return $true }
    if ($script:ExcludedFileNames -contains $lower) { return $true }
    if ($lower -like '.env.*') { return $true }
    foreach ($extension in $script:ExcludedExtensions) {
        if ($lower.EndsWith($extension)) { return $true }
    }
    return $false
}

function Get-ForbiddenReason {
    param([string]$RelativePath)
    $parts = $RelativePath.Split('/')
    $lower = $parts[$parts.Count - 1].ToLowerInvariant()
    if ($script:ReservedNames -contains $lower) { return 'Windows reserved device name' }
    if ($lower -eq '.env' -or ($lower -like '.env.*' -and $lower -ne '.env.example')) {
        return 'environment file'
    }
    foreach ($extension in $script:ForbiddenZipExtensions) {
        if ($lower.EndsWith($extension)) { return "file type $extension" }
    }
    if ($lower -like 'ouronex-release-*') { return 'packaging output' }
    foreach ($part in $parts) {
        if (Test-ExcludedDirectory -Name $part) { return "private folder '$part'" }
    }
    return $null
}

function Copy-AppTree {
    param(
        [string]$Source,
        [string]$Destination
    )
    foreach ($item in (Get-ChildItem -LiteralPath $Source -Force)) {
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) { continue }
        $target = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) {
            if (Test-ExcludedDirectory -Name $item.Name) { continue }
            New-Item -ItemType Directory -Path $target -Force | Out-Null
            Copy-AppTree -Source $item.FullName -Destination $target
        }
        else {
            if (Test-ExcludedFile -Name $item.Name) { continue }
            Copy-Item -LiteralPath $item.FullName -Destination $target -Force
            $script:CopiedFiles++
        }
    }
}

function Assert-NoForbiddenPath {
    param([string[]]$RelativePaths, [string]$Context)
    $violations = New-Object System.Collections.Generic.List[string]
    foreach ($relative in $RelativePaths) {
        $reason = Get-ForbiddenReason -RelativePath $relative
        if ($reason) { $violations.Add("$relative ($reason)") }
    }
    if ($violations.Count -gt 0) {
        Stop-Package ("$Context contains secrets, databases or scratch data: " + ($violations -join '; ')) 2
    }
}

$script:CopiedFiles = 0

try {
    # --------------------------------------------------------------- inputs
    if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
        if (-not [string]::IsNullOrWhiteSpace($env:OURONEX_RELEASE_SOURCE)) {
            $RepoRoot = $env:OURONEX_RELEASE_SOURCE
        }
        else {
            $RepoRoot = Split-Path -Parent $PSScriptRoot
        }
    }
    $repoFull = Resolve-FullPath -Path $RepoRoot -BasePath (Get-Location).ProviderPath
    if (-not (Test-Path -LiteralPath $repoFull -PathType Container)) {
        Stop-Package "repository folder not found: $repoFull" 1
    }
    $manifestSource = Join-Path $repoFull 'package-manifest.json'
    if (-not (Test-Path -LiteralPath $manifestSource -PathType Leaf)) {
        Stop-Package "package-manifest.json not found in $repoFull" 1
    }
    $builder = Join-Path $repoFull 'deploy\windows\Build-PublicSite.ps1'
    if (-not (Test-Path -LiteralPath $builder -PathType Leaf)) {
        Stop-Package "public site builder not found: $builder" 1
    }
    $requiredSource = @(
        'backend\manage.py',
        'backend\backend\wsgi.py'
    )
    $missingSource = @($requiredSource | Where-Object {
            -not (Test-Path -LiteralPath (Join-Path $repoFull $_) -PathType Leaf)
        })
    if ($missingSource.Count -gt 0) {
        Stop-Package ("the application tree is incomplete; missing " + ($missingSource -join ', ')) 1
    }

    if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
        if (-not [string]::IsNullOrWhiteSpace($env:OURONEX_RELEASE_OUTPUT)) {
            $OutputDirectory = $env:OURONEX_RELEASE_OUTPUT
        }
        elseif (Test-Path -LiteralPath 'D:\tmp' -PathType Container) {
            $OutputDirectory = 'D:\tmp'
        }
        else {
            $OutputDirectory = [System.IO.Path]::GetTempPath()
        }
    }
    $outputFull = Resolve-FullPath -Path $OutputDirectory -BasePath (Get-Location).ProviderPath
    if (Test-Path -LiteralPath $outputFull -PathType Leaf) {
        Stop-Package "output path is an existing file, not a folder: $outputFull" 1
    }
    if (Test-PathInside -Candidate $outputFull -Parent $repoFull) {
        Stop-Package "output folder must be outside the repository: $outputFull" 1
    }
    if (-not (Test-Path -LiteralPath $outputFull)) {
        New-Item -ItemType Directory -Path $outputFull -Force | Out-Null
    }

    # ------------------------------------------------------- unique names
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $zipPath = $null
    $workPath = $null
    for ($index = 1; $index -le 100; $index++) {
        $suffix = if ($index -eq 1) { '' } else { "-$index" }
        $candidateZip = Join-Path $outputFull "OuroNex-release-$stamp$suffix.zip"
        $candidateWork = Join-Path $outputFull "OuroNex-release-$stamp$suffix.work"
        if (-not (Test-Path -LiteralPath $candidateZip) -and
            -not (Test-Path -LiteralPath $candidateWork)) {
            $zipPath = $candidateZip
            $workPath = $candidateWork
            break
        }
    }
    if (-not $zipPath) {
        Stop-Package "could not find an unused archive name in $outputFull for timestamp $stamp" 1
    }

    Write-Host ''
    Write-Host 'OuroNex release packager' -ForegroundColor Cyan
    Write-Host "  source   : $repoFull"
    Write-Host "  output   : $outputFull"
    Write-Host "  archive  : $zipPath"
    Write-Host ''

    $staging = Join-Path $workPath 'staging'
    $appDir = Join-Path $staging 'app'
    $publicDir = Join-Path $staging 'public'
    New-Item -ItemType Directory -Path $appDir -Force | Out-Null

    # ------------------------------------------------ stage the app tree
    Write-Host '[1/5] Copying the working tree into the scratch staging folder...'
    Copy-AppTree -Source $repoFull -Destination $appDir
    if ($script:CopiedFiles -eq 0) {
        Stop-Package "no files were copied from $repoFull" 1
    }
    Write-Host "      $($script:CopiedFiles) files staged in $appDir"

    # -------------------------------------------- refresh the staged manifest
    Write-Host '[2/5] Refreshing size and SHA256 values in the staged manifest...'
    $stagedManifest = Join-Path $appDir 'package-manifest.json'
    if (-not (Test-Path -LiteralPath $stagedManifest -PathType Leaf)) {
        Stop-Package "package-manifest.json did not reach the staged app folder" 2
    }
    try {
        $manifest = Get-Content -LiteralPath $stagedManifest -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        Stop-Package "staged package-manifest.json is not valid JSON: $($_.Exception.Message)" 1
    }
    if (-not $manifest.PSObject.Properties['files']) {
        Stop-Package 'staged package-manifest.json has no files[] array' 1
    }
    $entries = @($manifest.files)
    if ($entries.Count -eq 0) {
        Stop-Package 'staged package-manifest.json files[] is empty' 1
    }
    $missingContent = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $entries) {
        if (-not $entry.PSObject.Properties['path']) {
            Stop-Package 'staged package-manifest.json has an entry without a path' 1
        }
        $relative = ([string]$entry.path) -replace '\\', '/'
        if ($relative.StartsWith('/') -or $relative -match '^[A-Za-z]:' -or
            $relative -match '(^|/)\.\.(/|$)') {
            Stop-Package "package-manifest.json path is not repository-relative: $relative" 1
        }
        $stagedFile = Join-Path $appDir ($relative -replace '/', '\')
        if (-not (Test-Path -LiteralPath $stagedFile -PathType Leaf)) {
            $missingContent.Add($relative)
            continue
        }
        $length = (Get-Item -LiteralPath $stagedFile).Length
        $hash = (Get-FileHash -LiteralPath $stagedFile -Algorithm SHA256).Hash.ToLowerInvariant()
        $entry | Add-Member -NotePropertyName bytes -NotePropertyValue $length -Force
        $entry | Add-Member -NotePropertyName sha256 -NotePropertyValue $hash -Force
    }
    if ($missingContent.Count -gt 0) {
        Stop-Package ("package-manifest.json lists content that is missing from the working tree: " +
            ($missingContent -join ', ') + ". Restore those files or update the manifest; nothing was packaged.") 1
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText(
        $stagedManifest,
        $manifestJson + "`n",
        (New-Object System.Text.UTF8Encoding($false))
    )
    Write-Host "      $($entries.Count) manifest entries refreshed in the staged copy"

    # ------------------------------------------------------- build public
    Write-Host '[3/5] Building public\ with Build-PublicSite.ps1...'
    $reportPath = Join-Path $workPath 'public-package-report.json'
    $builderArgs = @(
        '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $builder,
        '-ManifestPath', $stagedManifest, '-SourceRoot', $appDir,
        '-Destination', $publicDir, '-ReportPath', $reportPath
    )
    $builderOutput = & powershell.exe @builderArgs 2>&1
    $builderCode = $LASTEXITCODE
    if ($builderCode -ne 0) {
        foreach ($line in $builderOutput) { [Console]::Error.WriteLine([string]$line) }
        Stop-Package "public site build failed with exit code $builderCode" 2
    }
    foreach ($line in $builderOutput) { Write-Host "      $line" }

    # ------------------------------------------------------- verify staging
    Write-Host '[4/5] Verifying the staged release tree...'
    $requiredStaged = @(
        'app\package-manifest.json',
        'app\backend\manage.py',
        'app\backend\backend\wsgi.py',
        'public\index.html'
    )
    $missingStaged = @($requiredStaged | Where-Object {
            -not (Test-Path -LiteralPath (Join-Path $staging $_) -PathType Leaf)
        })
    if ($missingStaged.Count -gt 0) {
        Stop-Package ("staged release is incomplete; missing " + ($missingStaged -join ', ')) 2
    }
    $stagingFiles = @(Get-ChildItem -LiteralPath $staging -Recurse -File -Force)
    $stagingRelative = @($stagingFiles | ForEach-Object {
            $_.FullName.Substring($staging.Length + 1).Replace('\', '/')
        })
    Assert-NoForbiddenPath -RelativePaths $stagingRelative -Context 'staged release'

    # ---------------------------------------------------------- create zip
    Write-Host '[5/5] Creating and verifying the archive...'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $staging,
        $zipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $zipNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace('\', '/') })
    }
    finally {
        $archive.Dispose()
    }
    # Empty folders are stored as entries that end with a slash; count files only.
    $zipFileNames = @($zipNames | Where-Object { -not $_.EndsWith('/') })
    if ($zipFileNames.Count -ne $stagingFiles.Count) {
        Stop-Package ("archive holds $($zipFileNames.Count) files but the staged release has $($stagingFiles.Count) files") 2
    }
    $zipLookup = New-Object 'System.Collections.Generic.HashSet[string]' (
        [string[]]$zipFileNames, [System.StringComparer]::OrdinalIgnoreCase
    )
    $absent = @($stagingRelative | Where-Object { -not $zipLookup.Contains($_) })
    if ($absent.Count -gt 0) {
        Stop-Package ("archive is missing staged files: " + ($absent -join ', ')) 2
    }
    foreach ($required in @('app/backend/manage.py', 'app/backend/backend/wsgi.py', 'public/index.html', 'app/package-manifest.json')) {
        if (-not $zipLookup.Contains($required)) {
            Stop-Package "archive is missing a required entry: $required" 2
        }
    }
    Assert-NoForbiddenPath -RelativePaths $zipNames -Context 'archive'

    $zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $zipLength = (Get-Item -LiteralPath $zipPath).Length
    if ($zipLength -le 0) {
        Stop-Package "archive is empty: $zipPath" 2
    }
}
catch {
    Stop-Package "unexpected failure: $($_.Exception.Message)" 2
}

Write-Host ''
Write-Host 'Release package ready.' -ForegroundColor Green
Write-Host "  zip      : $zipPath"
Write-Host "  sha256   : $zipHash"
Write-Host "  size     : $zipLength bytes"
Write-Host "  files    : $($stagingFiles.Count)"
Write-Host "  staging  : $workPath"
Write-Host '  app\ and public\ are at the archive root; extract it and pass the folder to Deploy-Release.ps1 -StagedReleasePath.'
Write-Host ''

exit 0
