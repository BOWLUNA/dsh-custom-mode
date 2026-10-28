# dsh-custom-mode

English | [中文](README.zh.md)

Edit a DeepSeek Harness (`dsh`) custom mode: system prompt, base mode, and plugin switches. Keep more than one assistant. 自定义模式、系统提示词、提示词编辑。

<p align="center">
<img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/header.png" width="820" alt="dsh-custom-mode">
</p>

<table align="center">
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/05-assistant-manager.png" width="360" alt="Assistants"></td>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/03-system-prompt.png" width="360" alt="System prompt"></td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/01-mode-switch.png" width="360" alt="Base mode"></td>
<td align="center"><img src="https://raw.githubusercontent.com/BOWLUNA/dsh-custom-mode/main/docs/images/02-plugin-switches.png" width="360" alt="Plugin switches"></td>
</tr>
</table>

## Install and make the first request

These instructions are for version `2.2.6`. Check the [exact-host results and acceptance limits](docs/CURRENT_COMPATIBILITY.md) before installing or updating.

Start with an installed [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and a model configured through its own interface. Check `dsh --version` against the exact hosts in the compatibility record. This package does not install the host or configure model credentials.

### Web / CLI

Pin the plugin version; a bare name can resolve an older build during pnpm's release cooldown:

```sh
dsh --version
dsh plugin --profile web add dsh-custom-mode@2.2.6
```

Restart the process that serves this Web profile using its usual launcher. For a local CLI instance, the existing launch form is `dsh web --port 3081 --no-open`; use a free port and open the URL printed by that process. Restart only that instance. Installing a bundle does not refresh an already running host.

### Desktop and Windows

In the desktop app, use its **Plugins** page to install `dsh-custom-mode@2.2.6`, then restart the app. This project's scripts deliberately refuse `--profile desktop`; do not modify its profile files by hand. Windows/Electron acceptance remains separate from Web acceptance; see the compatibility record.

On Windows, the npm installation above can use the host's `dsh` command from PowerShell. Only the optional clone installer requires Git Bash (plus Node.js and npm). If `dsh` is not on PATH, use the host's supplied launcher, or replace `dsh` with `node "<host-install>/node_modules/@deepseek-ai/dsh/lib/bin.js"`. Do not point that path at this plugin's directory unless the host is actually installed there.

### Verify the whole path

1. Open Settings → Custom mode and check the displayed version. A page that opens is only the first check.
2. Scroll to **New assistant at the bottom of the page**. When the built-in `custom` assistant already exists, this section follows its editor. Choose a starting setting such as Writing, enter a recognizable name, and select New assistant. The created assistant becomes the editing target.
3. Set a temporary prompt such as `For the next readiness check, reply with exactly CUSTOM_MODE_READY.` Save and wait for the page to confirm that it was applied. If it says the file was saved but application failed, select Retry activation before continuing.
4. Start a **new session**, open its mode/assistant selector, and explicitly choose that named assistant. Send `Readiness check.` through a model already configured in DSH.
5. Success means the assistant is selectable without a broken-preset warning and returns the expected readiness reply without a prompt-assembly error. Restore your intended prompt after the check. If it fails, use the [current recovery steps](docs/TROUBLESHOOTING.md#current-recovery-steps).

## What each choice means

The assistant selected on the settings page is the **one being edited**. Selecting or creating it does not change the assistant used by a new session. On first activation, the plugin may fill a missing default with the built-in `custom` assistant; an existing default is preserved. A newly created Writing assistant still needs to be chosen in the session selector.

Choose the creation starting settings first; a new assistant starts from Standard. After creation, its base mode and individual plugin switches can be adjusted in its editor.

| Starting settings | Initial behavior |
| --- | --- |
| Coding | Official Standard mode, tools as shipped. |
| Writing | Official Standard mode; terminal off, file tools on. |
| Chat | Official Standard mode; files and terminal off. |

The prompt is stored in `prompt.md` and reread when the next model step is assembled. History and file import load a draft; saving writes it. A stale save is refused when the underlying file changed. `custom_prompt` asks for approval before it writes the same file. Turning off the Identity/persona row also turns off this prompt's injection.

## Upgrade, clone development, and removal

The fixed-version npm path above is the normal installation path. Release assets, once published, also include `dsh-custom-mode-2.2.6.tgz`, a preset-only import archive, and `SHA256SUMS`. Verify a downloaded archive's hash before installing it; the preset-only archive does not include the settings page.

For a clone, `./install.sh --profile web` keeps the source-linked development workflow. It requires Node.js, npm, Bash and the host CLI. Before changing the profile, it prepares the new package and an archive of the **actual installed old package** with offline `npm pack --ignore-scripts`. It preserves existing prompt, metadata and composition, and refreshes managed code only after installation checks. A failed replacement reinstalls the local old archive and restores refreshed code. Files newly created by the attempt are retained at printed recovery paths when rolled back. An unverified rollback exits with an error and keeps the archive and logs at the printed transaction path. A broken old install that cannot be archived is rejected before replacement. The script is not a substitute for the desktop plugin manager.

`./uninstall.sh` removes the plugin but keeps assistant data. `--purge` explicitly deletes the managed assistant directories and their prompts; keep your own backup before using it.

## Compatibility and versioning

Declared host range: `>=0.1.5-rc.2 <0.2.0-0 || >=0.1.6-alpha.1 <0.2.0-0 || >=0.1.7-alpha.1 <0.2.0-0 || >=0.2.0-0 <0.3.0-0 || >=0.2.1-alpha.1 <0.3.0-0 || >=0.2.2-alpha.2 <0.3.0-0`

The plugin version is its own stable `x.y.z` line; it does not mirror DSH. On 2026-10-27 the public host tags were `latest=0.2.1-rc.2`, `next=0.2.1-rc.4`, and `alpha=0.2.2-alpha.2`. Tags move; the declared range and completed checks are separate facts. See [exact versions, acceptance limits and historical evidence](docs/CURRENT_COMPATIBILITY.md) for the tested scope.

Release requires the compatibility and browser workflows. The unit runner, real prompt-component checks, packed-install checks and browser checks cover different boundaries. Windows/Electron, a real model response and GPU execution must each have their own evidence; they are not inferred from a page screenshot or unit count. Headless mode does not start an agent-preset session.

## Plugin markets

The documented catalogs use different discovery and approval rules. Their 2026-10-09 listing results are historical, so a package may not be searchable in every market today. The fixed-version installation above remains the direct path. [Market interfaces and limits](docs/MARKETPLACES.md) explains the read-only adapter; it never executes catalog-provided shell commands or submits a listing.

## Docs

- [Troubleshooting](docs/TROUBLESHOOTING.md) — current recovery first, historical incidents below.
- [Architecture](docs/ARCHITECTURE.md) — prompt reading and host coupling points.
- [Publishing](docs/PUBLISHING.md) — existing gated release path and read-back evidence.
- [Contributing](CONTRIBUTING.md) — isolated development and checks.
- [AGENTS.md](AGENTS.md) — repository instructions for agents.

## License

MIT
