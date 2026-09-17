# Troubleshooting

English | [中文](TROUBLESHOOTING.zh.md)

Everything in this document is a **failure that was reproduced by actual testing**, and each entry has symptoms, cause, and a self-recovery procedure. Every command can be copied and run directly.

First, remember one general self-check command — it distinguishes "not installed at all" from "installed but not taking effect":

```sh
dsh --profile web --dump-config | grep -n custom-mode
```

Output present = the plugin row has entered the composition tree (any remaining problem is on the browser side).
**No output** = it was not installed into the profile, or dsh was not restarted after installing.

---

## 1. [Critical] After installing, dsh no longer starts and only a single `pending` line remains

### Symptoms

`./install.sh` prints "installation complete" and exits with 0. Then dsh is restarted:

```
dsh: warning: 1 entry did not activate
custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
```

The interface does not open, nothing is listening on the port, and the agent is gone too — the whole harness is left with this one plugin waiting for two services that will never appear.
The output of `dsh --profile web --dump-config` is suspiciously short:

```yaml
# == dsh-custom-mode
- id: custom-mode
  name: dsh-custom-mode
```

### Cause (already fixed, but machines that were already installed on need self-recovery)

`install.sh` used to contain a piece of logic that "cleans up ghost entries that cannot be resolved"; it probed every bundle through two hardcoded paths:

```
$DSH_HOME/profiles/<profile>/node_modules/<name>/package.json
$DSH_HOME/profiles/node_modules/<name>/package.json
```

The in-box bundles shipped with the profile **template** (`@deepseek-ai/dsh-base`, `@deepseek-ai/dsh-web-app`) are not in
these two locations — they are resolved by dsh's own installation anchor — so they were judged to be ghosts and **deleted from `dsh.profile.bundles`**. Once the base bundle is gone, `llm` / `session` / `webServer` / `agentPresets` are all no longer assembled.

This is not a guess, it was measured: running the old `install.sh` against a fresh `DSH_HOME`, the profile's bundles go from
`["@deepseek-ai/dsh-base","@deepseek-ai/dsh-web-app"]` to `["dsh-custom-mode"]`.

dsh's own `reconcilePlugins` explicitly states that in-box bundles "are never touched", so the correct approach is
**add only, never delete**. The current `install.sh` does exactly that, and adds a post-install self-check:
if the composition tree is shorter than 20 lines it errors out immediately, instead of letting you discover the problem on the next restart.

### Self-recovery (for machines already broken by an old version)

Just add the missing names back to the profile manifest; nothing needs to be reinstalled:

```sh
# 1. See what is missing right now
node -p "JSON.stringify(require(process.env.HOME + '/.dsh/profiles/web/package.json').dsh.profile.bundles)"

# 2. Add back the two shipped with the template (varies by profile template; web/tui both use these two)
node -e '
const fs = require("fs");
const p = process.env.HOME + "/.dsh/profiles/web/package.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const want = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];
j.dsh.profile.bundles = [...new Set([...want, ...(j.dsh.profile.bundles ?? [])])];
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
console.log("bundles =", j.dsh.profile.bundles);
'

# 3. Confirm the recovery: there should be hundreds of lines
dsh --profile web --dump-config | wc -l
```

After restarting dsh, normal operation should be restored.

> If `$DSH_HOME` was backed up **before** installing the plugin, this `package.json` can also be recovered directly from the backup.

---

## 2. On WSL, `dsh plugin add` fails: pnpm's Rust panic

### Symptoms

```
==> 2/2 安装设置页插件 "dsh-custom-mode" 到 profile "web"
Error:   × Main thread panicked.
  ├─▶ at pnpm\crates\config\src\defaults.rs:51:39
  ╰─▶ current dir is an absolute path with drive letter
dsh: pnpm failed in profile directory /home/<user>/.dsh/profiles/web
```

### Cause

`dsh plugin` **forwards to the `pnpm` on the PATH** (`spawnSync("pnpm", …)`, cwd = the profile directory).
WSL's PATH includes Windows directories by default, so it very easily picks up the `Windows` version of
`pnpm.cmd`/`pnpm.exe` first. It interprets the cwd `/home/...` in the Windows way, and therefore panics.

### Fix

Make the pnpm on the PATH the **Linux version**:

```sh
corepack enable pnpm     # generate the pnpm shim in corepack's directory
which pnpm               # must be /home/... or /usr/..., not /mnt/c/...
```

Or use nvm/apt to install a Linux version of Node and then `npm i -g pnpm`.

The current `install.sh` points this situation out at step 0, instead of waiting until pnpm reports an obscure panic.

