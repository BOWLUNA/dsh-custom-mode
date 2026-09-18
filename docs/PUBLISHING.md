# Publishing and Distribution

English | [中文](PUBLISHING.zh.md)

This project has **two artifacts**, distributed in different ways (for the reasons, see [`ARCHITECTURE.md`](ARCHITECTURE.md)):

| Artifact | Type | Distribution |
|---|---|---|
| `preset/` | agent preset (**a file directory**) | copy into `$DSH_HOME/.agent-presets/<id>/` |
| `editor/` | profile bundle plugin (**an npm package**) | `dsh plugin --profile <p> add <package name or path>` |

An agent preset is **not** an npm package, so do not expect `npm install` to install it — `dsh` discovers it from a directory on disk.

## Option one: a GitHub repository (the least effort; recommended to start with)

Others:

```sh
git clone https://github.com/BOWLUNA/dsh-custom-mode
cd dsh-custom-mode
./install.sh
```

The script copies the preset and calls `dsh plugin add ./editor` (a local-path install, which pnpm will link).

## Option two: publish editor to npm as well

The preset still goes through clone (it is not an npm package), while editor is published to npm separately. **Already published**:
`dsh-custom-mode@0.1.6-alpha.1` (2026-09-17, tag `alpha`); `dsh-custom-mode@0.1.6-alpha.2`
(2026-09-18, tags `alpha` and `latest`).

```sh
cd editor
npm login --auth-type=web          # first time: browser login
npm publish --tag alpha            # give --tag explicitly, for the reason below
```

### Pre-publish self-check list

- [x] The source is **shipped with the package**, so installing needs no build script.
      Otherwise pnpm's `allowBuilds` will block users (`dsh` itself will prompt, but the experience is poor).
- [x] The patch file that `dsh.bundle.patch` points to is not missing from `files` (CI has an assertion against the real packlist).
- [x] `dsh.client.platform` is `"web"`.
- [x] `exports["./client"]` points to the browser half.
- [x] The `private` field has been deleted (it was `true` before publishing and was only for local development).
- [x] Peers that do not apply are marked `optional` in `peerDependenciesMeta`, otherwise the first thing a user sees after installing is a WARN.

The `files` allowlist is already written, and this is something that **cannot be checked by eye** — the easiest trap to fall into is "a file was left out",
and that only surfaces after someone installs it. CI (`.github/workflows/test.yml`) has an assertion against the real packlist,
and the same thing can be run locally at any time:

```sh
cd editor
npm pack --dry-run --json | node -e '
  const files = JSON.parse(require("fs").readFileSync(0, "utf8"))[0].files.map((f) => f.path);
  const need = ["index.mjs", "client.js", "composition.mjs", "meta.mjs", "paths.mjs", "cordis.patch.yml", "package.json"];
  const missing = need.filter((name) => !files.includes(name));
  console.log(files.join(", "));
  if (missing.length > 0) { console.error("缺:", missing); process.exit(1); }
'
```

The current expected output (`locales.mjs` is the "single source of truth" copy from the documentation, shipped with the package so that readers can find it):

```
client.js, composition.mjs, cordis.patch.yml, index.mjs, locales.mjs, meta.mjs, package.json, paths.mjs
```

### Three pitfalls found by actual testing

**1) `publishConfig.tag` is not honored; `--tag` must be given explicitly.**

`editor/package.json` declares `"publishConfig": { "access": "public", "tag": "alpha" }`,
but npm 11.19.0's `npm publish --dry-run` still prints `with tag latest`; only explicitly adding
`--tag alpha` on the command line turns it into `with tag alpha`. So **do not gamble on publishConfig being read**.

**2) On the first publish, `latest` was still pointed at the prerelease.**

Measured result: `npm view dsh-custom-mode dist-tags` →

```json
{ "alpha": "0.1.6-alpha.1", "latest": "0.1.6-alpha.1" }
```

That is, the convention that "a prerelease should not occupy `latest`" did not hold here (on the first publish the registry fills in `latest` for it).
That was true while the version mirrored the DSH release: mirroring an alpha DSH release made every
version a prerelease, so there was no stable version for `latest` to point at. Since **`1.0.0`** the
package has its own stable line and the ordinary semantics apply:

- `dsh plugin --profile web add dsh-custom-mode` installs the current version, and `latest` names a
  stable version — which is also what directories and markets require before they will auto-install it;
