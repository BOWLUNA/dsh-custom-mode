# Current compatibility checks

English | [中文](CURRENT_COMPATIBILITY.zh.md)

<a id="231-validation"></a>

## 2.3.1 release and verification

Version `2.3.1` is available from [GitHub Release](https://github.com/BOWLUNA/dsh-custom-mode/releases/tag/v2.3.1) and [npm](https://www.npmjs.com/package/dsh-custom-mode/v/2.3.1). The GitHub Release was published on 2026-11-04 at 20:47:01 UTC. Tag `v2.3.1` and npm exact/latest `gitHead` resolve to `78a72481dbb7a9af344ae455f6933d8d395cbcdb`. [PR 23](https://github.com/BOWLUNA/dsh-custom-mode/pull/23) passed all 15 required checks on `6abaad98743026cd5f40d77c7c038c549256e4b6` ([test: 10/10](https://github.com/BOWLUNA/dsh-custom-mode/actions/runs/41905432683), [browser/native: 5/5](https://github.com/BOWLUNA/dsh-custom-mode/actions/runs/41905432847)); the merge/tag tree is identical. The [release workflow](https://github.com/BOWLUNA/dsh-custom-mode/actions/runs/41906432486) then passed all 16 jobs: 10 compatibility, 5 browser/native and publication.

Public read-back passed 31/0 (`PUBLIC-DISTRIBUTION-02.json`): npm exact/latest are `2.3.1`, gitHead/SRI/SHA1 agree, and npm/GitHub plugin archives are byte-identical. Independent inspection of actual downloaded assets passed 111/0: all 32 npm inputs match the final tag, and all six preset ZIP entries match the final-tag manifest and five source files.

| Public asset | Bytes | SHA256 |
| --- | --- | --- |
| npm / GitHub `dsh-custom-mode-2.3.1.tgz` | 184539 | `b5945b4462fca82e8da97856a357afc666c20eccc3bcc1b87c914f021b2a3a24` |
| GitHub `dsh-custom-mode.dshpreset` | 16672 | `dc982f92fc2bbb102e269539353714cca5d8d5b166ebd6cceab557a395bde294` |
| GitHub `SHA256SUMS` | 184 | `f1b56bc025f82a49354373610352763339261b017b22aa7319f7d4cf1f25bbc7` |

The public preset ZIP is not byte-identical to the 16881-byte Windows-built ZIP: all six decompressed payloads, manifest and timestamp are identical, while DEFLATE lengths account for the entire 209-byte difference, with platform `create_system` and derived offsets differing. Use the actual public hashes above. The first expected-archive mismatch remains recorded in `PUBLIC-DISTRIBUTION-01.json`; source/content diagnosis and the unchanged public verifier's successful second read-back are retained separately. The published checksum file is the actual 184-byte LF asset, not the earlier Windows CRLF expectation.

Runtime files are unchanged from validated source `d93bb765a5f422743d881655a997937af708f740`; the local evidence below remains bound to its `2.3.0` metadata/archive. New `2.3.1` packaging and remote release checks are the separately verified results above. The historical `2.3.0` publication record is preserved below.

On 2026-11-04 the public host channels were `latest=0.2.1-rc.5`, `next=0.2.2-rc.1` and `alpha=0.2.2-alpha.3`. The source CI matrices target these exact hosts, retaining older `0.1.7-rc.2` and `0.2.0-rc.2` regressions. Edited workflow configuration is not a completed remote CI result.

### Validated runtime snapshot d93bb76

| Local check | Completed result | Boundary |
| --- | --- | --- |
| Registered suite, Windows / Node `24.21.0` | 20 suites / 1315 checks / zero failures | Validated `d93bb76` / metadata `2.3.0`; fixtures do not replace browser acceptance |
| Real prompt-registry / working-directory component contract | Passed on the three current exact hosts | Synthetic session/filesystem projections; no full agent loop, model or GPU |
| Native disabled-expression contract | 70/0 on each current host and on `0.1.7-rc.2`, `0.2.0-rc.2` | Actual host YAML/Loader/registration/activation/inventory comparison; not a rendered-page check |
| Packed installation / unit / documentation / boot gate | 8/8 on each current exact host, including 20 suites / 1315 checks | Fresh isolated `verified-rc1-01`, `verified-latest-01`, `verified-alpha-01` runs |
| Native manager API on the validated baseline package | 24/0 on each of `0.2.2-rc.1`, `0.2.2-alpha.3` | Strict observer-driven official API checks; Plugins UI and same-document frontend HMR remain separate |
| Rendered settings / picker / marketplace | 74/0 browser checks on each current host; picker and native marketplace operations passed | Packed plugin in isolated Chrome; no Electron or model claim |
| Draft and creation browser flow | 49/0 on each current host, with 8 screenshots per host | DOM composition/keyCode-229 events and trusted ordinary Enter; not an OS IME test |
| Full lifecycle and observer cleanup | 28/0 on each current host, browser mode `full` | API, five base modes, restart, removal/reinstall, data preservation and deletion; all task runs exited successfully |

The validated baseline package (metadata `2.3.0`) SHA256 is `28046e7728613d7ed7654cab6b08d5590a31516c50252b96f050cd0ec3967fa9`. The three compatibility archives and both inputs to `verified-native-rc1-01` / `verified-native-alpha-01` are byte-identical; all 32 packaged files matched the `d93bb76` source snapshot (`package-source-comparison.json`). All three baseline runtime reports, three draft reports and both baseline native reports bind to that `2.3.0` package identity. The released `2.3.1` archive has different version/README bytes and was separately compared with its final tag as recorded above.

Late visual QA identified YAML-quoted context predicates that could warn and incorrectly disable the default plugin-manager tool. The fixed source decodes YAML quoting, preserves known conditions for the native loader, truly disables unsupported context conditions and scopes the editor's immutable boolean capability snapshot per request. Compiler diffs compare decoded sources without manufacturing an override for different YAML quoting. The five exact-host 70/0 contract logs are `final-disabled-contract-rc1.log` and `final-disabled-contract-<other-exact-host>.log`; the final unit log is `predicate-integration-unit.log`.

Persistence cases include failed history writes, stale metadata/mode/switch saves, exact post-save generations and checked repair/reorder with held drafts. The real Bash uninstall script is exercised with a synthetic CLI and temporary files (30/0); the POSIX newline-filename execution probe is skipped locally on Windows and retained for Linux CI. Reproduction commands and boundaries are in [MEASUREMENTS.md §38](MEASUREMENTS.md#38-unreleased-review-fixes-2026-11-04). Evidence is retained outside the package under `DSH-FIX-20261104-01`.

The baseline rendered runs use the same `verified-rc1-01`, `verified-latest-01` and `verified-alpha-01` directories. Each `runtime-report.json` contains 28 passing checks with no browser skip, and each `drafts-report.json` contains 49 passing checks and eight captures covering Chinese/English, real light/dark host themes, and 1440/480-pixel widths. The flow exercises creation focus/Enter, dirty draft replacement both ways, explicit saved-copy behavior retaining the original draft, settings navigation/remount, real refresh/close beforeunload cancellation and a clean refresh after discard. Composition-event coverage is synthetic DOM input, not an operating-system IME.

Root visual QA inspected all eight RC1 captures and two captures from each other host. The predicate warning is gone. An authenticated independent observer confirmed native inventory and the UI agree: on RC1/alpha, `profileContext=true` makes the shipped manager condition enabled; latest retains its literal `disabled:true` factory state (`enabled=false`). At 480 pixels the older latest host retains its native sidebar and approximately 432-pixel dialog, while newer RC1 uses a wider native layout; inspected controls had no overflow or occlusion.

Baseline native API runs `verified-native-rc1-01` and `verified-native-alpha-01` each completed 24/0 with successful script exits. The actual public `2.2.6` migration reported `applied` and preserved the observed user files; a real host restart then ran the candidate and saving passed. In the controlled fixed-old `2.2.7` fixture, the observed target-tar 503 produced `failed`/`restore: applied`, with installed and running old versions, unchanged user-file hashes and successful saving without restart; a healthy update then applied and saved under host HMR. The no-HMR fixture reported `restart-required`, verified new disk/old runtime, and passed version/data/save checks after an actual process restart. This lowered-version fixture is not public `2.2.6`; Windows termination is not claimed to be graceful.

The non-author audited the bounded final native reports and revised source, without independently replaying the hosts. These are observer API tests, not Plugins UI clicks or strict same-document frontend HMR proof. Electron, real models/GPU and local execution of the POSIX newline-filename probe remain outside these local runs; release CI is recorded separately above.

### Earlier diagnostic checkpoint

The earlier `7fc9a88de71726e73969af8b9c7db999c83b066fac9ca58ea06dcaf54d8251b2` package passed 20/1265, three 8/8 compatibility runs and the two 24/0 API runs `native-rc1-03` / `native-alpha-01`; those results preceded discovery of the predicate defect and are not final acceptance of the changed source. Its package comparison is retained as `package-source-comparison.pre-predicate.json`. The bounded API results and 94/0 adversarial probes remain diagnostic evidence in §38. Independent review closed permissive outcome-predicate and unobserved-503 gaps before those API runs, but did not independently replay their hosts.

Publication and required remote CI are complete as recorded above. Plugins UI update acceptance, strict same-document frontend HMR, OS IME, Electron and real-model/GPU results remain outside completed scope; the POSIX filename probe was not executed locally on Windows.

## 2.3.0 release and verification

Version `2.3.0` was published on 2026-10-28: [GitHub Release](https://github.com/BOWLUNA/dsh-custom-mode/releases/tag/v2.3.0) and [npm](https://www.npmjs.com/package/dsh-custom-mode/v/2.3.0). Release tag `v2.3.0` and npm `gitHead` both resolve to `2f76c206e156a9950f00f4cefc50ad85d22bdfd6`. The [release workflow](https://github.com/BOWLUNA/dsh-custom-mode/actions/runs/40681712038) completed all 10 compatibility/test jobs, all 3 browser/lifecycle jobs and publication successfully at that source commit. The npm read-back reported both version and `latest` as `2.3.0`.

The local/native results below bind to the original 32-file candidate package, SHA256 `c7e05adac7e00a43dfad333cb6ce7bde1a786c8f72170df64365a3073a8862a7`, with client SHA256 `e922be58056f5b7a75fb7048b9d0756b16e7b87982779468011b103040d1bffb`. Code/component, documentation and package evidence were independently reviewed; [PR 21](https://github.com/BOWLUNA/dsh-custom-mode/pull/21) retains the pre-merge exact-head CI record. Downloaded npm and GitHub plugin archives were byte-identical to that original package, and all 32 packaged files matched the released Git blobs. Downloaded `SHA256SUMS` matched both payload assets. These distribution checks preserve the local/native acceptance boundaries below.

| Downloaded asset | Bytes | SHA256 |
| --- | --- | --- |
| npm / GitHub `dsh-custom-mode-2.3.0.tgz` | 179035 | `c7e05adac7e00a43dfad333cb6ce7bde1a786c8f72170df64365a3073a8862a7` |
| GitHub `dsh-custom-mode.dshpreset` | 16672 | `6852641b26246bfa918f35139394d4f0a5a002c3b83fbb523c04392c273cdbd2` |
| GitHub `SHA256SUMS` | 184 | `388c14c0e854010e4c71ec61282417256f1fcdd15249a3986367efe7c4638913` |

On isolated Windows/Node `24.21.0`, exact DSH `0.2.1-rc.2` passed **19 suites / 1187 checks**, using a new source snapshot and privately copied task dependencies. The final guards checked the count, translation pairing, version consistency and browser literals. A later README-only wording correction was paired and repacked; the runtime/tests were unchanged. All 32 package inputs were compared with the frozen source, and later non-package documentation changes preserve those bytes. This does not turn the earlier three-host or browser results into a new full matrix for this candidate.

Three isolated DSH Web `0.2.2-alpha.2` runs used the official Plugins confirmation and a controlled loopback registry, with separate homes/stores and synthetic assistant data. Alpha requires Node `>=24.9`.

| Run and starting package | Completed evidence | Boundary |
| --- | --- | --- |
| A: actual published `2.2.6` → final candidate | Official update reported the new version running; the complete test-assistant directory retained all five user-content files and two managed-code files with identical hashes. Old registrations caused a typed Chinese/English restart suggestion, with no ineffective Fix button; the warning region fit at 480 pixels. One host restart then restored registration and saving for both assistants (2/2), without Duplicate errors. | Published 2.2.6 cannot acquire cleanup retroactively; this first migration requires that restart. The narrow-window check covered the warning region, not a full responsive matrix. |
| B: fixed-code lower-version fixture → final candidate | Three target-tar HTTP503 responses produced official restoration of the old fixture. All seven directory entries retained their hashes; an edit saved successfully without restarting. After restoring healthy downloads, the official update succeeded in the same host PID/start time, then editing/saving remained healthy. Recovery, save, update and later save registered 2/2 with no Duplicate or cleanup errors. Each transition had its own unchanged seven-file baseline; intentional edits were recorded separately. | The lower package is candidate code with a changed version and a nonvisual old-CSS marker, not the public 2.2.6 implementation. |
| C: HMR disabled, fixed-code lower-version fixture → final candidate | The dumped configuration explicitly disabled HMR. Official UI reported startup-only application and a restart requirement; disk was 2.3.0 while the page still ran 2.2.6. After a real host restart, runtime was 2.3.0, all seven directory entries retained their hashes, and selection/saving registered 2/2 without Duplicate errors. | The raw manager result fields were not captured; this claim follows the UI, disk/runtime split, configuration and restart evidence. It does not establish this behavior on other host versions. |

The final style had one 8120-character tag, SHA256 `2ae646455b806c9c79f09f941281b95dd85f56cec97ad8fe108e1099d2122ee7`, and the synthetic old marker disappeared in B. The tool could not obtain an independent frontend Document identity, so **strict same-Document replacement is unverified**. The same host PID/start time, official running-version result and working registration/save path establish the tested host HMR behavior; same tab or correct CSS alone does not prove Document identity. Task tabs and process identities were closed/read back. Forced Windows process exits are not reported as graceful shutdowns.

The older checked `0.2.1-rc.2`/`rc.4` hosts lack alpha's native version-query/update APIs and retain official-details/guide fallbacks. Earlier picker/74-check and light/dark/narrow-window results bind to their recorded earlier clients, not this final client. Existing CI keeps the exact current-host matrix and older `0.1.7-rc.2`/`0.2.0-rc.2` regression legs; the release workflow above passed that matrix for the released source. Capability and separate query/update permissions are checked from actual services; file/link/tarball sources remain unchanged. No standalone updater or new credential access is introduced.

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