---

## 3. `editor/client.js` was changed, but the page does not change

First work out which half was changed — the two halves have completely different reload mechanisms:

| File changed | How it takes effect |
| --- | --- |
| `editor/client.js` (browser half) | **Automatic**: `dsh-client-hmr` stat-polls the bundle file every ~500ms; about 1 second later the page updates by itself, with **no restart and no refresh** |
| `editor/index.mjs` / `composition.mjs` / `meta.mjs` / `paths.mjs` (host half) | **`dsh web` must be restarted**: these are rows in the main process |

Prerequisites for HMR: `dsh-client-hmr` is enabled in the profile's composition (`dsh --profile web --dump-config | grep -A2 'id: hmr'`),
and **the page is still open** — if the SSE connection drops there will be no pushes, and in that case refreshing the page once is enough.

> Earlier documentation contained the sentence "changing client.js requires a restart", which is wrong (it contradicts the measurements in `ARCHITECTURE.md` §10).
> It has been corrected.

---

## 4. There is no "Custom mode" item in the settings panel

Check in order:

1. **Is the plugin in the composition tree**: `dsh --profile web --dump-config | grep custom-mode`.
2. **Was dsh restarted after installing**: the bundle's client-side content only enters the client graph during **startup assembly**.
3. **Are `dsh.client` and `exports["./client"]` both present** in `editor/package.json`
   (if either is missing, the browser half will not be discovered, and it **will not report an error**).
4. **Are the host half's service dependencies satisfied**: the host half has `inject = ["webServer", "agentPresets"]`,
   and when either service is missing the plugin stays in `pending` (the startup log will say waiting for services).
5. **Does the browser Console contain an error starting with `dsh-custom-mode:`** — this page's failure policy is
   "rather have the whole page not appear than ever crash the page", so it only ever speaks to the Console.

---

## 5. There is no "Custom mode" in the mode selector

A preset is a **file**, and the usual reason dsh cannot see it is that the file itself is broken:

- `$DSH_HOME/.agent-presets/<id>/preset.yml` has broken YAML → that mode **silently disappears** (no error).
  If it was edited with an editor, confirm that `name:` is a single-line scalar with quotes. The settings page escapes it automatically when writing, but manual editing does not.
- The directory is missing `agent.cordis.yml`.
- The directory name cannot be `standard` / `ptc` / `minimal` / `cordis` — those are the names of the built-in modes.
- The mode is only read when a **new session** is created: an already open session will not switch modes midway.

---

## 6. Saving the prompt is rejected

The renderer performs **strict interpolation**: a complete `{{...}}` group must be a registered variable, otherwise rendering **throws**,
and the consequence is not "this section does not take effect" but **every model request in that mode fails**. So both write paths validate first:

| Text | Result |
| --- | --- |
| Plain text | Accepted |
| `{{model}}` / `{{cwd}}` / `{{provider}}` | Accepted |
| `{{}}`, `{{ model }}`, `{{Model}}`, `{{foo}}` | Rejected, with the reason given |
| A single unclosed `{{` | Accepted (the renderer treats it as a literal) |

To write literal braces, use a single `{` or an unclosed `{{`.

**What to do if it has already been written badly**: edit the file directly, bypassing validation:

```sh
$EDITOR ~/.dsh/.agent-presets/custom/prompt.md
```

Or temporarily clear the entire prompt down to a single line of plain text, then change it in the settings page.

---

## 7. Version mismatch

This plugin's version number **follows the official one** (currently `0.1.6-alpha.1`). After upgrading dsh, if the settings page is blank or startup reports
"the current DSH version is missing a required API", then a coupling point has broken: see the "coupling point checklist" in the README and verify them one by one.

Step 0 of `install.sh` prints `dsh --version` together with the adaptation version declared by the plugin, and warns when they do not match.

---

## 8. A non-default preset directory name was used, and the settings page cannot read the prompt

The editor only recognizes `$DSH_HOME/.agent-presets/custom/prompt.md` by default. If it was installed with `--preset-id mine`,
the **dsh process** must carry the environment variable (`export` in your own shell does not count — dsh has to be started from an
environment that has this variable):

```sh
export DSH_CUSTOM_PROMPT_PATH="$DSH_HOME/.agent-presets/mine/prompt.md"
```

For a systemd service, write it into the unit's `Environment=` instead.

---

## 9. Security: the settings page's private route must pass the platform's authentication

### Symptoms (measured on 0.1.6-alpha.1; this repository has already fixed it at the source level)

Before the fix, `/custom-mode` was **readable and writable without authorization**:

