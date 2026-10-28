# Security Policy

English | [中文](SECURITY.zh.md)

## Reporting a Problem

Do not post vulnerability details in a public bug report. GitHub private vulnerability reporting was
disabled at the repository check on 2026-10-27. If **Security → Report a vulnerability** is actually
available, use that private route. Otherwise, use the [private-channel request form](https://github.com/BOWLUNA/dsh-custom-mode/issues/new?template=security_contact.yml)
only to ask the maintainer for a private reporting channel. That request is public: include no
vulnerability details, exploit code, credentials or user data. No private email address is published here.

After a private channel is available, share the affected version, impact and a synthetic reproduction.
Remove token URLs, API keys, cookies and private prompts/history. Once confirmed, the aim is to explain
the impact and fixed version where possible, and disclose details after a fix. No response or fix deadline
is promised.

## Current Validation Scope

Installation compatibility is declared in `engines.dsh` and the `@deepseek-ai/dsh` peer range in
[package.json](package.json). The plugin has its own version line. Exact completed checks and their
platform limits are maintained in [CURRENT_COMPATIBILITY.md](docs/CURRENT_COMPATIBILITY.md).

| Plugin version | DSH version | Status |
| --- | --- | --- |
| `2.3.0` (candidate) | Declared range unchanged; current exact-host targets are `0.2.1-rc.2`, `0.2.1-rc.4`, `0.2.2-alpha.2`, with legacy regressions | **Supported host range declared; verification pending** — new-release integration and native update-flow acceptance are not inherited from 2.2.6. See CURRENT_COMPATIBILITY.md for completed evidence and limits |

This records the current package's compatibility and verification scope. It does not define a security
support expiry date or a backport schedule.

## Historical Records

The [2.2.6 verification record](docs/CURRENT_COMPATIBILITY.md#226-verification-scope) retains its exact-host results and acceptance limits. The earlier 2.2.5 record includes the cwd prompt-contract gap found after page/lifecycle checks had passed. Neither is fresh acceptance of 2.3.0.

Older release declarations remain in the [changelog](CHANGELOG.md), compatibility history and Git history. They do not promise current support, a backport schedule or fresh desktop acceptance. Initial `0.1.6-alpha.1` builds before `review/2026-09-fixes` were affected by the route issue below; upgrading is recommended.

## Known Problems and Fixes

The following incident describes the old implementation, not the current route registration.

### The settings-page private route had no authentication (fixed; shipped in `1.0.1`)

**Impact**: The `/custom-mode` route is registered on `ctx.webServer`'s bare HTTP table, while the
platform's Host/Origin fence and browser session authentication apply only to the channels mounted
by the Connection service (`/`, `/api`…). As a result, the entire system prompt can be read with an
**unauthorized** `GET`, and `prompt.md` can be rewritten with a `content-type: text/plain`
**POST**. The latter matters especially — an ordinary form-style cross-site request does not
trigger a CORS preflight, so any web page open in the user's browser can POST to that port; the
response cannot be read, but the write has already happened.

**Fixed** (twice): `1.0.1` ran the platform's check by hand at the top of every request and failed closed
when the service was missing. `1.0.3` removed that design entirely: the routes are registered on the
platform's shared `/api` channel (`ctx.connection.fetch.register`), where the carrier applies the
loopback/`trustedHosts` Host check, `Sec-Fetch-Site`/`Origin`, and the browser-session cookie **before**
dispatching. There is no hand-rolled check left to move, reorder or forget, and when `connection` is absent
nothing is registered at all.

**Mitigation** (when an immediate upgrade is not possible): the route is bound only to `127.0.0.1`
by default, so the risk comes mainly from (a) other users/processes on the same machine and (b)
cross-site requests from the user's own browser. Exposing dsh on a LAN or behind a reverse proxy
significantly amplifies the impact, so do not deploy the old version that way.

For the full measurements before and after the fix (including the 401/403 comparison), see
[`docs/MEASUREMENTS.md`](docs/MEASUREMENTS.md) section 2 and
[`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) section 9.

## Design Boundaries

- The settings page's routes are registered on the platform's shared **`/api` channel**
  (`ctx.connection.fetch.register`), so the carrier applies the loopback/`trustedHosts` Host check,
  `Sec-Fetch-Site`/`Origin`, and the signed browser-session cookie **before** dispatching to them.
  The plugin performs no authentication check of its own — that is the point: the fence is structural
  rather than a rule to remember. (Before this, the route lived on the raw `webServer` table and had to
  call `ctx.connection.requestRejection` itself; the version that forgot is documented above.)
- Prompt/composition editing does not proactively query a package registry. If you explicitly request an
  update check or continue an update in the official Plugins interface, the host handles requests through
  its configured registry and package-management channels. The plugin does not read credentials, change
  authorization or replace the host's confirmation and update flow.
- Data changes include managed assistant prompts, metadata, composition, prompt history and
  transaction/recovery files. `prompt-history.jsonl` contains full historical prompt text; treat history
  and recovery copies as prompt data when sharing files. Assistant creation/deletion manages its
  directory, and activation maintains seed markers and managed code. Prompt writes validate
  interpolation variables before saving to avoid breaking later requests with a typo.
- `composition.mjs` evaluates the `!!js` platform expressions in the factory composition
  (`new Function`). What it evaluates is the **composition file already installed on this
  machine** — DSH would execute that file as a Cordis plugin anyway, so this introduces no new
  trust surface; but if a composition file is taken from elsewhere and placed in the preset
  directory, treat it as code.
