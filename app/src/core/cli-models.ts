import { setCoreEnv } from './env'
import { nodeCoreEnv } from './node-env'
import { setCoreBroadcaster } from './notify'
import type { ModelRole, ModelsListResult, PullProgress } from '@shared/models'

/**
 * `webdeck-core models …` — the model choices as commands, for scripts and
 * for an agent working beside the app.
 *
 * Same code as Settings → AI → On this Mac: the registry, the providers and
 * their refusals, against the same data directory (`--user-data`, else
 * ~/.webdeck), so a choice made here is the one the app uses. Nothing is
 * served; the process does its one thing and exits.
 *
 *   models list [--json]                 runtimes, models, what is in force
 *   models use <id> --for agent|ask      choose (a cloud id becomes the synced choice)
 *   models use --clear --for agent|ask   back to the cloud choice
 *   models pull <name> [--json]          Ollama pull, one progress line per update
 *   models remove <name>                 Ollama remove
 *   models test <id> [--json]            one prompt: time to first token, tokens/s
 *   models recommend [--json]            models sized to this machine's memory
 *   models endpoint add <name> <url> [--key-stdin]
 *   models endpoint remove <name>
 *
 * Exit codes: 0 done · 1 refused or failed (the reason on stderr) · 2 usage.
 */
export const MODELS_USAGE = `usage: webdeck-core models <list|use|pull|remove|test|recommend|endpoint> [...] [--json] [--user-data DIR]
  list                          runtimes, models and the choice in force
  use <id> --for agent|ask      choose a model (ollama/qwen3.5:9b, anthropic/claude-opus-5, …)
  use --clear --for agent|ask   go back to the cloud choice
  pull <name>                   pull an Ollama model, with progress
  remove <name>                 remove an Ollama model
  test <id>                     time one short answer
  recommend                     models sized to this machine's memory
  endpoint add <name> <url> [--key-stdin]   an OpenAI-compatible endpoint (key read from stdin)
  endpoint remove <name>`

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  if (i !== -1 && i + 1 < argv.length) return argv[i + 1]
  const inline = argv.find((a) => a.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : undefined
}

function positional(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      if (!a.includes('=') && !['--json', '--clear', '--key-stdin'].includes(a)) i++
      continue
    }
    out.push(a)
  }
  return out
}

const GB = 1_000_000_000
const size = (bytes?: number): string => (bytes ? `${(bytes / GB).toFixed(1)} GB` : '')

/** The list as people read it: one line per runtime, its models indented. */
export function formatList(result: ModelsListResult): string {
  const lines: string[] = []
  for (const runtime of result.runtimes) {
    const state = runtime.running ? 'running' : runtime.installed ? 'not running' : 'not installed'
    lines.push(`${runtime.label} — ${state}${runtime.detail ? ` · ${runtime.detail}` : ''}`)
    const models = result.models.filter((m) =>
      runtime.provider === 'openai-compatible'
        ? m.id.startsWith(
            `openai-compatible/${runtime.id === 'lmstudio' ? 'lmstudio' : runtime.id.replace(/^endpoint:/, '')}/`
          )
        : m.provider === runtime.provider
    )
    for (const m of models) {
      const roles = [
        result.selection.agent === m.id ? 'agent' : '',
        result.selection.ask === m.id ? 'ask' : ''
      ].filter(Boolean)
      const caps = [
        m.capabilities.tools ? 'tools' : '',
        m.capabilities.thinking ? 'thinking' : '',
        m.capabilities.vision ? 'vision' : ''
      ].filter(Boolean)
      lines.push(
        `  ${m.id}${size(m.sizeBytes) ? ` · ${size(m.sizeBytes)}` : ''}${caps.length ? ` · ${caps.join(' ')}` : ''}${
          roles.length ? ` · in force for ${roles.join(' and ')}` : ''
        }`
      )
    }
  }
  lines.push(`agent: ${result.selection.agent}`)
  lines.push(`ask:   ${result.selection.ask}`)
  return lines.join('\n')
}

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', (c) => (data += c))
    process.stdin.on('end', () => resolve(data.trim()))
  })
}

