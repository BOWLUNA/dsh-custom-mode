# Tests

English | [中文](README.zh.md)

```sh
node test/run.mjs
```

One entry point runs all thirteen suites and resolves the "shipped presets directory" itself (it is not
in this repository; it comes from the installed `@deepseek-ai/dsh-agent-presets`):

```
Shipped presets directory: /…/dsh-agent-presets/presets
(source: $DSH_HOME/profiles/node_modules)
──────── composition.test.mjs ────────
… result: 63 passed, 0 failed
──────── composition-edge.test.mjs ────────
… result: 26 passed, 0 failed
──────── prompt-reader.test.mjs ────────
… result: 15 passed, 0 failed
──────── prompt-tool.test.mjs ────────
… result: 37 passed, 0 failed
──────── meta.test.mjs ────────
… result: 45 passed, 0 failed
──────── editor-route.test.mjs ────────
… result: 51 passed, 0 failed
──────── seed.test.mjs ────────
… result: 31 passed, 0 failed
──────── locales.test.mjs ────────
… result: 65 passed, 0 failed
all 13 suites passed (presets source: $DSH_HOME/profiles/node_modules)
```

**662 checks** in total (on a runtime without zstd — Node < 22.15 — the session-trace suite skips its frame-based checks; `tools/verify-doc-numbers.mjs` says so instead of failing). Only `composition.test.mjs` needs that shipped directory; the other twelve bring
their own fixtures, temporary directories and stubs, and can be run on their own directly.

There are three resolution paths, and any one of them hitting is enough: the
`DSH_SHIPPED_PRESETS_DIR` environment variable → Node resolution from this file (the path an
npm-installed dsh takes in CI) → `$DSH_HOME/profiles/node_modules` (the path taken when dsh is
installed locally). When all three miss, it prints **which paths it tried**, rather than throwing a
bare `ENOENT`. To specify it by hand:

```sh
DSH_SHIPPED_PRESETS_DIR=/path/to/dsh-agent-presets/presets node test/run.mjs
```

A single suite can also be run on its own:

```sh
node test/composition.test.mjs   # requires the directory above to resolve
node test/locales.test.mjs       # no shipped preset needed; pure dictionary/wording
node test/prompt-reader.test.mjs # no dsh needed: drives the persona section's text provider
node test/prompt-tool.test.mjs   # no dsh needed: copies the tool module to a temp dir, then imports it
node test/meta.test.mjs          # no dsh needed: redirects the write location with DSH_CUSTOM_PROMPT_PATH
node test/composition-edge.test.mjs  # no dsh needed: the shipped preset uses self-built fixtures
node test/editor-route.test.mjs      # no dsh needed: stubs ctx / req / res, drives the real handler
node test/seed.test.mjs              # no dsh needed: builds its own source and target directories
```

CI (`.github/workflows/test.yml`) runs `npm install @deepseek-ai/dsh@<the adapted version>` on every
push, then `node test/run.mjs` — it tests the **real shipped text**, not a self-made fixture.

## What these tests protect against

`composition.mjs` performs **text surgery** (preserving shipped comments and `!!js` expressions), so
most of its failure modes are **silently wrong behaviour** rather than a thrown error. The tests
target exactly that class:

- **Untouched rows must stay byte-identical** — otherwise a platform condition is lost, or a row that
  ships disabled is turned on.
- **`disabled` must be anchored to this row's own indentation** — otherwise disabling a group rewrites
  a child row's key instead, with no effect at all.
- **Re-joining must be lossless** — otherwise comment lines fuse with YAML keys and produce a corrupt
  configuration.
- **An empty range must return an empty string** — otherwise every group gains a blank line before its
  first row.

All five of these bugs really occurred in the past; the tests were added after they appeared.

`locales.test.mjs` additionally guards against the **hardest-to-spot** class of drift:
`editor/locales.mjs` is the single source of truth for the wording, but the browser half cannot import
it (hand-written bundle, no bundler), so `client.js` holds a **hand-copied duplicate**. It now
extracts both dictionaries from `client.js` and compares them entry by entry against `locales.mjs` —
changing only one side fails CI outright, rather than waiting for a user of some language to see stale
wording.

`prompt-tool.test.mjs` and `meta.test.mjs` fill in two gaps that the docs **claimed but did not
actually have**: the `custom_prompt` tool (the editing channel when there is no browser) previously
had not a single test; the README said `preset.yml` "has a round-trip test", but no test had ever
imported `meta.mjs`. Both test files redirect their own write location to a temporary directory (one
by "copying the module over and then importing it", the other via `DSH_CUSTOM_PROMPT_PATH`), so they
never touch the repository's `preset/prompt.md` and `preset/preset.yml`.

`prompt-tool.test.mjs` also carries a **drift guard**: the validation logic for `{{variable}}` exists
in two copies, in `editor/index.mjs` (the settings-page write path) and `preset/prompt-tool.mjs` (the
tool write path), duplicated on purpose. It extracts the function from the latter's source and
compares the two verdicts over the same input table — a split verdict means one path accepts a form
the renderer throws on, i.e. every request in that mode fails. This is the same class of risk as the
dictionary drift in `client.js`, only with heavier consequences.

`editor-route.test.mjs` is the one that most needed to exist in this test suite: the `editor/index.mjs`
it covers is exactly the half where the security fix lives, and it previously had **no test at all**
(the fix was verified by hand with curl at the time). Manual verification proves "it was right at that
moment"; it cannot stop someone later from moving the fence after method dispatch, or forgetting to
fail closed. It drives the real handler with stubbed `ctx`/`req`/`res`, and its first assertion is
that **a rejected request must produce no side effect whatsoever** (a 401 POST must not rewrite the
file).

`composition-edge.test.mjs` uses its own built shipped fixtures to cover inputs that the shipped files
do not have today but that manual editing or a future version might produce. Two of its assertions are
easy to write backwards by assumption, and are worth recording separately:

- **An untouched row keeps its `\r` too** (the same thing as "byte-identical"), so the output is **not
  guaranteed to be all LF** — CRLF input produces mixed line endings;
- **"Explicitly turning on a row that is already enabled on this platform" is a no-op**, and must not
  be recorded as an override when the switch is inferred back — this is a necessary consequence of the
  tri-state semantics, not a defect.

`seed.test.mjs` covers the preset seeding a one-command install depends on: a storefront installs a
plugin with a single command, and the npm package is all that command carries. It asserts that missing
files are created, that an existing `prompt.md` or a generated `agent.cordis.yml` is **never**
overwritten, that a second activation writes nothing, that an unwritable home is reported instead of
thrown, and — because the package necessarily holds a second copy of the preset — that
`editor/preset/` stays byte-identical to `preset/`.
