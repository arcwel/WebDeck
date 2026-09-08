# Local models: a deployment plan

A plan, with its first two phases now built: the seam and the Ollama provider,
Settings → AI → On this Mac, and the composer picker. Phases 2 to 4 remain.

## The ask

Let WebDeck's agent and its page assistant run on a model that lives on this
machine — no key, no network, nothing leaving the computer — alongside Claude,
which stays the default and the reference for quality.

## What is there today

Everything that talks to a model is in one file, `app/src/core/domains/agent.ts`,
and it talks to exactly one provider through the Anthropic SDK, at three points:

| Call        | What it does                                                                                                                          | What it needs from a model                                                                            |
| :---------- | :------------------------------------------------------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------- |
| **Plan**    | One request with a forced `create_plan` tool call; the steps go to the user for approval                                              | Structured output that matches a schema                                                               |
| **Execute** | A streaming loop: text streams to the transcript, `tool_use` blocks run against the workspace, results go back, until the model stops | Tool calling with JSON-schema arguments, streaming, multi-turn tool results, a clear "I am done" stop |
| **Ask**     | The page assistant: a question plus the page's text, answered as a stream                                                             | Streaming text                                                                                        |

Around them: an allowlist of Claude model ids the settings will accept, the
chosen model kept in `ai-config.json` and pushed through WebDeck Sync, keys in
the OS keychain under a provider name (`anthropic` / `openai` / `gemini`), a
scripted mock provider behind `AGWEB_AGENT_MOCK=1` that the tests run on, and
a status the UI reads that means "an Anthropic key exists". The agent's
twenty-odd tools are written as Anthropic tool definitions.

So the shape of the work is clear: put a provider seam where the SDK is called
directly, keep the Anthropic implementation exactly as it is behind that seam,
and add local implementations beside it.

## Runtimes, in the order they should land

| Tier | Runtime                                                   | Why this order                                                                                                                                                                                | How it is reached                                                                                                                            |
| :--- | :-------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **Ollama**                                                | Installed on this Mac already (0.33.3) with a tools-capable model; the most common local runtime; its own API exposes model lists, pulls, capabilities and context length, which the UI needs | `http://127.0.0.1:11434` — `/api/chat` for tools, thinking and streaming; `/api/tags`, `/api/show`, `/api/pull` for discovery and management |
| 2    | **Any OpenAI-compatible server**                          | LM Studio, llama.cpp's server, vLLM, Jan and most others speak this; one implementation covers them all                                                                                       | A base URL, `/v1/models` for discovery, `/v1/chat/completions` with `tools` and `stream: true`                                               |
| 3    | **Apple's on-device model** (macOS 26, Foundation Models) | Zero install, small, private; good for Ask, not for the agent (no tool loop of the size we run)                                                                                               | A small helper in the browser process, later                                                                                                 |

Not viable: Chromium's own built-in model. It arrives through Google's
component updater, which an unbranded Chromium does not have.

Not bundled: we do not ship a runtime inside the app. Ollama is MIT and could
be, but it is a 100 MB moving target with its own updater and GPU stack. The
app detects what is installed, offers the install link when nothing is, and
can start `ollama serve` itself when the binary is present and the user says
so. A managed llama.cpp inside the core is a later option if detection proves
too fiddly for users.

## Architecture

**A `ModelProvider` interface** in a new `app/src/core/domains/models/` domain:

```
plan(task, context)                      → steps, validated against the plan schema
execute(messages, tools, onText, signal) → stream of text deltas and tool calls, then a stop
ask(prompt, context, onToken, signal)    → stream of text
models()                                 → what this provider can run, with capabilities
health()                                 → reachable, version, what is loaded
```

Three implementations behind it:

- `anthropic.ts` — the code that exists today, moved, unchanged in behaviour,
  still using the Anthropic SDK, adaptive thinking and the server-side
  fallbacks. It stays the reference: every local provider is measured against
  it.
- `ollama.ts` — the native API, because it gives us things the compatible one
  does not: `think: true` streams the model's reasoning into the transcript
  the way Claude's does, `format` takes a JSON schema for the plan step, and
  `/api/show` tells us whether a model can call tools before we let it try.
- `openai-compatible.ts` — one client for tier 2, with a base URL and an
  optional key; the plan step uses `response_format` with a schema where the
  server supports it and a validated JSON instruction where it does not.

