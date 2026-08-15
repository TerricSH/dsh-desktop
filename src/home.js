// Seed a writable DSH home from the bundled harness. The dsh CLI itself
// maintains `$DSH_HOME/profiles/node_modules` as flat symlinks resolved from
// its own installation (healProfilesModuleFallback), so the app only needs to
// provide the web profile's config files; the package links are dsh's job.
// The app's own plugins (@terricsh/*) are linked from the bundled install
// tree as well, so profile patch rows resolve without an external install.
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
  // The app's own plugins (@terricsh/*) live in the bundled install tree.
  // Link them into the profile's node_modules so profile patch rows resolve
  // them the same way a manually wired profile does. Best-effort: the loader
  // can also resolve them straight from the install tree.
  const installPkgs = path.join(harnessRoot, 'install', 'node_modules', '@terricsh')
  if (fs.existsSync(installPkgs)) {
    const profileNm = path.join(webDir, 'node_modules', '@terricsh')
    fs.mkdirSync(profileNm, { recursive: true })
    for (const name of fs.readdirSync(installPkgs)) {
      const target = path.join(installPkgs, name)
      const link = path.join(profileNm, name)
      if (fs.existsSync(target) && !fs.existsSync(link)) {
        try {
          fs.symlinkSync(target, link, 'junction')
        } catch (err) {
          /* best-effort */
        }
      }
    }
  }
  return homeDir
}
