# Bundle the DeepSeek Harness deployment into resources/harness so the desktop
# app is fully self-contained (no external dsh / node install needed).
#
# Sources (override with env):
#   DSH_BUNDLE_SOURCE   the deployment's node_modules dir (default: newest npx
#                       deployment under %LOCALAPPDATA%\npm-cache\_npx)
#   DSH_PROFILE_DIR     the web profile config dir (default: $DSH_HOME\profiles\web)
#
# Output: resources/harness\node_modules (full package tree incl. the dsh CLI
# and the web frontend) + resources/harness\profile-web\{package.json, cordis.patch.yml}
#
# Run: npm run bundle

$ErrorActionPreference = 'Stop'

$dest = Join-Path $PSScriptRoot '..\resources\harness'

# --- resolve source tree -------------------------------------------------
$srcTree = $env:DSH_BUNDLE_SOURCE
if (-not $srcTree) {
  $npxRoot = Join-Path $env:LOCALAPPDATA 'npm-cache\_npx'
  if (Test-Path $npxRoot) {
    $deployments = Get-ChildItem $npxRoot -Directory -ErrorAction SilentlyContinue |
      ForEach-Object { Join-Path $_.FullName 'node_modules' } |
      Where-Object { Test-Path (Join-Path $_ '@deepseek-ai\dsh\lib\bin.js') }
    if ($deployments) {
      $srcTree = $deployments | Sort-Object { (Get-Item $_).LastWriteTime } -Descending | Select-Object -First 1
    }
  }
}
if (-not $srcTree -or -not (Test-Path (Join-Path $srcTree '@deepseek-ai\dsh\lib\bin.js'))) {
  throw "no dsh deployment found; set DSH_BUNDLE_SOURCE to a deployment's node_modules"
}

# --- resolve source profile ---------------------------------------------
$srcProfile = $env:DSH_PROFILE_DIR
if (-not $srcProfile -and $env:DSH_HOME) { $srcProfile = Join-Path $env:DSH_HOME 'profiles\web' }
if (-not $srcProfile -or -not (Test-Path (Join-Path $srcProfile 'package.json'))) {
  throw "no web profile found; set DSH_PROFILE_DIR to the profile config dir"
}

Write-Output "bundle source tree : $srcTree"
Write-Output "bundle source profile: $srcProfile"
Write-Output "bundle destination  : $dest"

# --- copy the package tree (real files only; robocopy /E follows no junctions) --
# The tree lives under install/node_modules on purpose: electron-builder's
# extraResources hard-excludes a root-level node_modules, but a nested one
# passes its filter.
New-Item -ItemType Directory -Force (Join-Path $dest 'install\node_modules') | Out-Null
& robocopy $srcTree (Join-Path $dest 'install\node_modules') /E /MT:16 /NFL /NDL /NJH /NJS /R:1 /W:1 /XD .bin
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }

# --- copy profile config -------------------------------------------------
# package.json carries the deterministic bundle list; the patch layer ships
# empty (the source home's patch references the owner's personal plugins,
# which a self-contained app must not depend on). Users extend the app's own
# home patch later (see README).
New-Item -ItemType Directory -Force (Join-Path $dest 'profile-web') | Out-Null
Copy-Item (Join-Path $srcProfile 'package.json') (Join-Path $dest 'profile-web\package.json') -Force
Set-Content -Path (Join-Path $dest 'profile-web\cordis.patch.yml') -Value "# Your patch layer for this dsh profile: a top-level YAML array of loader patch entries.`n[]`n" -Encoding utf8 -NoNewline

$size = (Get-ChildItem (Join-Path $dest 'install\node_modules') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
$count = (Get-ChildItem (Join-Path $dest 'install\node_modules') -Recurse -File -ErrorAction SilentlyContinue).Count
Write-Output ("bundled {0:N1} MB / {1} files -> {2}" -f ($size / 1MB), $count, $dest)
