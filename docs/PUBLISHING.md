# Publishing and distribution

English | [中文](PUBLISHING.zh.md)

## Current release path

The repository root is the npm package. Its bundled `preset/` is the only packaged preset source; activation seeds missing user files and refreshes managed code. A preset-only `.dshpreset` archive does not install the settings page. Do not revive the old `editor/` subpackage or tell npm users to clone a second preset copy.

Version `2.2.6` follows the gated release path below. Keep source, local checks, independent review, remote CI, npm publication and GitHub Release results separate; verify publication through read-back evidence.

1. Fix the candidate version in `package.json`, update both language documents and their pairing records, and record the complete candidate commit. Changing the package version does not require mirroring a host version: update host pins/ranges only after those exact hosts are adapted and checked.
2. Run the registered suites, real prompt-component contracts, translation and documentation guards, syntax checks and the real npm packlist. Use isolated homes for packed install, restart, preset selection, browser interaction, uninstall and reinstall. Test interrupted saves and installer rollback with synthetic data. The release check list must name any unverified desktop/model/GPU boundary.
3. Have a non-author inspect the final diff and corresponding evidence. Push the checked branch, then read back its complete remote SHA. A draft PR can carry the review; merging a default/production branch is a separate authorized action.
4. Use the existing `.github/workflows/release.yml` path. A matching `v<package version>` tag triggers compatibility and browser reusable workflows before publishing. A manual dispatch with an exact version only publishes from `main`; a blank dispatch checks identity and does not publish. Do not move an existing release tag to another commit or bypass a failed gate.
5. Keep the existing NPM_TOKEN or Trusted Publishing/OIDC configuration. The current workflow checks and passes an existing NPM_TOKEN; when no token is configured, npm can use the existing OIDC publisher connection. Do not read or rewrite secrets, publisher permissions, approvals or global release policy. Resolve an unavailable credential/approval through the normal owner flow.
6. Read back the tag's commit, required run results, exact npm version and dist metadata, and GitHub Release assets. Verify the downloaded checksums. A command started, a staged npm publish, or a successful local test is not completed distribution.

## Package and release assets

`package.json` declares the runtime allowlist, bundle patch, browser export and optional host peer. Keep those facts in one manifest. Verify the actual list rather than maintaining an expected list by hand:

```sh
npm pack --dry-run --ignore-scripts --json
```

Release assets are built by the existing `tools/release-assets.py` entry point. It produces the npm plugin archive, a preset-only import archive and `SHA256SUMS`; the latter covers the two assets. Run it only in an isolated output directory. Its manifest must identify a real accepted source host, and asset checks must be tied to the same candidate commit. The official-host installation, user home, caches, credentials and test environment do not belong in the assets.

For a clone, `./install.sh --profile web` retains the linked development path. It uses offline local packing to prepare/validate the new package and an actual installed old-package rollback snapshot. Existing user prompt, metadata and composition stay unchanged; managed code has its own restore snapshot. Failed replacement is recovered through a real host package operation, not by copying back a manifest over a different node_modules state. Keep an incomplete rollback's printed transaction directory. Normal registry users can install a fixed version directly as documented in the README.

## Market and repository presentation

Use the root package identity, repository URL and existing `screenshots.json`. README images and market screenshots share the files under `docs/images/`; changing a screenshot does not publish an npm package. A screenshot proves appearance at its recorded version, not a successful conversation.

The 2026-10-09 market discovery results in [MARKETPLACES.md](MARKETPLACES.md) are historical snapshots. An accepted npm release does not establish listing approval or discoverability in every catalog. Recheck the actual catalog before claiming that a market install works; do not submit a listing, request refresh or change repository settings without authorization for that external action.

## Historical publication notes

These facts explain older incidents; their old commands, API assumptions and credential advice are not current setup instructions. Full version history remains in Git and [MEASUREMENTS.md](MEASUREMENTS.md).

- Before 1.10.0 the root was a private wrapper and the real npm package lived in `editor/`. That split confused third-party detectors and required two preset copies. The single root package supersedes it.
- The old `0.1.6-alpha.*` line mirrored the host and used the alpha tag. Since 1.0.0 the plugin has its own plain stable version line. A historical alpha dist-tag or example must not be promoted as the current install command.
- Old measurements showed release cooldown/cache and duplicate `minimumReleaseAgeExclude` entries selecting or rejecting unexpected versions. Exact-version selection still needs policy/compatibility acceptance and a version read-back; it is not a promise that every package-manager policy can be bypassed.
- Early notes recommended session login, Automation tokens, changing tags and manual Release APIs. Those were incident-specific workarounds. Current publication follows the existing gated workflow and configured authentication; do not copy those historical credential/permission recipes.
- Historical social-preview API limits, catalog counts and screenshot choices were measured on their dates. Recheck them before editing public metadata; they are not current API contracts or required release actions.