/** Run the subcommand; returns the exit code. `argv` is everything after `models`. */
export async function runModelsCli(argv: string[]): Promise<number> {
  const json = argv.includes('--json')
  const out = (value: unknown, human: () => string): void => {
    process.stdout.write(`${json ? JSON.stringify(value, null, 2) : human()}\n`)
  }
  const fail = (message: string): number => {
    if (json) process.stdout.write(`${JSON.stringify({ error: message })}\n`)
    else process.stderr.write(`${message}\n`)
    return 1
  }
  const args = positional(argv)
  const command = args[0]
  if (!command || command === 'help' || argv.includes('--help')) {
    process.stdout.write(`${MODELS_USAGE}\n`)
    return command ? 0 : 2
  }

  setCoreEnv(
    nodeCoreEnv({ userDataDir: flag(argv, 'user-data'), appDir: process.env.WEBDECK_CORE_RUNTIME })
  )
  // The agent module wires the providers into the registry when it loads.
  await import('./domains/agent')
  const registry = await import('./domains/models/registry')

  try {
    switch (command) {
      case 'list': {
        const result = await registry.listModels()
        out(result, () => formatList(result))
        return 0
      }
      case 'use': {
        const role = flag(argv, 'for')
        if (role !== 'agent' && role !== 'ask') return fail('use needs --for agent or --for ask')
        const id = argv.includes('--clear') ? null : args[1]
        if (id === undefined) return fail('use needs a model id, or --clear')
        const result = await registry.useModel(role as ModelRole, id)
        out(result.selection, () => `${role}: ${result.selection[role as ModelRole]}`)
        return 0
      }
      case 'pull': {
        const name = args[1]
        if (!name) return fail('pull needs a model name, e.g. qwen3.5:9b')
        let code = 0
        const done = new Promise<void>((resolve) => {
          setCoreBroadcaster((channel, payload) => {
            if (channel !== 'event:models-pull') return
            const p = payload as PullProgress
            if (json) process.stdout.write(`${JSON.stringify(p)}\n`)
            else {
              const pct =
                p.total && p.completed !== undefined
                  ? ` ${Math.round((p.completed / p.total) * 100)}%`
                  : ''
              process.stdout.write(`${p.status}${pct}${p.error ? ` — ${p.error}` : ''}\n`)
            }
            if (p.done) {
              if (p.error) code = 1
              resolve()
            }
          })
        })
        registry.pullModel(name)
        await done
        return code
      }
      case 'remove': {
        const name = args[1]
        if (!name) return fail('remove needs a model name')
        const result = await registry.removeModel(name.includes('/') ? name : `ollama/${name}`)
        out(result.selection, () => `removed ${name}`)
        return 0
      }
      case 'test': {
        const id = args[1]
        if (!id) return fail('test needs a model id')
        const r = await registry.testModel(id)
        out(
          r,
          () =>
            `${r.id}: first token ${r.firstTokenMs} ms · ≈${r.tokensPerSecond} tokens/s · ${r.totalMs} ms total\n${r.sample}`
        )
        return 0
      }
      case 'recommend': {
        const r = registry.recommendations()
        out(r, () =>
          [
            `memory: ${Math.round(r.memoryBytes / 1_073_741_824)} GB`,
            ...r.models.map(
              (m) =>
                `  ${m.model} · ${size(m.sizeBytes)} · ${m.fit}${m.recommended ? ' · recommended' : ''} — ${m.note}`
            )
          ].join('\n')
        )
        return 0
      }
      case 'endpoint': {
        const action = args[1]
        if (action === 'add') {
          const [, , name, url] = args
          if (!name || !url) return fail('endpoint add needs a name and a URL')
          const key = argv.includes('--key-stdin') ? await readStdin() : undefined
          const e = registry.addEndpoint(name, url, key)
          out(e, () => `added ${e.name} at ${e.baseUrl}${e.hasKey ? ' (with key)' : ''}`)
          return 0
        }
        if (action === 'remove') {
          if (!args[2]) return fail('endpoint remove needs a name')
          const result = await registry.removeEndpoint(args[2])
          out(
            result.runtimes.map((s) => s.id),
            () => `removed ${args[2]}`
          )
          return 0
        }
        return fail('endpoint needs add or remove')
      }
      default:
        process.stderr.write(`${MODELS_USAGE}\n`)
        return 2
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
}
