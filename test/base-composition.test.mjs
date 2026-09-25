/**
 * 出厂组成「从哪来」—— 两条 dsh 线的第三个分歧点，以及它取不到时的降级。
 *
 * Run: node test/base-composition.test.mjs
 *
 * **为什么这个套件必须存在**：1.9.12 只有一条解析路（`@deepseek-ai/dsh-agent-presets` 的文件），
 * 而 0.1.7 起那个包不再发布 —— 于是官方桌面端内置的那条线上，设置页读组成时抛错、HTTP 层回 500，
 * 页面只剩一个红字。CI 全绿，因为 `test/run.mjs` 给每个套件**注入了** presets 目录，等于把真实
 * 环境里缺的那样东西补上了。这个套件反过来：它**先删掉**那个环境变量，再逐条验证解析链与降级。
 *
 * 覆盖：
 *   1. `extractPluginsBlock()` —— 从 `dsh-web-app/presets/<mode>.patch.yml` 里取出 plugins 序列，
 *      且保持注释 / `!!js` / 分组结构逐字节不变（文本手术，不是 YAML 往返）；
 *   2. 解析顺序 —— 显式 override → 宿主交出（readDocument）→ 旧线目录 → 打包 patch → 类型化失败；
 *   3. 降级 —— 取不到组成时：读状态仍可用（提示词在）、保存提示词成功（组成文件不动）、
 *      带开关的保存被明确拒绝、新建助手给出类型化错误。
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

// 本套件的全部意义就是「没有 presets 目录」那条路，所以先把注入清掉。
delete process.env.DSH_SHIPPED_PRESETS_DIR
delete process.env.DSH_PRESET_PATCH_DIR

const dir = mkdtempSync(join(tmpdir(), 'dsh-custom-base-'))

// ★ 隔离这台机器：`DSH_SHIPPED_PRESETS_DIR` 的语义是**排他**的（设了就只看它），
//   所以把它指向一个不存在的目录，等于同时关掉"注入目录"和"Node 发现"两条路 ——
//   否则装了 dsh 的开发机上，测试会命中真实安装，测的就不是"没有出厂组成"这条分支了。
process.env.DSH_SHIPPED_PRESETS_DIR = join(dir, 'no-legacy-presets')

/** 一份合成的声明式 patch：注释、!!js、分组、深缩进全都占上。 */
const PATCH = [
  '# Agent preset standard: one declaration inserted after the web patch.',
  '- insert:',
  "    - id: preset-standard",
  "      name: '@deepseek-ai/dsh-agent-preset'",
  '      config:',
  '        id: standard',
  '        order: 1',
  '        plugins:',
  '          # 这一行是注释，必须原样活下来',
  '          - id: persona',
  "            name: '@deepseek-ai/dsh-persona'",
  '          - id: tool-bash',
  "            name: '@deepseek-ai/dsh-tool-bash'",
  "            disabled: !!js process.platform === 'win32'",
  '          - id: planning',
  '            name: cordis:group',
  '            group: true',
  '            isolate:',
  '              planMode: true',
  '            config:',
  '              - id: plan-mode',
  "                name: '@deepseek-ai/dsh-plan-mode'",
  '          - id: tool-off',
  "            name: '@deepseek-ai/dsh-tool-off'",
  '            disabled: true',
  '',
].join('\n')

const patchesDir = join(dir, 'patches')
mkdirSync(patchesDir, { recursive: true })
for (const mode of ['standard', 'ptc', 'minimal', 'cordis']) {
  writeFileSync(join(patchesDir, `${mode}.patch.yml`), PATCH, 'utf8')
}
writeFileSync(join(patchesDir, 'not-a-patch.yml'), 'nothing here\n', 'utf8')

const legacyDir = join(dir, 'legacy-presets')
mkdirSync(join(legacyDir, 'standard'), { recursive: true })
const LEGACY_STANDARD = ['# legacy shipped base', '', '- id: persona', "  name: './persona.mjs'", '', '- id: tool-legacy', "  name: '@deepseek-ai/dsh-tool-legacy'", ''].join('\n')
writeFileSync(join(legacyDir, 'standard', 'agent.cordis.yml'), LEGACY_STANDARD, 'utf8')

