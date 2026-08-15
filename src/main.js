// dsh-desktop: an Electron shell for the DeepSeek Harness Web GUI.
//
// Behaviour:
// - attach to an already-running dsh web server on the port (default 3080), or
//   spawn the dsh CLI and wait for it to become ready;
// - show the GUI in an own window (no browser chrome), minimize to tray;
// - on quit, stop only a server this app spawned; an attached server survives.
//
// Flags:
//   --smoke              headless verification: load the page, screenshot to
//                        smoke.png, print SMOKE_OK / SMOKE_FAIL, exit
//   --port <n>           port to attach/spawn on (default 3080)
//   --dsh-command <cmd>  dsh launcher to spawn (default: auto-resolve)
//   --no-tray            quit when the window closes instead of hiding to tray
//   --help               this text

import { app, BrowserWindow, Tray, Menu, nativeImage, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DshServer } from './server.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(here, '..')
const ASSETS = path.join(ROOT, 'assets')

// Portable/test mode: keep Chromium's profile (cookies, caches) out of AppData.
// Must run before any path derived from userData below.
if (process.env.DSH_DESKTOP_USERDATA) {
  app.setPath('userData', path.resolve(process.env.DSH_DESKTOP_USERDATA))
}

// Bundled harness: packaged apps keep it under process.resourcesPath, dev
// builds under resources/ next to the project.
const HARNESS_ROOT = app.isPackaged
  ? path.join(process.resourcesPath, 'harness')
  : path.join(ROOT, 'resources', 'harness')

// The app's own DSH home (writable, per-user) unless the user overrides it.
const HOME_DIR = process.env.DSH_DESKTOP_HOME
  ? path.resolve(process.env.DSH_DESKTOP_HOME)
  : path.join(app.getPath('userData'), 'dsh-home')

// Writable scratch area: inside the asar there is no filesystem, so packaged
// builds keep logs and smoke output under userData.
const DATA_DIR = app.isPackaged ? path.join(app.getPath('userData'), 'data') : path.join(ROOT, 'data')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function parseFlags(argv) {
  const flags = { smoke: false, port: 3080, dshCommand: undefined, noTray: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--smoke') flags.smoke = true
    else if (arg === '--no-tray') flags.noTray = true
    else if (arg === '--help' || arg === '-h') flags.help = true
    else if (arg === '--port') flags.port = Number(argv[++i])
    else if (arg === '--dsh-command') flags.dshCommand = argv[++i]
    else if (arg.startsWith('--')) {
      console.error(`unknown flag: ${arg}`)
      flags.help = true
    }
  }
  return flags
}

const flags = parseFlags(process.argv.slice(1))

if (flags.help) {
  console.log(`dsh-desktop — DeepSeek Harness desktop shell

Usage: npm start [-- --smoke] [-- --port <n>] [-- --dsh-command <cmd>] [-- --no-tray]

  --smoke              headless check: screenshot the GUI to smoke.png and exit
  --port <n>           port to attach/spawn on (default 3080)
  --dsh-command <cmd>  dsh launcher to spawn (default: auto-resolve)
  --no-tray            quit on window close instead of hiding to tray

Environment:
  DSH_DESKTOP_COMMAND   same as --dsh-command
  DSH_DESKTOP_PORT      same as --port
  DSH_DESKTOP_HOME      DSH home for the app's own server (default: <userData>/dsh-home)
  DSH_DESKTOP_USERDATA  Chromium profile dir (portable/test mode)`)
  app.exit(0)
}

/** @type {BrowserWindow | undefined} */
let win
/** @type {Tray | undefined} */
let tray
/** @type {DshServer | undefined} */
let server
let quitting = false

function iconPath(name) {
  const full = path.join(ASSETS, name)
  return fs.existsSync(full) ? full : undefined
}

function showWindow() {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '显示主窗口', click: showWindow },
    { label: '隐藏主窗口', click: () => win?.hide() },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        quitting = true
        server?.stop()
        app.quit()
      },
    },
  ])
}

