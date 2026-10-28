# Contributing

English | [中文](CONTRIBUTING.zh.md)

`dsh-custom-mode` is an agent preset plus a settings-page plugin for DeepSeek Harness. The repository root is the package, `preset/` is its one preset source, and the runtime remains plain ES modules with no build step or added runtime dependencies.

## Report a reproducible failure

Start with the [current troubleshooting steps](docs/TROUBLESHOOTING.md#current-recovery-steps), then use the [bug form](https://github.com/BOWLUNA/dsh-custom-mode/issues/new?template=bug_report.yml). Report the exact host/plugin versions, platform, installation source and failing step. An open page, a successful save and a successful model request are different observations. Use synthetic prompts and sanitize token URLs, credentials and private history. Follow [SECURITY.md](SECURITY.md) for security concerns instead of posting vulnerability details.

## Isolated development

Use Node 24 for full host/integration checks, plus git, npm and Bash for installer tests. Alpha hosts require Node >=24.9. The package's Node 20 declaration covers its code, while host dependencies can require a newer runtime. Choose an exact host from [CURRENT_COMPATIBILITY.md](docs/CURRENT_COMPATIBILITY.md); the package and host versions do not have to match.

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
```

Create a new workspace outside the clone. On Unix with Bash:

```sh
DSH_CHECK_ROOT="$(mktemp -d)"
DSH_HOST_DIR="$DSH_CHECK_ROOT/host"
mkdir -p "$DSH_HOST_DIR"
printf '{"private":true}\n' > "$DSH_HOST_DIR/package.json"
```

On Windows with PowerShell, use this setup instead; Git Bash must also be installed for the installer tests:

```powershell
$DSH_CHECK_ROOT = Join-Path ([IO.Path]::GetTempPath()) ('dsh-custom-dev-' + [guid]::NewGuid().ToString('N'))
$DSH_HOST_DIR = Join-Path $DSH_CHECK_ROOT 'host'
New-Item -ItemType Directory -Path $DSH_HOST_DIR | Out-Null
'{"private":true}' | Set-Content -LiteralPath "$DSH_HOST_DIR/package.json" -Encoding utf8
```

From the clone root, the following commands work with either setup. The exact rc.2 host is an example from the compatibility record:

```sh
npm install --prefix "$DSH_HOST_DIR" --cache "$DSH_CHECK_ROOT/npm-cache" --ignore-scripts --save-exact --no-audit --no-fund @deepseek-ai/dsh@0.2.1-rc.2
node -p "require(process.argv[1]).version" "$DSH_HOST_DIR/node_modules/@deepseek-ai/dsh/package.json"
node tools/prompt-contract-check.mjs --host-install "$DSH_HOST_DIR"
node tools/compat-check.mjs --host-install "$DSH_HOST_DIR" --out "$DSH_CHECK_ROOT/check-01" --port 32110
```

Confirm that the version read-back is `0.2.1-rc.2`. The component check starts no model or server. The compatibility checker copies the source to `--out/candidate`, links that candidate to the supplied host dependencies, and uses its own synthetic `DSH_HOME`. It runs unit/guard/package checks and a loopback boot check; choose a free port. Results are written to `check-01/report.json` and its logs. Use a fresh `--out` for each source snapshot; never hand-edit the generated copy.

Do not point `--host-install` at a live installation, an archived dependency tree or global packages: the unit runner can derive fixture files under that host's node_modules. Keep the new workspace while reviewing evidence; it contains test data, not a live user home. For documentation-only edits, start with translation, link and diff checks rather than starting a host.

Optional source-linked UI iteration uses `./install.sh --profile web` with an exact host CLI on PATH and a disposable `DSH_HOME`. See [package and rollback behavior](docs/PUBLISHING.md#package-and-release-assets). Use only processes and test homes you created; desktop profiles remain managed through the desktop app.

## Required evidence before release

The existing gates below run in the prepared candidate, with its task-specific host dependencies. Runtime/UI changes need their relevant behavior checks; a documentation-only PR should record what was checked and what was not applicable without claiming a full runtime run.

```sh
node test/run.mjs
node tools/verify-version-consistency.mjs
node tools/verify-translation-pairing.mjs
node tools/verify-doc-numbers.mjs
node tools/verify-browser-literals.mjs
npm pack --dry-run --ignore-scripts --json
```

Register new suites in `test/run.mjs`; update documented counts from the real integrated run. Check actual prompt assembly against the exact supported host APIs, including old user prompts/custom suffixes. Reproduce the fixed failure paths rather than merely checking the new implementation's shape.

Real UI changes need the existing browser verification against an isolated exact host and the official settings controls as the reference. Packed install, preset selection, save/application, restart, uninstall/reinstall and the first-request boundary need their own evidence. A component test is not a desktop acceptance result. Use [CURRENT_COMPATIBILITY.md](docs/CURRENT_COMPATIBILITY.md) for reproduction entry points and pending checks.

For update-related changes, test the actual native capability rather than only a host version string. Use a new isolated profile and synthetic loopback registry to check explicit queries, separate read/update permissions, original installation sources, draft-protected navigation and the official Plugins confirmation/result handoff. Older hosts need their details/manual-guide fallback checked independently. Keep synthetic-registry results distinct from public-registry or desktop acceptance; never test self-updates in the host serving your active work.

## Invariants

- Preserve untouched composition rows byte-for-byte, including platform conditions and shipped disabled state; do not YAML-round-trip the file.
- Preserve three-state switches: untouched, explicitly on and explicitly off.
- Register routes through the host's authenticated shared `/api` channel, keeping the carrier's Host/Origin/authentication fence.
- Wait for optional host services inside scoped injection; missing Web services must not stall the whole plugin row.
- Keep the page/tool prompt validators and the browser/host dictionaries consistent.
- Treat prompt, metadata and composition as user data. Refresh managed code separately; use temporary fixtures in tests.
- Preserve recovery evidence and recover before assistant discovery; process-termination checks do not prove physical power-loss durability.
- Serialize persisted changes with registry synchronization, and distinguish saved-but-not-applied from a completed operation. Retry synchronization without replaying a mutation.
- Use the official native UI primitives and measured defaults; do not repaint their disabled states, spacing or typography to invent another control system.

## Equal-authority translations

Edit both language documents in the editable source checkout before updating their pairing records:

```sh
node tools/verify-translation-pairing.mjs --write
node tools/verify-translation-pairing.mjs
```

Pair hashes catch drift, while structure and language checks catch missing sections. Re-recording a hash does not replace reviewing both texts.

## Version and publication

Every publish gets a new plain `x.y.z` plugin version. Host compatibility lives in `engines.dsh` and the optional peer range; exact CI pins must satisfy both. New dist-tags are information to investigate, not automatic support. Follow [PUBLISHING.md](docs/PUBLISHING.md), use the existing gated workflow, and keep independent review, remote SHA read-back and distribution verification separate. Do not change publisher permissions or merge the default branch as an incidental development step.

## Style

- Plain JavaScript ES modules; avoid unrelated bundlers, language migrations or runtime dependencies.
- Explain why a constraint exists. Back host-behavior claims with exact-source references and observed output.
- Keep tests tied to user-visible behavior and failure recovery, with synthetic data and honest coverage boundaries.
