// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppleProvider } from './apple'

/**
 * The provider is a thin spawn-and-parse over the Swift helper, so the tests
 * stand in a fake helper — a script that speaks the same NDJSON — and pin
 * the parse: deltas, a rewritten snapshot, the status shapes, an error, and
 * a stop.
 */
const dir = join(tmpdir(), `wd-apple-${process.pid}`)
mkdirSync(dir, { recursive: true })

function fakeHelper(name: string, script: string): string {
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env node\n${script}`)
  chmodSync(path, 0o755)
  return path
}

afterAll(() => rmSync(dir, { recursive: true, force: true }))

const available = fakeHelper(
  'available.js',
  `
if (process.argv.includes('--status')) { console.log(JSON.stringify({ available: true })); process.exit(0) }
let input = ''
process.stdin.on('data', (c) => (input += c))
process.stdin.on('end', () => {
  const req = JSON.parse(input)
  console.log(JSON.stringify({ t: 'Paris' }))
  console.log(JSON.stringify({ t: ' is the capital' }))
  console.log(JSON.stringify({ replace: 'Paris is the capital.' }))
  console.log(JSON.stringify({ t: ' (' + req.maxTokens + ')' }))
  console.log(JSON.stringify({ done: true }))
})
`
)

const unavailable = fakeHelper(
  'unavailable.js',
  `console.log(JSON.stringify({ available: false, reason: 'Apple Intelligence is off.' }))`
)

const failing = fakeHelper(
  'failing.js',
  `
if (process.argv.includes('--status')) { console.log(JSON.stringify({ available: true })); process.exit(0) }
process.stdin.on('data', () => {})
process.stdin.on('end', () => { console.log(JSON.stringify({ error: 'declined this request' })); process.exit(1) })
`
)

const slow = fakeHelper(
  'slow.js',
  `
if (process.argv.includes('--status')) { console.log(JSON.stringify({ available: true })); process.exit(0) }
process.stdin.on('data', () => {})
process.stdin.on('end', () => { console.log(JSON.stringify({ t: 'thinking' })); setTimeout(() => {}, 30000) })
`
)

const onlyOnMac = process.platform === 'darwin' ? describe : describe.skip

onlyOnMac('AppleProvider', () => {
  it('reports available and offers one Ask-only model', async () => {
    const p = new AppleProvider(() => available)
    expect(await p.status()).toMatchObject({
      id: 'apple',
      installed: true,
      running: true,
      detail: 'Available — Ask only'
    })
    const models = await p.listModels()
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: 'apple/on-device',
      local: true,
      capabilities: { tools: false }
    })
  })

  it('reports the reason when the model is not available, and offers nothing', async () => {
    const p = new AppleProvider(() => unavailable)
    expect(await p.status()).toMatchObject({
      installed: true,
      running: false,
      detail: 'Apple Intelligence is off.'
    })
    expect(await p.listModels()).toEqual([])
  })

  it('reports a build without the helper', async () => {
    const p = new AppleProvider(() => null)
    expect(await p.status()).toMatchObject({ installed: false, detail: 'Not in this build' })
  })

  it('streams deltas, honours a rewritten snapshot, and passes maxTokens', async () => {
    const p = new AppleProvider(() => available)
    const tokens: string[] = []
    const text = await p.complete({
      model: 'on-device',
      system: 's',
      user: 'capital?',
      maxTokens: 42,
      onToken: (t) => tokens.push(t)
    })
    expect(tokens).toEqual(['Paris', ' is the capital', ' (42)'])
    expect(text).toBe('Paris is the capital. (42)')
  })

  it("surfaces the helper's error as the message", async () => {
    const p = new AppleProvider(() => failing)
    await expect(
      p.complete({ model: 'on-device', system: '', user: 'x', maxTokens: 5 })
    ).rejects.toThrow(/declined this request/)
  })

  it('stops the helper on abort', async () => {
    const p = new AppleProvider(() => slow)
    const controller = new AbortController()
    const run = p.complete({
      model: 'on-device',
      system: '',
      user: 'x',
      maxTokens: 5,
      signal: controller.signal,
      onToken: () => controller.abort()
    })
    await expect(run).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('cannot run the agent', async () => {
    const p = new AppleProvider(() => available)
    await expect(
      p.turn({ model: 'on-device', system: '', messages: [], tools: [], maxTokens: 1 })
    ).rejects.toThrow(/cannot run the agent/)
  })
})
