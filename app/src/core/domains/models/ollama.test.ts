// @vitest-environment node
// The core runs under Node, and so does its fetch: the DOM environment the
// renderer tests use swaps AbortSignal for its own, which Node's fetch rejects.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { OllamaProvider, toOllamaMessages, toOllamaTool } from './ollama'
import type { ChatMessage, ToolDef } from './types'

/**
 * The seam speaks Anthropic's shapes; Ollama speaks its own. Everything that
 * crosses is converted here, and a fake Ollama pins what actually goes on the
 * wire — a run against a real model is the proof, but a run against a real
 * model is not a unit test.
 */

const readFile: ToolDef = {
  name: 'read_file',
  description: 'Read a file.',
  input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
}

describe('conversion to Ollama', () => {
  it('turns a tool definition into a function tool', () => {
    expect(toOllamaTool(readFile)).toEqual({
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Read a file.',
        parameters: readFile.input_schema
      }
    })
  })

  it('turns an assistant tool call and its result into tool_calls and a named tool message', () => {
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
    expect(toOllamaMessages(messages)).toEqual([
      { role: 'user', content: 'Task: read it' },
      {
        role: 'assistant',
        content: 'Reading.',
        tool_calls: [{ function: { name: 'read_file', arguments: { path: 'a.txt' } } }]
      },
      { role: 'tool', content: 'hello', tool_name: 'read_file' }
    ])
  })

  it('drops thinking blocks and keeps text, since Ollama has no place for replayed reasoning', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 'x' },
          { type: 'text', text: 'Done.' }
        ] as ChatMessage['content']
      }
    ]
    expect(toOllamaMessages(messages)).toEqual([{ role: 'assistant', content: 'Done.' }])
  })
})

describe('against a fake Ollama', () => {
  let server: Server
  let endpoint = ''
  const requests: Array<{ path: string; body: Record<string, unknown> }> = []

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = ''
      req.on('data', (chunk) => (raw += chunk))
      req.on('end', () => {
        const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
        requests.push({ path: req.url ?? '', body })
        const json = (value: unknown): void => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(value))
        }
        if (req.url === '/api/version') return json({ version: '0.33.3' })
        if (req.url === '/api/tags')
          return json({
            models: [
              { name: 'qwen3.5:9b', size: 6_600_000_000 },
              { name: 'nomic-embed-text:latest', size: 300_000_000 }
            ]
          })
        if (req.url === '/api/show') {
          const model = body.model as string
          return json(
            model.startsWith('nomic')
              ? { capabilities: ['embedding'], model_info: {} }
              : {
                  capabilities: ['completion', 'tools', 'thinking'],
                  model_info: { 'qwen35.context_length': 262144 }
                }
          )
        }
        if (req.url === '/api/chat') {
          const messages = body.messages as Array<{ role: string; content: string }>
          const last = messages[messages.length - 1]
          if (body.stream === false) {
            // The plan: JSON shaped by the schema handed in as `format`.
            return json({
              message: {
                role: 'assistant',
                content: JSON.stringify({ steps: [{ kind: 'edit', title: 'Do it' }] })
              },
              done: true,
              done_reason: 'stop'
            })
          }
          res.setHeader('content-type', 'application/x-ndjson')
          const lines: unknown[] =
            last.role === 'tool'
              ? [
                  { message: { role: 'assistant', content: 'All ' }, done: false },
                  { message: { role: 'assistant', content: 'done.' }, done: false },
                  { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }
                ]
              : [
                  { message: { role: 'assistant', content: 'Let me read it.' }, done: false },
                  {
                    message: {
                      role: 'assistant',
                      content: '',
                      tool_calls: [
                        { function: { name: 'read_file', arguments: { path: 'a.txt' } } }
                      ]
                    },
                    done: false
                  },
                  { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }
                ]
          res.end(lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
          return
        }
        res.statusCode = 404
        res.end()
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    endpoint = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })
  afterAll(() => server.close())

  it('reports the runtime and lists chat models with their capabilities, not embedding models', async () => {
    const ollama = new OllamaProvider(endpoint)
    const status = await ollama.status()
    expect(status.running).toBe(true)
    expect(status.version).toBe('0.33.3')
    const models = await ollama.listModels()
    expect(models.map((m) => m.id)).toEqual(['ollama/qwen3.5:9b'])
    expect(models[0].capabilities).toEqual({ tools: true, thinking: true, vision: false })
    expect(models[0].contextLength).toBe(262144)
    expect(models[0].local).toBe(true)
  })

  it('runs a turn that calls a tool, then a turn that answers with the result', async () => {
    const ollama = new OllamaProvider(endpoint)
    const deltas: string[] = []
    const first = await ollama.turn({
      model: 'qwen3.5:9b',
      system: 'sys',
      messages: [{ role: 'user', content: 'Task' }],
      tools: [readFile],
      maxTokens: 100,
      onText: (d) => deltas.push(d)
    })
    expect(first.stopReason).toBe('tool_use')
    expect(deltas.join('')).toBe('Let me read it.')
    const call = first.content.find((b) => b.type === 'tool_use') as {
      id: string
      name: string
      input: unknown
    }
    expect(call.name).toBe('read_file')
    expect(call.input).toEqual({ path: 'a.txt' })
    // The request asked to think, named the tool, and set an explicit context size.
    const sent = requests.filter((r) => r.path === '/api/chat').at(-1)!.body
    expect(sent.think).toBe(true)
    expect((sent.tools as unknown[]).length).toBe(1)
    expect((sent.options as { num_ctx: number }).num_ctx).toBeGreaterThan(8000)

    const second = await ollama.turn({
      model: 'qwen3.5:9b',
      system: 'sys',
      messages: [
        { role: 'user', content: 'Task' },
        { role: 'assistant', content: first.content as ChatMessage['content'] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: 'hello' }] }
      ],
      tools: [readFile],
      maxTokens: 100
    })
    expect(second.stopReason).toBe('end_turn')
    expect(second.content).toEqual([{ type: 'text', text: 'All done.', citations: null }])
    const replay = requests.filter((r) => r.path === '/api/chat').at(-1)!.body.messages as Array<{
      role: string
      tool_name?: string
    }>
    expect(replay.at(-1)).toMatchObject({ role: 'tool', tool_name: 'read_file' })
  })

  it('plans through the schema and returns the parsed object', async () => {
    const ollama = new OllamaProvider(endpoint)
    const plan = await ollama.plan({
      model: 'qwen3.5:9b',
      system: 'plan',
      user: 'Task',
      tool: { name: 'create_plan', description: 'Plan.', input_schema: { type: 'object' } }
    })
    expect(plan).toEqual({ steps: [{ kind: 'edit', title: 'Do it' }] })
    const sent = requests.filter((r) => r.path === '/api/chat').at(-1)!.body
    expect(sent.format).toEqual({ type: 'object' })
    expect(sent.stream).toBe(false)
  })

  it('streams a one-shot answer', async () => {
    const ollama = new OllamaProvider(endpoint)
    const tokens: string[] = []
    const text = await ollama.complete({
      model: 'qwen3.5:9b',
      system: 'ask',
      user: 'hi',
      maxTokens: 50,
      onToken: (t) => tokens.push(t)
    })
    expect(text).toBe('Let me read it.')
    expect(tokens.length).toBeGreaterThan(0)
  })

  it('says the runtime is down when nothing answers', async () => {
    const ollama = new OllamaProvider('http://127.0.0.1:1')
    const status = await ollama.status()
    expect(status.running).toBe(false)
    expect(await ollama.listModels()).toEqual([])
  })
})

