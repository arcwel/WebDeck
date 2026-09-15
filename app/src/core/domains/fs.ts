import { promises as fsp, watch } from 'node:fs'
import type { FSWatcher } from 'node:fs'
import { dirname, isAbsolute, resolve, sep } from 'node:path'
import { IpcChannels, IpcEvents } from '@shared/ipc'
import type { FsEntry } from '@shared/ipc'
import { coreBroadcast } from '../notify'
import { isGrantedFile, workspaceRoots } from './workspace'
import { core } from '../rpc'
import { asString } from '../coerce'

/**
 * Workspace-scoped filesystem access for the Files and Editor blocks.
 *
 * Every path is validated to land inside one of the granted workspace roots —
 * this is the containment boundary the whole app rests on, so it lives in one
 * function (`resolveInWorkspace`) rather than being re-checked per caller. A
 * recursive watcher broadcasts change events (debounced) to windows.
 */

/** Editor-safe default. Monaco and the IPC hop degrade on very large files, so
 *  the *UI* asks for a cap — the agent passes none and reads whatever it wants,
 *  bounded only by its own context. We impose no ceiling of our own. */
const EDITOR_FILE_BYTES = 8 * 1024 * 1024
const IGNORED = new Set(['node_modules', '.git', 'out', 'dist', '__pycache__'])

/** True when `full` is `base` itself or something beneath it. */
function isInside(full: string, base: string): boolean {
  return full === base || full.startsWith(base + sep)
}

/**
 * Resolve a path, refusing anything outside the granted roots. Null if none.
 *
 * `root` pins the resolution to a specific workspace. Agent sessions pass the
 * workspace they were started in, so a project switch mid-run can never
 * silently retarget their writes at the newly opened project; UI callers omit
 * it and follow the live workspace.
 *
 * Multi-root (task 3B.4) is addressed by **absolute** paths only:
 *
 *  - A relative path resolves against the primary root, exactly as before.
 *    Relative paths stay unambiguous, and no existing caller changes meaning.
 *  - An absolute path is allowed only if it lands inside one of the folders
 *    the user explicitly granted this session.
 *
 * Pinning still wins: a caller that passed a `root` is confined to that root
 * whatever else has been granted, so an agent cannot reach a folder added
 * after it started.
 */
function resolveInWorkspace(rel: string, root?: string | null): string | null {
  if (root) {
    const full = resolve(root, rel)
    return isInside(full, root) ? full : null
  }

  const roots = workspaceRoots()

  if (isAbsolute(rel)) {
    const full = resolve(rel)
    if (roots.some((candidate) => isInside(full, candidate.path))) return full
    // A single file the user attached through a picker, or dropped onto the
    // window. Narrower than a root: attaching one file from the Desktop does
    // not hand over the Desktop. Checked before the "no workspace" refusal
    // below, because a granted file is granted whether or not a project is
    // open — dropping a document into an empty window has to work.
    return isGrantedFile(full) ? full : null
  }

  if (roots.length === 0) return null

  const base = roots[0].path
  const full = resolve(base, rel)
  return isInside(full, base) ? full : null
}

// Every op honors its {error} result contract: a thrown ENOENT/EEXIST/EACCES
// must reach the renderer as data, never as a rejected IPC invoke.
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export async function listDir(rel: string, root?: string | null): Promise<FsEntry[]> {
  const full = resolveInWorkspace(rel, root)
  if (!full) return []
  try {
    const entries = await fsp.readdir(full, { withFileTypes: true })
    return entries
      .filter((e) => e.isDirectory() || e.isFile())
      .map((e): FsEntry => ({ name: e.name, kind: e.isDirectory() ? 'dir' : 'file' }))
      .sort((a, b) =>
        a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)
      )
  } catch {
    return []
  }
}

