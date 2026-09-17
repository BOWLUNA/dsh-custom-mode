# Architecture and Pitfalls

English | [中文](ARCHITECTURE.zh.md)

This document records **measured conclusions**, not design preferences. Each entry corresponds to one runtime verification; they are written down because they determine why this project looks the way it does.

## 1. Why the settings page must be split into a standalone plugin and cannot be written as one row of a preset

This is the single most important constraint in the whole project.

In an agent preset's composition file (`agent.cordis.yml`), a row **may** reference a bundled module:

```yaml
- id: persona
  name: './prompt-reader.mjs'
```

That works because a preset's relative paths are resolved against the preset directory (`dsh-agent-presets`'s `classifyRowSpecifier` classifies `./x` as the `preset` type, and imports it through the `Include` subtree whose baseUrl has been rewritten).

**But the browser half does not.** The web client's module scanner (`@deepseek-ai/dsh-client-modules`):

- runs during **startup assembly** — in its constructor, `for (const entry of ctx.loader.entries()) this.dirty.add(entry.options.name)`;
- reads only the **root loader's entries**;
- on a miss it does `throw new ClientPackageCompositionError`, and **the entire boot fails**.

Meanwhile, an agent preset's rows are mounted by `dsh-agent-presets` through the `Include` subtree's `PresetTree`, **scoped per session at runtime**, and are **not in the root loader**.

Measured data (queried in a real run):

```
root loader entries:      161
client graph entries:      56   ← none of them are preset rows
```

So a browser half written inside a preset is **never discovered** and only becomes dead code. The only plane that can mount a browser half is the **root plane** (the profile).

**Conclusion**: split into two artifacts — a preset (files) + a settings-page plugin (profile bundle).

## 2. How a bundle plugin gets assembled

The settings-page plugin is a **bundle**: `package.json` declares `dsh.bundle.patch`, and the profile's `dsh.profile.bundles` lists it.

Composition order (`composeProfile`):

```
bundlePatches → profile.cordis.patch.yml → $DSH_HOME/cordis.patch.yml → --patch overlays
```

Two easy-to-get-wrong points:

- **A bundle patch adds rows with `- insert:`**, whereas **the profile's own `cordis.patch.yml` can only replace rows that already exist** (adding one reports `entry not found`). In the first version the new rows were written into the profile patch and were rejected outright.
- Package resolution first tries `INSTALL_ANCHOR` (the dsh install directory), and on failure **falls back to the profile directory**:

```js
for (const anchor of [installAnchor, join(profileDir, "package.json")]) { … }
```

So a package installed into the profile by `dsh plugin --profile <p> add ./editor` can be resolved, without needing to be installed into the dsh install directory.

## 3. `dsh.client.inject` must be declared (this bug kept the page from appearing at first)

The browser half needs to read a service:

```js
const slots = ctx.get("slots")
```

**That alone does not work.** The client registry guards service reads, and every official settings plugin additionally exports:

```js
exports.apply = apply
exports.inject = inject     // inject = ["slots"]
```

The symptom is subtle: the client graph **has an entry, with the correct rev, and the bundle is served**, yet the page simply never appears — because `apply` was rejected by the guard and registration never happened. Adding `exports.inject` fixed it immediately.

## 4. The browser half's hand-written bundle

This package's `client.js` is **hand-written**, not a build artifact. Format:

```js
window.__ModuleLoader__.load({
  id: "dsh-custom-mode",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const react = require("react")       // ← resolved from the "seed module table"
    function apply(ctx) { … }
    exports.apply = apply
    exports.inject = ["slots"]
    return module.exports
  },
})
```

The seed module table is provided by the web frontend; in 0.1.6 it contains:

```
react, react/jsx-runtime, react-dom, react-dom/client,
@deepseek-ai/cordis, @deepseek-ai/dsh-client-store,
@deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives,
@deepseek-ai/dsh-client-ui-dockkit
```

So `require("react")` works, **with no bundler and no installed dependencies needed**.

The whole `load()` call is wrapped in `try/catch`, so this package cannot crash the page — the worst case is that this one page does not appear.

## 5. Talking to the host: a private HTTP route

The browser half has no `host.call` (that is the channel reserved for dynamic Cordis packages); a statically loaded plugin goes through `ctx.remote.<namespace>` — which requires the host to register a Remote namespace and a typed contract, and is heavy and error-prone.

This project instead uses **one private HTTP route**:

