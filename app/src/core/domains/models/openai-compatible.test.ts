// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { setCoreEnv } from '../../env'
import type { ChatMessage, ToolDef } from './types'

const dir = join(tmpdir(), `wd-oai-${process.pid}`)
rmSync(dir, { recursive: true, force: true })
mkdirSync(dir, { recursive: true })
setCoreEnv({
  userDataDir: dir,
  homeDir: dir,
  appDir: dir,
  secrets: {
    isAvailable: () => true,
    encryptString: (s) => Buffer.from(s),
    decryptString: (b) => b.toString()
  }
})

const {
  OpenAICompatibleProvider,
  ToolCallAssembler,
  normaliseBaseUrl,
  parseJsonObject,
  parseSseLine,
  toOpenAIMessages,
  toOpenAITool
} = await import('./openai-compatible')

const readFile: ToolDef = {
  name: 'read_file',
  description: 'Read a file.',
  input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
}

describe('conversion to the OpenAI shapes', () => {
  it('turns a tool definition into a function tool', () => {
    expect(toOpenAITool(readFile)).toEqual({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file.',
        parameters: readFile.input_schema
      }
    })
  })

  it('keeps tool call ids and sends arguments as a JSON string', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'Task: read it' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Reading.' },
          { type: 'tool_use', id: 'call_1', name: 'read_file', input: { path: 'a.txt' } }
        ] as ChatMessage['content']
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'call_1', content: 'hello' }]
      }
    ]
    expect(toOpenAIMessages(messages)).toEqual([
      { role: 'user', content: 'Task: read it' },
      {
        role: 'assistant',
        content: 'Reading.',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a.txt"}' }
          }
        ]
      },
      { role: 'tool', tool_call_id: 'call_1', content: 'hello' }
    ])
  })

  it('sends an assistant turn with no text as null content', () => {
    const out = toOpenAIMessages([
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'c', name: 'read_file', input: {} }
        ] as ChatMessage['content']
      }
    ])
    expect(out[0]).toMatchObject({ role: 'assistant', content: null })
  })
})

describe('the stream', () => {
  it('parses data lines and skips keep-alives and [DONE]', () => {
    expect(parseSseLine(': keep-alive')).toBeNull()
    expect(parseSseLine('data: [DONE]')).toBeNull()
    expect(parseSseLine('')).toBeNull()
    expect(parseSseLine('data: {"choices":[{"delta":{"content":"hi"}}]}')).toEqual({
      choices: [{ delta: { content: 'hi' } }]
    })
  })

  it('assembles tool calls from indexed deltas', () => {
    const a = new ToolCallAssembler()
    a.add([{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"pa' } }])
    a.add([{ index: 1, id: 'call_b', function: { name: 'search', arguments: '{"q":' } }])
    a.add([{ index: 0, function: { arguments: 'th":"a.txt"}' } }])
    a.add([{ index: 1, function: { arguments: '"x"}' } }])
    expect(a.finish()).toEqual([
      { id: 'call_a', name: 'read_file', input: { path: 'a.txt' } },
      { id: 'call_b', name: 'search', input: { q: 'x' } }
    ])
  })

  it('refuses arguments that are not JSON rather than running the tool with {}', () => {
    const a = new ToolCallAssembler()
    a.add([{ index: 0, id: 'c', function: { name: 'run_command', arguments: '{oops' } }])
    expect(() => a.finish()).toThrow(/not readable JSON; the call was not run/)
  })
})

describe('helpers', () => {
  it('normalises a base url to /v1 over http or https only', () => {
    expect(normaliseBaseUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080/v1')
    expect(normaliseBaseUrl('http://127.0.0.1:8080/v1/')).toBe('http://127.0.0.1:8080/v1')
    expect(normaliseBaseUrl('https://llm.internal/api/v1?x=1#f')).toBe(
      'https://llm.internal/api/v1'
    )
    expect(normaliseBaseUrl('ftp://x')).toBeNull()
    expect(normaliseBaseUrl('not a url')).toBeNull()
  })

  it('finds the JSON object in a fenced or chatty reply', () => {
    expect(parseJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 })
    expect(parseJsonObject('Sure! {"a":{"b":2}} there')).toEqual({ a: { b: 2 } })
    expect(parseJsonObject('[1,2]')).toBeNull()
    expect(parseJsonObject('nothing')).toBeNull()
  })
})

/* ---- A fake OpenAI-compatible server ---- */

interface Seen {
  path: string
  auth?: string
  body: Record<string, unknown>
}

let server: Server
let base = ''
const seen: Seen[] = []
let refuseFormat = false
let planReplies: string[] = []

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c: Buffer) => (data += c.toString()))
    req.on('end', () => resolve(data))
  })
}

