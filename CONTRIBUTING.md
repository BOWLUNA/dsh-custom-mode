# Contributing

English | [中文](CONTRIBUTING.zh.md)

`dsh-custom-mode` is an agent preset plus a settings-page plugin for DeepSeek Harness. The repository root is the package, `preset/` is its one preset source, and the runtime remains plain ES modules with no build step or added runtime dependencies.

## Report a reproducible failure

Start with the [current troubleshooting steps](docs/TROUBLESHOOTING.md#current-recovery-steps). Report the exact host/plugin versions, platform, installation path and failing step. An open page, a successful save and a successful model request are different observations. Use synthetic prompts and sanitize token URLs, credentials and private history.

## Isolated development

Use Node 24 for full host/integration checks, plus git, npm and Bash for the clone installer. The package's Node 20 declaration covers its code, while installed host dependencies can require a newer runtime. Choose an exact accepted host from [CURRENT_COMPATIBILITY.md](docs/CURRENT_COMPATIBILITY.md); the package and host versions do not have to match.

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
node test/run.mjs
node test/install-script.test.mjs
```

The test runner needs the exact host's shipped declarations and explains resolution failures. Tests use synthetic temporary paths. Install host dependencies in a task-specific prefix; do not change a live harness installation, an archived node_modules tree or global packages. If a source checkout's dependency link must remain untouched, test an immutable candidate snapshot with a new dependency link, and keep the source checkout as the sole editable source.

For a disposable local Web home only:

```sh
DSH_HOME=/tmp/dsh-dev ./install.sh --profile web
DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open
```

Use a free port and only stop processes you started. The clone installer requires npm to pack/validate local archives offline, preserves user files, and keeps verified rollback evidence; it never downloads a newer rollback package. Its successful installation stays source-linked, so client edits can use host HMR. Host module changes require restarting that isolated instance. Use the desktop app's own plugin manager for its profile.

## Required evidence before release

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

Edit both language documents before updating their pairing records:

```sh
node tools/verify-translation-pairing.mjs --write
node tools/verify-translation-pairing.mjs
```

Pair hashes catch drift, while structure and language checks catch missing sections. Re-recording a hash does not replace reviewing both texts.

## Version and publication

Every publish gets a new plain `x.y.z` plugin version. Host compatibility lives in `engines.dsh` and the optional peer range; exact CI pins must satisfy both. New dist-tags are information to investigate, not automatic support. Follow [PUBLISHING.md](docs/PUBLISHING.md), use the existing gated workflow, and keep independent review, remote SHA read-back and distribution verification separate. Do not change publisher permissions or merge the default branch as an incidental development step.

## Style

- Plain JavaScript ES modules; no bundler, TypeScript migration or new runtime dependencies for this repair.
- Explain why a constraint exists. Back host-behavior claims with exact-source references and observed output.
- Keep tests tied to user-visible behavior and failure recovery, with synthetic data and honest coverage boundaries.
