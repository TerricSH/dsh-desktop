# Bundle the DeepSeek Harness deployment into resources/harness so the desktop
# app is fully self-contained (no external dsh / node install needed).
#
# Sources (override with env):
#   DSH_BUNDLE_SOURCE   the deployment's node_modules dir (default: newest npx
#                       deployment under %LOCALAPPDATA%\npm-cache\_npx)
#   DSH_PROFILE_DIR     the web profile config dir (default: $DSH_HOME\profiles\web)
#   DSH_REPO_ROOT       parent dir of the app's own plugin repos (default: the
#                       dir that contains dsh-desktop, e.g. E:\dsh)
#
# Output: resources/harness\node_modules (full package tree incl. the dsh CLI
# and the web frontend) + resources/harness\profile-web\{package.json, cordis.patch.yml}
# The app's own plugins (@terricsh/dsh-notify, @terricsh/dsh-app-launcher) are
# copied into the bundled tree and enabled in the bundled profile patch so the
# self-contained app ships with desktop notifications and the launcher.
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

# --- resolve the app's own plugin repos ----------------------------------
# Default: the directory that contains dsh-desktop (so E:\dsh\dsh-notify etc.).
$repoRoot = $env:DSH_REPO_ROOT
if (-not $repoRoot) { $repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) }
$appPlugins = @(
  @{ name = 'dsh-notify' },
  @{ name = 'dsh-app-launcher' }
)

Write-Output "bundle source tree : $srcTree"
Write-Output "bundle source profile: $srcProfile"
Write-Output "bundle destination  : $dest"
Write-Output "bundle plugin repos : $repoRoot"

# --- copy the package tree (real files only; robocopy /E follows no junctions) --
# The tree lives under install/node_modules on purpose: electron-builder's
# extraResources hard-excludes a root-level node_modules, but a nested one
# passes its filter.
New-Item -ItemType Directory -Force (Join-Path $dest 'install\node_modules') | Out-Null
& robocopy $srcTree (Join-Path $dest 'install\node_modules') /E /MT:16 /NFL /NDL /NJH /NJS /R:1 /W:1 /XD .bin
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with code $LASTEXITCODE" }

# --- copy the app's own plugins into the bundled tree ---------------------
# Needed so the loader can resolve @terricsh/* profile rows without an
# external npm install; the app home links them at first spawn (home.js).
foreach ($plugin in $appPlugins) {
  $src = Join-Path $repoRoot $plugin.name
  if (-not (Test-Path (Join-Path $src 'package.json'))) {
    Write-Warning "app plugin source not found: $src (skipped)"
    continue
  }
  $destPkg = Join-Path $dest "install\node_modules\@terricsh\$($plugin.name)"
  New-Item -ItemType Directory -Force $destPkg | Out-Null
  Copy-Item (Join-Path $src 'package.json') $destPkg -Force
  if (Test-Path (Join-Path $src 'lib')) { Copy-Item (Join-Path $src 'lib') $destPkg -Recurse -Force }
  if (Test-Path (Join-Path $src 'README.md')) { Copy-Item (Join-Path $src 'README.md') $destPkg -Force }
  Write-Output "bundled app plugin: @terricsh/$($plugin.name)"
}

# --- copy profile config -------------------------------------------------
# package.json carries the deterministic bundle list. The patch layer enables
# the app's own plugins (notifications + workspace launcher); users can edit
# the app's home patch later to remove or extend it.
New-Item -ItemType Directory -Force (Join-Path $dest 'profile-web') | Out-Null
Copy-Item (Join-Path $srcProfile 'package.json') (Join-Path $dest 'profile-web\package.json') -Force
$patch = @"
# Your patch layer for this dsh profile: a top-level YAML array of loader patch
# entries. The app ships with its own desktop plugins enabled below; edit this
# file (or the app home's profiles/web/cordis.patch.yml after first run) to
# customize.
- insert:
    - id: notify-desktop
      name: '@terricsh/dsh-notify'
    - id: app-launcher
      name: '@terricsh/dsh-app-launcher'
"@
Set-Content -Path (Join-Path $dest 'profile-web\cordis.patch.yml') -Value $patch -Encoding utf8 -NoNewline

$size = (Get-ChildItem (Join-Path $dest 'install\node_modules') -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
$count = (Get-ChildItem (Join-Path $dest 'install\node_modules') -Recurse -File -ErrorAction SilentlyContinue).Count
Write-Output ("bundled {0:N1} MB / {1} files -> {2}" -f ($size / 1MB), $count, $dest)
