# OuroNex local development server.
param(
    [int]$Port = 8080,
    [switch]$NoBrowser,
    [switch]$NoAdminPrompt
)

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BACKEND = Join-Path $ROOT "backend"
$Requirements = Join-Path $BACKEND "requirements.txt"
$BaseUrl = "http://localhost:$Port"

if ($env:OURONEX_NO_OPEN -eq "1") { $NoBrowser = $true }
if ($env:OURONEX_NO_ADMIN -eq "1") { $NoAdminPrompt = $true }

Write-Host "=== OuroNex Local Server ===" -ForegroundColor Cyan
Write-Host "Root: $ROOT"
Write-Host ""

# Do not start a second server on an occupied port.
$portOpen = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port `
    -InformationLevel Quiet -WarningAction SilentlyContinue
if ($portOpen) {
    Write-Host "Server is already running: $BaseUrl" -ForegroundColor Green
    Write-Host "CMS admin: $BaseUrl/admin/"
    if (-not $NoBrowser) { Start-Process "$BaseUrl/index.html" }
    exit 0
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "Python was not found. Install Python 3.11 or newer." -ForegroundColor Red
    exit 1
}

Push-Location $BACKEND
try {
    $django = python -c "import django; print(django.__version__)" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
        python -m pip install -r $Requirements
        if ($LASTEXITCODE -ne 0) { exit 1 }
        $django = python -c "import django; print(django.__version__)"
    }
    Write-Host "Python: $($python.Source)" -ForegroundColor Gray
    Write-Host "Django: $django" -ForegroundColor Gray

    Write-Host "`nChecking database..." -ForegroundColor Yellow
    python manage.py migrate --noinput
    if ($LASTEXITCODE -ne 0) { exit 1 }

    if (-not $NoAdminPrompt) {
        python manage.py shell -c "from django.contrib.auth import get_user_model; import sys; sys.exit(0 if get_user_model().objects.filter(is_superuser=True).exists() else 2)"
        if ($LASTEXITCODE -eq 2) {
            Write-Host "`nNo CMS administrator exists yet." -ForegroundColor Yellow
            $answer = Read-Host "Create one now? [Y/n]"
            if ($answer -ne "n" -and $answer -ne "N") {
                python manage.py createsuperuser
                if ($LASTEXITCODE -ne 0) { exit 1 }
            }
        }
    }

    Write-Host "`nStarting OuroNex..." -ForegroundColor Green
    Write-Host "  Website:   $BaseUrl/index.html"
    Write-Host "  Register:  $BaseUrl/register/"
    Write-Host "  Login:     $BaseUrl/login/"
    Write-Host "  Dashboard: $BaseUrl/dashboard/"
    Write-Host "  CMS admin: $BaseUrl/admin/"
    Write-Host "`nKeep this window open. Press Ctrl+C to stop." -ForegroundColor Yellow

    if (-not $NoBrowser) { Start-Process "$BaseUrl/index.html" }
    python manage.py runserver "127.0.0.1:$Port" --noreload
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
