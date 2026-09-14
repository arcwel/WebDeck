/**
 * Which debug adapter a file wants, by its extension.
 *
 * The ids are the core's adapter ids (debug.ts): `node` is js-debug, `python`
 * is debugpy, `go` is Delve, `rust` and `c` are lldb (codelldb or Xcode's
 * lldb-dap). A file this does not know gets no Debug button rather than a
 * failed launch.
 */
export type DebugLanguage = 'node' | 'python' | 'go' | 'rust' | 'c'

const BY_EXTENSION: Record<string, DebugLanguage> = {
  js: 'node',
  mjs: 'node',
  cjs: 'node',
  jsx: 'node',
  ts: 'node',
  mts: 'node',
  cts: 'node',
  tsx: 'node',
  py: 'python',
  go: 'go',
  rs: 'rust',
  c: 'c',
  cc: 'c',
  cpp: 'c',
  cxx: 'c',
  m: 'c',
  mm: 'c',
  swift: 'c'
}

export function debugLanguageOf(path: string | null | undefined): DebugLanguage | null {
  if (!path) return null
  const dot = path.lastIndexOf('.')
  if (dot === -1) return null
  return BY_EXTENSION[path.slice(dot + 1).toLowerCase()] ?? null
}

export const DEBUG_LANGUAGE_LABELS: Record<DebugLanguage, string> = {
  node: 'JavaScript / TypeScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  c: 'C / C++ / Swift'
}