function createTray() {
  const icon = iconPath('icon-32.png') ?? iconPath('icon.png')
  if (!icon) return
  tray = new Tray(nativeImage.createFromPath(icon))
  tray.setToolTip('DeepSeek Harness')
  tray.setContextMenu(buildTrayMenu())
  tray.on('double-click', showWindow)
}

function openWindow(url) {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 920,
    minHeight: 600,
    title: 'DeepSeek Harness',
    icon: iconPath('icon.png'),
    autoHideMenuBar: true,
    backgroundColor: '#171a21',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.webContents.setBackgroundThrottling(false)
  win.loadURL(url)
  win.once('ready-to-show', () => {
    if (!flags.smoke) win.show()
  })
  if (!flags.smoke && !flags.noTray) {
    // Closing hides to the tray instead of quitting.
    win.on('close', (event) => {
      if (!quitting) {
        event.preventDefault()
        win.hide()
      }
    })
  }
  return win
}

/** Headless verification: wait for the GUI to boot, screenshot, exit. */
async function runSmoke() {
  const url = server.url
  // Show off-screen so Chromium paints even though no one is watching.
  win.setPosition(-2000, -2000)
  win.show()
  const deadline = Date.now() + 45_000
  let state
  while (Date.now() < deadline) {
    try {
      state = await win.webContents.executeJavaScript(
        `({ ready: document.readyState === 'complete',
            boot: typeof window.__DSH_BOOT__ === 'object' && window.__DSH_BOOT__ !== null,
            children: document.querySelector('#root')?.children.length ?? 0 })`
      )
      if (state.ready && state.boot && state.children > 0) break
    } catch {
      // page not loaded yet
    }
    await sleep(500)
  }
  if (!state?.ready || !state.boot || state.children === 0) {
    throw new Error(`page did not boot (last state: ${JSON.stringify(state)})`)
  }
  await sleep(4000) // let the client modules settle before the screenshot
  const image = await win.webContents.capturePage()
  const out = path.join(DATA_DIR, 'smoke.png')
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.writeFileSync(out, image.toPNG())
  console.log(`SMOKE_OK ${url} ${image.getSize().width}x${image.getSize().height} -> ${out}`)
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock && !flags.smoke) {
  app.quit()
} else {
  app.on('second-instance', showWindow)

  app.whenReady().then(async () => {
    server = new DshServer({
      port: flags.port,
      dshCommand: flags.dshCommand,
      harnessRoot: HARNESS_ROOT,
      homeDir: HOME_DIR,
      logDir: DATA_DIR,
    })
    try {
      const { mode, url } = await server.start()
      const modeLabel = mode === 'bundled' ? 'spawned bundled harness' : mode === 'external' ? 'spawned external dsh' : 'attached'
      console.log(`[dsh-desktop] server ${modeLabel} at ${url}`)
      openWindow(url)
      if (flags.smoke) {
        await runSmoke()
        console.log('SMOKE_OK_END')
        server.stop() // app.exit skips will-quit; stop a spawned server here
        app.exit(0)
        return
      }
      createTray()
      console.log('[dsh-desktop] ready; close the window to minimize to tray, tray menu to quit')
    } catch (error) {
      console.error('[dsh-desktop] startup failed:', error)
      if (flags.smoke) {
        console.error(`SMOKE_FAIL ${error.message}`)
        app.exit(1)
        return
      }
      dialog.showErrorBox('DSH Desktop', `无法启动或连接 DeepSeek Harness：\n\n${error.message}`)
      server.stop()
      app.quit()
    }
  })

  app.on('window-all-closed', () => {
    if (quitting) app.quit()
    // otherwise keep running in the tray
  })
  app.on('before-quit', () => {
    quitting = true
  })
  app.on('will-quit', () => {
    server?.stop()
  })
}