- host half: `ctx.webServer.register({ kind: "exact", path: "/custom-mode", handler })`
- browser half: `fetch("/custom-mode", { method: "GET" | "POST" })`

Advantages: fully self-contained, it occupies no Cordis service name and cannot collide with anyone else, and there is no need to understand the Remote generation mechanism.

### 5.1 But a bare route is **not** inside the platform's browser trust fence (measured, since fixed)

The approach above had a consequence that was not realized at the time. `ctx.webServer` is a **bare HTTP table**; the platform's
Host/Origin fence plus browser authentication are attached by `@deepseek-ai/dsh-client-connection` to the
channel **it mounts itself** (`/`, `/api`…), and a route registered directly on `webServer` **does not pass through** it.

Measured (0.1.6-alpha.1, before this plugin was fixed):

```sh
# Unauthorized GET: hands over the entire system prompt
curl http://127.0.0.1:3081/custom-mode
→ 200 {"ok":true,...,"prompt":"You are a coding agent powered by ..."}

# Unauthorized POST: rewrites prompt.md directly
curl -X POST http://127.0.0.1:3081/custom-mode \
     -H 'content-type: text/plain' --data '{"mode":"standard","overrides":{},"prompt":"PWNED"}'
→ 200 {"ok":true,...}         # the file really was modified

# The official routes on the same machine, for comparison
curl http://127.0.0.1:3081/                → 401
curl http://127.0.0.1:3081/api/settings    → 401
```

The `content-type: text/plain` part makes it more than "any local process can write": **an ordinary form-style cross-site request needs no preflight**,
so any web page the user visits can POST to this port and change the agent's system prompt to whatever the attacker wants
(the response cannot be read, but the write has already happened). For an agent holding Shell and file tools, this is a genuine
prompt-injection channel.

**The fix**: wire the platform's own verdict into this route — `ctx.connection.requestRejection(req)`
(the Host/Origin fence + browser session validation), which yields the same decision `/api` gets:

```js
const rejection = ctx.get('connection').requestRejection(req)   // 403 / 401 / undefined
if (rejection !== undefined) { res.writeHead(rejection); res.end(); return }
```

Measured results after the fix:

```
Unauthorized GET                        → 401 unauthorized
Unauthorized POST (text/plain)          → 401, file not modified
POST + Origin: https://evil.example
     + Sec-Fetch-Site: cross-site       → 403 forbidden
With a valid dsh-auth-* cookie (browser session) → 200 (works as before)
```

**Two reusable conclusions**:

- A plugin registering a route on `ctx.webServer` = it owns its own security. Anything that needs browser access must first pass
  `connection.requestRejection`; for routes meant only for local processes, be aware that **any** local process can call them.
- The `connection` service is **not ready yet** when a bundle row's `apply()` runs (measured: putting it in `inject` leaves the plugin
  stuck at `pending`), so `ctx.get('connection')` must be fetched lazily **at request time**, and must **fail closed** when unavailable.

## 6. Why the `dsh-settings` API is not used

The host half of the community plugin `dsh-session-prompt` is:

```js
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
```

On dsh `0.1.6-alpha.1`, the **actual exports** of `dsh-settings` are only:

```
SettingsConflictError, SettingsProvider, default, redactSecrets
```

Those two functions **do not exist anywhere in the 0.1.6 codebase**. Because this is the bundle layer, a failed import in the host half takes down the boot.

This project therefore **does not use** `dsh-settings` at all: the prompt lives in an ordinary file, and the settings page reads and writes it itself.

## 7. Validating `{{…}}`: turning a local error into a mode-level failure

`@deepseek-ai/dsh-system-prompt`'s rendering rules:

```js
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/
// a complete {{x}} group: the name must be valid and registered, otherwise throw
// an unclosed single {{ : treated as a literal
```

The consequence of throwing is not "this sentence has no effect" but **every request in that mode fails**. So both write paths validate before writing to disk, and only let through `model` / `cwd` / `provider` (the three registered by `dsh-agent-loop`).

The validation logic exists as **one copy each** in `preset/prompt-tool.mjs` and `editor/index.mjs`, and the duplication is intentional: this way the preset does not have to depend on the editor's install location, and the editor's path stays configurable.

## 8. Debugging methods (useful next time this plugin is changed)

