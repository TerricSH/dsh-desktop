# Make an .ico from icon-256.png for Windows taskbar/explorer use.
# Run after `npm run make-icon`.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$png = Join-Path $PSScriptRoot '..\assets\icon-256.png'
$ico = Join-Path $PSScriptRoot '..\assets\icon.ico'

$bmp = [System.Drawing.Bitmap]::new($png)
try {
  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  try {
    $stream = [System.IO.File]::Create($ico)
    try { $icon.Save($stream) } finally { $stream.Dispose() }
  } finally { $icon.Dispose() }
} finally { $bmp.Dispose() }

Write-Output "wrote $ico"
