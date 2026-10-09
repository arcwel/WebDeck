// Some filesystems (notably Google Drive / CloudStorage mounts) strip the
// execute bit from files npm extracts. node-pty's spawn-helper must be
// executable or every pty spawn fails with "posix_spawnp failed".
import { execSync } from 'node:child_process'
import { chmodSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

if (process.platform !== 'win32') {
  const prebuilds = join('node_modules', 'node-pty', 'prebuilds')
  let platforms = []
  try {
    platforms = readdirSync(prebuilds)
  } catch {
    // node-pty not installed — nothing to fix
  }
  for (const platform of platforms) {
    const helper = join(prebuilds, platform, 'spawn-helper')
    try {
      const mode = statSync(helper).mode
      if (!(mode & 0o111)) chmodSync(helper, mode | 0o755)
    } catch {
      // no spawn-helper in this prebuild (e.g. win32) — skip
    }
  }
}

// Wire the repo's pre-commit hook (lint + typecheck, task 0.7) on install.
try {
  const hooks = join('..', '.githooks')
  if (existsSync(join(hooks, 'pre-commit'))) {
    if (process.platform !== 'win32') chmodSync(join(hooks, 'pre-commit'), 0o755)
    execSync('git config core.hooksPath .githooks', { cwd: '..', stdio: 'ignore' })
  }
} catch {
  // not a git checkout (e.g. tarball install) — nothing to wire
}

// Vendor the js-debug DAP server (task 12.4). Separate script so it can also
// be re-run on its own: `node scripts/fetch-js-debug.mjs`.
// WEBDECK_SKIP_BINARIES=1 skips the download outright, for offline or
// unattended runners where even attempting it can stall on a dropped connection.
if (process.env.WEBDECK_SKIP_BINARIES === '1') {
  console.log('js-debug: WEBDECK_SKIP_BINARIES=1, not downloading')
} else {
  try {
    execSync('node scripts/fetch-js-debug.mjs', { stdio: 'inherit' })
  } catch {
    // Already warned by the script itself; never fail the install for it.
  }
}
