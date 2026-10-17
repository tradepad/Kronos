# One-shot Windows setup for the Kronos sidecar. Safe to run repeatedly.
#   1. Finds the Kronos `model/` package (this repo already contains it).
#   2. Creates .venv with Python 3.10+ (3.12 / 3.11 preferred).
#   3. Installs requirements (torch is large: a few minutes the first time).
$ErrorActionPreference = "Stop"
$SidecarDir = $PSScriptRoot
$RepoRoot = (Resolve-Path (Join-Path $SidecarDir "..\..\..")).Path
Set-Location $SidecarDir

if (Test-Path (Join-Path $RepoRoot "model\kronos.py")) {
  Write-Host "[bootstrap] Using Kronos model code from this repo: $RepoRoot\model"
} elseif (-not (Test-Path (Join-Path $SidecarDir "Kronos\.git"))) {
  Write-Host "[bootstrap] Cloning Kronos repo..."
  git clone --depth 1 https://github.com/shiyu-coder/Kronos.git (Join-Path $SidecarDir "Kronos")
}

function Find-Python {
  foreach ($v in @("3.12", "3.11", "3.13", "3.10")) {
    try { & py "-$v" -c "import sys" 2>$null; if ($LASTEXITCODE -eq 0) { return @("py", "-$v") } } catch {}
  }
  foreach ($exe in @("python", "python3")) {
    try {
      & $exe -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3,10) else 1)" 2>$null
      if ($LASTEXITCODE -eq 0) { return @($exe) }
    } catch {}
  }
  return $null
}

$Venv = Join-Path $SidecarDir ".venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
if (-not (Test-Path $VenvPy)) {
  $py = Find-Python
  if (-not $py) {
    Write-Host "[bootstrap] Python 3.10+ not found. Install Python 3.12 from https://www.python.org/downloads/ (tick 'Add python.exe to PATH') and run this again." -ForegroundColor Red
    exit 1
  }
  Write-Host "[bootstrap] Creating virtualenv with $($py -join ' ')..."
  if ($py.Length -gt 1) { & $py[0] $py[1] -m venv $Venv } else { & $py[0] -m venv $Venv }
}

& $VenvPy -m pip install --quiet --upgrade pip wheel
Write-Host "[bootstrap] Installing Python dependencies (torch is large, this can take a few minutes)..."
& $VenvPy -m pip install --quiet -r (Join-Path $SidecarDir "requirements.txt")
if ($LASTEXITCODE -ne 0) { Write-Host "[bootstrap] pip install failed." -ForegroundColor Red; exit 1 }
Write-Host ""
Write-Host "[bootstrap] Done. Start the sidecar with:  .\run.ps1"