function sse(chunks: unknown[]): string {
  return chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
}

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const raw = await readBody(req)
    const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    seen.push({ path: req.url ?? '', auth: req.headers.authorization, body })
    if (req.url === '/v1/models') {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'qwen-7b' }, { id: 'nomic-embed' }] }))
      return
    }
    if (req.url === '/v1/chat/completions') {
      if (refuseFormat && body.response_format) {
        res.statusCode = 400
        res.end('{"error":{"message":"response_format is not supported"}}')
        return
      }
      res.setHeader('content-type', 'text/event-stream')
      const messages = body.messages as Array<{ content: string }>
      const last = messages[messages.length - 1].content
      if (/schema/.test(last)) {
        const reply = planReplies.shift() ?? '{"steps":[]}'
        res.end(sse([{ choices: [{ delta: { content: reply }, finish_reason: 'stop' }] }]))
        return
      }
      if (body.tools) {
        res.end(
          sse([
            { choices: [{ delta: { content: 'Let me ' } }] },
            { choices: [{ delta: { content: 'look.' } }] },
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_9',
                        function: { name: 'read_file', arguments: '{"path":' }
                      }
                    ]
                  }
                }
              ]
            },
            {
              choices: [
                { delta: { tool_calls: [{ index: 0, function: { arguments: '"b.txt"}' } }] } }
              ]
            },
            { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }
          ])
        )
        return
      }
      res.end(
        sse([
          { choices: [{ delta: { content: '', reasoning: 'Thinking first.' } }] },
          { choices: [{ delta: { content: 'Hello' } }] },
          { choices: [{ delta: { content: ' there' }, finish_reason: 'stop' }] }
        ])
      )
      return
    }
    res.statusCode = 404
    res.end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const address = server.address()
  base = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}/v1` : ''
})

afterAll(() => {
  server.close()
  rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  seen.length = 0
  refuseFormat = false
  planReplies = []
})

describe('OpenAICompatibleProvider', () => {
  it('lists LM Studio first and reports a card per endpoint, marking a remote one', async () => {
    const p = new OpenAICompatibleProvider(fetch, 'http://127.0.0.1:1')
    p.addEndpoint('team', 'http://llm.internal:8000', 'sk-team')
    p.addEndpoint('here', base)
    const statuses = await p.statuses()
    expect(statuses.map((s) => s.id)).toEqual(['lmstudio', 'endpoint:team', 'endpoint:here'])
    expect(statuses[0]).toMatchObject({ label: 'LM Studio', running: false, custom: false })
    expect(statuses[1]).toMatchObject({ running: false, remote: true, custom: true })
    expect(statuses[2]).toMatchObject({ running: true, remote: false, detail: '1 model' })
    expect(p.endpoint('team')?.hasKey).toBe(true)
    expect(p.endpoint('here')?.hasKey).toBe(false)
    p.removeEndpoint('team')
    p.removeEndpoint('here')
    expect(p.endpoints().map((e) => e.name)).toEqual(['lmstudio'])
  })

  it('refuses a bad name, a bad url, and the built-in name', () => {
    const p = new OpenAICompatibleProvider(fetch, 'http://127.0.0.1:1')
    expect(() => p.addEndpoint('Bad Name', base)).toThrow(/lowercase/)
    expect(() => p.addEndpoint('ok', 'nowhere')).toThrow(/http:\/\/ or https:\/\//)
    expect(() => p.addEndpoint('lmstudio', base)).toThrow(/built-in/)
    expect(() => p.removeEndpoint('lmstudio')).toThrow(/built in/)
  })

  it('offers chat models with endpoint-qualified ids and leaves embeddings out', async () => {
    const p = new OpenAICompatibleProvider(fetch, base)
    const models = await p.listModels()
    expect(models).toHaveLength(1)
    expect(models[0]).toMatchObject({
      id: 'openai-compatible/lmstudio/qwen-7b',
      model: 'lmstudio/qwen-7b',
      label: 'qwen-7b',
      local: true,
      capabilities: { tools: true }
    })
  })

  it('sends the key as a bearer token', async () => {
    const p = new OpenAICompatibleProvider(fetch, 'http://127.0.0.1:1')
    p.addEndpoint('keyed', base, 'sk-secret')
    await p.listModels()
    expect(seen.find((s) => s.path === '/v1/models')?.auth).toBe('Bearer sk-secret')
    p.removeEndpoint('keyed')
  })

  it('streams a turn and returns the tool call as an Anthropic block', async () => {
    const p = new OpenAICompatibleProvider(fetch, base)
    const deltas: string[] = []
    const result = await p.turn({
      model: 'lmstudio/qwen-7b',
      system: 'sys',
      messages: [{ role: 'user', content: 'read b' }],
      tools: [readFile],
      maxTokens: 100,
      onText: (d) => deltas.push(d)
    })
    expect(deltas.join('')).toBe('Let me look.')
    expect(result.stopReason).toBe('tool_use')
    expect(result.content[1]).toMatchObject({
      type: 'tool_use',
      id: 'call_9',
      name: 'read_file',
      input: { path: 'b.txt' }
    })
    const request = seen.find((s) => s.path === '/v1/chat/completions')!
    expect(request.body.model).toBe('qwen-7b')
    expect(request.body.stream).toBe(true)
    expect((request.body.tools as unknown[]).length).toBe(1)
  })

  it('completes a prompt as streamed text', async () => {
    const p = new OpenAICompatibleProvider(fetch, base)
    const tokens: string[] = []
    const thoughts: string[] = []
    const text = await p.complete({
      model: 'lmstudio/qwen-7b',
      system: 'sys',
      user: 'hi',
      maxTokens: 10,
      onToken: (t) => tokens.push(t),
      onThinking: (t) => thoughts.push(t)
    })
    expect(text).toBe('Hello there')
    expect(tokens).toEqual(['Hello', ' there'])
    expect(thoughts).toEqual(['Thinking first.'])
  })

  it('plans with response_format, and without it when the server refuses the field', async () => {
    const p = new OpenAICompatibleProvider(fetch, base)
    planReplies = ['{"steps":[{"title":"one"}]}']
    const plan = await p.plan({
      model: 'lmstudio/qwen-7b',
      system: 'sys',
      user: 'do it',
      tool: readFile
    })
    expect(plan).toEqual({ steps: [{ title: 'one' }] })
    expect(seen.at(-1)?.body.response_format).toMatchObject({ type: 'json_schema' })

    seen.length = 0
    refuseFormat = true
    planReplies = ['```json\n{"steps":[{"title":"two"}]}\n```']
    const fallback = await p.plan({
      model: 'lmstudio/qwen-7b',
      system: 'sys',
      user: 'do it',
      tool: readFile
    })
    expect(fallback).toEqual({ steps: [{ title: 'two' }] })
    expect(seen.map((s) => Boolean(s.body.response_format))).toEqual([true, false])
  })

  it('retries once on a non-JSON plan and then reports it', async () => {
    const p = new OpenAICompatibleProvider(fetch, base)
    planReplies = ['I cannot.', 'Still no.']
    await expect(
      p.plan({ model: 'lmstudio/qwen-7b', system: 'sys', user: 'do it', tool: readFile })
    ).rejects.toThrow(/did not return a usable plan/)
    planReplies = ['nope', '{"steps":[]}']
    await expect(
      p.plan({ model: 'lmstudio/qwen-7b', system: 'sys', user: 'do it', tool: readFile })
    ).resolves.toEqual({ steps: [] })
  })

  it('says which endpoint is not answering', async () => {
    const p = new OpenAICompatibleProvider(fetch, 'http://127.0.0.1:1')
    await expect(
      p.complete({ model: 'lmstudio/x', system: '', user: 'hi', maxTokens: 5 })
    ).rejects.toThrow(/LM Studio is not answering at http:\/\/127\.0\.0\.1:1/)
    await expect(
      p.complete({ model: 'nowhere/x', system: '', user: 'hi', maxTokens: 5 })
    ).rejects.toThrow(/does not name a known endpoint/)
  })
})
