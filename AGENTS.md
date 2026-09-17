# AGENTS.md

Instructions for coding agents working in this repository. The human-facing version is
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## What this is

A custom mode for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh). It is
deliberately **two artifacts**, because they are mounted on different planes (see
`docs/ARCHITECTURE.md` §1):

| Artifact | What it is | Where it goes |
| --- | --- | --- |
| `preset/` | an agent preset (**a directory of files**, not an npm package) | `$DSH_HOME/.agent-presets/custom/` |
| `editor/` | the settings-page plugin (npm package + profile bundle) | `dsh plugin --profile web add ./editor` |

## Commands

```sh
node test/run.mjs                                  # 8 suites, 333 checks; resolves the shipped presets itself
node tools/verify-translation-pairing.mjs          # bilingual pairing check (what CI runs)
bash -n install.sh && bash -n uninstall.sh         # syntax of the two scripts

# Against a real harness: always use a throwaway DSH_HOME, never the one in use
DSH_HOME=/tmp/dsh-dev ./install.sh
DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open
DSH_HOME=/tmp/dsh-dev dsh --profile web --dump-config | wc -l      # hundreds of lines = healthy

# Screenshots (it really clicks, saves, and switches theme and language), see tools/screenshots/README.md
DSH_HOME=/tmp/dsh-dev ./tools/screenshots/run-shots.sh "http://127.0.0.1:3081/?token=…" docs/images
```

## What must not break

1. **Untouched rows stay byte-identical** (keeping `!!js` platform conditions and shipped `disabled`
   state). `composition.mjs` does text surgery, not a YAML round-trip — do not "simplify" it into
   parse-and-reserialise.
2. **The switch is tri-state**: untouched / explicitly on / explicitly off. `undefined` and `false`
   are two different things.
3. **The settings route must run `ctx.connection.requestRejection(req)` first**, and must fail
   **closed** when that service is missing. A route registered on the raw `webServer` table is
   outside the platform's browser-trust fence (measured: the prompt could be read and `prompt.md`
   rewritten without authentication).
4. **Waiting for services belongs in a scoped `ctx.inject(deps, cb)`**, never in the row's own
   `inject`: otherwise a profile without a web server (tui) prints the same `pending` warning a
   broken installation does.
5. **The two copies of the `{{…}}` validator stay in step** (`editor/index.mjs` ↔
   `preset/prompt-tool.mjs`); a test compares their verdicts.
6. **The dictionary in `client.js` stays in step with `locales.mjs`**; a test extracts both and diffs them.
7. **`editor/preset/` is a packaging copy of `preset/`, not a second source.** npm can only ship
   files inside the package, so the five preset files exist twice; `test/seed.test.mjs` asserts they
   stay byte-identical. Edit `preset/`, copy, or the test fails.
8. **Seeding never overwrites.** `editor/seed.mjs` fills in only missing files at activation, so a
   storefront install (`dsh plugin add <pkg>`) is complete on its own, and a user's `prompt.md` or a
   generated `agent.cordis.yml` survives. It must not throw either: an unwritable `DSH_HOME` is
   reported and the boot continues.
9. **`preset/prompt.md` and `preset/preset.yml` are user data.** Tests must write to temporary paths
   (`DSH_CUSTOM_PROMPT_PATH`, or copy the module into a temp directory and import it from there).
10. **The version number follows dsh only**: small changes do not bump it; it changes when upstream
   releases a new version and this plugin is re-adapted. A repackaged build may append `.revN`, which
   `tools/verify-version-consistency.mjs` accepts and nothing else.

## Known traps (all measured)

- `agent-presets` exists **only in the web profile composition**; tui and headless do not have it, so
  the custom mode cannot even be selected there.
- `dsh --profile headless` refuses to run a session that uses an agent preset
  (`the one-shot runner does not compose`), so end-to-end verification has to go through a web instance.
- `agent-presets.default` is hard-coded to `standard` in the composition; the same key in
  `settings.yaml` is a **runtime override**. They are not the same thing.
- pnpm can leave the plugin symlink behind in `node_modules` (`uninstall.sh` cleans it up).
- Under WSL, if the `pnpm` on PATH is the Windows build, `dsh plugin add` panics with
  `current dir is an absolute path with drive letter`; use the Linux build (`corepack enable pnpm`).

## Knowing when you are done

- Code: `node test/run.mjs` is green. Docs: `node tools/verify-translation-pairing.mjs` passes
  (both sides of a pair must be edited, then re-recorded with `--write`).
- Behaviour: run it for real under a throwaway `DSH_HOME` and write the observed output into
  `docs/MEASUREMENTS.md` — this repository's convention is that a conclusion comes with the command
  and its raw output, not with "should be fine".