**The conversion layer** is the real work, and the part that gets the tests:
Anthropic content blocks to chat messages and back, tool definitions
(`input_schema` → `parameters`), tool results (`tool_result` blocks → `tool`
role messages), and stop reasons. Golden tests pin each conversion in both
directions, and a recorded fake server lets the loop run in CI without a
model.

**Model ids become provider-qualified**: `anthropic/claude-opus-5`,
`ollama/qwen3.5:9b`, `openai-compatible/<endpoint-name>/<model>`. The
allowlist that refuses unknown ids today becomes a registry the providers
fill at runtime.

**Capabilities gate what a model may do.** A model that cannot call tools
can serve Ask but not the agent, and the picker says so rather than letting a
run fail on its first step. Context length comes from the runtime; the core
sets it explicitly (Ollama's `num_ctx`) rather than trusting a default, and
caps tool output harder for local models than for Claude.

**The synced preference stays cloud-only.** The chosen model syncs across
machines today; a local model on one machine does not exist on another. The
choice splits into a synced cloud choice and a per-machine local override,
resolved local-first, kept in `ai-config.local.json` beside the synced file.

## UI and UX

**Settings → AI gains a "Local models" section.**

- One card per runtime: _Ollama · running · 2 models_ / _LM Studio · not
  running_ / _Custom endpoint_. A runtime that is installed but not running
  gets a Start button; one that is missing gets the install link.
- Under each, its models with the badges that matter: size, context, and
  _tools · thinking · vision_ as found by the runtime, not assumed.
- For Ollama, _Pull a model…_ with a recommended list sized to the machine's
  memory — on 24 GB, a 9B model at 4-bit is comfortable and a 30B
  mixture-of-experts is possible; on 8 GB, a 4B model — with download
  progress in the card.
- Per model: _Use for Agent_ / _Use for Ask_, and _Test_, which sends one
  short prompt and shows time-to-first-token and tokens per second, because
  that number is what decides whether a local model is pleasant.
- A custom endpoint that is not on loopback shows a plain warning that page
  text and workspace files will be sent to it, and takes the same deliberate
  typing a key does.

**The composer's model picker** groups by where the model runs: _Cloud_
(Claude, as now) and _On this Mac_ (each local model, with its capability
badges). The status dot goes blue for local, and the label reads
`qwen3.5:9b · on this Mac`. A model that cannot run the agent is listed under
Ask only.

**The Agents block** shows provider and model on its status line, and
"Runs on this Mac — nothing leaves it" when local is in force. When the
machine is offline and a local model is configured, the block offers it
rather than reporting a failed cloud call.

**Permission modes** are unchanged. Smaller models are more open to a page
that tells them what to do, so a local model defaults to Review-driven, and
switching one to Full autonomy carries the same confirmation the guards
already put in front of the money and identity toggles.

## Workflows

1. _First local run._ Settings → AI → Local models shows Ollama running with
   `qwen3.5:9b` (tools · thinking · vision). Click _Use for Agent_. In the
   composer the dot turns blue. Give a task; the plan arrives from the local
   model; approve; the run proceeds with the same transcript, tools and
   permission prompts as with Claude.
2. _Nothing installed._ The section shows the Ollama install link and a
   one-line explanation. After install, the card flips to _running_ on its
   own; _Pull a model…_ suggests one for this machine's memory.
3. _Offline on a plane._ The composer notices the cloud call cannot start and
   offers the local model in one click; Ask on a page uses it too.
4. _A team endpoint._ Add a custom endpoint at `http://llm.internal:8000`,
   see the warning, type the address, pick a model from `/v1/models`, and
   use it for the agent. The address is per-machine and never syncs.
5. _Back to Claude._ Pick Claude in the composer; the local choice is
   remembered for next time.

## Deployment, in phases

Each phase ships on its own, behind the gates the rest of the app uses, and
is verified on the real window on this Mac with `qwen3.5:9b` before it is
called done.

| Phase                     | Work                                                                                                                                                                            | Proof it works                                                                                                                                                      |
| :------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0 — the seam**          | `ModelProvider`, the Anthropic implementation moved behind it, the mock provider as a second implementation, provider-qualified ids, the split of synced and per-machine choice | No behaviour change: the existing agent tests pass unchanged; a run with Claude reads the same transcript                                                           |
| **1 — Ollama**            | The native provider for Ask and Agent, detection and health, the settings section, the picker groups, capability gating, the offline offer                                      | On this Mac: a plan and a three-step agent run end to end with the network cable out, and Ask on a page; conversion golden tests; a recorded-server loop test in CI |
| **2 — OpenAI-compatible** | The generic provider with a custom endpoint card, LM Studio detection on its default port                                                                                       | The same run against LM Studio and a llama.cpp server; the non-loopback warning verified in the window                                                              |
| **3 — models**            | Pull with progress, remove, the memory-sized recommendations, the Test button, embeddings through the local runtime for workspace search later                                  | Pull a model from empty and run with it; a bad model id reports plainly                                                                                             |
| **4 — Apple on-device**   | Ask on macOS 26 through Foundation Models, no install                                                                                                                           | Ask on a page with no runtime installed                                                                                                                             |

Phase 0 is small and unblocks everything. Phase 1 is the bulk of it.

### Phases 0 and 1: built and verified

On this Mac with `qwen3.5:9b` (Ollama 0.33.3): Ask answers on a page, the
agent plans, waits for approval and writes a file in about twenty seconds,
the picker groups Cloud and On this Mac, refusals read as sentences (a model
that is not pulled, one that cannot call tools, an id the build does not
know), and a QA pass drove the installed build through menu, tab, split,
reader and small-window scenarios with a clean console.

How failure surfaces, by design:

| When                                       | What the user sees                                                                       |
| :----------------------------------------- | :--------------------------------------------------------------------------------------- |
| Ollama is not answering                    | The endpoint and how to start it, in Settings → AI, the Agents banner and the transcript |
| An answer is cut off mid-stream            | "Ollama's answer was cut off before it finished."                                        |
| A plan takes longer than three minutes     | The session ends with a timeout instead of spinning                                      |
| The model garbles a tool call's arguments  | The turn ends naming the tool; nothing runs with an empty input                          |
| A model's capability probe fails           | The model is still offered (as able to call tools) and probed again next time            |
| The per-machine choice file cannot be read | A warning in the core log; the choice falls back to the cloud model                      |

The model's plan goes through the same bounds as a user's edit of it (known
kinds, bounded titles, no untitled steps) before it is shown for approval.

## Risks, stated up front

- **Small models call tools badly.** The agent offers many tools; a 9B model
  loses accuracy as the list grows. Local providers get a reduced tool
  profile — the file, command and browser tools that matter, not all
  twenty — and the plan step validates its JSON and retries once before
  giving up with a readable message.
- **Memory.** Chromium and a model compete for the same RAM. The settings
  section shows what a model needs against what the machine has, and the
  recommendations err small.
- **Latency.** First tokens from a cold model take seconds. The transcript
  shows a _loading model_ state rather than a blank pause, and Test puts the
  number in front of the user before they commit.
- **Runtime drift.** Ollama's API moves. The provider pins to the endpoints
  used here and reports its version in health, so a breaking change shows up
  as a clear line in Settings rather than a silent failure.
- **Prompt injection.** Unchanged in kind, worse in degree with smaller
  models. The permission engine and guards remain the safety net; the
  default mode for local models says so.

## What is deliberately out

- Running the model inside the browser process or the core. A runtime that
  ships separately is a runtime someone else keeps working.
- Fine-tuning, embeddings-based memory, and model routing across cloud and
  local in one run. Each is a plan of its own once the seam exists.
- Telemetry of any kind about which models are used.

## CLI opportunities

Every action here should be one command as well as a click, for the agent
and for scripts:

1. `webdeck-core models list --json` — runtimes found, models, capabilities,
   which is in force for Agent and Ask.
2. `webdeck-core models use ollama/qwen3.5:9b --for agent` — the same choice
   the picker makes.
3. `webdeck-core models pull qwen3.5:9b --json` — Ollama pulls with progress
   lines.
4. `webdeck-core models test <id>` — one prompt, time-to-first-token and
   tokens per second, exit code 0 when it answered.

## Open for review

1. Ollama first, then OpenAI-compatible — or both in phase 1?
2. The recommended default local model for this Mac: `qwen3.5:9b` is already
   here and does tools, thinking and vision; is that the one we point new
   users at?
3. Should a local model be allowed in Full autonomy at all, or held to
   Review-driven?
4. Detect-and-link, or ship a managed runtime later?
