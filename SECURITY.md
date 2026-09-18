# Security Policy

English | [中文](SECURITY.zh.md)

## Reporting a Problem

Submit through GitHub's **private vulnerability reporting** (repository → Security → Report a
vulnerability), not a public issue. If that entry point is unavailable, an issue may be opened
that says only "there is a security problem, please provide a private channel", carrying no
details.

Once a report is confirmed, the aim is to provide, where possible: impact scope, reproduction
conditions, and the fixed version, and to publish details only after the fix is released.

## Support Scope

Which DSH versions this plugin supports is declared in `engines.dsh` and the `@deepseek-ai/dsh` peer
range in `editor/package.json` (see README, "Versioning"); the package version is its own line and no
longer encodes it. Development and verification cover the rows below, newest first:

| Plugin version | DSH version | Status |
| --- | --- | --- |
| `1.0.0` | `0.1.6-alpha.2` | **Supported (current development and verification target)** |
| `0.1.6-alpha.2` | `0.1.6-alpha.2` | **Supported (current development and verification target)** |
| `0.1.6-alpha.1` (including commits after this repository's `review/2026-09-fixes` branch) | `0.1.6-alpha.1` | Supported (previous) |
| `0.1.6-alpha.1` earlier than the above branch (i.e. the initial commit) | `0.1.6-alpha.1` | **Affected by the problem described below; upgrading is recommended** |

## Known Problems and Fixes

### The settings-page private route had no authentication (fixed; shipped in `1.0.1`)

**Impact**: The `/custom-mode` route is registered on `ctx.webServer`'s bare HTTP table, while the
platform's Host/Origin fence and browser session authentication apply only to the channels mounted
by the Connection service (`/`, `/api`…). As a result, the entire system prompt can be read with an
**unauthorized** `GET`, and `prompt.md` can be rewritten with a `content-type: text/plain`
**POST**. The latter matters especially — an ordinary form-style cross-site request does not
trigger a CORS preflight, so any web page open in the user's browser can POST to that port; the
response cannot be read, but the write has already happened.

**Fixed**: Before handling any request, the route first calls
`ctx.connection.requestRejection(req)` (the same decision as for `/api`), and **fails closed**
when that service is unavailable (503 + host log), rather than falling back to no validation.

**Mitigation** (when an immediate upgrade is not possible): the route is bound only to `127.0.0.1`
by default, so the risk comes mainly from (a) other users/processes on the same machine and (b)
cross-site requests from the user's own browser. Exposing dsh on a LAN or behind a reverse proxy
significantly amplifies the impact, so do not deploy the old version that way.

For the full measurements before and after the fix (including the 401/403 comparison), see
[`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md) section 2 and
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) section 9.

## Design Boundaries

- This plugin **introduces no** outbound network requests and reads no credentials.
- The settings page can write only the two files in the preset directory (`prompt.md`,
  `agent.cordis.yml`) and `preset.yml`; before writing it validates the prompt's interpolation
  variables, avoiding the promotion of a typo into "every request in that mode fails".
- `composition.mjs` evaluates the `!!js` platform expressions in the factory composition
  (`new Function`). What it evaluates is the **composition file already installed on this
  machine** — DSH would execute that file as a Cordis plugin anyway, so this introduces no new
  trust surface; but if a composition file is taken from elsewhere and placed in the preset
  directory, treat it as code.
