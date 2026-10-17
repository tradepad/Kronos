# Start the Kronos sidecar on Windows. Run .\bootstrap.ps1 first.
#   $env:KRONOS_VARIANT = mini | base   (default base)
#   $env:KRONOS_DEVICE  = cuda | cpu    (auto-detected)
#   $env:KRONOS_PORT    = 5005
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$VenvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VenvPy)) { Write-Host "[run] .venv missing. Run .\bootstrap.ps1 first." -ForegroundColor Red; exit 1 }
if (-not $env:KRONOS_VARIANT) { $env:KRONOS_VARIANT = "base" }
$Port = if ($env:KRONOS_PORT) { $env:KRONOS_PORT } else { "5005" }
Write-Host "[run] variant=$($env:KRONOS_VARIANT) port=$Port"
# Single worker on purpose: inference is GPU-bound and concurrency hurts.
& $VenvPy -m uvicorn server:app --host 127.0.0.1 --port $Port --log-level info --workers 1
