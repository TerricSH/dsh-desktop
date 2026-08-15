// Rasterize the DSH favicon into app-icon PNGs (256/64/32/16) using the
// bundled Chromium: render the SVG on a dark rounded backdrop at 512px,
// capture, downscale. Run: npm run make-icon
//
// The favicon uses `prefers-color-scheme`, so force nativeTheme to dark to
// get the white glyph on the dark tile.

import { app, BrowserWindow, nativeTheme } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const ASSETS = path.join(ROOT, 'assets')

const log = (msg) => console.log(`[make-icon] ${msg}`)

// Keep Chromium's profile/cache out of the OS default location: a build tool
// must not depend on (or pollute) AppData.
app.setPath('userData', path.join(ROOT, 'data', 'userdata-icon'))
app.disableHardwareAcceleration()

// Hard timeout: never hang the caller.
setTimeout(() => {
  console.error('[make-icon] FATAL timeout')
  app.exit(2)
}, 90_000).unref()

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark'
  const svg = fs.readFileSync(path.join(ASSETS, 'favicon.svg'), 'utf8')
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; background: #171a21; }
  body { display: flex; align-items: center; justify-content: center; }
  svg { width: 78%; height: 78%; }
</style></head><body>${svg}</body></html>`

  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false })
  win.webContents.setBackgroundThrottling(false)
  log('loading data URL')
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  log('loaded, waiting for paint')
  await new Promise((resolve) => setTimeout(resolve, 800))
  log('capturing')
  const image = await win.webContents.capturePage()
  log(`captured ${image.getSize().width}x${image.getSize().height}`)
  for (const size of [256, 64, 32, 16]) {
    const resized = size === 256 ? image : image.resize({ width: size, height: size })
    fs.writeFileSync(path.join(ASSETS, `icon-${size}.png`), resized.toPNG())
  }
  fs.copyFileSync(path.join(ASSETS, 'icon-256.png'), path.join(ASSETS, 'icon.png'))
  writeIco()
  log('wrote icon.png, icon-256.png, icon-64.png, icon-32.png, icon-16.png, icon.ico')
  app.exit(0)
})

/** Write a valid Windows .ico (PNG-compressed entries, one per size). */
function writeIco() {
  const entries = [16, 32, 64, 256].map((size) => ({
    size,
    png: fs.readFileSync(path.join(ASSETS, `icon-${size}.png`)),
  }))
  const headerSize = 6
  const entrySize = 16
  let offset = headerSize + entries.length * entrySize
  const buffer = Buffer.alloc(headerSize + entries.length * entrySize + entries.reduce((n, e) => n + e.png.length, 0))
  buffer.writeUInt16LE(0, 0) // reserved
  buffer.writeUInt16LE(1, 2) // type: icon
  buffer.writeUInt16LE(entries.length, 4)
  for (let i = 0; i < entries.length; i += 1) {
    const { size, png } = entries[i]
    const base = headerSize + i * entrySize
    buffer.writeUInt8(size === 256 ? 0 : size, base) // 0 means 256
    buffer.writeUInt8(size === 256 ? 0 : size, base + 1)
    buffer.writeUInt8(0, base + 2)
    buffer.writeUInt8(0, base + 3)
    buffer.writeUInt16LE(1, base + 4) // planes
    buffer.writeUInt16LE(32, base + 6) // bit count
    buffer.writeUInt32LE(png.length, base + 8)
    buffer.writeUInt32LE(offset, base + 12)
    png.copy(buffer, offset)
    offset += png.length
  }
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), buffer)
}
