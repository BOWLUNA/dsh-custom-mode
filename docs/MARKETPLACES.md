# Plugin market interfaces

English | [中文](MARKETPLACES.zh.md)

These are DSH profile-plugin markets. They are not VS Code, JetBrains, or MCP catalogs. No catalog submission or external message is part of this release.

| Market | Discovery interface | Install mechanism | Limit |
| --- | --- | --- | --- |
| [dshmarket](https://github.com/dsh-market/dsh-market), npm `dshmarket` | Curated [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) YAML; `https://awesome-dsh-plugin.com/plugins.json` (`name`, `url`, optional `npm`) | npm first, GitHub source fallback; Settings → Plugin Market | The 2026-10-09 11:56 UTC JSON response contains this root npm package at `2.2.2`. Catalog updates remain controlled upstream. |
| [DSH Plugin Hub](https://github.com/dshplugin/dsh-plugin-hub), npm `dsh-plugin` | `https://api.dsh-plugin.org/plugins.en.json`; compact `s/r/vr/wi/ic/igc` or normalized `slug/source/install` | npm, GitHub, or the Hub's validated DSH install command | The same check found the root npm package at `v2.2.2`, reviewed and web-installable. Entries use lowercase repository identity; matching is case-insensitive. |
| [DSH Plugin Store](https://github.com/DshMarketPlace/dsh-plugins-store), npm `dshmarketplace-plugin` | `https://dshmarketplace.dev/api/v1/plugins`; `results`, `fullName`, `npmPackage`, `installCheck` | DSH profile plugin manager, also exposed by Store search/install tools | The UI filters to `installCheck: passed`. Our root entry and obsolete `#editor` entry both returned `null`; live UI discovery is pending their review. |

The first two repositories were active on 2026-10-08/09; Store was active on 2026-10-05 and is smaller. These are candidates selected from verified DSH ecosystem projects, not a claim that every third-party market has been integrated.

Our root `package.json` is the actual install manifest: public npm identity `dsh-custom-mode`, MIT license, repository URL, `dsh.bundle.patch`, `exports["./client"]`, `dsh.client.platform: web`, and identical peer/engine DSH ranges. The package needs no build-time or install-time script. Existing `screenshots.json` remains the repository-side screenshot interface. Do not add invented market-specific manifest fields.

`tools/market-check.mjs` normalizes each documented schema and reports discovery separately from installability. It accepts only this exact root repository and npm identity when generating install arguments, rejects the removed `editor` subpath, and never executes downloaded commands. `--self-test` checks all three schemas and unsafe/stale inputs; `--fixture-dir` allows an offline replay of captured public catalog JSON. An unavailable endpoint is never recorded as an empty catalog or a passed discovery test.

The core install/load checks use the exact packed npm artifact on both current DSH channels. They exercise API access, all base modes, prompt persistence, removal, reinstallation, and rendered UI, including the native UI revision (see [current checks](CURRENT_COMPATIBILITY.md)). Pin the package version to avoid pnpm's release-age cache selecting an older build.

## Candidate installation through real market UI (2026-10-09)

The unpublished `2.2.3` candidate at commit `a326c38972fa4cdc85ab550751a4ea38d8bd416e` was installed through each available market UI path in separate throwaway Web profiles. The public catalogs still resolve the published `2.2.2`; a catalog install button cannot certify an unpublished candidate.

| Market package | Host | Real UI path and result |
| --- | --- | --- |
| `dshmarket@1.66.14` | `0.2.0-rc.2` | Advanced → Backup & Restore → Import and preview → Start restore, using a local profile backup containing only package metadata and the pinned GitHub dependency. Installed `2.2.3`; settings and API loaded. Disable removed routes; re-enable restored them. Uninstall removed dependency and bundle. |
| `dsh-plugin@1.6.2` | `0.2.1-alpha.2` | Custom → DSH command accepted the pinned `git+https` source below. Installed `2.2.3`, mounted automatically, loaded settings/API, then uninstalled cleanly. The GitHub-address input rejects `#ref`; the DSH-command input preserves it. There is no separate enable switch in this Hub UI. |
| `dshmarketplace-plugin@0.2.0` | `0.2.0-rc.2` | Plugin store search for `dsh-custom-mode` returned no match and explicitly displayed its install-tested-only policy. No custom URL/file/branch input was available. Candidate installation, enablement and uninstall remain blocked by the upstream listing filter; no catalog data was changed. |

```sh
dsh plugin --profile web add git+https://github.com/BOWLUNA/dsh-custom-mode.git#a326c38972fa4cdc85ab550751a4ea38d8bd416e
```

Both successful installs matched all 32 files in the candidate packlist and contained one bundle entry. After uninstall, both routes returned 404, dependency and bundle entries were absent, and the ordinary sample prompt file remained with its original hash. Tests used real browser clicks and no model calls, marketplace submission, or new credentials. The temporary hosts were stopped after verification. These results certify the stated UI paths; they do not claim Store approval or cross-ecosystem marketplace support.
