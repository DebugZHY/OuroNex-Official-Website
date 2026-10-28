# OuroNex local development — one-click start (Windows PowerShell)
# Usage: powershell -File scripts/dev.ps1

$ErrorActionPreference = "Stop"
$ROOT = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$BACKEND = Join-Path $ROOT "backend"

Write-Host "=== OuroNex Dev Environment ===" -ForegroundColor Cyan
Write-Host "Root: $ROOT"
Write-Host ""

# Check Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { Write-Host "Python not found. Install Python 3.11+." -ForegroundColor Red; exit 1 }
Write-Host "Python: $($python.Source)" -ForegroundColor Gray

# Check Django
$django = python -c "import django; print(django.__version__)" 2>$null
if (-not $django) {
    Write-Host "Installing Django..." -ForegroundColor Yellow
    python -m pip install django
}
Write-Host "Django: $django" -ForegroundColor Gray

# Migrate
Write-Host "`nRunning migrations..." -ForegroundColor Yellow
Push-Location $BACKEND
python manage.py migrate
Pop-Location

# Start server
Write-Host "`nStarting server on http://localhost:8000 ..." -ForegroundColor Green
Write-Host "  Static site:  http://localhost:8000/index.html" -ForegroundColor White
Write-Host "  Login:        http://localhost:8000/login/" -ForegroundColor White
Write-Host "  Register:     http://localhost:8000/register/" -ForegroundColor White
Write-Host "  Dashboard:    http://localhost:8000/dashboard/" -ForegroundColor White
Write-Host "  Admin:        http://localhost:8000/admin/" -ForegroundColor White
Write-Host ""
Write-Host "Press Ctrl+C to stop." -ForegroundColor Yellow

Push-Location $BACKEND
python manage.py runserver 8000
Pop-Location
