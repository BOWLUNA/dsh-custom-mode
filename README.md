# dsh-custom-mode

English | [中文](README.zh.md)

Edit a DeepSeek Harness (`dsh`) mode's system prompt, base mode, and plugin switches. Keep more than one assistant. Standard, PTC, Minimal, and Creator stay in the menu.

![Settings](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/01-mode-switch.png)

## Install

Pin the version. A bare name can install an older build during pnpm's release cooldown. Details: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

```sh
dsh plugin --profile web add dsh-custom-mode@2.2.0
```

Restart the process that serves the profile. The version on the settings page is the one that is running.

Desktop app: install from the in-app Plugins page. The CLI cannot modify `profiles/desktop`.

On Windows, `install.sh` is bash and it needs a `dsh` executable on `PATH`. Otherwise use the `dsh` shipped with DeepSeek Harness, or `node node_modules/@deepseek-ai/dsh/lib/bin.js`.

## Use

1. Open Settings → Custom mode.
2. Edit the system prompt. Save is directly under the editor.
3. A new session uses this assistant when `settings.yaml` has no `agent-presets.default` yet. An existing value is left as it is.

The prompt is `prompt.md`. The next time a model step is assembled, that file is read again. History can load an older draft into the editor; loading does not write. A save computed against an older copy is refused when the file changed underneath. The model can change the same file only through `custom_prompt`, which asks first.

New assistants start as one posture. That choice applies only to the assistant you create next.

| Posture | After create |
| --- | --- |
| Develop | Built-in Standard tool set. |
| Write | Terminal off. File tools on. |
| Chat | Files and terminal off. |

## Boundaries

- It does not replace Standard, PTC, Minimal, or Creator.
- It does not ship a role-play preset.
- It does not run in the desktop profile from the CLI. Headless mode will not start a session that uses an agent preset.

## Compatibility

Declared range: `>=0.1.5-rc.2 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0`

| dsh | Claim | Checked for 2.2.0 |
| --- | --- | --- |
| `0.2.0-rc.2` | declared | Windows web profile, before this release |
| `0.2.1-alpha.1` | declared, in CI | not re-run for this release |
| `0.1.7-rc.2` | declared, in CI | not re-run for this release |

The unit suite also passed under WSL2 Ubuntu 26.04 (Node only, no dsh process, no browser). That is not a Linux desktop result.

## Docs

- [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) — wrong version installed, base mode unavailable, half-finished upgrade
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — where the prompt is read, and which host calls this package depends on
- [docs/PUBLISHING.md](docs/PUBLISHING.md) — tags and release
- [CONTRIBUTING.md](CONTRIBUTING.md) — people
- [AGENTS.md](AGENTS.md) — agents

## License

MIT
