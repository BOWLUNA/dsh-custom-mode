# Current compatibility checks

English | [中文](CURRENT_COMPATIBILITY.zh.md)

On 2026-10-09, the `2.2.3` candidate was tested using the exact official npm hosts below. The default channel remains a release candidate; no final stable DSH version is claimed.

| Host | Package and unit checks | Rendered browser checks | Runtime checks |
| --- | --- | --- | --- |
| `0.2.0-rc.2` (`latest` / `next`) | 15 suites, 934 checks; package and boot pass | 74 pass; mode picker passes | 20 pass |
| `0.2.1-alpha.2` (`alpha`) | 15 suites, 934 checks; package and boot pass | 74 pass; mode picker passes | 20 pass |

These are real Windows Web-profile installations in isolated test homes, reusing previously installed hosts. The revised UI uses native Input and Button atoms, native Menu surfaces, and the native InlineEditor surface/font for document textareas. The browser check compares control appearance with native defaults. Both screenshots were inspected. Runtime checks cover authenticated routes, all five base modes, saves, repeated installation, removal, reinstallation, data preservation, and actual assistant deletion. Test text is ordinary fixture data; no model was called.

VMware/Electron desktop, named Linux servers, third-party market UI installation, and history-loading performance are separate checks and remain unverified. The candidate is not an npm release; keep the PR as a draft until the release review is complete.

Reproduce using an existing exact host and a new evidence directory outside the source tree:

```sh
node tools/compat-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --port 32110
node tools/runtime-check.mjs --host-install /path/to/exact-host --out /path/to/new-evidence --browser /path/to/chrome --port 32110 --cdp-port 9229
```

The tools use separate test homes, ordinary fixtures, and sanitized logs. Do not run them against a user's active profile or copy credentials, prompts, or history into test evidence.
