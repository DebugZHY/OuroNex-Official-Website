#requires -Version 5.1
<#
.SYNOPSIS
    Builds the OuroNex public website package from the package-manifest allowlist.

.DESCRIPTION
    Copies ONLY the files listed in package-manifest.json files[].path into a fresh
    destination directory, verifies every copied byte hash, and proves that no
    private file reached the output.

    Safety rules enforced by this script:
      * package-manifest.json files[].path is the only allowlist. Nothing else is
        copied, so the repository root is never served wholesale.
      * Manifest paths must be repository-relative forward-slash paths without
        drive letters, leading slashes or `..` segments.
      * Every source file must match the sha256 recorded in the manifest when one
        is recorded, so a stale manifest cannot package unexpected content.
      * The destination must be outside the repository, must not contain the
        repository, must be an empty/new directory and must not be a reparse
        point. Existing packages are never overwritten.
      * The package is assembled in a temporary sibling directory and moved into
        place only after verification, so a failed build never leaves a
        half-written release.
      * After copying, the whole output tree is enumerated and compared to the
        allowlist. Extra files, executables, scripts, secrets, databases,
        translation dictionaries and repository folders fail the build.

    Exit codes: 0 = package built and verified, 1 = invalid input/refused,
                2 = verification failed.

.EXAMPLE
    PS> .\Build-PublicSite.ps1 -Destination D:\OuroNex\staging\20261031-0400\public

