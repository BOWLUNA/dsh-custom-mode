# Changelog

English | [中文](CHANGELOG.zh.md)

The version number is this package's **own stable line** (`1.0.0`, `1.0.1`, …) and every publish gets
a new one. Which DSH it supports is declared in `engines.dsh` + the `@deepseek-ai/dsh` peer range, and
CI asserts the DSH version it actually installs and tests falls inside them — see the "Versioning"
section of the README. Entries from `0.1.6-alpha.*` and earlier follow the old convention (the version
mirrored the DSH release) and are kept as history.

## [1.9.9]

### Completes the busy-state edit protection, and corrects two inaccurate claims in 1.9.8

- **\`#6\` completed.** 1.9.8 only made the **prompt editor** read-only; the **description box and row switches
  stayed editable**, so text typed during a save round trip was still overwritten by the server's normalised
  result. Now a \`cpfe-busy\` class on the panel root plus one CSS rule disables interaction for every
  draft-mutating control, and the description box is read-only too. Re-verified in a real browser
  (latency forced to 4000 ms): **7/7**.
- **\`#8\` corrected: 1.9.8's "not fixed" was wrong.** Capturing the save request body shows
  \`overrides = {"ghost-row": false}\` — the fold into the draft does reach the wire. The earlier verdict came
  from an assertion that could not tell **"the row was removed"** from **"the row was re-enabled"**.
  (The \`base\`-row path remains unverified: building that fixture would require touching the global dsh install.)
- **Root-cause fix outside the plugin code**: \`release.yml\` now **creates a GitHub Release** when a tag is
  pushed. Before this it only published to npm, so the repository's Releases panel stayed on an old version and
  the repository looked unchanged even though the code was updated.

Tests: 725 checks.

## [1.9.8]

### "Fix for this line" damaged an unrelated group — plus five more defects an adversarial review and a real browser lab confirmed

After 1.9.7 came a round of **adversarial review plus real-browser lab testing** (79 assertions, 20 failing).
This release fixes five of them:

- **"Fix for this line" turned off unrelated capabilities** (data-corruption class). The flat second pass
  inside `disableRowsInPlace` delimited segments by "the next 4-space `- id:`", so a group's **last child
  swallowed the following top-level content** and `disabled` was written into the **next group**. Measured:
  with `dsh-plan-mode` missing, clicking fix turned off `plan-mode` and **`compaction` together** while
  reporting only the requested row. The pass was redundant (the top-level pass already recurses into every
  group via its `isGroup` branch); removing it takes collateral damage 7 → **0** and structural anomalies
  (line count Δ=+2) 6 → **0**.
- **`unresolvableRows` reported a healthy group as broken.** It walked the whole subtree, so `name` came
  from the **last child** — the page named a healthy group and "fix for this line" would disable it entirely.
  It now reads only the keys at the row's **own** indentation.
- **A broken prompt journal made an assistant impossible to open.** The write-through in `readState`
  (`recordExternalChange`) had no guard while 1.9.7 only guarded the read half, so the same corruption still
  turned GET state into a 500. It now follows the same rule as `saveState`: a failed audit line degrades to
  "this revision was not recorded" and never breaks the read.
- **The English UI could show Chinese punctuation.** Nine places that concatenated a translated sentence with
  hard-coded full-width punctuation now go through the dictionary (a new `status.detail` template, and
  `delete.description` now takes `{id}`). Measured: the English delete confirmation rendered
  `… cannot be undone.（custom）`.
- **Edits made during a save round trip were dropped silently.** While busy, `update()` no longer accepts
  draft changes (one place covering every draft field) and the editor becomes read-only; the result of
  "fix for this line" is now folded **into the draft** instead of being undone by the next save. Measured:
  text typed mid-round-trip went 108 → 83 characters, and a row switch flipped back.

Tooling: `tools/browser-verify.mjs`'s `openSection` **always failed on a clean instance** (`设置` is a
toggle while the code treated it as "open", and its retry loop was dead code because both `catch` blocks
re-threw). Fixed — all **57 assertions pass**; until now the "UI changes must be clicked through" gate that
`AGENTS.md` requires was red.

Tests: 698 → **725** checks.

#### Correction (2026-09-21, post-release — superseded by 1.9.9)

This section originally said \`#6\` / \`#8\` were not fixed. **The \`#8\` half was wrong**, and the \`#6\` half was only half right:

- **\`#6\`: the fix was incomplete, not ineffective.** The state-level guard worked; the problem was that I only
  added \`readOnly\` to the **prompt editor**, while the **description box and the row switches stayed editable**
  (\`document.querySelector('.cpfe textarea')\` returns the description box — it comes first in the DOM — which is
  also why the probe measured the wrong element). **Completed in 1.9.9**: a \`cpfe-busy\` class on the panel root
  plus one CSS rule that disables interaction, and the description box is read-only too.
  Re-verified in a real browser: **7/7**.
- **\`#8\`: the "not fixed" conclusion was wrong.** The assertion only looked for \`disabled: true\` after the row,
  so it could not tell **"the row was removed"** from **"the row was re-enabled"** — and it was the former:
  re-rendering walks the shipped base, and a row that is not in it gets dropped, leaving the mode **healthy**.
  Capturing the save request body also proves the client's fold **does** reach the wire
  (\`overrides = {"ghost-row": false}\`). With the corrected assertion: **6/6**.

> Same lesson as "a negative conclusion must first prove its trigger fired": **the assertion itself can be wrong.**
> An assertion that cannot distinguish two outcomes produces both false passes and false failures.

## [1.9.7]

### The approval gate could be walked around — and ten other defects confirmed by review

Three independent read-only reviews of the whole plugin turned up 15 reproducible defects. This release fixes the
ones that are security-relevant, violate a documented invariant, or leave a promise the code does not keep; the
rest are filed as issues with their reproductions.

**P0 — the in-session approval gate had a one-word hole.** The gate asked only for `action === 'write' | 'append'`,
while `execute` treated *any* action that was not exactly `read` or `append` as a full-file replace. So
`action: "replace"` — or `"Write"`, `"overwrite"`, `""`, or `"append "` with one trailing space — overwrote the
user's system prompt **with no approval panel**, which is precisely the failure the gate exists to prevent. The
gate now asks for everything that is not a pure read, and `execute` rejects unknown verbs explicitly instead of
falling through into the write path. Two independent layers, so a future edit to either cannot reopen it.

**P0 — a missing import made the "approval gate is off" warning permanent.** `rmSync` was used to clear the marker
file but never imported, so the `ReferenceError` was swallowed by the silent `catch`: once written, the marker
stayed, and the settings page warned "The approval gate is off" forever even on a host where the gate works.

**One bad journal file made an assistant unopenable, and made successful saves lie.** `readEntries` read
`prompt-history.jsonl` unguarded, so a root-owned (`chmod 000`) or directory-shaped history file 500'd every state
and history read — the page's entry point for that assistant — and made a save that *had* already written
`prompt.md` report `writeFailed`, leaving the page stuck on a stale draft. The read is now guarded (a bad file
costs the history, not the assistant), and the audit record runs outside the write `try`, because a record that
fails must never fail a save.

**A second missing import, in the reorder rollback.** `presetMetaPath` was used twice in `assistants.mjs` but never
imported, so the snapshot/rollback path threw, the error was swallowed, and the rollback loop skipped every entry.
A failed reorder was left half-applied on disk while the page said it had rolled back.

**Every user-visible result now carries a `code` — including the five that did not.** The page renders results
from its own bilingual dictionary; without a `code` it falls back to the host's Chinese string, so the English UI
turned Chinese at exactly the moments something went wrong. Fixed: `unknownAssistant()`, the four failure returns
of `createAssistantDir`, and `writePresetMeta`'s empty-name branch. Three codes that had **no dictionary entry at
all** (`bodyTooLarge`, `repaired`, `repairNotNeeded`) got one in each language.

**A control character in a name no longer bricks `preset.yml`.** `yamlScalar` escaped only `"` and `\`, so a BEL,
VT or NUL in a name or description produced a file the platform's js-yaml cannot parse — the mode then degraded to
its bare directory id in every picker, with description and `order` lost, while this plugin's own page still showed
the name. It now emits through `JSON.stringify`, whose escaping is exactly what a YAML double-quoted scalar needs;
output for ordinary names is byte-identical to before.

- `journal.mjs`'s two early returns also contradicted their own JSDoc by omitting `n`; they now always return it
  (`0` when nothing was recorded).

**A new guard (section 12)** asserts both halves against the source of **every** host module: every `ok: false`
return carries a `code`, and every code has a Chinese *and* an English entry in `locales.mjs`. It was validated
with a mutated copy, and immediately earned its keep: it caught a sixth code-less return the first time it ran,
and the first version of its own scanner was too weak to see one of them (a regex that paired an apostrophe in an
English comment with the next real quote and blanked a whole function) — fixed, because a guard that silently
checks less than it claims is worse than none.

