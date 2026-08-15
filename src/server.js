// The dsh web server manager: attach to a running server, or resolve the dsh
// CLI and spawn one. Only a server this process spawned is stopped on quit;
// an attached server is left running (it may serve other windows).

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const LOOPBACK = '127.0.0.1'

export function localUrl(port) {
  return `http://${LOOPBACK}:${port}`
}

/** Whether an HTTP server answers at url (any status counts as an answer). */
export async function probe(url, timeoutMs = 1500) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) })
    return true
  } catch {
    return false
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findOnPath(name) {
  const dirs = (process.env.PATH ?? '').split(path.delimiter)
  for (const dir of dirs) {
    if (!dir) continue
    for (const exe of [`${name}.cmd`, `${name}.exe`, `${name}.bat`, name]) {
      const full = path.join(dir, exe)
      try {
        if (fs.statSync(full).isFile()) return full
      } catch {
        // not in this directory
      }
    }
  }
  return undefined
}

/**
 * Resolve a `dsh` launcher to spawn, in order:
 * 1. `DSH_DESKTOP_COMMAND` (explicit override, may carry its own arguments)
 * 2. `dsh` on PATH
 * 3. the npm global prefix (`$APPDATA/npm/dsh.cmd`)
 * 4. the newest npx deployment under the npm-cache _npx folder
 *    (`$LOCALAPPDATA/npm-cache/_npx`, any deployment, .bin/dsh.cmd)
 */
export function resolveDshCommand(env = process.env) {
  if (env.DSH_DESKTOP_COMMAND?.trim()) return env.DSH_DESKTOP_COMMAND.trim()
  const onPath = findOnPath('dsh')
  if (onPath) return onPath
  if (env.APPDATA) {
    const global = path.join(env.APPDATA, 'npm', 'dsh.cmd')
    if (fs.existsSync(global)) return global
  }
  if (env.LOCALAPPDATA) {
    const npxRoot = path.join(env.LOCALAPPDATA, 'npm-cache', '_npx')
    if (fs.existsSync(npxRoot)) {
      const candidates = fs.readdirSync(npxRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(npxRoot, entry.name, 'node_modules', '.bin', 'dsh.cmd'))
        .filter((bin) => fs.existsSync(bin))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      if (candidates.length > 0) return candidates[0]
    }
  }
  return undefined
}

export class DshServer {
  /**
   * @param {object} options
   * @param {number} [options.port] - the port the Web GUI is expected on (default 3080).
   * @param {string} [options.dshCommand] - explicit launcher; falls back to resolveDshCommand().
   * @param {string} logDir - directory for the spawned server's log file.
   * @param {number} [options.spawnTimeoutMs] - readiness budget after spawning (default 90s).
   */
  constructor({ port = 3080, dshCommand, logDir, spawnTimeoutMs = 90_000 } = {}) {
    this.port = port
    this.url = localUrl(port)
    this.dshCommand = dshCommand ?? resolveDshCommand()
    this.logPath = path.join(logDir, 'server.log')
    this.spawnTimeoutMs = spawnTimeoutMs
    /** @type {'attached'|'spawned'|undefined} */
    this.mode = undefined
    /** @type {import('node:child_process').ChildProcess | undefined} */
    this.child = undefined
  }

  /**
   * Attach to a server already answering on the port, or spawn the dsh CLI.
   * @returns {{ mode: 'attached'|'spawned', url: string, pid?: number }}
   */
  async start() {
    if (await probe(this.url)) {
      this.mode = 'attached'
      return { mode: 'attached', url: this.url }
    }
    if (!this.dshCommand) {
      throw new Error(
        `no DSH server on ${this.url} and no dsh launcher found. ` +
        'Set DSH_DESKTOP_COMMAND to the dsh.cmd path (or add dsh to PATH).'
      )
    }
    fs.mkdirSync(path.dirname(this.logPath), { recursive: true })
    const log = fs.createWriteStream(this.logPath, { flags: 'a' })
    log.write(`\n=== ${new Date().toISOString()} dsh-desktop: spawning ${this.dshCommand} web --host ${LOOPBACK} --port ${this.port} ===\n`)
    // .cmd launchers need the shell on Windows; shell:true also tolerates
    // spaces in the resolved path.
    this.child = spawn(this.dshCommand, ['web', '--host', LOOPBACK, '--port', String(this.port)], {
      shell: true,
      windowsHide: true,
      // shell:true only accepts 'ignore'|'inherit'|'pipe' stdio, so pipe and
      // forward into the log stream manually.
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    this.child.stdout.pipe(log)
    this.child.stderr.pipe(log)
    const deadline = Date.now() + this.spawnTimeoutMs
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) {
        throw new Error(`dsh exited early (code ${this.child.exitCode}); see ${this.logPath}`)
      }
      if (await probe(this.url)) {
        this.mode = 'spawned'
        return { mode: 'spawned', url: this.url, pid: this.child.pid }
      }
      await sleep(500)
    }
    throw new Error(`dsh did not become ready on ${this.url} within ${this.spawnTimeoutMs}ms; see ${this.logPath}`)
  }

  /** Stop the server, but only when this instance spawned it. */
  stop() {
    if (this.mode !== 'spawned' || !this.child) return
    try {
      // /T kills the whole tree (cmd wrapper + the node process it launched).
      spawnSync('taskkill', ['/pid', String(this.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    } catch {
      // already gone
    }
    this.child = undefined
    this.mode = undefined
  }
}