const {
  BASE_MODE_IDS,
  BaseCompositionUnavailableError,
  extractPluginsBlock,
  isBaseCompositionUnavailable,
  readBaseCompositionText,
  resetBaseCompositionCachesForTests,
  setBaseCompositions,
  setPatchPresetsDir,
} = await import('../editor/base-composition.mjs')
const { BASE_MODES, collectRows, renderComposition, readBaseComposition, overridesOf } = await import('../editor/composition.mjs')

console.log('=== 1. extractPluginsBlock：取出 plugins 序列，且不动它一个字节 ===')
{
  const extracted = extractPluginsBlock(PATCH)
  check('取到了内容', typeof extracted === 'string' && extracted.length > 0)
  const firstRowLine = extracted.split('\n').find((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  check('第一条行回到第 0 列', firstRowLine.startsWith('- id: persona'), JSON.stringify(firstRowLine))
  check('注释原样保留', extracted.includes('# 这一行是注释，必须原样活下来'))
  check('!!js 表达式逐字节保留', extracted.includes("disabled: !!js process.platform === 'win32'"))
  const rows = collectRows(extracted)
  check('行数正确（4 行）', rows.length === 4, JSON.stringify(rows.map((r) => r.id)))
  check('persona 的模块名解析出来', rows[0].moduleName === '@deepseek-ai/dsh-persona')
  const group = rows.find((row) => row.id === 'planning')
  check('分组仍然是分组', group !== undefined && group.group === true)
  check('分组的子行没有被压平', group !== undefined && group.children.length === 1 && group.children[0].id === 'plan-mode', JSON.stringify(group?.children?.map((c) => c.id)))
  const off = rows.find((row) => row.id === 'tool-off')
  check('字面 disabled: true 读成关闭', off !== undefined && off.disabled === true)
  const bash = rows.find((row) => row.id === 'tool-bash')
  check('平台条件被保留为表达式', bash !== undefined && bash.disabledExpression === "!!js process.platform === 'win32'", JSON.stringify(bash?.disabledExpression))
  check('没有 plugins: 时返回 null', extractPluginsBlock('a: 1\nb: 2\n') === null)
  check('空输入返回 null', extractPluginsBlock('') === null)
}

console.log()
console.log('=== 2. 解析顺序：override → 宿主 → 旧线 → patch → 类型化失败 ===')
{
  resetBaseCompositionCachesForTests()
  setBaseCompositions(null)
  process.env.DSH_PRESET_PATCH_DIR = patchesDir

  const fromPatch = readBaseCompositionText('standard')
  check('patch 路可用', fromPatch.text.includes('- id: persona'))
  check('来源标注是 patch', fromPatch.source.includes('dsh-web-app'), fromPatch.source)
  check('readBaseComposition() 返回同一份文本', readBaseComposition('standard') === fromPatch.text)

  // 宿主交出的文本优先于 patch（0.1.7 的正路）
  setBaseCompositions(new Map([['standard', LEGACY_STANDARD]]))
  const fromHost = readBaseCompositionText('standard')
  check('宿主文本优先于 patch', fromHost.source === 'agentPresets.readDocument()', fromHost.source)
  check('取到的是宿主那一份', fromHost.text === LEGACY_STANDARD)
  setBaseCompositions(null)

  // 显式 override 优先于一切（且是排他的）
  process.env.DSH_SHIPPED_PRESETS_DIR = legacyDir
  const fromLegacy = readBaseCompositionText('standard')
  check('显式 override 最优先', fromLegacy.source === 'DSH_SHIPPED_PRESETS_DIR', fromLegacy.source)
  check('取到的是 override 目录里的文件', fromLegacy.text === LEGACY_STANDARD)
  process.env.DSH_SHIPPED_PRESETS_DIR = join(dir, 'no-legacy-presets')

  // 只有 patch 目录、但里面没有这个模式 → 类型化失败，且带上尝试过的途径
  process.env.DSH_PRESET_PATCH_DIR = join(dir, 'empty')
  mkdirSync(join(dir, 'empty'), { recursive: true })
  let thrown
  try {
    readBaseCompositionText('standard')
  } catch (error) {
    thrown = error
  }
  check('失败是 BaseCompositionUnavailableError', thrown instanceof BaseCompositionUnavailableError, String(thrown))
  check('失败带 code', thrown !== undefined && thrown.code === 'baseCompositionUnavailable')
  check('失败带 modeId', thrown !== undefined && thrown.modeId === 'standard')
  check('失败列出尝试过的途径', thrown !== undefined && Array.isArray(thrown.attempts) && thrown.attempts.length >= 2, JSON.stringify(thrown?.attempts))
  check('isBaseCompositionUnavailable() 认得它', isBaseCompositionUnavailable(thrown) === true)
  check('readBaseComposition() 同样抛出', (() => { try { readBaseComposition('standard'); return false } catch (error) { return isBaseCompositionUnavailable(error) } })())

  delete process.env.DSH_PRESET_PATCH_DIR
  resetBaseCompositionCachesForTests()
}

console.log()
console.log('=== 3. 声明与 UI 的基础模式清单必须同源 ===')
{
  const ui = BASE_MODES.map((mode) => mode.id).join(',')
  check('BASE_MODE_IDS 与 BASE_MODES 一致', ui === BASE_MODE_IDS.join(','), `${ui} vs ${BASE_MODE_IDS.join(',')}`)
}

console.log()
console.log('=== 3.5 声明式 roster：改名后磁盘优先（否则"改名"永远不生效）===')
{
  // 实测（2026-09-25，0.1.7-rc.2）：POST /state 存下 name=写作助手、preset.yml 已是新名，而助手列表与
  // 选择器里仍是旧名 —— 因为合成行（磁盘）被注册表里**上一次注册**留下的旧 name 覆盖了。注册表只该
  // 提供它独有的东西（mount 诊断 broken），名字与描述以磁盘为准。
  const { effectiveRosterRows } = await import('../editor/preset-backend/index.mjs')
  const rosterRoot = join(dir, 'roster-root')
  const assistant = join(rosterRoot, 'renamed')
  mkdirSync(assistant, { recursive: true })
  writeFileSync(join(assistant, 'prompt.md'), 'x\n', 'utf8')
  writeFileSync(join(assistant, 'prompt-reader.mjs'), '// reader\n', 'utf8')
  writeFileSync(join(assistant, 'preset.yml'), 'name: 写作助手\ndescription: 磁盘上的新描述\n', 'utf8')
  const rows = effectiveRosterRows(
    [{ id: 'renamed', name: '旧名字', description: '旧描述', broken: 'mount failed' }],
    { root: rosterRoot, backendId: 'declarative' },
  )
  check('磁盘上的 name 优先于注册表副本', rows[0].name === '写作助手', JSON.stringify(rows[0]))
  check('磁盘上的 description 优先', rows[0].description === '磁盘上的新描述', JSON.stringify(rows[0].description))
  check('注册表独有的 broken 仍然合并进来', rows[0].broken === 'mount failed', JSON.stringify(rows[0].broken))
  check('合成行带 trust/path（下游依赖）', rows[0].trust === 'user' && typeof rows[0].path === 'string')
}

console.log()
console.log('=== 4. 降级：读得到提示词、存得下提示词、开关被明确拒绝 ===')
{
  // 组装一个「本工具管理」的助手目录：判据是 prompt.md + prompt-reader.mjs。
  const userRoot = join(dir, 'agent-presets')
  const presetDir = join(userRoot, 'custom')
  mkdirSync(presetDir, { recursive: true })
  writeFileSync(join(presetDir, 'prompt-reader.mjs'), '// fixture reader\n', 'utf8')
  writeFileSync(join(presetDir, 'prompt.md'), '原始提示词\n', 'utf8')
  writeFileSync(join(presetDir, 'preset.yml'), 'name: 测试助手\n', 'utf8')
  const compositionPath = join(presetDir, 'agent.cordis.yml')
  const compositionText = ['# 基础模式: standard', '', '- id: persona', "  name: './prompt-reader.mjs'", '  config:', '    complete: false', ''].join('\n')
  writeFileSync(compositionPath, compositionText, 'utf8')

  process.env.DSH_CUSTOM_PROMPT_PATH = join(presetDir, 'prompt.md')
  const { readState, saveState, createAssistant } = await import('../editor/index.mjs')
  const rows = [{ id: 'custom', trust: 'user', path: compositionPath, name: '测试助手', description: '' }]

  // 4a. 没有任何来源 → 状态仍可用，只是开关/基础模式降级
  resetBaseCompositionCachesForTests()
  setBaseCompositions(null)
  process.env.DSH_PRESET_PATCH_DIR = join(dir, 'empty')
  const state = readState(rows, 'custom', {})
  check('读状态不抛异常', state.ok === true, JSON.stringify(state).slice(0, 200))
  check('提示词仍然读到', state.prompt === '原始提示词\n', JSON.stringify(state.prompt))
  // 降级不影响"磁盘上现在有什么行"这件事：状态照实报出，页面据此不渲染开关（服务端也会拒绝改开关）。
  // 曾经想过返回 []，但那等于对 API 调用方说谎 —— 拒绝要发生在写入那一侧，而不是在读取这一侧。
  check('行仍按磁盘状态报出（降级只影响可编辑性）', Array.isArray(state.rows) && state.rows.length > 0, JSON.stringify(state.rows?.length))
  check('带 baseUnavailable 标记', state.baseUnavailable !== null && state.baseUnavailable !== undefined && state.baseUnavailable.code === 'baseCompositionUnavailable')
  check('告警里点名了它', Array.isArray(state.warnings) && state.warnings.includes('baseCompositionUnavailable'), JSON.stringify(state.warnings))

  // 4b. 只存提示词 → 成功，组成文件一字不动
  const saved = saveState(rows, { id: 'custom', mode: 'standard', overrides: {}, prompt: '改过的提示词\n', name: '测试助手', description: '' })
  check('降级保存成功', saved.ok === true, JSON.stringify(saved))
  check('降级保存的 code 是 savedPromptOnly', saved.code === 'savedPromptOnly', String(saved.code))
  check('提示词已落盘', readFileSync(join(presetDir, 'prompt.md'), 'utf8') === '改过的提示词\n')
  check('组成文件未被触碰', readFileSync(compositionPath, 'utf8') === compositionText)

  // 4c. 还想改开关 → 明确拒绝，不静默丢弃
  const refused = saveState(rows, { id: 'custom', mode: 'standard', overrides: { 'tool-web': false }, prompt: '又改了\n', name: '测试助手', description: '' })
  check('带开关的保存在降级态被拒绝', refused.ok === false && refused.code === 'baseCompositionUnavailable', JSON.stringify(refused).slice(0, 200))
  check('被拒时提示词没有被写', readFileSync(join(presetDir, 'prompt.md'), 'utf8') === '改过的提示词\n')

  // 4d. 新建助手也给出类型化错误
  const created = createAssistant(rows, { name: '新助手' })
  check('降级态新建助手是类型化失败', created.ok === false && created.code === 'baseCompositionUnavailable', JSON.stringify(created).slice(0, 200))

  // 4e. 一旦组成可解析，同一套函数恢复正常（证明降级不是把功能改没了）
  setBaseCompositions(new Map([['standard', LEGACY_STANDARD]]))
  const restored = readState(rows, 'custom', {})
  check('恢复后行列表非空', Array.isArray(restored.rows) && restored.rows.length > 0, JSON.stringify(restored.rows?.length))
  check('恢复后没有降级标记', restored.baseUnavailable === undefined || restored.baseUnavailable === null)
  check('恢复后告警里没有它', Array.isArray(restored.warnings) && restored.warnings.includes('baseCompositionUnavailable') === false)
  const rendered = renderComposition('standard', new Map(), { modeName: '测试助手', assistantId: 'custom' })
  check('恢复后能渲染组成', rendered.includes('- id: persona') && rendered.includes('custom-prompt-tool'))
  check('overridesOf 能在宿主文本上工作', typeof overridesOf(rendered, 'standard') === 'object')

  delete process.env.DSH_PRESET_PATCH_DIR
  resetBaseCompositionCachesForTests()
}

rmSync(dir, { recursive: true, force: true })
console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
