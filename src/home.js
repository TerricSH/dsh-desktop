// Seed a writable DSH home from the bundled harness. The dsh CLI itself
// maintains `$DSH_HOME/profiles/node_modules` as flat symlinks resolved from
// its own installation (healProfilesModuleFallback), so the app only needs to
// provide the web profile's config files; the package links are dsh's job.
// Idempotent: existing files are never touched.

import fs from 'node:fs'
import path from 'node:path'

/**
 * Ensure the app's DSH home has a web profile config seeded from the bundle.
 * @param {string} homeDir - DSH_HOME for the app (writable, per-user).
 * @param {string} harnessRoot - bundled harness dir (resources/harness).
 * @returns {string} homeDir
 */
export function ensureHome(homeDir, harnessRoot) {
  const webDir = path.join(homeDir, 'profiles', 'web')
  fs.mkdirSync(webDir, { recursive: true })
  const bundledProfile = path.join(harnessRoot, 'profile-web')
  if (fs.existsSync(bundledProfile)) {
    for (const name of ['package.json', 'cordis.patch.yml']) {
      const src = path.join(bundledProfile, name)
      const dst = path.join(webDir, name)
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst)
    }
  }
  return homeDir
}
