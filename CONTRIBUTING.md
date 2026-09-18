# Contributing

English | [中文](CONTRIBUTING.zh.md)

Thanks for wanting to help with `dsh-custom-mode` — a **custom mode** (agent preset) for
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), plus the settings-page plugin
that edits its system prompt.

This project is small and deliberately has **no build step and no dependencies**: the browser half is a
hand-written bundle and everything else is plain Node ES modules. Keeping it that way is part of the
design, not an accident.

## Before you open an issue

Most failures here are silent — the mode simply does not appear, or a save does not take effect. Start
with [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md): it covers the failures that were actually
reproduced on a real machine, each with symptoms, cause and a way out. Then use the issue template; it
asks for the two things that separate "installed but inert" from "not installed at all".

## Ways to help that are not code

- Report bugs with the reproduction steps the template asks for.
- Tell us the DSH version you are on. This plugin is version-locked to the DSH release it was adapted
  to, so "which DSH" is the first question for any report.
- If you build your own DSH plugin, add the [`dsh-plugin` topic](https://github.com/topics/dsh-plugin)
  to your repository — that is how plugins get discovered.

## Development loop

Prerequisites: Node.js ≥ 20, `git`, and a `dsh` matching the version in
`editor/package.json` (currently `0.1.6-alpha.2`; if it differs, check the README's coupling-point
table first).

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
node test/run.mjs          # thirteen suites; resolves the shipped presets itself
```

To try the plugin against a real harness, install it into a **throwaway** `DSH_HOME` so your own
installation is never touched:

```sh
DSH_HOME=/tmp/dsh-dev ./install.sh
DSH_HOME=/tmp/dsh-dev dsh web --port 3081 --no-open     # then open the URL it prints
```

Editing `editor/client.js` is picked up by client HMR in about a second — no restart, no refresh.
Changing the host half (`index.mjs`, `composition.mjs`, `meta.mjs`, `paths.mjs`) needs a restart.

Screenshots are produced, not taken: `tools/screenshots/` drives a real instance over CDP. Use it
instead of editing images by hand.

## What must not break

These are the invariants the tests and the docs exist for. Each one was a real bug at some point:

- **Untouched rows stay byte-identical.** The compiler rewrites a shipped composition by text surgery;
  a row the user never touched must keep its `!!js` platform condition and its shipped `disabled`
  state. A round-trip through a YAML parser would silently change platform behaviour.
- **The switch is tri-state**, not a boolean: untouched / explicitly on / explicitly off.
- **The settings route runs the platform's own check first.** It is registered on the raw
  `webServer` table, which is *outside* the browser-trust fence; `ctx.connection.requestRejection(req)`
  is what puts it back inside, and it must fail **closed** when that service is missing.
- **The plugin row activates everywhere.** Waiting for services belongs in a scoped `ctx.inject`, not
  in the row's own `inject` — otherwise a profile without a web server prints the same
  "did not activate" warning a broken installation does.
- **The two copies of the `{{…}}` validator stay in step** (`editor/index.mjs` and
  `preset/prompt-tool.mjs`). They are duplicated on purpose; a drift means one write path accepts
  something the renderer throws on, i.e. every request in that mode fails.
- **The dictionary copy in `client.js` stays in step with `locales.mjs`.** The browser half cannot
  import it, so a test extracts both and compares them.
- **`preset/prompt.md` is user data.** Tests must write to temporary paths, never to the repository's
  copy.

## Translations carry equal authority

`README.md` and `CONTRIBUTING.md` are English; `README.zh.md` and `CONTRIBUTING.zh.md` are Chinese.
Both sides matter equally, so the pairing is **recorded and checked**:

```sh
node tools/verify-translation-pairing.mjs           # what CI runs
node tools/verify-translation-pairing.mjs --write   # after bringing both sides along
```

Edit one side and forget the other, and CI will say so. Re-record only once both sides really say the
same thing.

## Version numbers

The package version is its **own line** (`1.0.0`, `1.0.1`, …), not a mirror of the DSH release.
Which DSH this plugin supports is declared in `engines.dsh` and the peer range in
`editor/package.json`; `tools/verify-version-consistency.mjs` asserts the DSH version CI tests falls
inside them. Bump the version for every publish (npm refuses to republish one), and widen the ranges
when you re-adapt to a newer DSH. See the "Versioning" section of the README.

## Style

- Plain JavaScript ES modules — no TypeScript, no bundler, no new dependencies.
- Comments explain *why*, and measured facts beat opinions: if you write "this is how dsh behaves",
  say how you checked. `docs/MEASUREMENTS.md` is where that kind of evidence lives.
- Keep the tests' assertions precise. A loose regex that passes for the wrong reason is worse than no
  test — two of the tests in this repository were written wrong first and had to be fixed.
