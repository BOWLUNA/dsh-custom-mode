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
node test/run.mjs                                  # 11 suites, 520 checks; resolves the shipped presets itself
node tools/verify-translation-pairing.mjs          # bilingual pairing check (what CI runs)
bash -n install.sh && bash -n uninstall.sh         # syntax of the two scripts

# Against a real harness: always use a throwaway DSH_HOME, never the one in use
DSH_HOME=/tmp/dsh-dev ./install.sh
DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open
DSH_HOME=/tmp/dsh-dev dsh --profile web --dump-config | wc -l      # hundreds of lines = healthy

# Browser verification — the ONLY check that can see a rendered page. Needs a browser with a
# DevTools port and a running instance; see "The lab" below.
CDP_PORT=9222 node tools/browser-verify.mjs --url "http://127.0.0.1:3082/?token=…" --out shot.png

# Screenshots for the README (really clicks, saves, switches theme and language), see tools/screenshots/README.md
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
10. **The version number is the package's own stable line** (`1.0.0`, `1.0.1`, …) — it does not mirror
   dsh, and it must stay a bare `x.y.z` so directories and markets will auto-install it. Which dsh is
   supported is declared in `engines.dsh` + the peer range, and
   `tools/verify-version-consistency.mjs` asserts the CI-pinned dsh version falls inside them. Bump the
   version for every publish; widen the ranges when re-adapting.

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

## The lab (browser verification)

Unit tests here are blind to the last mile: they prove the host answers and the bundle registers,
but not what the page *renders*. That gap shipped a real bug — a page of raw keys
(`assistant.heading`) that every suite passed through. So a UI change is not verified until
`tools/browser-verify.mjs` has run against a real instance.

The lab is any second machine you can reboot freely (`$LAB` below); the machine running the harness
is **never** a test target — its `dsh web` serves the user and hosts the running agent, so restarting
it kills the session. Concrete hosts, addresses and launcher scripts belong in the operator's own
`~/.dsh/AGENTS.md`, which is not part of this repository.

```sh
# 1. ship the tree (the lab has its own checkout; node_modules excluded)
tar czf - --exclude=node_modules --exclude=.git -C <repo-parent> dsh-custom-mode \
  | ssh "$LAB" 'tar xzf - -C /root/dsh-lab'

# 2. a throwaway DSH_HOME on the lab. Seed settings.yaml (onboarding version + locale + theme) so
#    the first-run modals stay away. NEVER copy ~/.dsh/.credentials.yaml — credentials stay here.
ssh "$LAB" 'mkdir -p /root/dsh-custom-lab && cd /root/dsh-lab/dsh-custom-mode \
  && DSH_HOME=/root/dsh-custom-lab ./install.sh'

# 3. boot it (a script + setsid, not a foreground ssh command) and read the token URL from the log
ssh "$LAB" '/root/custom-lab.sh && cat /root/custom-lab.log'

# 4. a browser with a DevTools port. The lab already has playwright's chromium and a launcher.
ssh "$LAB" '/root/chrome-lab.sh'          # CDP on 127.0.0.1:9222

# 5. verify the rendered page (create/delete round trip included), then look at the screenshot
ssh "$LAB" 'cd /root/dsh-lab/dsh-custom-mode && CDP_PORT=9222 \
  node tools/browser-verify.mjs --url "<token URL>" --out /root/verify.png'
scp "$LAB":/root/verify.png /tmp/verify.png               # then read the image
```

`pkill -f "some string"` over ssh matches **its own command line** and kills the session
(`exit 255`); use the `[x]` trick. Long operations (an `npm i -g`) belong in a script behind
`setsid nohup`, polled — not in a foreground `ssh`.

## Knowing when you are done

- Code: `node test/run.mjs` is green. Docs: `node tools/verify-translation-pairing.mjs` passes
  (both sides of a pair must be edited, then re-recorded with `--write`).
- Behaviour: run it for real under a throwaway `DSH_HOME` and write the observed output into
  `docs/MEASUREMENTS.md` — this repository's convention is that a conclusion comes with the command
  and its raw output, not with "should be fine".
