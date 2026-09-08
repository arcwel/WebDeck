import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { coreEnv } from '../env'

/**
 * Minimal atomic JSON persistence in the app's userData directory.
 * Writes go to a temp file first so a crash mid-write can't corrupt state.
 */
export class JsonStore<T> {
  constructor(
    private readonly name: string,
    private readonly defaults: T
  ) {}

  /** Resolved lazily: stores are constructed at module import, which runs
   *  before setCoreEnv() wires the host (and before index.ts applies the
   *  AGWEB_USER_DATA override the Electron adapter reflects via app.setPath). */
  private get file(): string {
    return join(coreEnv().userDataDir, `${this.name}.json`)
  }

  /** The stored value over the defaults. A file that is not there yet is the
   *  normal first run and says nothing; a file that cannot be read or parsed
   *  is reported once per read, because silently falling back to the defaults
   *  is how a choice (a model, a setting) quietly reverts. */
  read(): T {
    try {
      const raw = readFileSync(this.file, 'utf8')
      return { ...this.defaults, ...(JSON.parse(raw) as T) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const reason = error instanceof Error ? error.message : String(error)
        console.warn(`[json-store] ${this.file}: ${reason}; using defaults`)
      }
      return this.defaults
    }
  }

  write(value: T): void {
    const tmp = `${this.file}.tmp`
    mkdirSync(dirname(this.file), { recursive: true })
    writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }
}
