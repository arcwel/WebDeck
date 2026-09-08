# Arcwel WebDeck (repo: arcwel/WebDeck)

Arcwel WebDeck is a **standalone project in its own repository** (`arcwel/WebDeck`).

## Standing rules

- **New projects always get their own GitHub repository and their own project
  folder.** Never nest a new project inside an existing repository. If asked to
  "create a new project", create (or ask for) a new repo first.
- All AGWeb work happens here at the repo root: docs at the top level, the
  Electron app in `app/`.

## Layout

- `PRD.md` — product requirements (source of truth for scope)
- `TASKS.md` — phased build plan with live statuses
- `DESIGN.md` — Dev Deck design spec (stage reveal, blocks, multi-window)
- `RESOURCES.md` — techniques/libraries/repos used
- `app/` — Electron 37 + electron-vite + React 19 + TypeScript app
- `design/` — design-canvas artboards

## Development

```bash
cd app
npm ci
npm run dev        # develop
npm run lint && npm run typecheck && npm run build
xvfb-run -a node scripts/smoke.mjs smoke.png   # full E2E smoke test
```

The smoke test drives the built app end to end (browser, Dev Deck, editor,
terminal, Document Studio, agents with `AGWEB_AGENT_MOCK=1`). Run the full
pipeline before every push; CI (`.github/workflows/ci.yml`) runs the same steps.
