# Arcwel WebDeck — User Documentation

A browser that builds. Browse the web full-screen; press **⌘D** and a full IDE —
editor, terminal, files, source control, debugger, and an agent — slides in around
the page you're already looking at.

## Guides

| Guide | What it covers |
| :-- | :-- |
| **[Getting Started](getting-started.md)** | Install and run, the first five minutes, the Dev Deck blocks, and keyboard shortcuts. |
| **[Permission Modes](permission-modes.md)** | How the agent is gated — Secure / Review / Agent / Custom — the decision table, confirmation prompts, and the audit log. |
| **[Agent Workflows](agent-workflows.md)** | The plan → approve → execute → verify loop, the composer, and managing conversations. |
| **[Document Studio](document-studio.md)** | Styled Markdown and data documents, Mermaid and math, slide decks, and exporting. |
| **[Settings Sync](settings-sync.md)** | Keep settings, policy, model, and theme the same across machines via a local-first file — no account, no server. |

New here? Start with **[Getting Started](getting-started.md)**.

## Reference (project root)

These live at the repository root and go deeper than the user guides:

- [`PRD.md`](../PRD.md) — product requirements and technology decisions
- [`DESIGN.md`](../DESIGN.md) — the Dev Deck's design spec and motion
- [`IDE_FOUNDATION.md`](../IDE_FOUNDATION.md) — why the IDE runs on VS Code's services
- [`SECURITY.md`](../SECURITY.md) — trust boundaries, the agent's limits, residual risks
- [`SETTINGS_ARCHITECTURE.md`](../SETTINGS_ARCHITECTURE.md) — which settings are Chromium's and which are WebDeck's, and the menu each is reached from
- [`CHROMIUM_MIGRATION.md`](../CHROMIUM_MIGRATION.md) — the move to an upstream Chromium fork