- to pin an exact version, write the full `dsh-custom-mode@1.0.0`;
- `alpha` is kept pointing at the last build of the old mirroring line (`0.1.6-alpha.2`) for anyone who
  pinned it.

**3) Peer dependencies must be marked `optional`, otherwise the first thing a user sees after installing is a warning.**

This project does **not** import `@deepseek-ai/dsh` (the settings page only uses services injected by the platform and node built-ins); declaring it serves only to
express "which host this adapts to". Without the optional marking, installing from the registry prints:

```
[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.
```

So `editor/package.json` was given:

```json
"peerDependenciesMeta": { "@deepseek-ai/dsh": { "optional": true } }
```

> This fix is in the repository, but it was **not** shipped with `0.1.6-alpha.1` (that version is already occupied). Running `npm unpublish` for one metadata
> warning is not worth it: unpublishing the whole package locks the package name for 24 hours. It will take effect with the next version (that is, after the official DSH
> update).

### After publishing a revision, move `latest` too

`npm publish --tag alpha` sets only the tag you pass. Storefronts install by package name, which
resolves **`latest`**, so a revision published without moving it leaves the one-command install on the
previous version. Measured: after publishing `0.1.6-alpha.1.rev1` under `alpha` only,
`dsh plugin --profile web add dsh-custom-mode` still installed `0.1.6-alpha.1` — the version that
predates the seeding which makes a one-command install complete.

```sh
npm dist-tag add dsh-custom-mode@<version> latest
```

pnpm caches the resolved `latest` too: a machine that resolved it before the change keeps installing the
old version until its metadata cache expires, so verify an install from a clean cache rather than
trusting the tag alone.

**And expect a one-day lag on pnpm ≥ 11.** `minimumReleaseAge` defaults to `1440` minutes, so for the
first day after a release a **bare name** install keeps resolving to the previous version — nothing is
wrong with the registry, and `npm view` will happily show the new `latest`. Measured on this package:
`dsh plugin --profile web add dsh-custom-mode` installed `0.1.6-alpha.1` thirteen hours after
`0.1.6-alpha.2` was published, and installed alpha.2 at once when the version was given explicitly.
If a user reports "it installed the old one", that is the reason; §17 of `docs/TROUBLESHOOTING.md` has
the check and the two ways out.

### Version numbers, and what "which DSH does it support" means (since 2026-09-18)

npm requires every publish to carry a unique version, and the package now has its own stable line
(`1.0.0`, `1.0.1`, …), so that requirement no longer collides with anything:

- **Every publish bumps the version.** The `.revN` suffix — invented when the version had to mirror the
  DSH release and a repackaged build could not reuse a number — is retired.
- **Compatibility is declared, not encoded.** `engines.dsh` and the `@deepseek-ai/dsh` peer range in
  `editor/package.json` state which DSH releases this plugin supports, and
  `tools/verify-version-consistency.mjs` (run in CI) asserts that the DSH version CI actually installs
  and tests falls inside those ranges. When re-adapting to a newer DSH, widen the ranges and bump the
  pin in the workflow.
- **The same version number still cannot be republished**: `npm publish` rejects it with `EPUBLISHCONFLICT`.

### 2FA

If the account has auth-and-writes enabled, the token obtained by browser login **cannot** publish, and returns:

```
403 Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

Two ways out: `npm publish --otp=123456` (changes every 30 seconds), or create a granular access
token with "bypass 2FA" checked and use it in a temporary userconfig (do not write it to `~/.npmrc`; revoke it after use):

```sh
umask 077
printf '//registry.npmjs.org/:_authToken=%s\n' "$NPM_TOKEN" > /tmp/npmrc-publish
npm publish --userconfig /tmp/npmrc-publish --tag alpha
rm -f /tmp/npmrc-publish
```

### How to verify after publishing (do not just look at "published successfully")

```sh
npm view dsh-custom-mode dist-tags versions