**Documentation**: 1.9.3–1.9.6 were published without changelog entries; they are backfilled here.

Tests: 685 → **698** checks.

## [1.9.6]

### One badge style, not two

The two badge rows mixed shields' default style (rounded, taller) with flat-square, which is why no amount of
spacing tweaking made them line up. Row one (npm / CI / license) is now flat-square + logo as well, CI moving from
GitHub's own `badge.svg` to shields' workflow-status badge; the in-package README carries both rows too, since npm
renders that one. Measured and recorded: GitHub strips HTML `style="display:flex"` (verified with `POST /markdown`),
so spacing in a README cannot come from flex — matching the styles is the fix.

## [1.9.5]

### Storefront tidy-up

- The header image becomes **1280×640** (GitHub's recommended social-preview size), rendered by the jointly
  committed `docs/images/header.html` through headless Chrome, with a `header@2x.png` alongside it.
- All five screenshots become **1280×720 full-screen views** (they used to be cropped to each panel, so one table
  showed five different aspect ratios).
- A second community badge row (bilibili / Douyin / RedNote / Discord / Discussions), and CONTRIBUTING points at
  the now-enabled Discussions.

## [1.9.4]

### The npm page gets the header and screenshots too

npm renders the README **that sits next to `package.json`** — `editor/README.md` — not the repository root one, so
1.9.3's header and English screenshots only ever appeared on GitHub. The in-package README now carries the header
and the four screenshots as well, using the same absolute raw links.

## [1.9.3]

### Second external review — 11 confirmed defects fixed

Of four external reviews, 11 findings reproduced on this machine and were fixed:

- **P1 security**: upgrading never refreshed the **code modules** inside an assistant directory, so anyone who
  first installed on 1.0.x / 1.1.x kept a `prompt-tool.mjs` with no approval gate forever. The two code modules are
  now refreshed (atomic write) whenever they differ, while user data (`prompt.md`, `preset.yml`, the generated
  composition) stays fill-only.
- **P1**: `install.sh` still copied the packaged composition, which is rendered for one dsh line — moving to the
  other line made the platform mark the preset broken and drop the mode from every picker. It is no longer copied;
  the plugin derives it for the line actually installed.
- **P1 guards**: `picker-probe` looked for `Standard` while the English UI says `Standard mode`; `browser-verify`
  assumed a Chinese UI and failed ~20 checks on a cold English instance. It now switches to Chinese first and exits
  loudly if it cannot (measured on a real English instance: 57 checks, 0 failures).
- **P2**: "Fix for this line" no longer rewrites the persona section and loses comments; seeding uses the shared
  atomic write (Windows hit EBUSY when two processes shared `DSH_HOME`); a mode the platform dropped silently now
  logs a host warning on activation; Chinese punctuation in the English dictionary, `POST /state` clearing an
  unprovided description, and `publishConfig.tag` were all fixed.
- **Disproved** (with evidence): "the mode is visible but cannot be selected", and the REQUEST_EXTENSION P0, did not
  reproduce on either dsh line.

Images and docs: `docs/images` became **English-UI** screenshots (new script `tools/screenshots/run-shots-en.mjs`,
cropped to the panel), a new header `docs/images/header.png`, and README absolute raw links so the npm page can
render them.

## [1.9.2]

### Updating a user's install cleanly — and the reason a bare install lags

Three questions from the maintainer turned into one feature and one measurement.

**The measurement**: `dsh plugin --profile web add dsh-custom-mode` (no version) on a clean machine installed
**1.0.1** while `latest` was 1.9.0. Cause, isolated: `registry` is the real npmjs.org and
`pnpm config get minimumReleaseAge` is `undefined` — i.e. pnpm 12.4.2 applies its **default 24-hour cooldown**;
every version from 1.1.0 up had been published within the previous ~16 hours, and the newest one older than 24
hours was exactly 1.0.1. A pinned `@1.9.x` bypasses it. The README's Updating section now carries the pinned
command, the reason, and how to check what you actually got.

**The feature**: the settings page now shows the **installed version**, and when an assistant's composition has
enabled rows this dsh line cannot resolve — the P0 that makes the platform drop the whole mode from every picker —
it says so and offers **「Fix for this line」**. That action disables exactly those rows *in place*
(`disableRowsInPlace`), so hand-added or future rows are not silently discarded the way a full re-render would.
Repairing is idempotent, and the detector refuses to guess: with no `@deepseek-ai/` next to the shipped presets it
reports nothing rather than crying wolf (a false positive would talk a user into disabling a working row).
Platform conditions are **evaluated** (`disabled: !!js process.platform === 'win32'`) instead of pattern-matched,
which was the difference between "this row is off on my platform" and a false alarm.

Tests: 667 → **676** checks, including the report/repair round trip and the "does not touch other rows" assertion.

## [1.9.1]

> **Never published to npm.** The registry publish for this version was blocked by an account-side
> 2FA/token failure, so `latest` went straight from `1.9.0` to `1.9.2`. Everything below shipped in
> **1.9.2**; pinning `@1.9.1` fails — that is expected, not a packaging bug.

### Three reviews, one pass: documentation made true, two UI regressions fixed

**Documentation drift was the strongest convergent finding** (one review shipped a D1–D8 table of doc-vs-source
contradictions), and every row was real:

- `CONTRIBUTING.md` still told contributors the settings route lives on the **raw `webServer` table with a
  hand-rolled `requestRejection`** — the architecture removed in `1.0.3`. Rewritten (both languages) to describe
  the fenced `/api` channel, with the old shape kept only as a "do not restore this" history note.
- `.github/PULL_REQUEST_TEMPLATE.md` asked contributors to confirm "8 suites (… = 333)", that
  `requestRejection(req)` still runs, and that the version mirrors the dsh release. All three were years (well,
  days) out of date; it now points at `tools/verify-doc-numbers.mjs` instead of pasting counts.
- `SECURITY.md`'s support table listed a `1.0.0`–`1.0.6` range (only `1.0.0`–`1.0.4` were ever published) and
  marked two different rows as the "current development and verification target". Rebuilt from the registry.
- `README`'s install example was pinned to `@1.7.0`; `test/README.md` listed eight suites totalling 333.
- `tools/verify-doc-numbers.mjs` now also asserts that the README's pinned install version **is** the package
  version, so that class of drift fails in CI instead of waiting for a reviewer.

**Two UI regressions** (one of them mine):

- The mode's description in the picker was a **bilingual concatenation** ("完整编码能力…… / Full coding
  ability…") — the fix for the English-UI leak in `1.7.0` produced a string that is Chinese-first in an English
  UI and long enough to stretch the picker card. Shortened to one short bilingual line.
- The row **metadata claimed default states** that hold on one dsh line but not the other ("Ralph: off by
  default" — enabled in the stable line's shipped composition). The claims are gone; the row's details now show
  the **actual shipped state**, derived from the file (`row.disabled`), which is correct on any line. A lint
  fails the test suite if a row note claims a default state again.
- Switching the base mode now says so when it is changed but unsaved: the row list below is rendered from the
  **saved** composition, which a review read as "my click did nothing".

**Also fixed**: the 4 MB body cap trusted `content-length` (a chunked request could skip it) — it now checks the
bytes actually read, with a streamed-body test; and the change journal now uses the shared atomic write instead
of keeping a third private copy.

**Three claims checked and found wrong** (recorded in `docs/MEASUREMENTS.md` §23): "no GitHub Releases" (there are
v1.3.0–v1.9.0), the `1.0.0`–`1.0.6` range above, and "concurrent `GET /state` can interleave journal records"
(the append is synchronous and Node runs one callback at a time — cross-process contention is documented and is
a different thing).

Tests: 662 → **667** checks, browser verification 53 → **56**.

## [1.9.0]

### Section copy and the description field, from the same report

- Each of the four sections opened with a paragraph of 60–120 characters above the controls. They now show **one
  hint line** with a ▸ that opens the full explanation — the same pattern as the plugin rows, sharing the same
  expanded-state map. Not a word of the explanations was dropped.
- The **description field** was a single-line input while the description is bilingual, so the page showed
  `完整编码能力… / Ful` — it clipped its own content. It is now a `textarea` that grows with what it holds (the
  shell has no multi-line input primitive; the styling uses the same semantic variables as everything else).

Measured after: the description's `scrollHeight` fits inside its `clientHeight`, i.e. nothing is hidden.

**Both bugs this change introduced were caught by the browser verification, not by the suites**: the settings page
was throwing `ReferenceError: Cannot access 'draft' before initialization` (a `useEffect` above the state it reads)
and `TypeError: Cannot read properties of null (reading 'description')` (no assistant selected) while all 13
suites stayed green. Fixed, and four checks now cover the two complaints: 49 → **53** browser checks.

## [1.8.0]

### The plugin-row list now looks like the shell's own plugin page

Reported from real use: the per-row annotations took too much room, spacing was uneven, and some rows did not
wrap — "a long bar just hangs there". Measured before: 33 rows, 84–117px tall, two auto-fill columns, and a bare
row id (`tool-bash`, `planning`, …) as the second line. After: **one row per plugin**, uniform height (56–58px),
zero horizontal overflow, a single ellipsis-truncated description line (the full text is in `title`), and the
switch on the right — the shape the shell's own Plugins page uses.

Everything that is developer detail — the row id, the full note, whether the switch is untouched or set by you,
the platform condition — moved behind a per-row disclosure (▸). Nothing is expanded by default; the disclosure
is per session and not persisted.

`tools/browser-verify.mjs` grew four checks for exactly the complaints (height ≤ 64px, height spread ≤ 8px, no
horizontal overflow, every row has a toggle) and went from 44 to **49** checks. The disclosure itself is verified
by screenshot and DOM reading rather than by an automated click: measured in the WSL lab, the coordinate for a
pointer click occasionally races with a re-render, and a flaky assertion is worse than none.

## [1.7.1]

### Two of the checks added in 1.7.0 were environment-dependent

Both failed in CI on the first run, on two different jobs, and both were my checks rather than the product:

- **The documented count assumed a full runtime.** `test/README.md` says 662 checks; Node 20 has no zstd, so the
  session-trace suite skips its frame-based section and the same code produces 632 — the numbers check then
  correctly reported a drift that is not a drift. It now notices a skipped run, says why, and requires the
  documented figure to be an upper bound within the skipped range instead.
- **The approval-reason assertion had a length bound.** The reason carries the prompt path, so on Windows
  (longer paths) the bilingual line reached 304 characters and tripped a `< 300` bound. The assertion is now
  semantic and environment-independent: the 500-character body must not be embedded, and the 60-character
  preview must be — which is what "truncated" means.

Neither changed product behaviour. They are recorded because the point of the numbers tool is that a check
which only passes on one machine is not a check.

## [1.7.0]

### Fixed: on the stable dsh line the mode had disappeared from every picker

A review found it, and it was real: on `0.1.5-rc.2` (the npm `latest` line, i.e. most users' default) 「自定义模式」
never appeared in the new-session mode picker. The settings page still worked, which is exactly why our checks
stayed green.

The chain: our packaged seed template had been rendered from the **preview** line and enabled a row
(`workflow-ptc` → `@deepseek-ai/dsh-workflow-ptc`) that the stable line does not install at all; the platform's
health check marks a preset with an unresolvable **enabled** row as broken, and a broken preset is silently
dropped from the pickers.

- The seeded composition is now **derived from the composition the installed line actually ships**
  (`starterComposition()`), with the packaged file kept only as a fallback. `install.sh` no longer copies a
  composition, so the first activation writes the derived one.
- `test/seed.test.mjs` walks every enabled row of the derived composition and asserts its package resolves in
  this install. On the stable line it prints the template's own problem — the bug it prevents.
- New `tools/picker-probe.mjs` opens the real new-session picker over CDP and fails when an expected mode is
  missing: the one user-visible fact none of our checks covered (found by this review's §4).
- Verified on `0.1.5-rc.2`: the derived file, the roster and the picker
  (`["自定义模式","标准模式","PTC 模式","极简模式"]`), see `docs/MEASUREMENTS.md` §20.

### The English interface stopped leaking Chinese in the three places it still did

- An illegal `{{…}}` interpolation is rejected with a **code**, so the page renders it from its dictionary.
- The `custom_prompt` **approval reason** is bilingual. It is a security decision, and the panel is rendered by
  the platform, so the plugin cannot know the interface language — both languages on one line is the honest
  answer, not one of them.
- The seeded assistant's **description** is bilingual (the name stays 「自定义模式」: it is the brand and what the
  marketplace lists).

### Writes: one implementation, and the remaining races named rather than glossed over

- **All atomic writes now share one module** (`editor/atomic.mjs`): a review found `meta.mjs` writing
  `preset.yml` with a bare `writeFileSync` under a comment promising the opposite — and a corrupt `preset.yml`
  is precisely how a mode disappears from every picker.
- `saveState` stages **both** files before renaming either (`writeAtomicPair`), so the composition and the prompt
  no longer have a mixed-state window between two independent writes.
- `prompt-tool.mjs` (the in-session writer) gained the same rename retry and failure cleanup as the settings page.
- `reorderAssistant` rolls back the files it already wrote when a later write fails, instead of leaving a
  half-applied order.
- Saves are **serialised per assistant inside the process**. A review measured 1 failure in 10 concurrent saves
  on Windows even after the retry, because two handlers prepared and renamed the same pair of files at once; the
  retry covers the cross-process window, the serialisation removes the in-process one. Both are stated as what
  they are — this is no longer claimed to be impossible.
- A missing approval gate is no longer only a `console.error`: the preset side leaves a marker and the settings
  page shows a warning, so an old host cannot silently drop the gate.

### Documentation is now checked, not remembered

`tools/verify-doc-numbers.mjs` runs the suite and compares every documented count (suite count, check count, the
declared dsh range, the version in SECURITY's support table) with reality; CI runs it. It exists because this
review found three drifts in one pass that no test could see — and it immediately found two more of mine (the
Chinese README had kept "12 个套件、588 项", `test/README.md` "333 checks").

Also: the README's install command now carries the pnpm release-cooldown warning next to it (a bare
`dsh plugin add` 38 minutes after a release was measured landing on a 3-minor-old version), duplicate/deleted
toasts use display names instead of internal directory ids, the dictionary's dead duplicate key is gone (with a
duplicate-key check), the literal `**` markdown that rendered as asterisks is gone, and
`tools/session-trace.mjs` now rejects unknown arguments instead of ignoring them.

## [1.6.1]

### Two portability bugs in the trace tool, both found by CI

- **`import`ing the tool ran the CLI and called `process.exit`.** `main()` was invoked unconditionally at module
  scope, so a test that imported `decodeSessionLog` also ran the command line — which, on a machine without
  `~/.dsh/sessions` (i.e. every CI runner), exited 2 and killed the test process before a single check printed.
  It passed locally only because this machine *does* have a session store, so `main()` returned normally. The
  CLI now runs only when the file is the entry point (resolved through `realpath`).
- **Node 20 has no zstd**, so importing the module failed with
  `does not provide an export named 'zstdDecompressSync'` and took the whole Node 20 job down. The tool now
  imports `node:zlib` as a namespace, reports "this Node has no zstd support (v20.x): Node ≥ 22.15 required"
  and exits 2 instead of crashing at import; the suite prints why it is skipping the frame-based checks and
  still exercises the extraction logic that does not need zstd — a suite that silently passes by doing nothing
  would be worse than one that says why.
- `execFileSync('mkdir', …)` in the test became `mkdirSync` (there is no `mkdir` binary on Windows).

## [1.6.0]

### The trace reader can now *assert*: `--expect`, `--compare`, `--grep`, `--denied`

Turned a claim into a check. `--expect 'custom_prompt(read)=1'` compares the tally and exits 1 on any
mismatch, so "the model needed one call" is no longer a sentence in a changelog but something a reviewer or CI
can re-run. `--compare <A> <B>` reads two sessions (or two homes' latest) and prints a difference table sorted
by |Δ|, which answers "did this change make the agent take more or fewer steps?" — the question behind the
append work. `--grep` and `--denied` filter the listing.

Measured end to end on a real session (`docs/MEASUREMENTS.md` §19), which is also where the reader's own bug
turned up: **a real log stores `data.arguments` as a JSON string**, not an object, so the action suffix was
being dropped and the tool reported `custom_prompt` instead of `custom_prompt(read)` — synthetic logs (which
used objects) had not caught it. Fixed, and the real shape is now pinned by a test.

## [1.5.1]

### New: `tools/session-trace.mjs` — a session's tool calls in one command

Measurements in this repository often take the shape of "the model called this tool once / twice", and until
now the only way to read that was to open the trajectory tab in a browser and look. That gap let a wrong claim
through: a CHANGELOG line said "one tool call" while the session had two.

- Reads `$DSH_HOME/sessions/**/session.v3.jsonl.zstd` directly and prints each call (turn/step, tool,
  arguments, ok/denied) plus a per-tool tally, with `--summary` (counts only), `--json` and `--session`.
- Session logs are **multi-frame** Zstandard: Node's one-shot decoder returns the *first* frame and silently
  ignores the rest, which is exactly why a naive read looks like an empty session. The reader scans the frame
  magic and decodes from every candidate (false magics fail to decode and are skipped). Measured on a 9.3 MB
  log with 5,722 frames: all frames decoded, all 8,915 lines parsed, ~0.5 s.
- Undecodable input exits 2 with a message instead of pretending the session was empty.
- A test builds multi-frame logs itself, including a **stray frame magic** between two real frames, and pins
  the tally/denial classification and the CLI's exit code.

## [1.5.0]

### `custom_prompt` can append, and both writing actions are gated

An external review noted the tool could only overwrite the whole prompt, so an agent that just wanted to
remember one rule had to read the entire prompt and write it back — two calls, and a chance to lose content on
the way.

- New `action: "append"`: the text is added at the end (exactly one newline between blocks), the file is
  created if it does not exist, and the **combined** text goes through the same `{{…}}` validation as a
  hand-typed save — an append cannot smuggle an unregistered variable into the file.
- The approval gate covers **both** writing actions; its reason says which one it is
  (`…整体替换为 N 字符…` / `…追加到 N 字符…`).
- Measured in a real session: asked to remember a rule, the model chose `append` on its own. The trajectory
  shows the exact sequence — `custom_prompt{"action": "read"}` (not gated) then
  `custom_prompt{"action": "append", "text": "回复结尾不要出现征询式问句。\n"}` — the panel said
  `把「自定义模式」的系统提示词追加到 15 字符：…（写入 …/prompt.md）`, approving grew the file 258 → 273
  characters with the original text intact, and the platform logged 「系统提示词已更新」. Two tool calls, and
  that is the honest framing: the benefit is **not** "always one call" but "the whole prompt never has to be
  rewritten", which is what made the old path able to lose content.

### Documentation: the pair checker now also checks language purity

`MEASUREMENTS.md` had §16–§18 written in Chinese inside the **English** file (my own doing, and exactly what
the review meant by "mixed tails"). Those sections are now English, and `tools/verify-translation-pairing.mjs`
grew a fourth layer: an English side must not contain a run of ≥12 CJK characters and a Chinese side must not
contain a sentence of ≥10 ASCII words, with code fences, inline code and quoted spans skipped (quoting
upstream source or a UI label is legitimate). Verified by injecting a Chinese paragraph into `README.md` and
watching it fail on the right line.

## [1.4.1]

### The stable line ships a row the preview line does not — and the new CI matrix caught it

`0.1.5-rc.2` has a `workflow-worker-thread` row inside the delegation group
(`@deepseek-ai/dsh-workflow-worker-thread`, `provider: spawn`) that `0.1.6-alpha.2` no longer ships. Our row
label table had no entry for it, so the check "every shipped row can be looked up" failed on the stable line —
in CI, within minutes of the matrix gaining that line, and **not** in the manual stable-line pass I had run
before (which exercised install, the API and the browser, but not label coverage over every shipped row).

Added the label and its note (both languages), and re-ran the whole suite against **both** lines' shipped
presets before pushing (`DSH_SHIPPED_PRESETS_DIR=<stable>/… node test/run.mjs`). That command is the local
equivalent of what the matrix now does in CI.

## [1.4.0]

### Supports both dsh lines: the latest stable and the latest preview

Until now `engines.dsh` started at `0.1.6-alpha.1`, which **excluded the stable release** (`0.1.5-rc.2`) — so
stable users were told the plugin was unsupported. It was never true: measured on `0.1.5-rc.2`, everything
works. The declared range is now `>=0.1.5-rc.2 <0.2.0-0`, and CI installs **both** lines (stable on Ubuntu,
preview on Ubuntu ×2 + Windows) and asserts each one falls inside the range it was tested against.

Measured on `0.1.5-rc.2`: bundle registration, a healthy 542-line composition tree, the `/api` fence
(unauthenticated 401 / with session 200), `state`/`history`/`warnings`/`factoryPrompt` all present, and the
full browser verification **38/38**. The two host APIs we lean on — `tools/pre-execute` (approval seam) and
`connection.fetch.register` (fenced route channel) — both exist on the stable line.

### The English UI no longer falls back to Chinese when something happens

An external review called this the sharpest remaining defect: the host returned hard-coded Chinese `note` and
`error` strings, and the page displayed them verbatim — so an English user saw a fully English panel until the
moment they saved or hit an error, when the status line turned Chinese.

- Every user-visible host result now carries a **`code`** (plus `params` for the values the sentence needs:
  the assistant's display name, the base mode, a limit, a path, an underlying error). The page renders the
  message from its own bilingual dictionary, so it follows the interface language.
- The Chinese `note`/`error` strings are **kept** as the compatibility face of the HTTP API: an older client,
  or a caller reading the JSON directly, still gets a readable sentence. A test pins both halves.
- Names in those messages are **user data** and are never translated — the English status says
  `Saved (自定义模式, base mode standard)…` because that is what the assistant is called.
- Duplicate/delete messages use the assistant's display name instead of leaking the internal directory id.

Measured in a real browser (`tools/browser-verify.mjs`, 38 → 44 checks): switch the interface to English, edit,
save — the status message is English; switch back and the panel is Chinese again.

### Fixed: Windows concurrent saves, for real this time

An external review showed the previous fix was half a fix: randomising the temporary name removed the
tmp-vs-tmp collision but not the **destination** collision — on Windows two concurrent renames onto the same
target still fail with `EPERM`/`EBUSY` (measured: 2 of 10 concurrent saves returned 400), and the failure path
left orphan `.tmp-…` files inside the assistant directory (which the roster scans).

- `rename` now retries with a short backoff on `EPERM`/`EBUSY`/`EACCES` and rethrows anything else
  immediately; the retry is injectable, so it is pinned by a test that runs on Linux too.
- The failure path removes the temporary file.
- `editor/journal.mjs` had the same two problems (temporary name without randomness, no retry, no cleanup) —
  fixed the same way.
- The history's `bytes` figure is now real **UTF-8** size: it was `text.length` (UTF-16 code units) while the
  UI labels it "B", so CJK entries showed about a third of the true size.

## [1.3.0]

### The agent's own prompt rewrite now goes through the platform's approval seam

`custom_prompt`'s `write` action replaces the entire system prompt, and the caller can be an injected model —
the path had no gate at all. It now registers `tools/pre-execute` and answers `ask` for that action, which
hands the decision to the platform's approval policy. **Measured with a real model session** on
`0.1.6-alpha.2` (raw output in `docs/MEASUREMENTS.md` §17):

- approval policy `ask` (preset `workspace-write`): the panel 「等待审批」 appears with our reason — *what*
  will be written (char count + first line) and *where* — and 「允许一次」 really writes the file;
- approval policy `never` (preset `danger-full-access`): **no panel, the call is denied** and the file is
  untouched. So the worst case is "the change does not happen", never "it happened quietly";
- `read` and every other tool pass through untouched, so the gate cannot turn into wallpaper;
- if a host lacks `tools/pre-execute`, the plugin says so loudly instead of degrading silently.

### New: it points out settings that cannot take effect

Borrowed in spirit from the persona engine `whale-persona`, which names configured-but-inactive items: the
page now warns when 「身份（系统提示词）」 is off while `prompt.md` still has content (your prompt is being
ignored — the worst kind of silent contradiction), when the `custom_prompt` tool row is off, and when the
assistant has no name or description (the picker shows the bare id / 「暂无描述」). Warnings are returned as
codes so the wording stays in the bilingual dictionaries, and a test asserts a healthy assistant produces
**no** warnings — a false alarm teaches users to ignore the real ones.

## [1.2.0]

### New: change history for the system prompt

A prompt has three ways to change: this page saves it, the in-session `custom_prompt` tool rewrites it, and
a human edits the file. The last two were **invisible** — the page only ever showed "the current text".
Now every change leaves a version, listed under the prompt box with its time and where it came from, and
any version can be loaded back into the editor.

- **Append-only journal**, one file per assistant (`prompt-history.jsonl`), capped at 30 versions. A
  corrupted line is skipped rather than costing the user every version — the replay discipline the
  ecosystem's persona inbox uses, applied here to changes that *already happened* instead of proposals
  waiting for a yes.
- **Single writer**: only the host half writes the journal. The preset-side tool does not, because those
  files ship independently and the format would then have two implementations. Instead the host compares
  what is on disk with what the journal ends with when the page asks for state, and records an `external`
  revision when they differ — so a change made in a session shows up as *"changed in a session / by hand"*.
  The honest limitation: only the state on leaving is recorded, not every intermediate edit; this is an
  audit trail, not version control.
- **Versions are keyed by a sequence number, not a timestamp** (measured: two records can land in the same
  millisecond, and keying on the timestamp returns the neighbour).
- **Loading a version only edits the draft**, exactly like typing: nothing reaches disk until you save, so
  browsing history cannot destroy the current prompt (Reload discards it).

Verified in a real browser (`tools/browser-verify.mjs`, 26 → 34 checks).

## [1.1.0]

### New: "Reset to factory prompt"

An edited prompt could previously only be recovered by deleting the assistant and creating it again — there
was no way back. The system-prompt block now has a third button:

- **「恢复出厂提示词」** puts the **shipped template** (the text a new assistant starts from, i.e.
  `editor/preset/prompt.md`) back into the editor.
- It is **draft-only**, like every other edit on the page: nothing is written until you save, and
  Reload discards it — so a misclick cannot destroy a prompt. The button disables itself when the editor
  already shows the factory text.
- The host half sends the template with the state response (`factoryPrompt`); if it cannot be read, the
  button is disabled rather than writing something wrong, and the reason goes to the host log.
- The reset text goes through the same `{{…}}` validation as anything typed — a test saves it verbatim to
  prove the "reset → save" path works.

Verified in a real browser (`tools/browser-verify.mjs`, now 26 checks): the button renders, the click
replaces the editor text with the factory text, and Reload still restores the pre-click text (i.e. it
really was a draft).

### Also

- Screenshots regenerated: `05-assistant-manager.png` no longer repeats `01`'s content (it is cropped to
  the assistant section, 800×292), and the screenshot tool no longer calls the pre-`1.0.3` route path.

## [1.0.4]

### Windows support: three platform defects an external review found by testing there

Windows had never been tested. A review ran the whole thing on it (npm install, four install paths, the API
surface, an attack simulation, a real browser, load tests) and found defects that only appear there.

- **`install.sh` / `uninstall.sh` crashed in Git Bash.** `$(pwd)` is an MSYS path (`/c/Users/…`); embedded
  inside `node -e "require('$ROOT/…')"` it is no longer path-translated, so Windows' node died with
  `MODULE_NOT_FOUND` — and because that line ended in `|| echo '?'`, the version self-check silently degraded
  to `?` in exactly the environment that needed it. Paths now go through `tools/package-facts.mjs` by
  **relative** path, and a failed read is reported instead of rendering as `?`.
  `test/manifests.test.mjs` asserts both scripts keep this shape (verified by re-introducing the old line and
  watching it fail).
- **Concurrent saves could fail with `EPERM` on Windows.** `writeAtomic`'s temporary name was
  `<file>.tmp-<pid>`, so two in-flight saves in one process shared it; on POSIX `rename` atomically
  overwrites and the race is invisible, while Windows locks the target. The name now carries a random suffix.
  (`preset/prompt-tool.mjs`, the in-session write path, had the same shape of problem from the other side: it
  wrote non-atomically while the settings page already wrote atomically. It is atomic now too, in both
  packaged copies.)
- **Four test assertions were hardcoded to Linux.** They assumed the shipped `tool-bash` row
  (`disabled: !!js process.platform === 'win32'`) evaluates to "on", which is only true off Windows. They now
  derive the expected branch from the shipped state on the machine that runs them, so both platforms are
  correct — and CI gained a **`windows-latest` job** so this can never silently regress again.
- **A backstop on request size** (4 MB): `requestBody: 'buffered'` leaves the cap to the host's configuration,
  and the review measured a 5 MB body reaching the handler. The platform's cap stays the primary guard.

### Documentation drift the same review caught

- TROUBLESHOOTING §7 said the version **follows the official one**, contradicting this project's own
  versioning policy (and the package in hand): rewritten to describe the stable `1.0.x` line and the declared
  `engines.dsh` / peer range.
- TROUBLESHOOTING §9 and SECURITY still described the pre-`1.0.3` fail-closed `503`: updated to the structural
  fence (nothing is registered at all when `connection` is absent), and the "which version am I running"
  check now looks for `webServer.register(` instead of the removed `connectionRejection`.
- TROUBLESHOOTING §17's pnpm-delay claim no longer reproduces on pnpm 12.3.4 (measured): kept, but marked as
  version/config-dependent, with the "pin the exact version" advice left intact.
- The READMEs now state the verified platforms.

## [1.0.3]

### The HTTP surface moved onto the platform's fenced `/api` channel

An external review pointed out that this plugin registered its routes on the raw `ctx.webServer` table and
called `ctx.connection.requestRejection` itself, while the platform ships a fenced alternative
(`ctx.connection.fetch.register`, used by four official packages). Verified, then migrated.

- **Routes now go through `ctx.connection.fetch.register(...)`** — the shared `/api` channel, whose carrier
  applies the loopback/`trustedHosts` Host check, `Sec-Fetch-Site`/`Origin`, and the browser-session cookie
  **before** dispatching. The hand-rolled check is gone, so the fence is **structural**: a route cannot
  exist without it. This is the same class of mistake that produced the pre-`1.0.1` vulnerability — the old
  code had to *remember* to check.
- **Five exact routes** (`/api/custom-mode`, `/api/custom-mode/state|c reate|delete|reorder`): the Fetch
  registry matches exact paths, and the registered path includes the `/api` prefix (which is what the
  platform's own packages pass). The method table moved into the registrations, which strengthens the old
  guarantee — an undeclared method is never dispatched at all, so a `GET` on a POST-only path is a 404 from
  the channel rather than a 405 from us.
- The handler is Fetch-shaped (`(Request) => Response`), and every response carries
  `cache-control: no-store` (the page displays this state; a cached `state` read would show stale rows).
- Bodies use `requestBody: 'buffered'`, so the platform's configured JSON cap applies instead of our own
  hand-rolled 4 MB check.
- `test/editor-route.test.mjs` no longer simulates request-reading middleware. It asserts the **structure**:
  all five registrations on `connection.fetch`, the method sets per path, that a method the route does not
  declare never reaches a handler, and that the source contains no `requestRejection(` call and no
  `webServer.register(`. It also asserts that a scoped `inject` which never receives `connection` registers
  nothing at all.

Measured on dsh `0.1.6-alpha.2` (see `docs/MEASUREMENTS.md` §16 for both the 20-line probe that established
the API's real behaviour and the post-migration re-check): unauthenticated `401`, cross-site and
host-spoofed `403`, with session `200`, the old bare path `404`, and an unauthenticated `POST` that leaves
`prompt.md` untouched. Real-browser verification: **21/21**.

## [1.0.2]

### Fixed, after an external critical review (every item reproduced)

- **Explicitly switching a row back on no longer deletes its shipped platform condition.** Saving
  `off` then `on` used to splice the `disabled:` line out, leaving a file that was neither the shipped
  text nor an explicit override — while the page reported the row as untouched. It now **restores the
  shipped form** when that form already means "on" here (so a Linux click stops changing what Windows
  sees), and writes a literal `disabled: false` only when the shipped form really is off here.
- **A literal `disabled: false` was read as "disabled".** `describeRow` treated *any* literal as off, so
  the fix above would have been misread by our own reader; the value is now checked, not just its presence.
- **"Untouched" is now judged by text form, not by evaluated value**: a `!!js` expression whose result
  happens to equal a literal is still an override, so the page's "changed" marker matches the disk.
- **The Chinese settings page showed an English paragraph** in the system-prompt block (and it differed
  from the English one). Translated, and `locales.test.mjs` gained a guard that fails when a Chinese value
  is a full English sentence — key parity alone could never catch this.
- **Base mode semantics are now disclosed** in the UI and the READMEs: the base decides which *rows* exist;
  this plugin always replaces the base's `persona` row with its own reader (`complete: false`), so the
  base's prompt semantics are not inherited. Minimal is the visible case — minimal's tool set, not its prompt.
- **`node test/run.mjs` works on a machine whose only dsh is a global install** (and which has never been
  started): the resolution chain gained the node prefix, hoisted or nested. It previously exited 2 with a
  hint that did not apply.
- **Writes are atomic** (temporary file + `rename` in the same directory), so the prompt reader's
  mtime/size cache can no longer observe a half-written file.
- **`engines.dsh` and the peer range now have an upper bound** (`>=0.1.6-alpha.1 <0.2.0-0`) instead of
  claiming compatibility with every future dsh.
- `install.sh`: the `tui` summary no longer promises a `custom_prompt` tool that can never mount (without
  `agent-presets` nothing mounts that preset at all), and the stale `--preset-id` / `DSH_CUSTOM_PROMPT_PATH`
  advice is gone.
- Documentation drift that the review found: the README/CONTRIBUTING test counts (they said 8 suites/333
  checks; it is 11/520), `SECURITY.md` still marked the route fix "unreleased" (it shipped in `1.0.1`), and
  `PUBLISHING.md` still described the retired `.revN` practice in the present tense.

### Still open (tracked, not fixed here)

- The route is still registered on the raw `ctx.webServer` table and runs
  `ctx.connection.requestRejection` itself. The platform ships a fenced alternative —
  `ctx.connection.fetch.register({ path, methods, requestBody, fetch })`, which registers **below `/api`**
  where the carrier applies trust and authentication before dispatch — and four official packages use it.
  Migrating makes the fence structural instead of a discipline; it is a deliberate, separately verified
  change (host + client + tests + docs), not a drive-by edit.

## [1.0.1]

### Discoverability: how people find this plugin

- **npm metadata**: the package description no longer claims "follows the DSH version" (untrue since `1.0.0`),
  and `keywords` went from 5 to 14 — npm search reads them, and they only reach npm with a new version.
- **Repository**: description rewritten with the words people actually type; topics grew to 17, all of them
  honest (`custom-prompt`, `prompt-editor`, `agent-modes`, `multi-mode`, `assistant-manager`, …) plus the
  mandatory `dsh-plugin`.
- **README / npm landing page**: both now say in one line what this is and list the synonyms people search
  for ("custom prompt", "system-prompt editor", 多助手／多模式), because on GitHub and npm the page text is
  the index.
- **Social preview image** (1280×640) is generated and committed as `docs/images/social-preview.png`; the
  upload step is web-UI-only, and `docs/PUBLISHING.md` now documents it — it was previously recorded in a
  commit message and never actually applied.

### Fixed in the npm landing page (`editor/README.md`)

- It told first-time users to clone the repository — untrue since `0.1.6-alpha.1`, when the npm package started
  carrying the preset and seeding it on activation.
- The peer range was stated as `>=0.1.2-alpha.1` while the package declares `>=0.1.6-alpha.1`.
- The Measurements link pointed at the renamed `实测记录.md`, i.e. it was broken.

## [1.0.0]

### Versioning: the package gets its own line

- The package version becomes **`1.0.0`** and no longer mirrors the DSH release. `0.1.6-alpha.2` and the
  versions before it were the last of the mirroring line; the code in `1.0.0` is that code plus this
  versioning change.
- Why: several directories and markets only auto-install a **bare `x.y.z`** — one desktop market
  resolves npm `latest` and rejects anything carrying a prerelease tag, and mirroring an alpha DSH
  release made every version a prerelease. Compatibility is now stated where it can be checked:
  `engines.dsh` and the peer range, both `>=0.1.6-alpha.1`.
- `tools/verify-version-consistency.mjs` was rewritten to match: instead of asserting that the version
  string equals the CI-pinned DSH version, it asserts that the **CI-pinned DSH version satisfies the
  declared ranges**, and that the package version is a bare `x.y.z`. That is the claim worth checking;
  the old check only proved two strings agreed.
- The old `.revN` suffix (used when a repackaged build could not reuse a version number) is retired:
  every publish bumps the version.

## [0.1.6-alpha.2]

### Version number follows dsh `0.1.6-alpha.2`

- The version moves from `0.1.6-alpha.1.rev2` to **`0.1.6-alpha.2`**, and the `@deepseek-ai/dsh@<version>`
  pinned in CI moves with it: `tools/verify-version-consistency.mjs` asserts the two agree, which is what
  stops "CI green on the old runtime while the published package claims a version it never saw".
- The previous section's "Pending: the version bump needs a workflow edit" and "Pending release with the
  next version number" are both resolved by this release.
- Every conclusion was re-measured on dsh `0.1.6-alpha.2`: the unit gate, and the **real-browser
  verification** on the lab.

### Several assistants: one settings page managing many custom modes

- The settings page grew from "one mode" into an **assistant manager**: it lists every custom mode with
  **create / switch / delete**, and the four blocks below (name, base mode, plugin switches, system
  prompt) edit whichever one is selected.
- **Each assistant's system prompt is independent.** One assistant is one directory under the user
  preset root, and its `prompt-reader.mjs` / `prompt-tool.mjs` resolve `prompt.md` relative to **their
  own module location**, so N copies are N independent prompts. The `custom_prompt` tool edits only its
  own file too.
- **Creation** seeds the packaged template (`editor/assistants.mjs`): a fresh Standard-based composition
  plus the starter prompt. A name that is already a legal id (an English word) becomes the directory
  name; anything else falls back to `custom`, `custom-2`, …
- **Deletion** goes through the platform's `agentPresets.remove(id)`: a shipped preset is refused by the
  platform, and so is a directory outside the writable root. Deletion affects **new sessions only**;
  sessions already using it keep running (their composition was read when they started).
- **Only presets this tool created are managed.** The test is that the directory carries `prompt.md` and
  that its composition injects identity through `prompt-reader.mjs`. A hand-authored preset is neither
  listed nor touched — a save regenerates the composition from a base mode, and doing that to a
  hand-written file would destroy it.
- **A deleted assistant does not come back.** The first-run seed happens only on a genuine first run
  (recorded by a `.custom-mode.json` marker under the root). Every activation still repairs all managed
  directories by filling in MISSING files only, which rescues the case where a composition row names a
  deleted module and the whole mode reads as broken and vanishes from the picker.
- The route changed from one `exact` path to one **`prefix`** path covering `GET /custom-mode` (the
  list), `GET /custom-mode/state?id=`, and `POST /custom-mode/state|create|delete`, with a per-path
  method table (`GET /custom-mode/create` is a 405 — a prefetched link must not create an assistant).
- The `custom_prompt` description now names **its own** assistant (the composition row's
  `config.modeName`, falling back to the `preset.yml` beside the module). An older assistant's older
  module ignores that key — deliberately, since the module lives in the user's directory and activation
  must not overwrite their files; `./install.sh` refreshes the modules and keeps `prompt.md`.

### Interface and ergonomics (second pass)

- **Controls now come from the shell's own atoms**: `Button` / `Input` / `Switch` / `Tag` / `Pill` /
  `RiskConfirmation` and the icons all come from `@deepseek-ai/dsh-client-ui-primitives`. It sits in
  the shell's **seed table** beside `react`, so it is a plain `require` — no bundler, and no
  `dsh.client.external` declaration. The payoff: theme, light/dark, density and future restyling apply
  automatically, instead of a hand-copied visual spec that is guaranteed to go stale.
- **Degrade, don't blank**: with no atom module (an older shell) the page falls back to built-in plain
  controls with the **same prop contract**; with no `RiskConfirmation`, deletion falls back to a
  native `confirm` rather than losing the guardrail.
- **Switching assistants no longer discards drafts**: each assistant keeps its own unsaved edits
  (`entries[id]`), marked 「未保存」 in the list. The only path that throws edits away is the reload
  button, which renames itself to say so while a draft exists.
- **New "Duplicate"**: copies the source's prompt, base mode and row switches into a new assistant;
  the two are independent afterwards.
- **Deletion moved to `RiskConfirmation`**: permanently deleting the user's own prompt deserves an
  explicit acknowledgement, not a second click next to the primary button.
- **Base mode is now a pill selector**, with the selected mode's description on its own line.
- **An assistant with a broken composition** is flagged in the list (the roster's `broken`) instead of
  being a mode that simply refuses to open.
- Added a route-constant drift guard (the browser and host halves each hard-code the path) and tested
  `client.js`'s atom probe along both branches — atoms present and atoms missing.

### Interface fixes and ergonomics (third pass)

- **Fixed "the whole page renders raw keys" (`assistant.heading`, `btn.create`)** — a failure observed in
  the field. The cause: dsh `0.1.6-alpha.2`'s `settings.section` contract **no longer has a `locale:`
  option**, so the shell does not hand over a `t` bound to this namespace; the nav label went through the
  page's own `locale.bind()`, which could not resolve either. The shell's `t` is still preferred when it
  answers, and **the bundle's own zh/en dictionaries are now the floor** — a key that is in the table can
  never render raw; language switches re-render through `locale.subscribe()`. A test builds a shell whose
  `t` echoes the key and drives this path, verified to go red against the old code.
- **A failed registration is no longer silent.** `ctx.effect` swallows exceptions thrown by its callback
  (measured), so "registration failed" and "everything is fine" looked identical from outside — page
  present, console quiet, all copy raw. Registration now catches, warns with the reason, and re-reads once
  to tell "refused" apart from "registered but the host cannot see it".
- **Assistant ordering**: "Move up / Move down" writes the position into each `preset.yml` (`order`, the
  roster's own sort key), so it survives a restart, is visible in the file, and has no second copy to
  drift from; a rename preserves it.
- **Prompt import / export**: export saves the current text as `.md`; import reads a file into the
  **editor** rather than straight onto disk, so it goes through the same `{{…}}` validation; 1 MB cap,
  empty files refused.
- **Two UI gaps closed**: `Switch`'s `label` is its `aria-label` only (no visible text), so the row title
  is rendered here — otherwise every switch was nameless; `Input`'s wrap is `inline-flex`, so full-width
  fields need an explicit class.

### Real-browser verification (fourth pass)

- **New `tools/browser-verify.mjs`**: drives a real browser over a CDP port and asserts that no raw
  translation keys are visible, that the copy is translated, that every switch has a visible row
  title, that the nav entry is not a raw key, and that a full 「create → appears → risk confirmation
  → acknowledge → delete permanently → gone」 round trip works in the browser.
- **The page it renders has now been seen**: on the lab (with dsh upgraded to
  `0.1.6-alpha.2`) it reports **21/21 passed**, and the screenshot was inspected by eye. That closes
  the long-standing blind spot of "every suite green, nobody ever looked" — which is exactly what
  produced the wall of raw keys in `docs/ARCHITECTURE.md` §15.
- The two traps the verifier hit are recorded too: the settings panel is itself `[role=dialog]` (so
  a confirmation must be found by content among all dialogs), and `RiskConfirmation`'s tick and click
  must be two ticks apart.
- The assistant list container gained a `.cpfe-assistants` class: self-describing DOM, and it lets the
  verifier tell those pills apart from the base-mode selector.
- **Working guides**: `~/.dsh/AGENTS.md` (global, every session) and the workspace `AGENTS.md` now
  carry the machine inventory, the lab recipe, the npm-tag trap for upgrading dsh, and the rule that
  the session machine's dsh is never restarted.

### npm

`dsh-custom-mode@0.1.6-alpha.2` is published, with **both** the `alpha` and `latest` tags pointing at it
(ship `alpha` without moving `latest` and the marketplace's one-command install stays on the old
version — see `docs/PUBLISHING.md`).

Verified after publishing as the documentation requires, rather than trusting "publish succeeded":

- an anonymous `npm pack` pulls the tarball: its 16 files are **byte-identical** to the repository,
  including this release's new `assistants.mjs` and the updated `prompt-tool.mjs`;
- a throwaway `DSH_HOME` installs it from the registry for real: it resolves `0.1.6-alpha.2`, lands as a
  real directory (not a symlink), and the composition carries the `custom-mode` row;
- booting that instance logs 「已播种 preset …（新建 5 个文件）」, the route lists the assistant,
  `GET /custom-mode` still answers 401 unauthenticated, and this release's `/reorder` endpoint exists.

### Tests

Eleven suites with **520 checks** in total (the previous release had eight suites and 333 checks). Two
suites are new and three existing ones grew:

- `assistants` (68) — the multi-assistant core: which directories count as "this tool's" (the narrow
  test is a safety boundary), id allocation, creating from the template, first-run seeding and adoption,
  "deleting everything does not resurrect anything on restart", and reordering including its refusals.
- `client-bundle` (32) — the browser half's registration contract, previously untested: it loads the
  bundle the way the client module loader does and runs `apply` against a stand-in `ctx`, asserting the
  bundle id equals the package name, that `exports.inject` carries `slots`/`locale`, every field of the
  `settings.section` registration, and the failure policy — along both degradation paths, "the shell's
  dictionary cannot be found" and "the shell has no shared atom library".
- `editor-route` (45 → 112) — from one `exact` route to five endpoints (list / read / save / create /
  delete / reorder), the per-path method table, a guard against the browser and host halves drifting on
  the route constant, duplicating an assistant, plus the original fence and validation branches.
- `meta` (45 → 53) — `order` round trips, and "a rename must preserve it".
- `manifests` (13 → 16) — "npm's `files` whitelist must cover every module the runtime imports" (a
  measured lesson: miss one file, notice nothing locally, and the published package fails on activation).
## [0.1.6-alpha.1]

Adapted to dsh `0.1.6-alpha.1`. Grouped by theme; order within a group is not chronological.

### Verified against dsh `0.1.6-alpha.2` (version not moved yet, see Pending)

- **Every shipped mode gained one row upstream** (`tool-plugin-manager`,
  `@deepseek-ai/dsh-plugin-manager/tools`). Nothing had to change for it: the compiler reads the
  shipped composition at runtime, so a regenerated composition picks the new row up by itself — it
  only lacked a display label, which is now supplied in both languages.
- **New drift guard**: `composition.test.mjs` asserts every shipped row id has a `ROW_META` entry.
  An upstream release that adds a row now turns CI red instead of silently rendering a bare id.
- **The settings-page slot contract is unchanged.** `settings.section` is still `kind: list`,
  `scope: root`, and `dsh-client-ui-slots@0.1.6-alpha.2` still documents the `locale:` registration
  option that supplies the bound `t` seat — so the page does not change shape.
- All eight suites pass against the `0.1.6-alpha.2` presets.
- **`test/seed.test.mjs` no longer fakes an unwritable directory with `chmod 0o500`.** Root bypasses
  permission bits, so three assertions were green on CI and red for anyone running as root — a test
  whose result depended on who ran it. The path is now blocked by a regular file, which fails with
  `ENOTDIR` for every user.
- **A storefront install from the repository URL used to be a silent no-op.** The new Plugins page
  accepts a package name, a repository URL, or a local directory. Pasting the repository URL installed
  the whole repository — whose **root manifest had no `dsh` field at all** — so pnpm reported success,
  no bundle row was inserted, the host half never ran, and the setup silently did nothing. The root
  manifest now declares `main`, `exports["./client"]` and `dsh.bundle.patch` pointing into `editor/`,
  which makes all three inputs work; `test/manifests.test.mjs` asserts the two manifests agree on
  name, version and every declared path. Measured before the fix: the two versions had already drifted
  (`0.1.6-alpha.1` vs `0.1.6-alpha.1.rev2`) with nobody noticing.
- **The new row ships disabled in `standard`/`ptc`** (only `cordis` enables it), so the existing
  "rows that ship disabled stay disabled until touched" test now covers it — and the per-row switch is
  the only way to turn it on inside a Standard-based mode, since upstream keeps agent-preset rows
  read-only.
- **`tools/sync-client-dictionaries.mjs`** regenerates the dictionaries inlined in `client.js` from
  `locales.mjs` (with `--check`). The bundle cannot import, so those copies were hand-written — which
  is exactly how this release's new entries went missing from the bundle at first.

### Pending: the version bump needs a workflow edit

Moving to `0.1.6-alpha.2` means changing `editor/package.json` **and** the pinned
`@deepseek-ai/dsh@…` in `.github/workflows/test.yml` in the same commit;
`tools/verify-version-consistency.mjs` fails when only one moves. That workflow file needs the
`workflow` token scope, so the bump is left to an operator holding it. Until then the project stays on
`0.1.6-alpha.1`. The full coupling-point check against `0.1.6-alpha.2` — every declaration this project depends on, compared against the new tarballs — is recorded in `docs/MEASUREMENTS.md` §10, together with the suite passing against both versions' shipped presets.

### Marketplace install

- **The npm package now carries the preset, and the host half seeds it on activation.** A storefront
  install is one command, and the package is all that command carries: before this,
  `dsh plugin --profile web add dsh-custom-mode` produced a settings page whose composition file did
  not exist, so the page could not open and the mode was not selectable at all.
- Seeding **never overwrites**: an existing `prompt.md` (your text) or `agent.cordis.yml` (generated by
  the settings page) is left untouched, a second activation writes nothing, and an unwritable
  `DSH_HOME` is reported in the log without stopping the boot.
- The package copy of the preset lives in `editor/preset/`; `test/seed.test.mjs` asserts it stays
  byte-identical to `preset/`, because two copies of the same files drift.
- `engines.dsh` declares the adapter version for storefronts, and the peer range now carries an explicit
  prerelease comparator — without one, node-semver silently excludes every `0.1.6-*` build.
- Package version `0.1.6-alpha.1.rev1`: the adaptation is unchanged, the revision suffix exists because
  npm refuses to republish a version and this repackaged build has new files.
- `tools/verify-version-consistency.mjs` now runs in CI (it existed but nothing invoked it), and accepts
  `<dsh version>.revN` while still rejecting a version that drifts from the tested DSH release.
- `tools/screenshots` retries a stalled `Page.captureScreenshot` once instead of failing the run.
- **Published as `0.1.6-alpha.1.rev1`, with `latest` moved onto it.** A revision published under
  `alpha` alone leaves storefront installs — which resolve `latest` — on the previous version, i.e. the
  one without seeding. Documented in `docs/PUBLISHING.md`.

### Added

- **The system prompt is a file** (`prompt.md`), re-read before every model call, so a save takes
  effect on the **next step** — no restart and no new session. The official
  `@deepseek-ai/dsh-persona` resolves its `prefix` once at mount and cannot do this.
- **Base mode switching**: take one of `standard` / `ptc` / `minimal` / `cordis` as the base and copy
  rows by **text surgery** — keeping the shipped comments and `!!js` platform conditions byte for
  byte. Parsing the YAML and serializing it again would drop them, and a lost platform condition is a
  **silent** behaviour change.
- **Per-row plugin switches**, tri-state: untouched = as shipped; explicit on = the `disabled` key is
  removed (platform expression included); explicit off = written as `disabled: true`. Platform
  expressions are evaluated for real on the host, so the page shows the state actually in force on
  this machine.
- **Mode renaming**: display only; the internal id and the file paths are unchanged.
- **The `custom_prompt` tool**: an editing channel when no browser is available; the settings page is
  a Web UI supplied by the bundle and may not be present after a process restart, whereas this tool
  stays resident with the preset.
- Bilingual Chinese/English, light/dark theme following, and client-side HMR.

### Security

- **Fix: the settings-page private route performed no authentication.** `/custom-mode` was registered
  on the bare HTTP table of `ctx.webServer`, while the platform's Host/Origin fence and session
  authentication apply only to channels mounted by the Connection service. As measured before the
  fix: an unauthorized `GET` returned the entire system prompt (200), an unauthorized `POST`
  (`text/plain`) could rewrite `prompt.md` (200), while the official routes in the same process all
  returned 401. A form-style cross-site request triggers no preflight, so any page in the user's
  browser could POST to that port — for an agent holding shell and file tools, remotely triggerable
  prompt injection. The route now goes through `ctx.connection.requestRejection(req)` first (the same
  decision as `/api`) and **fails closed** when the service is unavailable.

### Fixed

- **`install.sh` deleted the base bundles shipped with the profile template.** In a fresh `DSH_HOME`,
  `dsh.profile.bundles` went from `["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` to this
  plugin alone: that "ghost entry cleanup" logic probed dependencies at two hard-coded paths, and
  those two packages are resolved by dsh's own install anchor. The consequence was that dsh would not
  start after installation (composition tree 158 lines → 1 line), while the script **exited with 0**.
  The trigger is "installing the plugin after dsh is installed but before it has ever been started".
  It now only adds and never removes, backed by three guards: a version/pnpm preflight self-check, a
  bundle invariant assertion, and a post-install composition self-check.
- **Installing into a profile without a web server no longer prints a false alarm.** A row-level
  `inject` is a hard dependency, and in tui neither service exists, so every start printed
  `1 entry did not activate … pending` — identical, word for word, to the error of a bricked
  installation. The row now uses scoped `ctx.inject(deps, cb)`: the row activates normally and only
  that route waits for the service.
- `install.sh` now reports whether the target profile has a web server. `agent-presets` exists only
  in the web composition, so when installed into tui, Custom mode cannot be selected at all (not
  merely missing its settings page).
- `uninstall.sh` removes the symlinks pnpm leaves behind in `node_modules` (reproduced on pnpm
  12.4.2).
- A missing `connection` returns 503; the response body used to say `forbidden` and now reports
  `unauthorized` / `forbidden` / `unavailable` according to the status.
- Both scripts' `--help` printed an extra `set -euo pipefail` line; `npm test` pointed at a path that
  does not exist; the `LICENSE` copyright holder was an old project name not present in this
  repository; two debug `console.log` calls were left in `client.js`.

### Tests

Eight suites with **333 checks** in total, most of them filling the coverage that mattered most and
was missing:

- `editor-route` (50) — the host-half HTTP route, the half the security fix lives in, previously
  untested. It asserts that the fence runs **before** any method dispatch, and every branch
  (401/403/503, GET, POST, 405, bad JSON, bad mode, rejected interpolation, oversized request body).
- `composition-edge` (26) — inputs the shipped file does not have today but manual edits or future
  versions may produce: CRLF, no trailing newline, lines missing `name:`, deeper indentation,
  duplicate ids. Two of them are easy to get backwards by assumption and are worth recording:
  untouched lines keep `\r` as well (so the output is **not guaranteed to be all LF**); "explicitly
  turning on a row that is already enabled on this platform" is a **no-op** and is not recorded as an
  override when the switch state is derived — a necessary consequence of the tri-state semantics.
- `prompt-tool` (37) and `meta` (45) — the editing channel when no browser is available; `preset.yml`
  round-trips (quotes, backslashes, colons, newline flattening, emoji, literals such as
  `"true"`/`"null"`, rejection of an empty name). Both redirect writes to a temporary directory.
- `prompt-reader` (15) — the hot-reload contract: after the file changes, the next evaluation must
  yield the new text; a failed read must not turn the persona into an empty string.
- `locales` (65) — the Chinese and English key sets match, and the hand-copied dictionary in
  `client.js` does not drift from `locales.mjs`.
- `composition` (63) — lossless text surgery, switch semantics, platform conditions, grouped
  indentation.
- Plus `test/run.mjs` as a single entry point: it resolves the shipped preset directory itself (three
  fallbacks) and prints the paths it tried when it fails.

### Continuous integration

`.github/workflows/test.yml`: on push/PR it runs `npm install @deepseek-ai/dsh@0.1.6-alpha.1` (the
presets shipped with the npm copy are byte-identical to the local ones, so the tests run against the
real shipped text rather than a hand-made fixture), runs the eight suites, and checks source-file
syntax, the two shell scripts, translation-pairing consistency, and the contents of the published
package.

### Documentation

- Added `docs/TROUBLESHOOTING.md` (11 classes of failures reproduced on a real machine: symptom,
  cause, recovery command) and `docs/MEASUREMENTS.md` (the commands and raw output behind each
  claim).
- `docs/ARCHITECTURE.md` gained §5.1 (why a private route sits outside the platform trust fence, with
  401/403 evidence) and §12 (row-level `inject` versus scoped `ctx.inject`).
- Corrected contradictory statements: both `PUBLISHING.md` and `ARCHITECTURE.md` §8 said "changing
  `client.js` requires a restart", contradicting the measurement in §10 of the same file (HMR
  self-updates in about a second).
- Completed `CONTRIBUTING.md` in both languages, `AGENTS.md`, `SECURITY.md`, the issue forms and the
  PR template.

- Every document exists in both languages: the English file keeps the default name (`docs/ARCHITECTURE.md`,
  `SECURITY.md`, `CHANGELOG.md`, `test/README.md`), the Chinese twin is the same name with `.zh.md`, and a
  `*.i18n.yaml` beside each pair records both sides' git blob hash. `tools/verify-translation-pairing.mjs`
  (run in CI) covers nine pairs, so editing one side and forgetting the other fails the build.
- Issue forms, the pull request template and `AGENTS.md` are English, with a link to the Chinese
  documentation from the issue chooser.

### Screenshots

- `tools/screenshots/`: a hand-written CDP client (zero dependencies). The script really flips
  switches, really clicks save, really switches theme and language, and writes the observed state
  into `observed.json`, so the screenshots can be re-run and checked.
- The four showcase images are all **800x800**, scale 1. GitHub scales inline images to the column
  width, so 2x images only double the payload: the same four went from about 750 KB to about 223 KB,
  while 800 px wide is displayed at its native size and the text stays sharper.
- The dark and English interfaces are still switched and asserted (the observed values go into
  `observed.json`), they just no longer store a duplicate frame each.

### npm

- Published **`dsh-custom-mode@0.1.6-alpha.1`** (dist-tag `alpha`). The package name matches the
  repository name: a client bundle's id must equal the package name (the same holds for the official
  settings-page plugins), and the bundle row name must be resolvable, so the package name, the load
  id in `client.js` and the row name in `cordis.patch.yml` were changed together, with the internal
  short name unified as `custom-mode`.
- Three things were measured during publication, detailed in `docs/PUBLISHING.md`:
  `publishConfig.tag` is not honoured (an explicit `--tag` is required); on a first publish the
  registry still points `latest` at the prerelease (accepted here, because every version is a
  prerelease); a peer dependency that is not imported must be marked `optional`, otherwise the first
  thing the user sees after installing is a WARN.
- Post-publish verification is not just "publish succeeded": the tarball is downloaded anonymously
  and really installed from the registry into a throwaway `DSH_HOME`.

### Pending release with the next version number

`0.1.6-alpha.1` on npm is immutable; the following changes are already in the repository and must
wait for an upstream DSH release to go out together with it:

- `editor/README.md` (the package page previously held metadata only);
- `peerDependenciesMeta` marks `@deepseek-ai/dsh` as `optional`;
- the `description` in `editor/package.json` is now in English.
