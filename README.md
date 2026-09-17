# dsh-custom-mode

English | [中文](README.zh.md)

A custom mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). Its
system prompt is a plain file you can edit on the Web settings page, and an edit takes effect on the
**next model step** — no restart, no new session.

The four official modes (`standard` / `ptc` / `minimal` / `cordis`) are untouched.

|  |  |
| --- | --- |
| ![Mode name and base mode](docs/images/01-mode-switch.png) | ![Plugin switches](docs/images/02-plugin-switches.png) |
| ![System prompt](docs/images/03-system-prompt.png) | ![Mode picker](docs/images/04-preset-picker.png) |

## Install

One command installs everything — the settings-page plugin, and the preset it seeds on first
activation:

```sh
dsh plugin --profile web add dsh-custom-mode
```

Restart dsh afterwards, then choose「自定义模式」for a new session. The preset is written to
`$DSH_HOME/.agent-presets/custom/`; anything already there is left alone, so a `prompt.md` you wrote
yourself is never overwritten.

To keep the sources around as well — or to install without npm — clone and run the script, which does
the same two things explicitly:

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
./install.sh            # copies preset/ into $DSH_HOME/.agent-presets/custom/ and installs the plugin
./uninstall.sh          # removes the plugin; keeps your prompt unless you pass --purge
```

The mode needs a profile that ships `agent-presets` — the `web` profile does, `tui` and `headless` do
not.

## Usage

- **Settings page** — rename the mode, pick a base mode, toggle plugin rows one by one, edit the prompt.
- **Ask the agent** — the mode ships a `custom_prompt` tool, so a session can read or rewrite the prompt.
- **Edit the file** — `$DSH_HOME/.agent-presets/custom/prompt.md` is the single source of truth.

Only `{{model}}`, `{{cwd}}` and `{{provider}}` are interpolated. An unknown `{{…}}` is rejected when
saved: the renderer throws on it, which would fail every request in that mode.

## How it works

dsh normally takes the system prompt from a preset's YAML, and `@deepseek-ai/dsh-persona` resolves its
`prefix` once at mount. This preset registers the same `deployment:persona-prefix` section but makes
its `text` a **function**, which the agent loop calls before every model step.

Two different things therefore decide when a change lands:

- **Prompt text** is re-read per step, so an edit applies to the **running** session immediately.
- **Switches and base mode** rewrite the composition file. `agent-presets` remounts a preset when that
  file's `mtimeMs` and `size` change, so a **new session** picks them up; a running session keeps the
  configuration it started with, which is deliberate — swapping a tool set mid-conversation would be wrong.

Row switches are tri-state. A row you never touched stays byte-identical to the shipped one, including
its `!!js` platform condition and its shipped `disabled` state; an explicit on/off replaces that
condition with a boolean. Platform expressions are evaluated on the host, so the page shows the state
actually in force on this machine rather than whether a key exists.

## Versioning

Developed and verified on dsh **`0.1.6-alpha.1`**. The version number mirrors the DSH release this
plugin was adapted to and is **not bumped per change** — fixes and docs accumulate under it until
upstream releases a new DSH and the plugin is re-adapted. What decides compatibility is whether the
APIs below still exist, not a patch number of our own.

<details>
<summary>Coupling points (check these when upgrading dsh)</summary>

| Dependency | Failure if it changes |
| --- | --- |
| `ctx.systemPrompt.section()` with a **function** `text` | the prompt stops hot-reloading — the point of the project |
| `agentPresets` remounts on composition `mtimeMs`+`size` | switches need a process restart to apply |
| `ctx.tools.register()` | loses the `custom_prompt` tool |
| `ctx.webServer.register({ kind, path, handler })` | settings page is blank |
| `ctx.connection.requestRejection(req)` | settings page fails closed (503) instead of serving |
| `ctx.inject(deps, cb)` (scoped wait) | the row parks in `pending` in profiles without a web server |
| `dsh.client` + `exports["./client"]`, client bundle id == package name | the browser half is not discovered |
| `settings.section` slot with `locale` | page placement / translated labels |
| `ctx.locale.register/bind` | falls back to Chinese |
| shipped layout `<presets>/<id>/agent.cordis.yml` and row text shape | base-mode switching breaks |
| `!!js` platform expressions | platform rows display the wrong state |

</details>

## Documentation

- [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — failures reproduced on a real machine, with symptoms, cause and a way out.
- [`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md) — the commands and raw output behind each claim.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — why this is two artifacts, and which host APIs it depends on.
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) — how the npm package is published.
- [`CHANGELOG.md`](CHANGELOG.md) · [`SECURITY.md`](SECURITY.md) · [`CONTRIBUTING.md`](CONTRIBUTING.md)

## Development

```sh
node test/run.mjs        # 8 suites, 333 checks; resolves the shipped presets itself
```

Edits to `editor/client.js` are hot-swapped by `@deepseek-ai/dsh-client-hmr` about a second later; the
host half (`index.mjs`, `composition.mjs`, `meta.mjs`, `paths.mjs`) needs a restart. See
[`test/README.md`](test/README.md) for what each suite protects, and [`CONTRIBUTING.md`](CONTRIBUTING.md)
before changing behaviour.

## License

MIT

---

## Built with

| | |
| --- | --- |
| Model | DeepSeek V4.1 Flash (`deepseek-v4-flash`, provider `deepseek-official`) |
| Runtime | DeepSeek Harness **0.1.6-alpha.1** (`@deepseek-ai/dsh`, preview) |

The whole project, research and dead ends included, cost the DSH client 111,406,700 tokens at a 98%
cache hit rate — about 306k of them output.
