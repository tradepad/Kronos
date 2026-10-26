<#
  Kronos Signal Desk: one-click start for Windows.

  Double-click START-WINDOWS.bat (or run .\scripts\start.ps1). It will:
    1. check Node.js and Python, and install pnpm if it is missing
    2. install the JavaScript packages and set up the Kronos model service
    3. open three windows (model service, bot, dashboard) and your browser

  -Heuristic   skip the Kronos model and run the momentum baseline instead
  -Samples N   Monte Carlo samples per forecast (default 3 on a CPU, 12 with an NVIDIA GPU)

  PAPER TRADING ONLY. Nothing here can place a real order.
#>
param([switch]$Heuristic, [int]$Samples = 0)
if ($Samples -le 0) { $Samples = if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) { 12 } else { 3 } }
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Root

function Say($m, $c = "White") { Write-Host "  $m" -ForegroundColor $c }
Write-Host ""
Say "KRONOS SIGNAL DESK" Red
Say "Paper trading only. No real orders, ever." DarkGray
Write-Host ""

# 1. Node.js
try { $nodeVer = (& node --version) } catch { $nodeVer = $null }
if (-not $nodeVer -or [int]($nodeVer.TrimStart("v").Split(".")[0]) -lt 20) {
  Say "Node.js 20 or newer is needed. Install the LTS version from https://nodejs.org and run this again." Red
  Read-Host "Press Enter to close"; exit 1
}
Say "Node $nodeVer" Green
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Say "Installing pnpm..." Yellow
  npm install -g pnpm | Out-Null
}

# 2. Packages + model service
Say "Installing dashboard and bot packages..." Yellow
pnpm install
if ($LASTEXITCODE -ne 0) { Say "pnpm install failed (see above)." Red; Read-Host "Press Enter to close"; exit 1 }

$Sidecar = Join-Path $Root "services\kronos-sidecar"
if (-not $Heuristic) {
  if (-not (Test-Path (Join-Path $Sidecar ".venv\Scripts\python.exe"))) {
    Say "Setting up the Kronos model service (first run downloads PyTorch, a few minutes)..." Yellow
    & powershell -ExecutionPolicy Bypass -File (Join-Path $Sidecar "bootstrap.ps1")
    if ($LASTEXITCODE -ne 0) {
      Say "Model setup failed. Starting with the heuristic baseline instead; fix Python and run again for Kronos." Yellow
      $Heuristic = $true
    }
  }
}

# 3. Launch
$ps = "powershell"
if (-not $Heuristic) {
  Say "Starting the Kronos model service (first start downloads the model weights)..." Yellow
  Start-Process $ps -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$Sidecar\run.ps1`"" -WindowStyle Normal
  $ok = $false
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:5005/health" -TimeoutSec 2; if ($h.ok -and $h.loaded_variants.Count -gt 0) { $ok = $true; break } } catch {}
  }
  if (-not $ok) { Say "The model service is still loading. The bot will retry; check its window for errors." Yellow }
  else { Say "Kronos loaded on $($h.device)." Green }
}

$predictor = if ($Heuristic) { "heuristic" } else { "kronos" }
$botCmd = "Set-Location '$Root'; pnpm bot --loop --predictor $predictor --model base --samples $Samples --backtest-windows 25 --backtest-interval 10 --min-confidence 0.55 --min-edge 0.02"
Start-Process $ps -ArgumentList "-NoExit", "-Command", $botCmd
Start-Process $ps -ArgumentList "-NoExit", "-Command", "Set-Location '$Root'; pnpm web"

Say "Opening the dashboard at http://localhost:3337 ..." Green
Start-Sleep -Seconds 8
Start-Process "http://localhost:3337"
Write-Host ""
Say "To stop: close the three windows (or press Ctrl+C in each)."
