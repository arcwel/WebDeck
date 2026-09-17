/**
 * Whether to start VS Code's web-worker extension host at boot.
 *
 * The host is its own site-isolated renderer, about 70 MB resident, and it can
 * only be enabled when the services initialise. Declarative extensions —
 * themes, grammars, snippets, keymaps — never need it. So it starts only when
 * an installed extension actually has code to run in it (a `browser` entry),
 * and the first install of such an extension asks for one reload.
 */
export interface InstalledForHost {
  manifest: Record<string, unknown>
}

export function needsExtensionHost(ext: InstalledForHost): boolean {
  return Boolean(ext.manifest.browser)
}

export function shouldStartExtensionHost(
  originAvailable: boolean,
  installed: readonly InstalledForHost[]
): boolean {
  return originAvailable && installed.some(needsExtensionHost)
}