describe('when Ollama misbehaves', () => {
  const turn = { model: 'qwen3.5:9b', system: 'sys', messages: [], tools: [], maxTokens: 100 }
  const ndjson = (lines: unknown[], tail = ''): Response =>
    new Response(
      lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : '') + tail,
      {
        headers: { 'content-type': 'application/x-ndjson' }
      }
    )
  const answering =
    (chat: () => Response): typeof fetch =>
    async (url) => {
      if (String(url).endsWith('/api/show')) return Response.json({ capabilities: ['completion'] })
      return chat()
    }

  it('refuses a tool call whose arguments are not readable JSON, naming the tool', async () => {
    const provider = new OllamaProvider(
      'http://fake',
      answering(() =>
        ndjson([
          {
            message: {
              role: 'assistant',
              content: '',
              tool_calls: [{ function: { name: 'run_command', arguments: '{not json' } }]
            },
            done: true,
            done_reason: 'stop'
          }
        ])
      )
    )
    await expect(provider.turn(turn)).rejects.toThrow(/"run_command".*not run/)
  })

  it('says the answer was cut off when the stream ends mid-line', async () => {
    const provider = new OllamaProvider(
      'http://fake',
      answering(() => ndjson([], '{"message":{"role":"assistant","content":"hel'))
    )
    await expect(provider.turn(turn)).rejects.toThrow(/cut off/)
  })

  it('says Ollama is not answering when the connection fails, with the endpoint', async () => {
    const provider = new OllamaProvider('http://127.0.0.1:1', async () => {
      throw new TypeError('fetch failed')
    })
    await expect(provider.turn(turn)).rejects.toThrow(/not answering at http:\/\/127\.0\.0\.1:1/)
  })

  it('offers a model whose capability probe failed, and does not cache that list', async () => {
    let tagCalls = 0
    const provider = new OllamaProvider('http://fake', async (url) => {
      if (String(url).endsWith('/api/tags')) {
        tagCalls++
        return Response.json({ models: [{ name: 'mystery:latest', size: 1 }] })
      }
      throw new TypeError('fetch failed')
    })
    const first = await provider.listModels()
    expect(first.map((m) => m.id)).toEqual(['ollama/mystery:latest'])
    expect(first[0].capabilities.tools).toBe(true)
    await provider.listModels()
    expect(tagCalls).toBe(2)
  })
})
