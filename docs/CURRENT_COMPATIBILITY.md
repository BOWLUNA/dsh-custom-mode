# Current compatibility checks

English | [中文](CURRENT_COMPATIBILITY.zh.md)

The `2.2.5` release adds exact official DSH `0.2.1-rc.2` coverage on 2026-10-17 while retaining the two previous host gates. All three host versions below are prereleases; no final stable DSH release is claimed.

| Exact official npm host | Package and unit checks | Rendered browser checks | Runtime checks |
| --- | --- | --- | --- |
| `0.2.0-rc.2` | 15 suites, 935 checks; package and boot | 74 checks; mode picker | 22 lifecycle checks; no nonexistent marketplace row |
| `0.2.1-alpha.5` | 15 suites, 935 checks; package and boot | 74 checks; mode picker | 22 lifecycle checks; native marketplace row on/save/off/save |
| `0.2.1-rc.2` | 15 suites, 935 checks; package and boot | 74 checks; mode picker | 22 lifecycle checks; native marketplace row on/save/off/save |

Coverage is isolated Linux x64 Web profiles with Node 24 and Chromium, using the exact official host installations and fresh test homes. Runtime checks cover authenticated routes, all five base modes, repeated saves and installation, restart, uninstall, reinstall, user-data preservation, and actual deletion of a synthetic assistant. The marketplace row is inherited from the host; its shipped default remains off. No model was called and no real GPU execution was attempted.

Windows/Electron desktop, real model/tool execution, and real GPU behavior remain unverified. The legacy `0.1.7-rc.2` unit/boot CI leg is retained; the new native-browser results above do not claim fresh coverage of that legacy line. Marketplace listing approval remains external to this release; the 2026-10-09 listing results in [MARKETPLACES.md](MARKETPLACES.md) are historical.

The official `dsh-v0.2.1-rc.2` tag is `687f282e8625c6b8d11ff58211a90524be2e4317`. Compared with alpha.5, the preset registry, authenticated Connection API, native settings UI and all four preset declarations are unchanged. New DeepSeek Search/Fetch providers and model labels belong to the host; this package does not call those services. The existing peer/engine range already admits rc.2, so no user-data migration or runtime shim is needed. CI pins all three channels; the marketplace probe distinguishes `0.2.0-rc.2` (no row) from `0.2.1-rc.2` (inherited row).

The two earlier hosts reuse the verified v2.2.4 native acceptance evidence; this task reruns local native acceptance only for `0.2.1-rc.2`. The required release CI still runs all three exact hosts.

## Release gates and reproduction

The existing release workflow requires the reusable compatibility and browser workflows before publishing. It also requires an exact tag/package version match and the existing npm publisher configuration. A local successful test does not establish that remote CI, registry publication, or a GitHub Release has completed. A missing npm approval or credential must be resolved through the normal publisher flow.

Use an exact official host and a fresh evidence directory outside the source tree:

```sh
node tools/compat-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --port 32110
node tools/runtime-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --browser /path/to/chrome --port 32110 --cdp-port 9229 --network-guard ./tools/loopback-test-guard.mjs
```

The tools use separate homes and synthetic prompts. Do not run them against an active user profile or copy credentials, prompts, or history into evidence. The optional loopback guard blocks external connections in the host process; dependency installation uses the normal official registry beforehand. Keep one browser page and enforce a memory budget appropriate to the machine.

Release assets contain the allowlisted plugin package, a preset-only import archive, and `SHA256SUMS`. They contain no host installation, user state, or acceptance environment. Verify the downloaded hashes before installation. The `.dshpreset` asset is not a substitute for installing the settings-page plugin.
