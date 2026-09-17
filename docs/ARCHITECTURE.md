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
    scope.effect(() => scope.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler }), '…')
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