# really install once from the registry in a throwaway DSH_HOME, to confirm that it is a real package and not a symlink
H=$(mktemp -d); DSH_HOME=$H dsh plugin --profile web add dsh-custom-mode
node -p "JSON.stringify(require('$H/profiles/web/package.json').dependencies)"
ls -la "$H/profiles/web/node_modules/dsh-custom-mode"      # should be a directory, not an arrow
DSH_HOME=$H dsh --profile web --dump-config | grep -A1 'id: custom-mode'
```

### Version suffixes on the package (`0.1.6-alpha.1.rev1`)

The package version is normally the DSH version it was adapted to. npm refuses to republish a version,
so a change to the *package itself* — new files in `files`, a metadata fix — goes out as
`<dsh version>.revN` — a practice **retired on 2026-09-18**, when the package moved to its own stable
line (see the section above); the checker no longer accepts that suffix.

### Peer ranges and prereleases

A range without an explicit prerelease comparator silently excludes every prerelease of the harness:
node-semver only lets a prerelease satisfy a range when some comparator shares its exact
`major.minor.patch` **and** carries a prerelease tag.

```jsonc
"peerDependencies": { "@deepseek-ai/dsh": ">=0.1.2-alpha.1" }   // never matches 0.1.6-alpha.1
"peerDependencies": { "@deepseek-ai/dsh": ">=0.1.6-alpha.1" }   // comparator on the 0.1.6 tuple
```

`engines.dsh` uses the same shape, for the same reason.

### Three hard-won lessons (learned the hard way; be sure to follow them)

**1. Do not pin exact versions in peerDependencies.**

The community plugin `dsh-session-prompt` wrote:

```json
"peerDependencies": {
  "@deepseek-ai/dsh-settings": "0.1.1-rc.2"
}
```

As a result it failed to load on dsh `0.1.6-alpha.1` — because the
`installSettingsSection` / `settingsNamespace` it imports **no longer exist** in the new host. And since it is a
bundle layer, a failed import in the host half makes **boot fail**, not merely one broken feature.

Recommended practice: **write a loose range for peer dependencies**, or simply do not declare packages you do not actually use.
This project **does not depend on** `dsh-settings` at all.

**2. Do not use `workspace:^`.**

That is an internal monorepo notation and cannot be resolved in a published package. The community plugin Armory used it,
and could only rely on an `npx` installer rewriting the declaration on the spot at install time — adding fragility for nothing.

**3. Do not use DOM anchors such as `[data-slot]` for mounting.**

That is a gamble that the product's internal DOM never changes. Use **declared slots** (this project uses `settings.section`).

## Making it easier for others to install: an optional one-click installer

If an experience like `npx dsh-custom-mode` is wanted later, write a `cli.cjs` that:

1. locates `$DSH_HOME`;
2. copies `preset/` into `.agent-presets/custom/`;
3. runs `dsh plugin --profile <p> add <package name>`;
4. checks whether the profile's `dsh.profile.bundles` contains that package, and adds it if missing;
5. **provides uninstall** (`npx ... uninstall`), and cleans up the bundles list when uninstalling.

Point 5 matters: changing a user's profile without giving them an uninstall path is very impolite behavior.

## How to declare version compatibility

Stating clearly in the README **which version it was verified on** is far more honest than writing a fake semver range. For this project:

> Developed and verified on dsh `0.1.6-alpha.2`.

Also list **which APIs are used**, so that when dsh is upgraded others can judge for themselves whether it is still compatible:

- `ctx.systemPrompt.section()` / `PromptSection.text` supports functions
- `ctx.tools.register(definition)`
- `ctx.webServer.register({ kind, path, handler })`
- `react` in the client seed module table

## After modifying client.js

Changing `editor/client.js` **needs neither a restart nor a page refresh**: `dsh-client-hmr` stats and polls the
bundle file every ~500ms, and replaces the plugin in place after about 1 second (for the measured evidence, see [`ARCHITECTURE.md`](ARCHITECTURE.md) §10).

Only changes to the **host half** (`index.mjs`, `composition.mjs`, `meta.mjs`, `paths.mjs`) need a restart —
they are rows in the main process and only enter the composition tree during startup assembly.

> This once said "after changing client.js you must restart; refreshing the page is not enough", which is wrong and directly contradicts the measured
> conclusion in ARCHITECTURE §10. §10 is authoritative.

## Decorating the GitHub repository itself

### Discoverability: description, topics, keywords, social preview

The four places someone can find this plugin by *searching* — all of them are cheap, and all of them go stale
silently if nothing checks them:

- **Repository description** (`gh repo edit --description`): one factual English sentence, keyword-bearing.
  It is what GitHub search and the repository list show.
- **Topics** (`gh repo edit --add-topic`): `dsh-plugin` is mandatory (the topic-driven marketplaces index by
  it); add the terms people actually type — `custom-mode`, `custom-prompt`, `prompt-editor`, `agent-modes`,
  `multi-mode`, `assistant-manager`, `system-prompt`, `deepseek-harness`, …
- **npm `keywords`** in `editor/package.json`: npm search reads them, and they do **not** update on a
  metadata-only change — a new version has to be published for them to appear on npm.
- **Social preview image** (1280×640): **the web UI is the only way to set it** — Settings → Social preview.
  The REST API has no endpoint for it, so this is the one step that cannot be scripted and the one that gets
  forgotten. Verify with:

  ```sh
  curl -sL https://github.com/BOWLUNA/dsh-custom-mode | grep -o 'og:image" content="[^"]*'
  # custom → repository-images.githubusercontent.com ; default → opengraph.githubassets.com
  ```

The image is generated, not hand-drawn: render the layout in a browser and capture it at 1280×640, then keep
the PNG in `docs/images/social-preview.png` so the source of truth is in the repository.

Finally, the wording matters: the README's first screen and the npm landing page (`editor/README.md`) should
contain the phrases people search for — including the synonyms ("custom prompt", "system-prompt editor",
多助手／多模式) — because for both GitHub and npm the page text is the index.

Beyond the code, there are a few places on the repository page that others look at first. These can only be set on the web or via the API, so the values are recorded here:

**About → Description**

```
DSH custom mode: the system prompt becomes a hot-editable file, control plugin mounting line by line, modes can be renamed
```

**About → Topics** (lowercase, hyphens, each no more than 50 characters)

```
dsh  deepseek-harness  agent-preset  system-prompt  cordis  plugin  prompt-engineering
```

**About → tick Issues**, and **Pin** this repository to the personal profile (the first public project is worth pinning).
If Wikis / Discussions are of no use, do not enable them — empty entry points only make a project look abandoned.

**Social preview**: use `docs/images/05-assistant-manager.png` (Settings → Social preview upload;
01–04 predate the assistant manager and no longer represent the project).
The default gray-background card looks bad when sharing a link.

**Release**: the tag name matches the plugin version (`v1.0.1`; see README "Versioning").

```sh
git checkout main
git tag -a v0.1.6-alpha.2 -m "dsh-custom-mode 0.1.6-alpha.2"
git push origin main && git push origin v0.1.6-alpha.2
```

**The version and CI move together**: the moment `editor/package.json`'s version changes, the
`@deepseek-ai/dsh@<version>` pinned in `.github/workflows/test.yml` has to move with it, or
`tools/verify-version-consistency.mjs` fails — it exists to stop "CI green on the old runtime while the
published package claims a version it was never tested against".

**The body is for visitors — do not paste the CHANGELOG**: follow the shape of the two published
releases — adapted dsh version → what this release is about → install (all three paths) → features →
correctness points → tests → docs → built with. If the release contains security fixes, the body must
**state the affected versions and the mitigation explicitly** rather than saying "fixed some issues";
copying that paragraph from `SECURITY.md` is enough.

**Do not tick "pre-release"** (matching both published releases): every version here is a preview and the
npm side deliberately points `latest` at the newest one, so GitHub's Latest badge follows it too. To
switch to pre-releases, change the published ones as well — not only the new one.

**The `.dshpreset` attachment** (importable in the desktop client; both releases ship one) is a zip
holding `manifest.json` plus the five files under `preset/`. The manifest fields are exactly:

```json
{
  "format": "dsh-preset",
  "version": 1,
  "id": "custom",
  "name": "自定义模式 / Custom mode",
  "description": "one line, matching the README",
  "sourceDshVersion": "the dsh version this release adapts to",
  "exportedAt": "ISO timestamp"
}
```

Pack and publish (`preset/` is the repository's current content; `sourceDshVersion` is this release's
adapted dsh version):

```sh
python3 - <<'ZIP'
import json, zipfile, datetime, os
FILES = ['agent.cordis.yml', 'preset.yml', 'prompt.md', 'prompt-reader.mjs', 'prompt-tool.mjs']
manifest = {
    'format': 'dsh-preset', 'version': 1, 'id': 'custom',
    'name': '自定义模式 / Custom mode',
    'description': '<one line, matching the README>',
    'sourceDshVersion': '<the dsh version this release adapts to>',
    'exportedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z'),
}
with zipfile.ZipFile('dsh-custom-mode.dshpreset', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
    for name in FILES:
        z.write(os.path.join('preset', name), 'preset/' + name)
ZIP
gh release create v<version> --title "v<version>" --notes-file notes.md dsh-custom-mode.dshpreset
```

Say in the body which host version the attachment was exported from, and warn that the importer may
report a compatibility warning.
