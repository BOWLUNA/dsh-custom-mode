#!/usr/bin/env node
/** Exact-host Context + Loader + preset register/inventory contract with synthetic profile services.
 * No server, browser, model, credentials or real DSH_HOME is used.
 * node tools/disabled-contract-check.mjs --host-install <isolated exact host>
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseComposition } from '../preset-backend/parse-composition.mjs'
import { toPluginRows } from '../preset-backend/declarative.mjs'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..'), args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--host-install')) throw new Error('Use disabled-contract-check.mjs [--host-install <isolated exact host>]')
const host = args[1] ? resolve(args[1]) : repo, modules = join(host, 'node_modules')
const directory = mkdtempSync(join(tmpdir(), 'dsh-disabled-contract-'))
process.env.DSH_HOME = directory
const load = (name) => import(pathToFileURL(join(modules, '@deepseek-ai', name, 'lib', 'index.js')).href)
const { Context } = await load('cordis')
const { Loader, Group } = await load('cordis-plugin-loader')
const { AgentPresetRegistry } = await load('dsh-agent-preset-registry')
const { entryListSchema } = await load('cordis-plugin-include')
const yaml = createRequire(join(host, 'package.json'))('js-yaml')
const hostVersion = JSON.parse(readFileSync(join(modules, '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version
const report = { hostVersion, platform: process.platform, boundary: 'Real host Context/Loader/register/compositionInventory; synthetic profile/projection/agent services, no full host/UI/session/model', checks: [] }
const check = (label, okay) => { report.checks.push({ label, passed: Boolean(okay) }); assert.ok(okay, label) }
const moduleFile = join(directory, 'probe.mjs'), moduleUrl = pathToFileURL(moduleFile).href
writeFileSync(join(directory, 'package.json'), '{"name":"synthetic-disabled-contract","version":"1.0.0","type":"module"}')
writeFileSync(moduleFile, `export function apply(ctx, config) { ctx.get('disabledContractProbe').record({ row: config.row, profileAvailable: ctx.get('profileContext') !== undefined }) }\n`)
const condition = "!ctx.get('profileContext')"
const text = `
- id: literal-on
  name: ${JSON.stringify(moduleUrl)}
  disabled: false
  config:
    row: literal-on
- id: literal-off
  name: ${JSON.stringify(moduleUrl)}
  disabled: true
  config:
    row: literal-off
- id: profile-present
  name: ${JSON.stringify(moduleUrl)}
  disabled: !!js ${JSON.stringify(condition)}
  config:
    row: profile-present
- id: profile-absent
  name: ${JSON.stringify(moduleUrl)}
  disabled: !!js '!!ctx.get("profileContext")'
  config:
    row: profile-absent
- id: platform-native
  name: ${JSON.stringify(moduleUrl)}
  disabled: !!js process.platform !== 'win32'
  config:
    row: platform-native
- id: false-expression
  name: ${JSON.stringify(moduleUrl)}
  disabled: !!js 'false'
  config:
    row: false-expression
- id: conditional-group
  name: cordis:group
  group: true
  disabled: !!js ${JSON.stringify(condition)}
  config:
    - id: group-child
      name: ${JSON.stringify(moduleUrl)}
      disabled: false
      config:
        row: group-child
`
let complete = false
try {
  for (const hasProfile of [false, true]) {
    const profile = join(directory, hasProfile ? 'profile-present' : 'profile-absent'); mkdirSync(profile)
    const ctx = new Context(), calls = [], disposers = []
    ctx.baseUrl = pathToFileURL(join(profile, 'profile.yml')).href
    const loader = new Loader(ctx, { baseUrl: ctx.baseUrl })
    loader.builtins.group = Group
    ctx.provide('disabledContractProbe', { record: (value) => calls.push(value) })
    ctx.provide('sessionProjections', { register: async () => ({ stateOf: () => null }) })
    ctx.provide('agents', {})
    if (hasProfile) ctx.provide('profileContext', { dir: profile, name: 'synthetic-web' })
    // The registry's real eager activation/mount and diagnostic methods are used. No Agent is created.
    const registry = new AgentPresetRegistry(ctx, { default: 'native-disabled-contract', selectedDefault: { get: () => undefined } })
    assert.equal(typeof registry.register, 'function'); assert.equal(typeof registry.compositionInventory, 'function')
    const expected = { 'literal-on': true, 'literal-off': false, 'profile-present': hasProfile, 'profile-absent': !hasProfile, 'platform-native': process.platform === 'win32', 'false-expression': true, 'group-child': hasProfile }
    const observed = {}
    try {
      for (const kind of ['native', 'plugin-adapter']) {
        const plugins = kind === 'native' ? yaml.load(text, { schema: entryListSchema }) : toPluginRows(parseComposition(text), directory)
        const id = kind + '-disabled-contract', start = calls.length
        disposers.push(await registry.register({ id, name: 'Synthetic disabled contract', plugins }))
        const declaration = (await registry.compositionInventory()).find((item) => item.id === id)
        check(`${hasProfile}/${kind}: real preset mounts`, declaration && !declaration.broken)
        const rows = new Map(declaration.rows.map((row) => [row.entryId, row]))
        const activated = calls.slice(start)
        for (const [row, enabled] of Object.entries(expected)) {
          check(`${hasProfile}/${kind}/${row}: native inventory effective enablement`, rows.get(row)?.enabled === enabled)
          check(`${hasProfile}/${kind}/${row}: actual module activation agrees`, activated.filter((value) => value.row === row).length === (enabled ? 1 : 0))
        }
        check(`${hasProfile}/${kind}: profile service inherited in active preset context`, activated.every((value) => value.profileAvailable === hasProfile))
        check(`${hasProfile}/${kind}: decoded condition retained by native Loader`, rows.get('profile-present')?.condition === condition)
        observed[kind] = Object.fromEntries([...rows].map(([id, value]) => [id, value.enabled]))
      }
      check(`${hasProfile}: product adapter matches independently parsed native YAML`, JSON.stringify(observed.native) === JSON.stringify(observed['plugin-adapter']))
    } finally { for (const dispose of disposers.reverse()) await dispose() }
  }
  complete = true
  console.log(JSON.stringify({ ...report, passed: report.checks.length, failed: 0 }, null, 2))
} finally {
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Invalid synthetic cleanup root')
  if (complete) rmSync(directory, { recursive: true })
  else console.error('Synthetic failed contract retained: ' + directory)
}
