# dsh-custom-mode

![dsh-custom-mode — a settings page for dsh agent modes](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/header.png)

[![npm](https://img.shields.io/npm/v/dsh-custom-mode?label=npm&style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-custom-mode) [![CI](https://img.shields.io/github/actions/workflow/status/BOWLUNA/dsh-custom-mode/test.yml?label=CI&style=flat-square&logo=githubactions&logoColor=white)](https://github.com/BOWLUNA/dsh-custom-mode/actions/workflows/test.yml) [![license](https://img.shields.io/npm/l/dsh-custom-mode?label=license&style=flat-square&logo=opensourceinitiative&logoColor=white)](LICENSE)

<!-- community badge row: required in every new repository (see the storefront template in the operator SOP/DSH Plugins folder) -->

[![bilibili](https://img.shields.io/badge/bilibili-%2300A1D6?style=flat-square&logo=bilibili&logoColor=white)](https://b23.tv/qJ4Ev0W) [![Douyin](https://img.shields.io/badge/Douyin-%23FE2C55?style=flat-square&logo=tiktok&logoColor=white)](https://v.douyin.com/VWh0M03Fa4Y/) [![RedNote](https://img.shields.io/badge/RedNote-%23FF2442?style=flat-square&logo=xiaohongshu&logoColor=white)](https://xhslink.cn/o/A7QtXmePBBF) [![Discord](https://img.shields.io/badge/Discord-%235865F2?style=flat-square&logo=discord&logoColor=white)](https://discord.gg/pz97SfAfSy) [![Discussions](https://img.shields.io/github/discussions/BOWLUNA/dsh-custom-mode?label=Discussions&style=flat-square&logo=github&logoColor=white)](https://github.com/BOWLUNA/dsh-custom-mode/discussions)

The **settings-page half** of [dsh-custom-mode](https://github.com/BOWLUNA/dsh-custom-mode) — a Web UI for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) agent modes: choose a mode's base
composition, toggle the plugin rows it mounts, and edit its **system prompt**, which is a plain file the
agent loop re-reads before every model step — **a save applies on the next step, with no restart and no new
session**. Several modes ("assistants") live side by side, each with its own prompt.

Searched for as: custom mode · custom prompt · system-prompt editor · multi-mode / several assistants ·
自定义模式 · 自定义提示词 · 多助手／多模式.

![Assistant manager](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/05-assistant-manager.png)

![Mode name and base mode](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/01-mode-switch.png)

![Plugin switches](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/02-plugin-switches.png)

![System prompt](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/03-system-prompt.png)

![Mode picker](https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/04-preset-picker.png)

## Install

```sh
dsh plugin --profile web add dsh-custom-mode
```

**That one command is the whole install.** The package carries the agent preset, and the host half writes it
into `$DSH_HOME/.agent-presets/` on first activation — filling in only what is missing, so a `prompt.md` you
wrote yourself is never overwritten.

To keep the source around as well, clone the repository and run `./install.sh` instead; it does the same two
things explicitly, and `./uninstall.sh` undoes them (keeping your prompt unless you pass `--purge`).

The mode is **web-profile only**: `agent-presets`, the service that mounts presets at all, ships with dsh's
`web` profile. In `tui` / `headless` this package activates but registers nothing.

## Requirements

- **dsh `>=0.1.5-rc.2 <0.2.0-0`**（latest stable `0.1.5-rc.2` and latest preview `0.1.6-alpha.2`）** — declared in `engines.dsh` and as an *optional* peer range. This package never
  imports `@deepseek-ai/dsh`; it only reads the host services dsh injects.
- **No build step, no dependencies**: the source is published as-is and uses only Node's standard library.
- The package version is its own line (`1.0.0`, `1.0.1`, …). Which dsh it supports is declared in
  `engines.dsh`; see the repository README's "Versioning" section.

## Documentation

The full documentation is bilingual in the repository:

- [README](https://github.com/BOWLUNA/dsh-custom-mode#readme) (English) ·
  [中文说明](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/README.zh.md)
- [Troubleshooting](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/TROUBLESHOOTING.md) —
  every failure that was actually reproduced, with symptoms, cause and a way out
- [Measurements](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/MEASUREMENTS.md) — the commands
  and raw output behind every claim
- [Architecture](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/docs/ARCHITECTURE.md) — why this had
  to be two artifacts, and which host APIs it depends on

## Security note

The route this package serves runs the platform's own browser-trust check
(`ctx.connection.requestRejection`) before anything else and **fails closed** when that service is
unavailable. Before that check existed, the route could be read and written unauthenticated — see
[SECURITY.md](https://github.com/BOWLUNA/dsh-custom-mode/blob/main/SECURITY.md) for the affected range and
the mitigation.

## License

MIT
