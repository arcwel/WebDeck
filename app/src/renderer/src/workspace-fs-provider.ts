import {
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  registerFileSystemOverlay,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IStat
} from '@codingame/monaco-vscode-files-service-override'
import { Emitter } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import { Disposable } from '@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle'
import type { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import type { IFileChange } from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files'
import { useShellStore } from '@/store'
import { workspaceRelative } from '@/workspace-relative'

/**
 * The workspace, as VS Code's file service sees it.
 *
 * WebDeck reads and writes files through the core's `fs` domain, which is
 * contained to the open workspace and the files the user granted. VS Code's
 * own file service had no provider for `file:` at all, so anything that went
 * through it — an extension's `workspace.fs`, a custom editor loading the
 * bytes it shows, a peek into a file no editor holds — found nothing. This
 * provider closes that: every call becomes the same core request WebDeck's
 * own blocks make, with the same containment, so a path outside the
 * workspace reads as not found rather than as a way around it.
 */
function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

const notFound = (): FileSystemProviderError =>
  FileSystemProviderError.create('file not found', FileSystemProviderErrorCode.FileNotFound)

class WorkspaceFileSystemProvider
  extends Disposable
  implements IFileSystemProviderWithFileReadWriteCapability
{
  readonly capabilities =
    FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive
  private readonly changeEmitter = this._register(new Emitter<readonly IFileChange[]>())
  readonly onDidChangeFile = this.changeEmitter.event
  private readonly capabilitiesEmitter = this._register(new Emitter<void>())
  readonly onDidChangeCapabilities = this.capabilitiesEmitter.event

  private rel(uri: URI): string {
    const rel = workspaceRelative(uri, useShellStore.getState().workspace?.path ?? null)
    if (rel === null) throw notFound()
    return rel
  }

  watch(): { dispose(): void } {
    return { dispose() {} }
  }

  async stat(uri: URI): Promise<IStat> {
    const result = await window.agweb.fs.stat(this.rel(uri))
    if (!result.stat) throw notFound()
    return {
      type: result.stat.kind === 'dir' ? FileType.Directory : FileType.File,
      ctime: result.stat.ctimeMs,
      mtime: result.stat.mtimeMs,
      size: result.stat.size
    }
  }

  async readdir(uri: URI): Promise<[string, FileType][]> {
    const entries = await window.agweb.fs.list(this.rel(uri))
    return entries.map((e) => [e.name, e.kind === 'dir' ? FileType.Directory : FileType.File])
  }

  async readFile(uri: URI): Promise<Uint8Array> {
    const result = await window.agweb.fs.readBase64(this.rel(uri))
    if (result.base64 === undefined) {
      throw result.error?.includes('larger')
        ? FileSystemProviderError.create(result.error, FileSystemProviderErrorCode.FileTooLarge)
        : notFound()
    }
    return base64ToBytes(result.base64)
  }

  async writeFile(uri: URI, content: Uint8Array): Promise<void> {
    const result = await window.agweb.fs.writeBase64(this.rel(uri), bytesToBase64(content))
    if (result.error) {
      throw FileSystemProviderError.create(result.error, FileSystemProviderErrorCode.Unknown)
    }
  }

  async mkdir(uri: URI): Promise<void> {
    const result = await window.agweb.fs.create(this.rel(uri), 'dir')
    if (result.error) {
      throw FileSystemProviderError.create(result.error, FileSystemProviderErrorCode.Unknown)
    }
  }

  async delete(uri: URI): Promise<void> {
    const result = await window.agweb.fs.remove(this.rel(uri))
    if (result.error) {
      throw FileSystemProviderError.create(result.error, FileSystemProviderErrorCode.Unknown)
    }
  }

  async rename(from: URI, to: URI): Promise<void> {
    const result = await window.agweb.fs.rename(this.rel(from), this.rel(to))
    if (result.error) {
      throw FileSystemProviderError.create(result.error, FileSystemProviderErrorCode.Unknown)
    }
  }
}

let registered = false

/** Put the workspace in front of VS Code's in-memory file system. Once. */
export function registerWorkspaceFileSystem(): void {
  if (registered) return
  registered = true
  registerFileSystemOverlay(1, new WorkspaceFileSystemProvider())
}
