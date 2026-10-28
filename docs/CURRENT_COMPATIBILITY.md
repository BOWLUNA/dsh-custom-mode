# Current compatibility checks

English | [中文](CURRENT_COMPATIBILITY.zh.md)

## 2.3.0 final candidate verification

Version `2.3.0` remains unreleased. The local/native results below bind to the original 32-file candidate package, SHA256 `c7e05adac7e00a43dfad333cb6ce7bde1a786c8f72170df64365a3073a8862a7`, with client SHA256 `e922be58056f5b7a75fb7048b9d0756b16e7b87982779468011b103040d1bffb`. Code/component, documentation and package evidence were independently reviewed. The existing compatibility/test and browser/lifecycle workflows must pass on the final release commit; use the exact-head results in [PR 21](https://github.com/BOWLUNA/dsh-custom-mode/pull/21), rather than an earlier green checkpoint. The final commit/CI receipts are tracked with the PR and handoff, without embedding a self-referencing commit hash here.

On isolated Windows/Node `24.21.0`, exact DSH `0.2.1-rc.2` passed **19 suites / 1187 checks**, using a new source snapshot and privately copied task dependencies. The final guards checked the count, translation pairing, version consistency and browser literals. A later README-only wording correction was paired and repacked; the runtime/tests were unchanged. All 32 package inputs were compared with the frozen source, and later non-package documentation changes preserve those bytes. This does not turn the earlier three-host or browser results into a new full matrix for this candidate.

Three isolated DSH Web `0.2.2-alpha.2` runs used the official Plugins confirmation and a controlled loopback registry, with separate homes/stores and synthetic assistant data. Alpha requires Node `>=24.9`.

| Run and starting package | Completed evidence | Boundary |
| --- | --- | --- |
| A: actual published `2.2.6` → final candidate | Official update reported the new version running; the complete test-assistant directory retained all five user-content files and two managed-code files with identical hashes. Old registrations caused a typed Chinese/English restart suggestion, with no ineffective Fix button; the warning region fit at 480 pixels. One host restart then restored registration and saving for both assistants (2/2), without Duplicate errors. | Published 2.2.6 cannot acquire cleanup retroactively; this first migration requires that restart. The narrow-window check covered the warning region, not a full responsive matrix. |
| B: fixed-code lower-version fixture → final candidate | Three target-tar HTTP503 responses produced official restoration of the old fixture. All seven directory entries retained their hashes; an edit saved successfully without restarting. After restoring healthy downloads, the official update succeeded in the same host PID/start time, then editing/saving remained healthy. Recovery, save, update and later save registered 2/2 with no Duplicate or cleanup errors. Each transition had its own unchanged seven-file baseline; intentional edits were recorded separately. | The lower package is candidate code with a changed version and a nonvisual old-CSS marker, not the public 2.2.6 implementation. |
| C: HMR disabled, fixed-code lower-version fixture → final candidate | The dumped configuration explicitly disabled HMR. Official UI reported startup-only application and a restart requirement; disk was 2.3.0 while the page still ran 2.2.6. After a real host restart, runtime was 2.3.0, all seven directory entries retained their hashes, and selection/saving registered 2/2 without Duplicate errors. | The raw manager result fields were not captured; this claim follows the UI, disk/runtime split, configuration and restart evidence. It does not establish this behavior on other host versions. |

The final style had one 8120-character tag, SHA256 `2ae646455b806c9c79f09f941281b95dd85f56cec97ad8fe108e1099d2122ee7`, and the synthetic old marker disappeared in B. The tool could not obtain an independent frontend Document identity, so **strict same-Document replacement is unverified**. The same host PID/start time, official running-version result and working registration/save path establish the tested host HMR behavior; same tab or correct CSS alone does not prove Document identity. Task tabs and process identities were closed/read back. Forced Windows process exits are not reported as graceful shutdowns.

The older checked `0.2.1-rc.2`/`rc.4` hosts lack alpha's native version-query/update APIs and retain official-details/guide fallbacks. Earlier picker/74-check and light/dark/narrow-window results bind to their recorded earlier clients, not this final client. Existing CI keeps the exact current-host matrix and older `0.1.7-rc.2`/`0.2.0-rc.2` regression legs; the final exact-head results remain the release gate. Capability and separate query/update permissions are checked from actual services; file/link/tarball sources remain unchanged. No standalone updater or new credential access is introduced.

No real model request, GPU execution, Electron desktop acceptance or production deployment was performed in these runs. Hover and complete whole-page adaptation remain outside the new browser scope. Local tests, native update behavior, final remote CI and publication are separate outcomes. The 2.2.6 section below is preserved as historical evidence.

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