export async function readFile(
  rel: string,
  root?: string | null,
  maxBytes: number | null = EDITOR_FILE_BYTES
): Promise<{ content?: string; error?: string; truncated?: boolean; bytes?: number }> {
  const full = resolveInWorkspace(rel, root)
  if (!full) return { error: 'no workspace' }
  try {
    const stat = await fsp.stat(full)
    // Over the caller's cap we return the head rather than refusing — a large
    // file becomes read-mostly, never unopenable. `null` means no cap at all.
    if (maxBytes !== null && stat.size > maxBytes) {
      const handle = await fsp.open(full, 'r')
      try {
        const buffer = Buffer.alloc(maxBytes)
        const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
        return {
          content: buffer.subarray(0, bytesRead).toString('utf8'),
          truncated: true,
          bytes: stat.size
        }
      } finally {
        await handle.close()
      }
    }
    return { content: await fsp.readFile(full, 'utf8'), bytes: stat.size }
  } catch (error) {
    return { error: message(error) }
  }
}

export async function writeFile(
  rel: string,
  content: string,
  root?: string | null
): Promise<{ error?: string }> {
  const full = resolveInWorkspace(rel, root)
  if (!full) return { error: 'no workspace' }
  try {
    await fsp.writeFile(full, content, 'utf8')
    return {}
  } catch (error) {
    return { error: message(error) }
  }
}

/**
 * Binary write for agent screenshots, Composer attachments and other non-text
 * artifacts. Creates the parent folder: attachments land in
 * `.webdeck/attachments/`, which a fresh project does not have, and the path
 * is already confined to the workspace by resolveInWorkspace.
 */
/** Bytes, base64 on the wire, for a viewer that needs the file as it is. */
const BINARY_READ_BYTES = 32 * 1024 * 1024

export async function readBinaryFile(
  rel: string,
  root?: string | null
): Promise<{ base64?: string; bytes?: number; error?: string }> {
  const full = resolveInWorkspace(rel, root)
  if (!full) return { error: 'no workspace' }
  try {
    const stat = await fsp.stat(full)
    if (!stat.isFile()) return { error: 'not a file' }
    if (stat.size > BINARY_READ_BYTES) {
      return { error: `larger than ${BINARY_READ_BYTES / (1024 * 1024)} MB`, bytes: stat.size }
    }
    return { base64: (await fsp.readFile(full)).toString('base64'), bytes: stat.size }
  } catch (error) {
    return { error: message(error) }
  }
}

export interface FsStat {
  kind: 'file' | 'dir'
  size: number
  mtimeMs: number
  ctimeMs: number
}

export async function statEntry(
  rel: string,
  root?: string | null
): Promise<{ stat?: FsStat; error?: string }> {
  const full = resolveInWorkspace(rel, root)
  if (!full) return { error: 'no workspace' }
  try {
    const stat = await fsp.stat(full)
    if (!stat.isFile() && !stat.isDirectory()) return { error: 'not a file or directory' }
    return {
      stat: {
        kind: stat.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        ctimeMs: stat.ctimeMs
      }
    }
  } catch (error) {
    return { error: message(error) }
  }
}

export async function writeBinaryFile(
  rel: string,
  data: Buffer,
  root?: string | null
): Promise<{ error?: string }> {
  const full = resolveInWorkspace(rel, root)
  if (!full) return { error: 'no workspace' }
  try {
    await fsp.mkdir(dirname(full), { recursive: true })
    await fsp.writeFile(full, data)
    return {}
  } catch (error) {
    return { error: message(error) }
  }
}

export async function createEntry(
  rel: string,
  kind: 'file' | 'dir',
  root?: string | null
): Promise<{ error?: string }> {
  const full = resolveInWorkspace(rel, root)
  if (!full) return { error: 'no workspace' }
  try {
    if (kind === 'dir') await fsp.mkdir(full, { recursive: true })
    else await fsp.writeFile(full, '', { flag: 'wx' })
    return {}
  } catch (error) {
    return { error: message(error) }
  }
}

