#!/usr/bin/env node
/** Synthetic counterexamples for the real native-update outcome predicate; no host or network. */
import { matchesUpdateOutcome } from './native-update-fixture.mjs'

let passed = 0, failed = 0
const check = (label, okay) => {
  console.log(`${okay ? 'PASS' : 'FAIL'} ${label}`)
  okay ? passed++ : failed++
}
const expected = { from: '2.2.7', to: '2.3.0', application: 'applied' }
const response = (patch = {}) => ({
  status: 200,
  data: {
    ok: true,
    value: { from: '2.2.7', to: '2.3.0', step: 'install', result: { application: 'applied' }, ...patch },
  },
})
check('exact applied outcome accepted', matchesUpdateOutcome(response(), expected))
check('exact restart outcome accepted', matchesUpdateOutcome(response({ result: { application: 'restart-required' } }), { ...expected, application: 'restart-required' }))
const recovery = { ...expected, application: 'failed', restoreApplication: 'applied' }
check('exact failed outcome with applied restore accepted', matchesUpdateOutcome(response({ result: { application: 'failed' }, restore: { application: 'applied' } }), recovery))

for (const [label, result] of [
  ['missing', undefined], ['null', null], ['empty', {}],
  ['cancelled', { application: 'cancelled' }], ['unknown', { application: 'mystery' }],
]) check('reject ' + label + ' result', !matchesUpdateOutcome(response({ result }), expected))

for (const [label, restore] of [
  ['missing', undefined], ['null', null], ['empty', {}],
  ['cancelled', { application: 'cancelled' }], ['failed', { application: 'failed' }],
  ['restart', { application: 'restart-required' }],
]) check('reject ' + label + ' restore', !matchesUpdateOutcome(response({ result: { application: 'failed' }, restore }), recovery))

for (const [label, patch] of [['from', { from: '2.2.6' }], ['to', { to: '3.0.0' }], ['step', { step: 'remove' }]]) {
  check('reject wrong ' + label, !matchesUpdateOutcome(response(patch), expected))
}
check('reject HTTP failure', !matchesUpdateOutcome({ ...response(), status: 500 }, expected))
check('reject API error', !matchesUpdateOutcome({ status: 200, data: { ...response().data, ok: false } }, expected))
check('reject missing HTTP wrapper', !matchesUpdateOutcome(response().data.value, expected))
check('reject success carrying restore', !matchesUpdateOutcome(response({ restore: { application: 'applied' } }), expected))
check('reject absent expectation', !matchesUpdateOutcome(response()))

console.log(`Native outcome self-test: ${passed} passed, ${failed} failed (synthetic predicate checks only)`)
process.exitCode = failed ? 1 : 0
