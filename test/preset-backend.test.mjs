/**
 * preset-backend tests — the two-line contract for **removing** an assistant.
 *
 * Run: node test/preset-backend.test.mjs
 *
 * Why this exists: on dsh ≥ 0.1.7 the platform service has **no \`remove()\`** — the only way to
 * unregister a preset is the disposer returned by \`register()\`. The host half used to demand
 * \`agentPresets.remove()\` and answer a typed \`noRemoveApi\` otherwise, which meant **the settings
 * page could not delete an assistant at all on the newer line**: the confirmation was shown, the
 * request came back 400, and the directory stayed on disk (measured 2026-09-25 with
 * \`tools/browser-verify.mjs\` on 0.1.7-rc.2: "删除后 API 里也没有它" failed while the UI said
 * "删除失败"). No suite covered deletion, so nothing caught it.
 *
 * These cases pin both halves: the declarative backend's own \`remove\` (dispose + delete the
 * directory, and refuse honestly when it does not know the directory), and \`deleteAssistant\`'s
 * choice between the two lines' removers.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeclarativeBackend, toPluginRows } from '../preset-backend/declarative.mjs'
import { parseComposition } from '../preset-backend/parse-composition.mjs'

let passed = 0
let failed = 0
const check = (label, condition, detail = '') => {
  if (condition) {
    passed += 1
    console.log(`PASS  ${label}`)
  } else {
    failed += 1
    console.log(`FAIL  ${label}${detail === '' ? '' : '  → ' + detail}`)
  }
}

const { deleteAssistant } = await import('../index.mjs')

const base = mkdtempSync(join(tmpdir(), 'cm-backend-'))
const root = join(base, 'presets')

/** One managed assistant directory (prompt.md + the reader module is what "managed" means). */
function makeAssistant(id) {
  const dir = join(root, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'prompt.md'), '你是' + id + '。\n', 'utf8')
  writeFileSync(join(dir, 'prompt-reader.mjs'), 'export default {}\n', 'utf8')
  writeFileSync(join(dir, 'agent.cordis.yml'), '- id: persona\n  name: ./prompt-reader.mjs\n', 'utf8')
  return { dir, row: { id, trust: 'user', path: join(dir, 'agent.cordis.yml'), name: '助手 ' + id } }
}

console.log('=== 1. 声明式后端：remove = 注销 + 删目录 ===')
{
  const { dir, row } = makeAssistant('alpha')
  const disposed = []
  const backend = createDeclarativeBackend({
    scope: {
      agentPresets: {
        register: async (definition) => {
          disposed.push(definition.id)
          return async () => { disposed.push('dispose:' + definition.id) }
        },
      },
    },
    log: () => {},
    warn: () => {},
  })

  const mounted = await backend.mountOne({ id: 'alpha', dir, name: 'A' })
  check('先能挂上（前置条件）', mounted.ok === true, JSON.stringify(mounted))
  check('挂上后记录在案', backend.mountedIds().includes('alpha') === true, JSON.stringify(backend.mountedIds()))

  const outcome = await backend.remove('alpha', dir)
  check('remove 报告成功', outcome.ok === true && outcome.dir === dir, JSON.stringify(outcome))
  check('调用了 disposer（这是新线唯一的注销手段）', disposed.includes('dispose:alpha') === true, JSON.stringify(disposed))
  check('目录真的没了', !existsSync(dir))
  check('注销后不再记录在案', backend.mountedIds().includes('alpha') === false, JSON.stringify(backend.mountedIds()))
}

console.log('=== 2. 不知道目录时如实拒绝，而不是假装删掉 ===')
{
  const backend = createDeclarativeBackend({
    scope: { agentPresets: { register: async () => async () => {} } },
    log: () => {},
    warn: () => {},
  })
  const outcome = await backend.remove('never-mounted')
  check('没有目录 → ok:false + 类型化 code', outcome.ok === false && outcome.code === 'noDirectory', JSON.stringify(outcome))
}

console.log('=== 3. deleteAssistant：按后端选删除入口 ===')
{
  const { dir, row } = makeAssistant('beta')
  const rows = [row]
  const seen = []
  const result = await deleteAssistant(rows, { id: 'beta' }, {
    remove: async (id, target) => {
      seen.push({ id, target })
      rmSync(target, { recursive: true, force: true })
      return { ok: true }
    },
  })
  check('删除成功', result.ok === true && result.code === 'deleted', JSON.stringify(result))
  check('删除入口拿到的是**受管目录**', seen.length === 1 && seen[0].id === 'beta' && seen[0].target === dir, JSON.stringify(seen))
  check('状态行用显示名而不是目录 id', result.params?.name === '助手 beta', JSON.stringify(result.params))
  check('目录已被删掉', !existsSync(dir))
}

console.log('=== 4. 两套入口都没有时，才是真做不到 ===')
{
  const { row } = makeAssistant('gamma')
  const result = await deleteAssistant([row], { id: 'gamma' }, undefined)
  check('没有删除入口 → 类型化 noRemoveApi（不抛）', result.ok === false && result.code === 'noRemoveApi', JSON.stringify(result))
}

console.log('=== 5. 旧线形态的入口仍然可用（只吃 id） ===')
{
  const { dir, row } = makeAssistant('delta')
  const result = await deleteAssistant([row], { id: 'delta' }, {
    remove: async (id) => {
      rmSync(dir, { recursive: true, force: true })
      return undefined // 旧线的 agentPresets.remove() 不返回对象
    },
  })
  check('旧线入口（返回 undefined）也判成功', result.ok === true, JSON.stringify(result))
  check('目录被删', !existsSync(dir))
}

console.log('=== 6. 未知 id → unknownAssistant（带 code） ===')
{
  const result = await deleteAssistant([], { id: 'nope' }, { remove: async () => ({ ok: true }) })
  check('未知 id 的类型化失败', result.ok === false && result.code === 'unknownAssistant', JSON.stringify(result))
}

console.log('=== 7. 配置表达式交给宿主加载器求值 ===')
{
  const expression = "process.getBuiltinModule('node:path').join(baseUrl, 'skills')"
  const text = '- id: skill-filesystem\n  name: test-skill\n  config:\n    customSkillDirs:\n      - !!js ' + expression + '\n    literal: keep\n    nested:\n      enabled: !!js process.platform !== "win32"\n'
  const parsed = parseComposition(text)
  const before = JSON.stringify(parsed)
  const converted = toPluginRows(parsed, base)
  const config = converted[0].config
  check('技能目录表达式使用宿主原生节点', config.customSkillDirs[0].__jsExpr === expression && !('__js' in config.customSkillDirs[0]), JSON.stringify(config))
  check('嵌套对象里的表达式也保留给宿主', config.nested.enabled.__jsExpr === 'process.platform !== "win32"', JSON.stringify(config.nested))
  check('普通配置值保持原值', config.literal === 'keep')
  check('转换不改动解析输入，不提前执行表达式', JSON.stringify(parsed) === before && typeof config.customSkillDirs[0] === 'object')
}

rmSync(base, { recursive: true, force: true })

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