.EXAMPLE
    PS> .\Build-PublicSite.ps1 -ManifestPath D:\build\package-manifest.json `
            -Destination D:\OuroNex\staging\public -ReportPath D:\build\public-report.json
#>
[CmdletBinding()]
param(
    # package-manifest.json to read. Defaults to the repository manifest next to this script.
    [string]$ManifestPath,

    # Fresh directory that receives the public package. Must be outside the repository.
    [Parameter(Mandatory = $true)]
    [string]$Destination,

    # Directory the manifest paths are resolved against. Defaults to the manifest folder.
    [string]$SourceRoot,

    # Evidence report path. Defaults to `public-package-report.json` beside the destination.
    [string]$ReportPath
)

$ErrorActionPreference = 'Stop'

$script:RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Stop-Build {
    param([string]$Message, [int]$Code = 1)
    [Console]::Error.WriteLine("BUILD-PUBLIC-SITE ERROR: $Message")
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

function ConvertTo-SafeRelativePath {
    param([string]$RawPath, [string]$EntryIndex)
    if ([string]::IsNullOrWhiteSpace($RawPath)) {
        throw "files[$EntryIndex].path is empty"
    }
    $p = $RawPath -replace '\\', '/'
    if ($p.StartsWith('/')) { throw "files[$EntryIndex].path must be repository-relative, not absolute: $RawPath" }
    if ($p -match '^[A-Za-z]:') { throw "files[$EntryIndex].path must not contain a drive letter: $RawPath" }
    if ($p -match '(^|/)\.\.(/|$)') { throw "files[$EntryIndex].path escapes the source root (parent traversal): $RawPath" }
    if ($p -match '(^|/)\.(/|$)') { throw "files[$EntryIndex].path contains a '.' segment: $RawPath" }
    if ($p.Contains(':')) { throw "files[$EntryIndex].path contains an invalid character ':': $RawPath" }
    if ($p.Contains('//')) { throw "files[$EntryIndex].path contains an empty segment: $RawPath" }
    if ($p.EndsWith('/')) { throw "files[$EntryIndex].path names a directory, not a file: $RawPath" }
    return $p
}

$forbiddenSegments = @('backend', 'scripts', 'docs', 'deploy', '_scratch', '.git', '.github', 'node_modules', 'venv', '.venv', 'staticfiles', 'exports')
$forbiddenNames = @('.env', '.env.example', '.env.local', 'package-manifest.json', 'manage.py', 'requirements.txt', 'start-local.cmd', '.gitignore', 'db.sqlite3')
$forbiddenExtensions = @('.py', '.pyc', '.pyo', '.ps1', '.psm1', '.psd1', '.bat', '.cmd', '.sh', '.sqlite3', '.sqlite3-wal', '.sqlite3-shm', '.db', '.log', '.json', '.md', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.bak', '.zip', '.7z', '.pem', '.pfx', '.key', '.crt')

function Test-ForbiddenRelativePath {
    param([string]$RelativePath)
    $segments = $RelativePath.Split('/')
    foreach ($s in $segments) {
        if ($forbiddenSegments -contains $s.ToLowerInvariant()) { return "segment '$s'" }
    }
    $name = $segments[$segments.Count - 1].ToLowerInvariant()
    if ($forbiddenNames -contains $name) { return "file name '$name'" }
    $ext = [System.IO.Path]::GetExtension($name)
    if ($ext -and ($forbiddenExtensions -contains $ext)) { return "extension '$ext'" }
    return $null
}

# ------------------------------------------------------------------ input checks
if ([string]::IsNullOrWhiteSpace($ManifestPath)) {
    $ManifestPath = Join-Path $script:RepoRoot 'package-manifest.json'
}
$ManifestPath = Resolve-FullPath -Path $ManifestPath -BasePath (Get-Location).ProviderPath
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) {
    Stop-Build "manifest not found: $ManifestPath (pass -ManifestPath with the package-manifest.json to deploy)" 1
}
$manifestFull = (Get-Item -LiteralPath $ManifestPath).FullName

if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $SourceRoot = Split-Path -Parent $manifestFull }
$sourceFull = Resolve-FullPath -Path $SourceRoot -BasePath (Get-Location).ProviderPath
if (-not (Test-Path -LiteralPath $sourceFull -PathType Container)) {
    Stop-Build "source root not found or not a directory: $sourceFull" 1
}

$destinationFull = Resolve-FullPath -Path $Destination -BasePath (Get-Location).ProviderPath
if (Test-Path -LiteralPath $destinationFull -PathType Leaf) {
    Stop-Build "destination is an existing file, not a directory: $destinationFull" 1
}
if (Test-PathInside -Candidate $destinationFull -Parent $script:RepoRoot) {
    Stop-Build "destination must be outside the repository: $destinationFull (the repository is never used as a web root)" 1
}
if (Test-PathInside -Candidate $script:RepoRoot -Parent $destinationFull) {
    Stop-Build "destination must not contain the repository: $destinationFull" 1
}
if (Test-Path -LiteralPath $destinationFull) {
    $existing = Get-Item -LiteralPath $destinationFull -Force
    if ($existing.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        Stop-Build "destination is a reparse point/junction; refusing to write through it: $destinationFull" 1
    }
    $existingChildren = @(Get-ChildItem -LiteralPath $destinationFull -Force)
    if ($existingChildren.Count -gt 0) {
        Stop-Build "destination is not empty ($($existingChildren.Count) entries); existing packages are never overwritten. Choose a new release directory: $destinationFull" 1
    }
}

if ([string]::IsNullOrWhiteSpace($ReportPath)) {
    $ReportPath = Join-Path (Split-Path -Parent $destinationFull) 'public-package-report.json'
}
$reportFull = Resolve-FullPath -Path $ReportPath -BasePath (Get-Location).ProviderPath
if (Test-PathInside -Candidate $reportFull -Parent $destinationFull) {
    Stop-Build "report path must not be inside the public package: $reportFull" 1
}

# ------------------------------------------------------------------ manifest read
try {
    $manifest = Get-Content -LiteralPath $manifestFull -Raw -Encoding UTF8 | ConvertFrom-Json
}
catch {
    Stop-Build "manifest is not valid JSON: $manifestFull ($($_.Exception.Message))" 1
}
if (-not $manifest.PSObject.Properties['files']) {
    Stop-Build "manifest has no files[] array: $manifestFull" 1
}
$entries = @($manifest.files)
if ($entries.Count -eq 0) {
    Stop-Build "manifest files[] is empty; refusing to build an empty package: $manifestFull" 1
}

# ------------------------------------------------------- resolve + hash sources
$plan = New-Object System.Collections.Generic.List[object]
$seen = @{}
for ($i = 0; $i -lt $entries.Count; $i++) {
    $entry = $entries[$i]
    if (-not $entry.PSObject.Properties['path']) {
        Stop-Build "manifest files[$i] has no path property" 1
    }
    try {
        $rel = ConvertTo-SafeRelativePath -RawPath ([string]$entry.path) -EntryIndex $i
    }
    catch {
        Stop-Build $_.Exception.Message 1
    }
    if ($seen.ContainsKey($rel.ToLowerInvariant())) {
        Stop-Build "manifest lists the same path twice: $rel" 1
    }
    $seen[$rel.ToLowerInvariant()] = $true

    $sourceFile = Join-Path $sourceFull ($rel -replace '/', '\')
    if (-not (Test-Path -LiteralPath $sourceFile -PathType Leaf)) {
        Stop-Build "manifest lists a missing source file: $rel (looked for $sourceFile)" 1
    }
    $hash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($entry.PSObject.Properties['sha256'] -and -not [string]::IsNullOrWhiteSpace([string]$entry.sha256)) {
        $expected = ([string]$entry.sha256).ToLowerInvariant()
        if ($expected -ne $hash) {
            Stop-Build "manifest hash is stale for $rel (manifest $expected, file $hash); regenerate package-manifest.json before deploying" 1
        }
    }
    $length = (Get-Item -LiteralPath $sourceFile).Length
    $plan.Add([pscustomobject]@{ Path = $rel; Source = $sourceFile; Sha256 = $hash; Bytes = $length })
}

# ------------------------------------------------------------------ assemble
$staging = "$destinationFull.building-$PID"
if (Test-Path -LiteralPath $staging) {
    Stop-Build "staging directory already exists, remove it and retry: $staging" 1
}
$completed = $false
try {
    New-Item -ItemType Directory -Path $staging -Force | Out-Null

    foreach ($item in $plan) {
        $target = Join-Path $staging ($item.Path -replace '/', '\')
        $targetDir = Split-Path -Parent $target
        if (-not (Test-Path -LiteralPath $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        Copy-Item -LiteralPath $item.Source -Destination $target -Force
        $copiedHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($copiedHash -ne $item.Sha256) {
            Stop-Build "copied bytes do not match the source for $($item.Path) (expected $($item.Sha256), got $copiedHash)" 2
        }
    }

    # ---------------------------------------------------------- verify output
    $stagedFiles = @(Get-ChildItem -LiteralPath $staging -Recurse -File -Force)
    if ($stagedFiles.Count -ne $plan.Count) {
        Stop-Build "package contains $($stagedFiles.Count) files but the allowlist has $($plan.Count)" 2
    }
    foreach ($item in (Get-ChildItem -LiteralPath $staging -Recurse -Force)) {
        if ($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
            Stop-Build "package contains a reparse point/junction: $($item.FullName)" 2
        }
    }

    $actual = New-Object System.Collections.Generic.List[string]
    foreach ($f in $stagedFiles) {
        $actual.Add($f.FullName.Substring($staging.Length + 1).Replace('\', '/'))
    }
    $allowed = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($item in $plan) { [void]$allowed.Add($item.Path) }

    $extras = @($actual | Where-Object { -not $allowed.Contains($_) })
    if ($extras.Count -gt 0) {
        Stop-Build ("package contains files that are not in the manifest allowlist: " + ($extras -join ', ')) 2
    }

    $forbiddenMatches = New-Object System.Collections.Generic.List[string]
    foreach ($rel in $actual) {
        $reason = Test-ForbiddenRelativePath -RelativePath $rel
        if ($reason) { $forbiddenMatches.Add("$rel ($reason)") }
    }
    if ($forbiddenMatches.Count -gt 0) {
        Stop-Build ("private files reached the package: " + ($forbiddenMatches -join '; ')) 2
    }

    # ----------------------------------------------------- move into place
    if (Test-Path -LiteralPath $destinationFull) {
        $left = @(Get-ChildItem -LiteralPath $destinationFull -Force)
        if ($left.Count -gt 0) {
            Stop-Build "destination became non-empty during the build; refusing to overwrite: $destinationFull" 1
        }
        Remove-Item -LiteralPath $destinationFull -Force
    }
    Move-Item -LiteralPath $staging -Destination $destinationFull
    $completed = $true

    # ------------------------------------------------------------- evidence
    $report = [ordered]@{
        builder              = 'deploy/windows/Build-PublicSite.ps1'
        generatedAt          = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
        manifest             = $manifestFull
        manifestSha256       = (Get-FileHash -LiteralPath $manifestFull -Algorithm SHA256).Hash.ToLowerInvariant()
        sourceRoot           = $sourceFull
        destination          = $destinationFull
        fileCount            = $plan.Count
        totalBytes           = ($plan | Measure-Object -Property Bytes -Sum).Sum
        files                = @($plan | ForEach-Object { [ordered]@{ path = $_.Path; bytes = $_.Bytes; sha256 = $_.Sha256 } })
        allowlistEntries     = $entries.Count
        extraFiles           = @()
        privateFilesAbsent   = $true
        forbiddenMatches     = @()
        repositoryExcluded   = $true
    }
    $reportDir = Split-Path -Parent $reportFull
    if (-not (Test-Path -LiteralPath $reportDir)) {
        New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    }
    $json = $report | ConvertTo-Json -Depth 6
    [System.IO.File]::WriteAllText($reportFull, $json + "`n", (New-Object System.Text.UTF8Encoding($false)))

    Write-Host ''
    Write-Host "Public package verified: $($plan.Count) files, 0 private files present." -ForegroundColor Green
    Write-Host "  destination : $destinationFull"
    Write-Host "  allowlist   : $manifestFull ($($entries.Count) entries)"
    Write-Host "  total bytes : $((($plan | Measure-Object -Property Bytes -Sum).Sum))"
    Write-Host "  report      : $reportFull"
    Write-Host '  only manifest files[].path entries were copied; repository folders, secrets, database, scripts and translation dictionaries are absent.'
}
finally {
    if (-not $completed -and (Test-Path -LiteralPath $staging)) {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
}

exit 0