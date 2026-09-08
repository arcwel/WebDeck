# Document Studio

Document Studio renders structured text as **styled documents** instead of raw
source. Open a supported file from the **Files** tree, drop it on the window, or
pick it with **Open file…**, and rather than a wall of plain text you get a
formatted view — with a one-click toggle back to the source whenever you want
it, and the file editable and saveable in place.

## Supported formats

| Format                          | Rendered as                                                   |
| :------------------------------ | :------------------------------------------------------------ |
| **Markdown** (`.md`)            | A styled document — headings, tables, code blocks, task lists |
| **JSON** (`.json`)              | A readable tree, and a graph of the structure                 |
| **YAML** (`.yaml` / `.yml`)     | A readable tree, and a graph of the structure                 |
| **TOML** (`.toml`)              | A readable tree, and a graph of the structure                 |
| **CSV / TSV** (`.csv` / `.tsv`) | A table                                                       |
| **XML** (`.xml`)                | A readable tree                                               |
| **SVG** (`.svg`)                | The image, with its source a click away                       |
| **Slides** (`*.slides.md`)      | A Reveal.js presentation (see below)                          |

Markdown documents also render:

- **Mermaid diagrams** — fenced ```mermaid blocks become real diagrams (drawn with
  `securityLevel: 'strict'`, and rendered under the page's Trusted Types policy).
- **Math** — inline and block math.

Toggle back to the raw source at any time with a single click.

## Slide decks

A file named `*.slides.md` becomes a **Reveal.js presentation**:

- `---` on its own line starts a **new slide** (horizontal).
- `--` starts a **vertical** slide beneath the current one.
- The first `# Heading` becomes the deck title.

The deck is served locally and **live-reloads** when you save the file, so editing
in the Editor block re-renders the presentation instantly. From the deck you can
export the slides to a **self-contained HTML** file or to **JSON**.

The slide runtime binds to loopback only and requires a literal-loopback `Host`
header, so a deck is never reachable from the network.

## Exporting

Beyond the slide exports above, a rendered document can be exported to:

- **HTML** — a standalone file.
- **PDF** — printed from the rendered view (the print step runs with scripts
  disabled, so exporting is safe).
- **PNG** — a captured image of the view.

## Opening documents

Three ways in, all landing in the same view:

- Click a file in the **Files** tree of the open project.
- **Drop** a file on the window, from Finder or anywhere else.
- **Open file…** from the menu, which uses the native open panel.

A document opened from outside a project opens at its own path, not as a copy —
see [Files from outside a project](#files-from-outside-a-project).

## Source files

Source and plain text — Python, JavaScript and TypeScript, Go, Rust, Java, C
and C++, shell, SQL, CSS, `.txt`, `.log`, `.ini` and the rest — open in the
source view, a full editor on the stage, with **Open in Editor** to take the
file into the Deck. The styled and graph views are not offered for them, since
they have no styled form.

## Files from outside a project

A file dropped on the window or picked with **Open file…** opens at its own
path, not as a copy, and the browser signs that path so the page can name
nothing it was not given. The view reloads on a change event inside the open
project, right after each save from the editor, and every 30 seconds for a file
outside any project, where no event ever arrives. Such files come back after a
relaunch like any other tab, for as long as they still exist.

## Related

- [Getting Started](getting-started.md) — the Files block and the Dev Deck.
- [`PRD.md`](../PRD.md) — the full Document Studio scope and roadmap.
