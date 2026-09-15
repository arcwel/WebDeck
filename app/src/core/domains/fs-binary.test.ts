import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setCoreEnv } from '../env'
import { nodeCoreEnv } from '../node-env'
import { readBinaryFile, statEntry } from './fs'
import { openWorkspacePath } from './workspace'

/**
 * The bytes-and-stat reads VS Code's file service goes through (the
 * workspace file system provider in the renderer): a binary comes back as it
 * is, a directory stats as one, and anything outside the workspace is not
 * found — the same containment the text read has.
 */
let dataDir: string
let project: string

beforeAll(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'wd-bin-data-'))
  setCoreEnv(nodeCoreEnv({ userDataDir: dataDir }))
  project = realpathSync(mkdtempSync(join(tmpdir(), 'wd-bin-project-')))
  mkdirSync(join(project, 'sub'))
  writeFileSync(join(project, 'blob.bin'), Buffer.from([0, 1, 2, 255, 254, 10, 13]))
  openWorkspacePath(project)
})

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
  rmSync(project, { recursive: true, force: true })
})

describe('binary read and stat', () => {
  it('returns the exact bytes of a binary file', async () => {
    const result = await readBinaryFile('blob.bin')
    expect(result.error).toBeUndefined()
    expect(result.bytes).toBe(7)
    expect([...Buffer.from(result.base64!, 'base64')]).toEqual([0, 1, 2, 255, 254, 10, 13])
  })

  it('stats a file and a directory', async () => {
    expect((await statEntry('blob.bin')).stat).toMatchObject({ kind: 'file', size: 7 })
    expect((await statEntry('sub')).stat).toMatchObject({ kind: 'dir' })
    expect((await statEntry('')).stat).toMatchObject({ kind: 'dir' })
  })

  it('reports what is not there, and refuses a path outside the workspace', async () => {
    expect((await statEntry('nope')).error).toBeTruthy()
    expect((await readBinaryFile('nope')).error).toBeTruthy()
    expect((await readBinaryFile('../outside')).error).toBe('no workspace')
    expect((await statEntry('/etc/hosts')).error).toBe('no workspace')
  })
})
