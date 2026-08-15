# One-shot packaging: sync the bundled harness (optional), build the portable
# exe, verify the harness actually landed inside the package, and report.
#
#   npm run package                    reuse resources/harness if present
#   npm run package -- -RefreshBundle  re-copy the harness from the current
#                                      deployment first
#   npm run package -- -Mirror ""      use official download hosts instead of
#                                      npmmirror (for CN networks the mirror
#                                      is the default)
#
# Exit codes: 0 = ok, 1 = failure.

param(
  [switch]$RefreshBundle,
  [string]$Mirror = "https://npmmirror.com/mirrors/electron/"
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$harness = Join-Path $root 'resources\harness'
$dist = Join-Path $root 'dist'

function Fail([string]$msg) { Write-Error $msg; exit 1 }

# --- 1. bundle the harness (unless a usable copy already exists) ----------
$needBundle = $RefreshBundle -or -not (Test-Path (Join-Path $harness 'install\node_modules\@deepseek-ai\dsh\lib\bin.js'))
if ($needBundle) {
  Write-Host '[package] syncing harness from deployment...' -ForegroundColor Cyan
  Push-Location $root
  npm run bundle 2>&1 | ForEach-Object { Write-Host $_ }
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { Fail "bundle failed (exit $code)" }
} else {
  Write-Host "[package] reusing existing harness: $harness"
}

# --- 2. build the portable exe --------------------------------------------
Write-Host '[package] building portable exe...' -ForegroundColor Cyan
if ($Mirror) {
  $env:ELECTRON_MIRROR = $Mirror
  $env:ELECTRON_BUILDER_BINARIES_MIRROR = ($Mirror -replace 'electron/?$', 'electron-builder-binaries/')
}
if (Test-Path $dist) { Remove-Item -Recurse -Force $dist }
Push-Location $root
npx electron-builder --win portable 2>&1 | ForEach-Object { Write-Host $_ }
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { Fail "electron-builder failed (exit $code)" }

# --- 3. verify the harness really landed in the package --------------------
# electron-builder hard-excludes a root-level node_modules from
# extraResources; our tree lives under install/node_modules on purpose, so
# this check catches a packaging regression early.
$packedHarness = Join-Path $dist 'win-unpacked\resources\harness'
if (-not (Test-Path (Join-Path $packedHarness 'install\node_modules\@deepseek-ai\dsh\lib\bin.js'))) {
  Fail "harness missing from package: $packedHarness"
}
$harnessSize = (Get-ChildItem (Join-Path $packedHarness 'install') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum

# --- 4. report --------------------------------------------------------------
$exe = Get-ChildItem $dist -Filter '*.exe' | Where-Object { $_.FullName -notmatch 'win-unpacked' } | Select-Object -First 1
if (-not $exe) { Fail 'no portable exe produced' }

Write-Host ''
Write-Host '[package] DONE' -ForegroundColor Green
Write-Host ("  exe     : {0}  ({1} MB)" -f $exe.FullName, [math]::Round($exe.Length / 1MB, 1))
Write-Host ("  harness : {0} MB inside the package" -f [math]::Round($harnessSize / 1MB, 1))
Write-Host '  verify  : dist\win-unpacked\DSH Desktop.exe --smoke --port 3199'
exit 0