```sh
curl http://127.0.0.1:3080/custom-mode            # 200，整份系统提示词被读走
curl -X POST http://127.0.0.1:3080/custom-mode \
     -H 'content-type: text/plain' --data '{"mode":"standard","overrides":{},"prompt":"PWNED"}'
                                                           # 200，prompt.md 真的被改写
```

On the same machine, official routes all return 401. The cause: the platform's Host/Origin fence and browser authentication only apply to
channels mounted by `@deepseek-ai/dsh-client-connection` (`/`, `/api`…), and routes that a plugin registers directly on
`ctx.webServer` **do not pass through** it.

The `text/plain` detail is crucial: **ordinary form-style cross-site requests do not trigger a preflight**, so any web page the user visits can POST to
this port. The response cannot be read, but the write has already happened — for an agent holding shell and file tools,
this is remotely triggerable prompt injection.

### Current behavior

The route asks the platform before handling any request:

```js
const rejection = ctx.get('connection').requestRejection(req)
```

Measurements after the fix:

| Request | Result |
| --- | --- |
| Unauthorized GET | `401 unauthorized` |
| Unauthorized POST (`text/plain`) | `401`, file not rewritten |
| POST + `Origin: https://evil.example` + `Sec-Fetch-Site: cross-site` | `403 forbidden` |
| With a valid `dsh-auth-*` cookie (normal browser session) | `200`, functionality unchanged |

**Which version you have installed yourself**: check whether `editor/index.mjs` contains `connectionRejection`.
If it does not, either upgrade this repository, or for now do not expose this settings page on a port that others can reach
(by default it binds only to `127.0.0.1`; the risk is mainly on **multi-user machines** and **cross-site requests from inside a browser**).

When the `connection` service cannot be obtained (DSH version mismatch), the route **fails closed** (returns 503 and explains in the host log),
rather than falling back to "it still works without validation".

---

## 10. Installing into a profile such as tui / headless: less works than expected

Both `./install.sh --help` and the two READMEs mention `--profile tui`, but **measurement** shows that one thing must be understood first:

```sh
dsh --profile web      --dump-config | grep agent-presets   # 有
dsh --profile tui      --dump-config | grep agent-presets   # 无
dsh --profile headless --dump-config | grep agent-presets   # 无
```

The `agent-presets` service **only appears in the web composition**, and "Custom mode" is precisely what it mounts. So in tui it is
not that "the settings page cannot be seen", but that **this mode does not exist at all**: it cannot be selected when creating a new session. The settings page additionally requires
`webServer` (it is a web page), which tui also does not have.

Before the fix, after installing into tui every startup printed this line:

```
dsh: warning: 1 entry did not activate
custom-mode (dsh-custom-mode): pending (waiting for services: webServer, agentPresets)
```

It is **exactly the same** as the "dsh turns into a brick after installing" error in [§1](#1-严重装完之后-dsh-起不来了只剩一行-pending),
which makes it highly misleading — a normal installation into the wrong profile looks no different from catastrophic corruption.
The plugin now uses **scoped service waiting** (`ctx.inject`), so it no longer leaves the whole row stuck in `pending`, and `install.sh` also
states on the spot, right after installing, that no settings page is available in this profile.

**Conclusion**: to use the graphical settings page, install into the web profile. Installing into another profile will not break anything, but it cannot be used either.

---

## 11. One-shot verification checklist (run through it after making changes)

```sh
# 1. The two test suites (63 of those items are the composition-file compiler)
DSH_SHIPPED_PRESETS_DIR="$(node -e '
  const {createRequire}=require("module");
  const r=createRequire(process.argv[1]);
  console.log(require("path").join(require("path").dirname(r.resolve("@deepseek-ai/dsh-agent-presets/package.json")),"presets"));
' "$PWD/editor/index.mjs")" node test/composition.test.mjs
node test/locales.test.mjs

# 2. The plugin row entered the composition tree
dsh --profile web --dump-config | grep custom-mode

# 3. The composition tree did not collapse (should be hundreds of lines, not 1 line)
dsh --profile web --dump-config | wc -l

# 4. The preset is seen by dsh (after restarting dsh, when creating a new session)
dsh --profile web --dump-config >/dev/null && ls "$HOME/.dsh/.agent-presets/custom"

# 5. The settings page can read status (replace <token> with the one printed when dsh web starts)
curl -s "http://127.0.0.1:3080/custom-mode" \
  -H 'cookie: dsh-token=<token>' | head -c 300
```

> The cookie name and the way to obtain the token in item 5 may differ between dsh versions; when opening the settings page in a browser, look at the
> `/custom-mode` request in the Network panel — that is the least effort.