- **Confirm a row made it into the composition tree**: `dsh --profile <p> --dump-config | grep <package>`
- **Confirm a client module can be discovered**: mount a dynamic Cordis plugin and look for your own package id in `ctx.get('clientModules').graph().entries`. An entry = composition succeeded; no entry = discovery failed.
- **Confirm the browser half actually ran**: `console.log` inside `apply`, and watch the browser Console.
- **`ctx.loader.entries()` contains only root-plane entries**, so do not use it to verify a preset's rows.
- After changing the contents of `client.js`, **no restart is needed**: HMR rebuilds the client graph (see §10 below); only changes to the host half need a restart.

## 9. One-sentence summary

> The preset manages **prompt content** (re-evaluated on every step); the profile bundle manages **the editing UI** (discovered during startup assembly).
> The only contract between the two is **the same file path**.

## 10. Client hot reload is measured to work (no restart needed to change the UI)

`dsh-client-hmr`'s host half **stat-polls** every client plugin's bundle file every `pollIntervalMs` (500ms by default); as soon as `mtimeMs`/`size` changes it calls `clientModules.rebuilt(id)` → rebuilds the client graph → pushes it to the page over the `/plugins/events` SSE → the browser half does `reload(id, rev)`:

```
modLoader.invalidate(id, rev)
await modLoader.prefetch(id)
await tearDownEntryFiber(entry)
removeOwnedStyles(id)        // remove that plugin's own <style data-plugin="<id>">
await entry.refresh()        // re-execute the bundle → apply again
```

**The same applies to a hand-written bundle**: no build artifact is needed, only `dsh.client` + `exports["./client"]` in place. Measured evidence (changing the file without refreshing the page):

```
graph rev    726f30aa8dd9 → 74bc149b2eca
entry rev    345c0f1330e41a14-47 → 50e01f6dc101
page behavior the purple test bar disappears on its own, bundle execution count 1 → 2
```

Two reusable conclusions:

- **A 200 from `/plugins/events` does not prove the route exists** — the SPA fallback also returns 200. Look at `content-type`: a real SSE route returns `text/event-stream`. Only a request with `Accept: text/event-stream` can tell them apart.
- **Verifying "the browser hop" does not need DevTools**: in `apply()`, increment a counter on `window` and render it onto the page. A growing count proves the bundle was re-executed; apart from the plugin suicidally restarting itself, this is the only way to see browser state remotely.

### The development loop changes accordingly

Change `editor/client.js` → **the page updates by itself about 1 second later**, with no need to restart `dsh web` and no need to refresh. Only changes to the **host half** (`index.mjs`/`composition.mjs`/`meta.mjs`) need a restart — those are rows in the main process.

## 11. A path trap that cost a great deal of time

`install.sh` **links the editor package to the repository directory**:

```
profiles/web/node_modules/dsh-custom-mode -> <repo>/editor
```

