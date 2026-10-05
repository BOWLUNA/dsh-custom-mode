#!/usr/bin/env node
/**
 * Read-only reminder for a dsh upgrade of this package.
 *
 * The card corpus lives in oh-my-dsh/dsh-plugin-upgrade-skill. It is not
 * vendored here. This script prints the decisions that corpus cannot make
 * for the lines this package actually claims, then exits 0.
 *
 * It does not clone, install, or write.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const range = manifest.engines?.dsh
const peer = manifest.peerDependencies?.['@deepseek-ai/dsh']

console.log('dsh-custom-mode upgrade preflight')
console.log('package ' + manifest.version)
console.log('engines.dsh = ' + range)
console.log('peer        = ' + peer)
console.log('ranges-identical ' + (range === peer))
console.log('')
console.log('Do not rewrite the range to ^0.2.0.')
console.log('^0.2.0 does not include 0.2.0-rc.*, and ^0.2.0-rc.1 drops the 0.1.7 line this package still claims.')
console.log('A rejected peer disables the row in stderr while --dump-config still lists it. Use tools/boot-check.mjs.')
console.log('')
console.log('Card corridor gap (oh-my-dsh/dsh-plugin-upgrade-skill @ be3b3f7):')
console.log('  no cards for 0.1.7-rc.1 -> 0.1.7-rc.2')
console.log('  no cards for 0.2.0-rc.1 -> 0.2.0-rc.2 or newer')
console.log('plan-migration exits 2 on those hops. That is a stop, not a license to invent a migration.')
console.log('Evidence for those lines is this repo: node test/run.mjs, tools/boot-check.mjs, tools/browser-verify.mjs.')
console.log('')
console.log('Touchpoints: .cursor/skills/dsh-plugin-upgrade/touchpoints.md')
console.log('Do not npm install -g @deepseek-ai/dsh from inside a running dsh session.')
