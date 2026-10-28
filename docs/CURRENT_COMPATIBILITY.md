# Current compatibility checks

English | [中文](CURRENT_COMPATIBILITY.zh.md)

## 2.3.0 verification in progress

Version `2.3.0` adds a manual update entry and repository guidance. Code checkpoint `e29ac10175473251bc4027ccb868c29a8e07c3da` in [PR 21](https://github.com/BOWLUNA/dsh-custom-mode/pull/21) passed all 13 exact-head checks: [10 compatibility/test jobs](https://github.com/BOWLUNA/dsh-custom-mode/actions/runs/40622150008) and [three browser/lifecycle jobs](https://github.com/BOWLUNA/dsh-custom-mode/actions/runs/40622150083). Local Windows/Node `24.21.0` checks on the three current hosts also passed 19 suites / 1164 checks, guards, marketplace adapter self-test, a 32-file package and isolated install/boot; the final link-style increment passed its targeted component, dictionary, document and package checks. Required workflows must also pass on the final release commit. The 2.2.6 results below remain historical evidence for that version.

| Exact host | Completed 2.3.0 evidence | Remaining boundaries |
| --- | --- | --- |
| `0.2.2-alpha.2` | Exact-head CI passed; real native-query/error/filter/orphan-draft cases on the earlier fixture, and final-client update-section rendering and keyboard checks below | Official confirm-and-install, self-update HMR, failed-install recovery and no-HMR restart flow unexecuted; Node >=24.9 |
| `0.2.1-rc.2`, `0.2.1-rc.4` | Exact-head CI passed; picker and 74 browser checks on the earlier client; final-client capability fallback, real plugin-details navigation and light/dark link checks passed | Native query/update APIs are absent; no Electron acceptance |
| `0.1.7-rc.2`, `0.2.0-rc.2` | Exact-head Linux Node20/24 unit regressions and Node24 prompt-contract, boot and mount gates passed | Older-host rendered navigation not rechecked; no new desktop claim |

The final browser client was `f4fa7a0d1d67f90985fd7c6463a0ef5fab732b42a0310fcd633d8ee0be893491`. All three current Web hosts served it in fresh Documents with one 8120-byte style tag, SHA256 `2ae646455b806c9c79f09f941281b95dd85f56cec97ad8fe108e1099d2122ee7`. On alpha, Chinese/English × real light/dark × 1440/720/480 pixels passed update-section bounds and document-overflow checks. The guide used the official 500 14px/22px font and light/dark link colors; one Chinese/dark keyboard path confirmed focus and blocked guide navigation with unsubmitted input. On rc.2/rc.4, the native check was disabled, actual plugin-details navigation worked, and both link themes matched. This scope covers the update section and these navigation paths.

Earlier alpha non-installation cases covered manual version queries, metadata HTTP503, excluding incompatible versions from update actions, and two-tab orphan-draft viewing, copying, cancellation and confirmed discard. They used the v3 base client `76b2e3c2…`; its lower-version fixture added a nonvisual CSS marker (installed client `9d779e6e…`). The final product increment changes only the guide link's style. Earlier rc.2/rc.4 picker/74-check results also bind to `76b2e3c2…`. The controlled registry packages used candidate code with synthetic version numbers, including a package labelled `2.2.6`; this does not establish migration from the published 2.2.6 implementation.

Final installation through the official Plugins confirmation, self-update HMR and same-Document style replacement, target-tar HTTP503 recovery, the no-HMR restart flow, and Electron remain unexecuted. Fresh-Document rendering and component style replacement have separate evidence. Hover, complete whole-page adaptation, commercial models and GPU execution are outside this scope.

The page detects actual services rather than inferring capability from a version string. In `0.2.2-alpha.2`, viewing versions and updating have separate host permissions. The checked `0.1.7-rc.2`/`0.2.0-rc.2` do not ship that remote-access service; `0.2.1-rc.2`/`rc.4` include an older `source(kind, id, action)` interface, without alpha's `whenAccess` or the new version-query/update APIs. Older-host navigation leaves management to the official page. File/link/tarball installs keep their original source. This feature adds no standalone updater, new HTTP update route or credential access. Electron, commercial-model and GPU acceptance remain separate.

## 2.2.6 verification scope

Results are tied to exact installations and generated source snapshots. The 2.2.6 integrated Windows/Node `24.21.0` check on DSH `0.2.1-rc.2` passed **18 suites / 1139 checks**. The installer includes partial-write, exclusive-publication, concurrent-file, failed-rollback and recovery-before-fill cases; an independent reviewer reproduced the publication failure boundaries. These are local/component checks, not a complete desktop conversation.

The final production UI code was also checked against an isolated Windows `0.2.1-rc.2` host using Linux Chrome: the picker and 74 browser checks passed. Chinese/English with real light/dark themes passed at 1440, 720 and 480 pixels, including long assistant/history labels and visible native menus. A separate interaction probe injected a delayed POST, a failed follow-up GET and an application-failure response; refresh did not repeat the save, and activation retry sent a real sync request. Those injected responses are not spontaneous production failures. The host's toolbar button and its dedicated Language selector have different backgrounds; the plugin preserves the native atoms rather than asserting they look identical.

On 2026-10-27 the public npm host tags were `latest=0.2.1-rc.2`, `next=0.2.1-rc.4`, and `alpha=0.2.2-alpha.2`. These exact hosts completed integrated unit, packed-install and boot checks; both rc.4 and alpha.2 also passed the real marketplace row's 10 checks, including on/save/off/save with a healthy preset. Alpha requires Node `>=24.9`.

At checkpoint `b064fc1a136a22d0975c46589c3a9e1eb3934f74`, the three current hosts completed the 74 rendered-browser checks and 22 runtime lifecycle checks (installation, repeated saves, restart, uninstall/reinstall and user-data preservation). These are step-level results from [the recorded CI run](https://github.com/BOWLUNA/dsh-custom-mode/actions/runs/40605525597), which also exposed separate trace-reader and probe-allowlist failures. A release must pass both complete reusable workflows at its final commit; an earlier step's success is not a green release gate.

| Exact host | Completed 2.2.6 evidence | Acceptance boundary |
| --- | --- | --- |
| `0.1.7-rc.2` | Real prompt-registry component contract | Unit/boot regressions retained in CI; no fresh native-browser claim |
| `0.2.0-rc.2` | Real prompt-registry component contract | Unit/boot regressions retained in CI; no fresh native-browser claim |
| `0.2.1-rc.2` | Real prompt/working-directory component contract; integrated 18/1139 on Windows Node24; packed install/boot, lifecycle and detailed browser checks above | The synthetic first-session scope below; no Electron/commercial-model/GPU acceptance |
| `0.2.1-rc.4` | Real prompt/working-directory component contract; integrated unit/pack/boot, browser74/lifecycle22 and marketplace10 | Detailed 4-context/narrow-window and first-session checks were on rc.2 |
| `0.2.2-alpha.2` | Real prompt/working-directory component contract; integrated unit/pack/boot, browser74/lifecycle22 and marketplace10; executor-row metadata independently checked | Node >=24.9; detailed first-session checks were on rc.2 |

The real component gate uses Cordis/SystemPrompt and the official WorkingDirectoryService constructor, lifecycle and ensure behavior where available. Only session/filesystem projections are synthetic. It checks old default text, custom suffixes, directory changes/repair and brace-containing paths without rewriting user files:

```sh
node tools/prompt-contract-check.mjs --host-install /path/to/exact-host
```

That component command does not start an agent loop or model service. A separate real `0.2.1-rc.2` Web session completed create assistant → save prompt → select in a new session → send the first message and displayed `CUSTOM_MODE_READY`. Its loopback synthetic SSE provider verified the custom prompt marker and expanded cwd/model. The session used the repaired UI before the final layout-only changes (`client.js` SHA256 `6f7d01b6…`); its prompt/backend runtime core matches the final UI's core. The final layout (`ccacb21f…`) has the separate browser checks above, not a second full first-session run. The response is synthetic, not a commercial model result; a second request rejected by the fixture's marker rules is not counted as another successful first session. The test host was manually terminated, not recorded as a graceful exit 0.

Electron desktop, commercial models and GPU execution remain outside this evidence. Current-channel CI uses Node24; older host regressions retain Node20 unit legs and Node24 runtime gates. Release gates must bind to the final commit; publication and asset read-back are recorded separately from these measured scopes.

## Historical 2.2.5 release record

The following 2026-10-17 statements describe the earlier release. They are preserved as historical evidence, not fresh acceptance of 2.2.6. The later review reproduced a cwd prompt-assembly failure on the real `0.2.1-rc.2` prompt components despite the earlier page/lifecycle green checks, consistent with [issue 19](https://github.com/BOWLUNA/dsh-custom-mode/issues/19) and the [exact upstream contract](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/system-prompt/README.md#L78). Component/unit success must not be promoted to a real-model or desktop result. The original record is available at the [reviewed source commit](https://github.com/BOWLUNA/dsh-custom-mode/blob/91720a3264825ed5a4d8ca389181c1dfd5797b1e/docs/CURRENT_COMPATIBILITY.md).

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

The tools use separate homes and synthetic prompts. Do not run them against an active user profile or copy credentials, prompts, or history into evidence. The optional Node loopback guard intercepts covered net/fetch paths in the test process; it is not system-level network isolation and does not constrain external programs. Dependency installation uses the official registry beforehand. Keep one browser page and enforce a memory budget appropriate to the machine.

Release assets contain the allowlisted plugin package, a preset-only import archive, and `SHA256SUMS`. They contain no host installation, user state, or acceptance environment. Verify the downloaded hashes before installation. The `.dshpreset` asset is not a substitute for installing the settings-page plugin.
