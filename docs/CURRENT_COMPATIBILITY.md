# Current compatibility checks

English | [中文](CURRENT_COMPATIBILITY.zh.md)

On 2026-10-09, the `2.2.3` candidate was tested using the exact official npm hosts below. The default channel remains a release candidate; no final stable DSH version is claimed.

| Host | Package and unit checks | Rendered browser checks | Runtime checks |
| --- | --- | --- | --- |
| `0.2.0-rc.2` (`latest` / `next`) | 15 suites, 934 checks; package and boot pass | 74 pass; mode picker passes | 20 pass |
| `0.2.1-alpha.2` (`alpha`) | 15 suites, 934 checks; package and boot pass | 74 pass; mode picker passes | 20 pass |

These are real Windows Web-profile installations in isolated test homes, reusing previously installed hosts. The revised UI uses native Input and Button atoms, native Menu surfaces, and the native InlineEditor surface/font for document textareas. The browser check compares control appearance with native defaults. Both screenshots were inspected. Runtime checks cover authenticated routes, all five base modes, saves, repeated installation, removal, reinstallation, data preservation, and actual assistant deletion. Test text is ordinary fixture data; no model was called.

Real market UI source installs now pass for dshmarket and DSH Plugin Hub; Store is blocked by its upstream listing filter (see [market UI results](MARKETPLACES.md)). VMware/Electron desktop, named Linux servers, and history-loading performance remain separate, unverified coverage. The package explicitly targets the Web profile. Desktop/VM coverage is not a gate in its current npm release workflow.

## Release readiness

Web package technical checks pass on both exact host channels. The release workflow requires both reusable compatibility and browser jobs before publication, an exact tag/package version match, and an existing npm publisher. The npm publish pipeline now enables `pipefail` so `tee` cannot mask an E403/OTP failure; mocked E403, OTP, success and already-published conflict outcomes were verified without registry writes.

The last successful `2.2.2` release used the existing `NPM_TOKEN` secret and returned publisher `bowluna`; that historical success does not prove the credential's current validity or write scope. A manual `workflow_dispatch` on the candidate branch reruns the release gates and checks an existing token's identity without publishing. An absent token instead selects the workflow's OIDC route; that needs an already-configured npm trusted publisher and cannot be proved by a no-op authentication step.

Keep PR #13 as a draft and npm `latest` at `2.2.2` until release review. The shortest release path is the existing authentication check, accepted merge/tag at the verified final commit, then the tag-triggered workflow. After publication, verify the registry artifact and `latest`, plus a clean-cache exact-version install. Any required npm OTP or approval is a human gate; do not create new credentials or persistent permissions.

Reproduce using an existing exact host and a new evidence directory outside the source tree:

```sh
node tools/compat-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --port 32110
node tools/runtime-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --browser /path/to/chrome --port 32110 --cdp-port 9229
```

The tools use separate test homes, ordinary fixtures, and sanitized logs. Do not run them against a user's active profile or copy credentials, prompts, or history into test evidence.
