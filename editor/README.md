# dsh-custom-mode

The **settings-page half** of [dsh-custom-mode](https://github.com/BOWLUNA/dsh-custom-mode): a Web UI
for a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) agent preset whose
**system prompt is a plain file you can edit, taking effect on the next model step** — no restart, no
new session.

![Settings → Custom mode](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/01-mode-switch.png)

## What is in this package, and what is not

This package is **only the editor**: one private HTTP route plus the browser half that renders the
settings section (base-mode picker, per-row plugin switches, prompt editor, mode rename).

The **agent preset itself is not an npm package** — it is a directory of files
(`preset/agent.cordis.yml`, `prompt-reader.mjs`, `prompt-tool.mjs`, `prompt.md`) that dsh discovers
under `$DSH_HOME/.agent-presets/<id>/`. It comes from the GitHub repository.

So:

- **First-time install** → clone the repository and run `./install.sh`. It copies the preset *and*
  installs this package into your profile.
- **Already have the preset, want to update the editor** → install this package directly:

  ```sh
  dsh plugin --profile web add dsh-custom-mode
  ```

- The mode is **web-profile only**: the `agent-presets` service, which mounts presets at all, ships
  with dsh's `web` profile. In `tui` / `headless` this package activates but registers nothing.

## Requirements

- `@deepseek-ai/dsh` `>=0.1.2-alpha.1` (declared as an *optional* peer: this package never imports it,
  it only reads the host services dsh injects)
- The version is this package's own line (`1.0.0`, `1.0.1`, …). Which DSH it supports is declared in
  `engines.dsh` and the peer range above; see the repository README's "Versioning" section.
- Source is published as-is: **no build step, no dependencies** beyond Node's standard library.

## Documentation

The full documentation is bilingual in the repository:

- [README](https://github.com/BOWLUNA/dsh-custom-mode#readme) (English) ·
  [中文说明](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/README.zh.md)
- [Troubleshooting](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/TROUBLESHOOTING.md) —
  every failure that was actually reproduced, with symptoms, cause and a way out
- [Measured behaviour](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/%E5%AE%9E%E6%B5%8B%E8%AE%B0%E5%BD%95.md) —
  the commands and raw output behind every claim
- [Architecture](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/ARCHITECTURE.md) — why
  this had to be two artifacts, and how the host APIs it depends on can break

## Security note

The route this package serves runs the platform's own browser-trust check
(`ctx.connection.requestRejection`) before anything else and **fails closed** when that service is
unavailable. Before that check existed, the route could be read and written unauthenticated — see
[SECURITY.md](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/SECURITY.md) for the affected
range and the mitigation.

## License

MIT