export async function renameEntry(
  fromRel: string,
  toRel: string,
  root?: string | null
): Promise<{ error?: string }> {
  // `root` is the caller's pin, and it matters most for the agent: writeFile
  // has always taken one, while this did not — so an agent confined to one
  // project could still move files across every OTHER granted root, which is
  // the confinement failing silently. BOTH ends are pinned: moving a file out
  // of the pin is as much an escape as moving one in.
  const from = resolveInWorkspace(fromRel, root)
  const to = resolveInWorkspace(toRel, root)
  if (!from || !to) return { error: 'no workspace' }
  if (from === to) return {}
  try {
    // POSIX rename() replaces the destination silently — refuse instead, so a
    // drag-onto-directory or rename-to-existing can never destroy a file.
    try {
      await fsp.stat(to)
      return { error: `${toRel} already exists` }
    } catch {
      // destination is free
    }
    await fsp.rename(from, to)
    return {}
  } catch (error) {
    return { error: message(error) }
  }
}

export async function deleteEntry(rel: string, root?: string | null): Promise<{ error?: string }> {
  // Pinned for the same reason as renameEntry, and it bites harder here:
  // file_write is `allow` in the DEFAULT mode, and rm is recursive.
  const full = resolveInWorkspace(rel, root)
  // Refuse to delete a root itself — any root, not just the primary one. With
  // multi-root (3B.4) a granted folder is as much a boundary as the project is.
  if (!full || workspaceRoots().some((root) => root.path === full)) {
    return { error: 'invalid path' }
  }
  try {
    await fsp.rm(full, { recursive: true })
    return {}
  } catch (error) {
    return { error: message(error) }
  }
}

/* ---- Change watching ---- */

let watcher: FSWatcher | null = null
let notifyTimer: ReturnType<typeof setTimeout> | null = null

export function watchWorkspace(root: string | null): void {
  watcher?.close()
  watcher = null
  if (!root) return
  try {
    watcher = watch(root, { recursive: true }, (_event, filename) => {
      const top = String(filename ?? '').split(sep)[0]
      if (IGNORED.has(top)) return
      if (notifyTimer) clearTimeout(notifyTimer)
      notifyTimer = setTimeout(() => coreBroadcast(IpcEvents.fsChanged, null, null), 150)
    })
  } catch (error) {
    console.warn('workspace watcher unavailable:', error)
  }
}

/** Register the workspace-filesystem domain with webdeck-core (P1). Pure —
 *  every path is workspace-scoped inside fs.ts. */
export function registerFsRpc(): void {
  core.register(IpcChannels.fsList, (rel) => listDir(asString(rel) ?? ''))
  core.register(IpcChannels.fsRead, (rel) => readFile(asString(rel) ?? ''))
  core.register(IpcChannels.fsReadBase64, (rel) => readBinaryFile(asString(rel) ?? ''))
  core.register(IpcChannels.fsStat, (rel) => statEntry(asString(rel) ?? ''))
  core.register(IpcChannels.fsWrite, (rel, content) => {
    const r = asString(rel)
    if (r === null || typeof content !== 'string') return { error: 'bad arguments' }
    return writeFile(r, content)
  })
  // Binary content the page has already read (an attachment picked with a
  // file input), base64 on the wire; images and other non-text files.
  core.register(IpcChannels.fsWriteBase64, (rel, base64) => {
    const r = asString(rel)
    if (r === null || typeof base64 !== 'string') return { error: 'bad arguments' }
    return writeBinaryFile(r, Buffer.from(base64, 'base64'))
  })
  core.register(IpcChannels.fsCreate, (rel, kind) => {
    const r = asString(rel)
    if (r === null || (kind !== 'file' && kind !== 'dir')) return { error: 'bad arguments' }
    return createEntry(r, kind)
  })
  core.register(IpcChannels.fsRename, (from, to) => {
    const f = asString(from)
    const t = asString(to)
    if (f === null || t === null) return { error: 'bad arguments' }
    return renameEntry(f, t)
  })
  core.register(IpcChannels.fsDelete, (rel) => {
    const r = asString(rel)
    if (r === null) return { error: 'bad arguments' }
    return deleteEntry(r)
  })
}
