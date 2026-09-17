<!--
The easiest way to break this repository is not "failing to write something", it is writing something
that silently breaks something else: an untouched row losing its platform condition, a group switch
landing on a child row, one language updated and the other left behind, one copy of a string changed
while its twin in another file stays stale, a new row added without a dictionary entry.
The checklist below exists for exactly those failure modes.
-->

## What this PR does

<!-- One or two sentences. If it fixes a bug, paste the reproduction command and the before/after output. -->

## Self-check

- [ ] `node test/run.mjs` is green across all 8 suites (63 + 26 + 15 + 37 + 45 + 51 + 31 + 65 = 333)
- [ ] Changed a string in `editor/client.js` → also changed `editor/locales.mjs` (section 6 catches drift)
- [ ] Changed the private route in `editor/index.mjs` → it still runs `ctx.connection.requestRejection(req)` first, and still fails **closed** when that service is missing
- [ ] Changed the text surgery in `composition.mjs` → untouched rows are still byte-identical to the shipped ones (including `!!js` conditions and rows that ship disabled)
- [ ] Added a composition row → `ROW_META` in `composition.mjs` and `row.<id>.label` in `locales.mjs` both cover it (otherwise the row renders as a bare id)
- [ ] Documentation has no contradicting statements (for example whether editing `client.js` needs a restart) and no stale paths
- [ ] Screenshots no longer match the UI → re-capture with `tools/screenshots/` instead of editing the images by hand
- [ ] Both sides of every translation pair were updated, then `node tools/verify-translation-pairing.mjs --write`

## Compatibility

- [ ] No new dsh-internal API is introduced; **if one is**, it was added to the coupling-point table in the README (that table exists so an upgrade can be checked off)
- [ ] `editor/package.json`'s `version` still matches the dsh release this plugin is adapted to

## Notes

<!-- Trade-offs a reviewer should know about, known gaps, and follow-ups. -->
