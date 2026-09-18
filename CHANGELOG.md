# Changelog

English | [中文](CHANGELOG.zh.md)

The version number is this package's **own stable line** (`1.0.0`, `1.0.1`, …) and every publish gets
a new one. Which DSH it supports is declared in `engines.dsh` + the `@deepseek-ai/dsh` peer range, and
CI asserts the DSH version it actually installs and tests falls inside them — see the "Versioning"
section of the README. Entries from `0.1.6-alpha.*` and earlier follow the old convention (the version
mirrored the DSH release) and are kept as history.

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
