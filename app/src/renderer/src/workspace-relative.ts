/**
 * The workspace-relative path for a `file:` URI inside the open workspace,
 * else null. Pure, so the containment rule is testable without the workbench.
 */
export function workspaceRelative(
  uri: { scheme: string; fsPath: string },
  workspacePath: string | null
): string | null {
  if (uri.scheme !== 'file' || !workspacePath) return null
  const root = workspacePath.replace(/\/+$/, '')
  const path = uri.fsPath
  if (path === root) return ''
  if (!path.startsWith(`${root}/`)) return null
  return path.slice(root.length + 1)
}