So **the repository is the live code**. The `$DSH_HOME/custom-mode/` that once existed was a **stale copy** of an earlier layout; writing files there has no effect whatsoever (the client bundle's `artifactBaseline` reports the size of the other copy). That directory has been deleted to avoid further misleading.

The way to diagnose this class of problem: read `clientModules.artifactBaseline(id)`; the `path` it returns is the copy actually being watched/served.

## 12. A row-level `inject` deadlocks the whole row; the correct way to wait for a service is a scoped `ctx.inject`

This one was hit in a real run, and the lesson is worth more than the conclusion.

**The cause**: `install.sh --help` and both READMEs said `--profile tui`, while the settings-page plugin at the time exported
`inject = ['webServer', 'agentPresets']` at package level. Neither service exists in the tui composition, so every tui startup printed:

```
dsh: warning: 1 entry did not activate
custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
```

**Why this is unacceptable**: this line is **identical** to the "installing dsh bricks it" error in [§5.1]. A normal
"wrong profile installed" then looks indistinguishable from catastrophic corruption — which amounts to teaching users to ignore the one warning that matters.

**The mechanism**: Cordis's `inject` is a **hard dependency** — if the name is in `inject`, the fiber waits until it appears. There is no
"optional dependency" form (`inject` has only required semantics in `cordis/src/registry.ts`).

**The correct way**: let the whole row activate normally, and put "the part that needs the service" into a scoped child fiber:

```js
export function apply(ctx) {
  ctx.inject(['webServer', 'agentPresets'], (scope) => {
    // execution only reaches here when both services exist
    scope.effect(() => scope.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }), '…')
  })
}
```

`ctx.inject(deps, callback)` is just sugar for `ctx.plugin({ inject: deps, apply: callback })`
("Start a callback once the requested dependencies are available" in `registry.ts`),
so it is the **dynamic form of the same declaration**, not a way around the dependency system.

**Measured result**: tui startup with a TTY no longer prints that warning, and the settings page in web works as usual (`401` unauthorized / `200` with a session).

**Two reusable points**:

- If only half of a plugin's functionality depends on some service, do not put that service in a row-level `inject` — otherwise, when that
  half does not apply, the whole row becomes a warning that looks like a failure.
- Conversely, **never** drop dependency declarations entirely and guess in `apply` with `ctx.get()` whether a service is present, just to avoid
  `pending`: in web, `apply` may run before `webServer` is ready, in which case the settings page would silently fail to register. Use `ctx.inject` to wait.

## 13. Several assistants: why one settings page managing N modes needs no new mechanism

The first version managed a single preset (`$DSH_HOME/.agent-presets/custom`). To become "create and
delete assistants like a chat app", the first question is whether the preset layer supports N at all.
It does — that is what it is for:

- `dsh-agent-presets`' `scanRoot()` turns **every** id-shaped subdirectory of the user preset root into
  a roster row (`USER_PRESET_DIR = '.agent-presets'`, `PRESET_ID = /^[a-z0-9][a-z0-9-]*$/`);
- discovery is **unmemoised**: `list()` / `resolve()` re-read the roots on every call, so a directory
  created a moment ago is selectable the next time a session starts;
- every preset directory is self-contained: `prompt-reader.mjs` / `prompt-tool.mjs` resolve `prompt.md`
  with `new URL('./prompt.md', import.meta.url)`, so one copy is one independent prompt.

The only genuinely single-instance part was the **settings page**: `paths.mjs` hard-codes the prompt path
as `.../custom/prompt.md`, there is one route, and the browser half assumes one mode. So this change
lands entirely in the editor package; not one composition file under `preset/` moved.

### 13.1 Which directories this tool owns (the test is a safety boundary)

The managed list must be **presets this tool created**, not "every preset under the user root":

- a save **regenerates the composition from a base mode** (that is how the per-row switches work);
- doing that to a hand-written `agent.cordis.yml` destroys it.

The test: the directory carries `prompt.md`, and it either carries `prompt-reader.mjs` or its
composition still references `'./prompt-reader.mjs'`. The second branch is what keeps an assistant
repairable after its reader module is deleted by accident. Deciding on `prompt.md` alone would misclaim
somebody else's hand-authored preset — and that mistake is destructive, so the test errs narrow.

### 13.2 Creation and deletion both go through the platform's own authoring seam

- **Deletion** uses `agentPresets.remove(id)`: the platform itself refuses `trust: 'system'` and
  re-checks that the directory really lives under the writable root (`preset.path.startsWith(dir)` in
  `deleteComposition`). Safer than the plugin running its own `rm -rf`.
- **Creation** seeds the packaged template (`seedPreset` → `createAssistantDir`) rather than calling
  `agentPresets.copy()`: a copy inherits the source assistant's prompt, switch states and extra files,
  and — decisive — creation would break the moment the user deleted every source. Seeding also makes
  "new" mean new.
- The writable root is **derived from the roster** (the grandparent of any `trust: 'user'` row), not
  hard-coded: a profile may point `roots` elsewhere, and a hard-coded path would write to the wrong
  place in that deployment.

### 13.3 A deleted assistant must not come back

The old `apply()` called `seedPresetWithLog(PRESET_DIR)` on every activation. With several assistants
that semantics becomes a bug: delete `custom`, restart the process, and it returns. The rule now:

- every activation repairs **every** managed directory by filling in only MISSING files (never
  overwriting — and it rescues the failure where a composition row names a deleted module, which makes
  the whole preset read as BROKEN and vanish from every picker);
- `custom` is created only on a genuine **first run** (no `.custom-mode.json` under the root);
- a root that already has managed assistants is adopted silently, marker and all.

The marker is a **file**: discovery's `child.isDirectory()` skips it, and its name does not match
`PRESET_ID`, so it can never be mistaken for a preset.

### 13.4 How the tool description knows which assistant it belongs to

The `custom_prompt` description carries the assistant's name from the composition row's config
(`config.modeName`), which the settings page writes on every save; the module falls back to reading
`preset.yml` beside itself, then to a generic label. **An older assistant's older module does not know
that key** — deliberately: the module lives in the user's directory and activation must not overwrite it
behind their back. Running `./install.sh` refreshes the modules (and keeps `prompt.md`).

## 14. The UI uses the shell's own atoms instead of hand-rolled controls

The page's **layout** is ours (grids, cards, spacing). Its **controls** all come from
`@deepseek-ai/dsh-client-ui-primitives`: `Button` / `Input` / `Switch` / `Tag` / `Pill` /
`Tooltip` / `RiskConfirmation` and the icon set.

### 14.1 Why it can just be required: the shell's seed table

A hand-written bundle cannot import an ESM package; it can only `require`. At boot the shell registers
a **seed table** mapping a fixed set of module names onto instances it has already bundled
(measured in `dsh-web-frontend/dist/assets/index-*.js`):

```js
{"react":_c,"react-dom":bc,"react-dom/client":Ic,"@deepseek-ai/cordis":ec,
 "@deepseek-ai/dsh-client-store":Jc,"@deepseek-ai/dsh-client-ui-slots":ou,
 "@deepseek-ai/dsh-client-ui-primitives":Cy,"@deepseek-ai/dsh-client-ui-dockkit":Xw}
```

So `require("@deepseek-ai/dsh-client-ui-primitives")` is the same kind of operation as
`require("react")`, and it does **not** need a `dsh.client.external` declaration — that field serves
*graph rows* (bundles with their own record in the boot manifest). The official
`@deepseek-ai/dsh-client-ui-settings-general` requires it at runtime with no `external` declaration
either, which is the precedent this follows.

The seed table also carries `@deepseek-ai/dsh-client-ui-slots` and `@deepseek-ai/dsh-client-store`:
the former is how official pages read slot contracts, the latter is small cross-page state.

### 14.2 The payoff is "it cannot drift"

The atoms are bundled with the shell and styled by the shell's CSS through `--dsw-*` tokens, so theme,
light/dark, density, corner radius and any future restyling reach this page automatically. Writing
one's own `<input>` / `<button>` is copying the shell's visual specification — and the copy is the
thing that goes stale.

The line drawn here: **containers are ours, controls are the shell's**. `client.js`'s CSS does layout
only; `cpfe-btn*` / `cpfe-input` / `cpfe-switch*` / `cpfe-tag*` / `cpfe-pill*` exist solely for the
fallback path below.

### 14.3 Degrading: an older shell without that seed word must still open

`ui-primitives` tracks the shell version. The probe is a `try`/`catch`: when it is unavailable the page
uses built-in plain controls with the **same prop contract** (`Switch.onChange` still hands over the
next boolean, not an event), so it renders plainer but usable rather than blank; with no
`RiskConfirmation`, deletion falls back to a native `confirm` instead of dropping the "irreversible
operation needs a confirmation" guardrail.

This is the other face of §3's lesson: there the failure was a page that **silently never appeared**,
so here degrading is always preferred to a failed `apply`.

### 14.4 A related confirmation: the client bundle's long cache is safe

`/plugins/??<id>/client.js&rev=<hash>` answers with
`cache-control: public, max-age=31536000, immutable`, which looks alarming. But `dsh-client-modules`
derives that rev from `artifactRevision(bundle, baseline)` — a sha1 over the **client.js bytes plus
mtimeMs**. Edit the file and the rev changes, so the URL changes, which is what makes `immutable`
safe: an ordinary refresh after a restart picks up the new UI, with no cache clearing.

## 15. `settings.section` no longer hands over a bound `t`: the page carries its own dictionaries (measured on 0.1.6-alpha.2)

This section records a real failure: every function was correct, yet the whole page rendered as raw keys
(`assistant.heading`, `btn.create`) — including the left nav, which showed `nav`. The page depended on a
contract that no longer exists.

### 15.1 The authoritative contract: three registration options, no `locale`

The `settings.section` slot declaration (shipped with `dsh-cordis-client-runner`, documentation included)
says:

```
registerOptions: [
  { name: "id",    requirement: "required", type: "string" },
  { name: "order", requirement: "optional", type: "number" },
  { name: "label", requirement: "optional", type: "string | (() => string)" }
]
doc: … `label` (registrant-localized display text — the registrant re-registers with
     fresh text on locale change, so the shell never subscribes locale state; the ledger
     bump doubles as the shell's re-render trigger) …
```

**There is no `locale:` any more.** The shell no longer binds a namespaced `t` for a section, so
`props.t` — even when present — is not ours, and the body echoed keys. Official bundles still contain a
leftover `locale: NS` (`ui-settings-plugins`, …), but the contract dropped it and it cannot be relied on.

`label` explicitly still supports a thunk and documents that a thunk "is re-read on every projection, so
localized text follows the active locale without re-registering" — so the nav label staying a thunk is
correct.

### 15.2 Two lessons

**(1) Never depend on the registration having succeeded.** The page used to route all of its copy through
`locale.register(ns, {zh, en})` plus the shell's `t`; one failed registration turned it into a wall of
keys. Now:

- the shell's `t` still wins when it answers (and a language switch re-renders through it);
- **the bundle's own zh/en dictionaries are the floor**: when the shell cannot answer, `t()` consults its
  own table, so a key that is in the table can never be displayed raw;
- language switches are driven by `locale.subscribe()`, and `activeLanguage()` re-reads the snapshot on
  every render.

That is not "ignoring host i18n" — it is treating it as an accelerator rather than a foundation. A test
builds a shell whose `t` echoes the key and drives this path (`test/client-bundle.test.mjs` §3), and it
was verified to go red against the old code.

**(2) `ctx.effect` swallows exceptions from its callback — which is what made the failure silent.**
The registration sat inside `ctx.effect(() => locale.register(...))`, and `effect()` hands the callback to
its own runner (setup barrier, promise handling): a throw inside it does **not** reach `apply`'s
`try/catch`. "Registration failed" and "everything is fine" were therefore indistinguishable from the
outside — page present, console quiet, all copy raw. Registration now catches its own error, warns with
the reason, and re-reads once afterwards (`bind(ns)("nav") === "nav"` means "registered but the host
cannot see it"), telling the two cases apart.

This holds for **any** initialization placed in `ctx.effect`: **do not treat its exceptions as ones that
will bubble.**

## 16. Assistant ordering lives in `preset.yml`'s `order`, with no second state file

The picker order is the roster order, and `dsh-agent-presets` sorts by `order ?? Infinity`, then id —
which is exactly how the shipped presets declare their own order. So "move up/down" keeps no list of its
own; it writes `order: 1..N` into **every** managed assistant:

- the order becomes a property of the preset: it survives a restart, is visible in the file, and has no
  second copy to drift from;
- writing all of 1..N is necessary: assistants that were never reordered have no `order` at all, so
  writing just one would interleave with the id sort;
- `meta.mjs`'s writer preserves the on-disk value when no `order` is passed — otherwise a RENAME would
  quietly push the assistant to the back.

The order affects **new sessions** only (the roster re-reads the roots on every call); open sessions are
unaffected.

## 17. Browser verification: the last mile unit tests cannot see

This repository's tests have a structural blind spot: they prove the host answers correctly and the
bundle registers, but they **cannot see the rendered page**. §15's failure was that blind spot's
product — every function correct, the page present, the page a wall of raw keys, and **every suite
green**.

From this version on, the acceptance test for a UI change is therefore not "the suite is green" but
"`tools/browser-verify.mjs` has run against a real instance".

### 17.1 What it asserts

Driving a real browser over a CDP port, it checks:

1. **no raw translation keys anywhere in the panel** (a built-in list: `assistant.heading`,
   `btn.create`, `status.enabled`, …);
2. the copy is **translated** (section headings, and the move/duplicate/import/export buttons);
3. **every switch has a visible row title** — `Switch`'s `label` is its `aria-label` only, so the
   title has to be drawn by the page;
4. the left nav entry is not the raw key `nav`;
5. a **create/delete round trip through the browser**: new assistant → it appears → the risk
   confirmation opens → acknowledge → delete permanently → it is gone;
6. no `dsh-custom-mode` error in the page console.

It does **not** start dsh itself; it takes one token URL. Which instance on which machine is the
caller's choice (the lab recipe is in the repository `AGENTS.md` §"The lab" and in
`~/.dsh/AGENTS.md`).

### 17.2 Two traps, both measured

- **The settings panel is itself `[role=dialog]`.** So "find the confirmation" cannot be
  `document.querySelector('[role=dialog]')` — that returns the panel. Search **all** dialogs by
  content. The first version of the verifier failed exactly this way: the assertion failed, the
  checkbox got ticked, and the confirm button was never clicked.
- **Ticking and confirming must be separate steps.** `RiskConfirmation`'s confirm button reads React
  state, so clicking the checkbox and the button in the same tick deletes nothing — the state has not
  landed yet.
