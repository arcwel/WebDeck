import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type { ModelInfo, ModelRuntimeStatus } from '@shared/models'
import { coreEnv } from '../../env'
import type { CompleteRequest, ModelProvider, PlanRequest, TurnRequest, TurnResult } from './types'

/**
 * Apple's on-device model (Foundation Models, macOS 26), through the
 * `webdeck-apple-llm` helper built from native/apple-llm/main.swift.
 *
 * Zero install and private, and small: it answers Ask and chat-with-page, and
 * it cannot run the agent — no tool loop of the size the agent needs, and a
 * context measured in a few thousand tokens. The picker lists it under Ask
 * only, and the registry refuses it for the agent with that sentence.
 */
export const APPLE_MODEL_ID = 'apple/on-device'

const STATUS_TTL_MS = 60_000
const STATUS_TIMEOUT_MS = 5000
/** Apple documents the model's context as about 4k tokens. */
const CONTEXT_LENGTH = 4096

interface HelperLine {
  t?: string
  replace?: string
  done?: boolean
  error?: string
  available?: boolean
  reason?: string
}

/** The helper, in the packaged runtime or the dev checkout. */
export function appleHelperPath(): string | null {
  const rel = join('apple-llm', `${process.platform}-${process.arch}`, 'webdeck-apple-llm')
  let appResources = ''
  try {
    appResources = join(coreEnv().appDir, 'resources', rel)
  } catch {
    // Before setCoreEnv(): only the dev candidate applies.
  }
  const candidates = [appResources, join(process.cwd(), 'resources', rel)]
  return candidates.find((path) => path && existsSync(path)) ?? null
}

export class AppleProvider implements ModelProvider {
  readonly id = 'apple' as const
  private cached: { at: number; status: ModelRuntimeStatus } | null = null

  constructor(private readonly helper: () => string | null = appleHelperPath) {}

  async status(): Promise<ModelRuntimeStatus> {
    if (this.cached && Date.now() - this.cached.at < STATUS_TTL_MS) return this.cached.status
    const status = await this.probe()
    this.cached = { at: Date.now(), status }
    return status
  }

  private async probe(): Promise<ModelRuntimeStatus> {
    const base: ModelRuntimeStatus = {
      provider: 'apple',
      id: 'apple',
      label: 'Apple on-device',
      installed: false,
      running: false
    }
    if (process.platform !== 'darwin') return { ...base, detail: 'macOS 26 only' }
    const helper = this.helper()
    if (!helper) return { ...base, detail: 'Not in this build' }
    const answer = await runHelper(helper, ['--status'], null, STATUS_TIMEOUT_MS).catch(
      (error: Error) => ({ error: error.message }) as HelperLine
    )
    if (answer.available) {
      return { ...base, installed: true, running: true, detail: 'Available — Ask only' }
    }
    return { ...base, installed: true, detail: answer.reason ?? answer.error ?? 'Not available' }
  }

  async listModels(): Promise<ModelInfo[]> {
    const status = await this.status()
    if (!status.running) return []
    return [
      {
        id: APPLE_MODEL_ID,
        provider: 'apple',
        model: 'on-device',
        label: 'Apple on-device',
        local: true,
        capabilities: { tools: false, thinking: false, vision: false },
        contextLength: CONTEXT_LENGTH
      }
    ]
  }

  async turn(_request: TurnRequest): Promise<TurnResult> {
    throw new Error("Apple's on-device model answers Ask but cannot run the agent.")
  }

  async plan(_request: PlanRequest): Promise<Record<string, unknown>> {
    throw new Error("Apple's on-device model answers Ask but cannot run the agent.")
  }

  async complete(request: CompleteRequest): Promise<string> {
    const helper = this.helper()
    if (!helper) throw new Error("Apple's on-device model is not in this build.")
    let text = ''
    await runHelper(
      helper,
      [],
      JSON.stringify({
        system: request.system,
        prompt: request.user,
        maxTokens: request.maxTokens
      }),
      0,
      (line) => {
        if (typeof line.t === 'string') {
          text += line.t
          request.onToken?.(line.t)
        } else if (typeof line.replace === 'string') {
          text = line.replace
        }
      },
      request.signal
    )
    return text
  }
}

/**
 * Run the helper once. Lines are NDJSON; the last carries `done`, `available`
 * or `error`. A signal kills the child, which is how a stop reaches the model.
 */
function runHelper(
  helper: string,
  args: string[],
  stdin: string | null,
  timeoutMs: number,
  onLine?: (line: HelperLine) => void,
  signal?: AbortSignal
): Promise<HelperLine> {
  return new Promise((resolve, reject) => {
    const child = spawn(helper, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let last: HelperLine = {}
    let buffer = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(last)
    }
    const onAbort = (): void => {
      child.kill()
      const error = new Error('aborted')
      error.name = 'AbortError'
      finish(error)
    }
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill()
            finish(new Error("Apple's on-device model did not answer in time."))
          }, timeoutMs)
        : undefined
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const handle = (raw: string): void => {
      const line = raw.trim()
      if (!line) return
      let parsed: HelperLine
      try {
        parsed = JSON.parse(line) as HelperLine
      } catch {
        return
      }
      last = parsed
      if (parsed.error) {
        child.kill()
        finish(new Error(parsed.error))
        return
      }
      onLine?.(parsed)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      let cut = buffer.indexOf('\n')
      while (cut !== -1) {
        handle(buffer.slice(0, cut))
        buffer = buffer.slice(cut + 1)
        cut = buffer.indexOf('\n')
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) =>
      finish(new Error(`The on-device helper could not start: ${error.message}`))
    )
    child.on('close', (code) => {
      if (buffer.trim()) handle(buffer)
      if (settled) return
      if (code !== 0 && !last.error) {
        finish(
          new Error(
            `The on-device helper exited with code ${code}${stderr ? `: ${stderr.trim().slice(0, 200)}` : ''}`
          )
        )
        return
      }
      finish()
    })
    if (stdin !== null) child.stdin.end(stdin)
    else child.stdin.end()
  })
}
