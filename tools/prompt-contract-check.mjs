#!/usr/bin/env node
/** Real exact-host prompt APIs with synthetic session/filesystem projections; no server or model. */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { apply as reader } from '../preset/prompt-reader.mjs'

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
const args = process.argv.slice(2)
if (args.length && (args.length !== 2 || args[0] !== '--host-install')) throw new Error('Use prompt-contract-check.mjs [--host-install <exact-host-installation>]')
const host = join(args[1] ? resolve(args[1]) : repo, 'node_modules')
const load = (name) => import(pathToFileURL(join(host, '@deepseek-ai', name, 'lib', 'index.js')))
const { Context } = await load('cordis')
const { createScope } = await load('dsh-scope')
const { SystemPrompt, renderPrompt } = await load('dsh-system-prompt')
const version = JSON.parse(readFileSync(join(host, '@deepseek-ai', 'dsh', 'package.json'))).version
const loop = readFileSync(join(host, '@deepseek-ai', 'dsh-agent-loop', 'lib', 'index.js'), 'utf8')
const nativeCwd = /systemPrompt\.variable\("cwd"/.test(loop)
const directory = mkdtempSync(join(tmpdir(), 'dsh-prompt-contract-'))
const prompt = join(directory, 'prompt.md')
const text = 'My custom identity\nYour working directory is {{cwd}}.\nKeep directory reference: {{cwd}}\n'
writeFileSync(prompt, text)
const ctx = new Context()
let workingDirectoryFiber, scope, defaultScope, completed = false
try {
  new SystemPrompt(ctx, { includeHarnessIdentity: true, personaPrefix: '', personaSuffix: '' })
  ctx.systemPrompt.variable('provider', (context) => context.agent?.options.provider)
  ctx.systemPrompt.variable('model', (context) => context.agent?.options.model)
  if (nativeCwd) ctx.systemPrompt.variable('cwd', (context) => context.agent?.session.header.cwd)
  const notices = [], changes = []
  let current = '/fixture/current'
  const session = { header: { cwd: '/fixture/original' }, append(type, data) {
    assert.equal(type, 'working-directory/change'); changes.push(data.cwd); current = data.cwd
  } }
  if (!nativeCwd) {
    const { WorkingDirectoryService } = await load('dsh-working-directory')
    // Real constructor, lifecycle, get/ensure/commit and assemble listener. Only storage/FS are synthetic.
    ctx.provide('fs', {
      async resolve(path) { return { path } },
      async stat(target) { return target.path === '/fixture/missing' ? undefined : { type: 'directory' } },
      processPath(target) { return target.path },
    })
    ctx.provide('sessionProjections', {
      register() { return { stateOf: (wanted) => wanted === session ? current : null } },
      stateOf: (wanted) => wanted === session ? current : null,
    })
    workingDirectoryFiber = ctx.plugin(WorkingDirectoryService, { defaultDirectory: '/fixture/fallback-from-host-config' })
    await workingDirectoryFiber.await()
  }
  const key = {}
  scope = createScope(ctx, key)
  reader(scope.ctx, { path: prompt, suffix: 'Keep before\nYour working directory is {{cwd}}.\nKeep after: {{cwd}}' })
  await new Promise(setImmediate)
  const agent = { session, ctx: scope.ctx, inject: (notice) => notices.push(notice), options: { provider: 'fixture-provider', model: 'fixture-model' } }
  const render = async () => renderPrompt(await ctx.systemPrompt.assemble({ scope: key, agent }))
  const first = await render()
  assert.ok(first.includes('Keep directory reference: ' + (nativeCwd ? session.header.cwd : current)))
  assert.ok(first.includes('Keep before') && first.includes('Keep after'))
  assert.equal(readFileSync(prompt, 'utf8'), text)
  if (!nativeCwd) assert.ok(!first.includes('Your working directory is'))
  current = '/fixture/changed/{{model}}'
  session.header.cwd = '/fixture/legacy-changed/{{model}}'
  const changed = await render()
  assert.ok(changed.includes(nativeCwd ? session.header.cwd : current), 'directory values must be interpolated once')
  if (!nativeCwd) {
    current = '/fixture/missing'
    const recovered = await render()
    assert.equal(current, session.header.cwd)
    assert.ok(recovered.includes('Keep directory reference: ' + session.header.cwd))
    assert.ok(recovered.includes('Keep after: ' + session.header.cwd))
    assert.ok(!recovered.includes('/fixture/missing'))
    assert.equal(changes.length, 1)
    assert.equal(notices.length, 1)
  }
  const defaultKey = {}
  defaultScope = createScope(ctx, defaultKey)
  reader(defaultScope.ctx, { path: prompt })
  await new Promise(setImmediate)
  const defaultPrompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: defaultKey, agent }))
  assert.ok(defaultPrompt.includes('My custom identity'))
  if (!nativeCwd) assert.ok(!defaultPrompt.includes('Your working directory is'))
  assert.equal(readFileSync(prompt, 'utf8'), text)
  completed = true
  console.log(JSON.stringify({ version, nativeCwd, realRegistryAssembleAndRender: true, realWorkingDirectoryServiceLifecycleAndEnsure: !nativeCwd, originalPromptUnchanged: true, customSuffixPreserved: true, currentDirectoryChangesReflected: true, missingDirectoryRestoredBeforeRendering: !nativeCwd, defaultSuffixRenders: true, bracesNotRescanned: true, boundary: 'Synthetic session/filesystem projections; no full agent loop, server, browser, model or GPU' }, null, 2))
} finally {
  if (defaultScope) await defaultScope.dispose()
  if (scope) await scope.dispose()
  if (workingDirectoryFiber) await workingDirectoryFiber.dispose()
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep)) throw new Error('Refusing fixture cleanup outside temporary root')
  if (completed) rmSync(directory, { recursive: true, force: true })
  else console.error('Synthetic failure fixture retained: ' + directory)
}
