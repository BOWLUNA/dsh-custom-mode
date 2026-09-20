/**
 * Assistant-registry tests — the multi-mode core.
 *
 * Run: node test/assistants.test.mjs
 *
 * Why this exists: this is the module that decides WHICH preset directories the
 * settings page is allowed to rewrite, and which id a new assistant gets. Both
 * answers are destructive if wrong:
 *
 *   - claim a hand-authored preset and the page regenerates its composition from a
 *     base mode, destroying it;
 *   - re-seed `custom` on every activation and an assistant the user deleted comes
 *     back on the next restart.
 *
 * The module is pure filesystem logic, so it needs neither dsh nor a running
 * harness — every case below builds its own tree under a temp directory.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))
const TEMPLATE = join(REPO, 'editor', 'preset')

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

const { readPresetMeta } = await import('../editor/meta.mjs')
const {
  allocateId,
  assistantDir,
  assistantsFromRoster,
  createAssistantDir,
  isManagedDir,
  reorderAssistant,
  scanManagedDirs,
  seedMarkerPath,
  seedOnActivation,
  userPresetRoot,
} = await import('../editor/assistants.mjs')
const { unresolvableRows } = await import('../editor/composition.mjs')

const dir = mkdtempSync(join(tmpdir(), 'dsh-custom-assistants-'))
const root = join(dir, 'agent-presets')

/** Build one preset directory; `files` names the files to create. */
function makePreset(id, files, composition = '') {
  const directory = join(root, id)
  mkdirSync(directory, { recursive: true })
  for (const name of files) writeFileSync(join(directory, name), name === 'agent.cordis.yml' ? composition : `# ${name}\n`, 'utf8')
  return directory
}

console.log()
console.log('=== 1. 什么算「本工具拥有的模式」 ===')
{
  const plain = makePreset('hand-made', ['agent.cordis.yml', 'preset.yml'], "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n")
  check('只有 prompt.md 不算（手写模式不能被改写）', isManagedDir(makePreset('half', ['prompt.md'])) === false)
  check('什么都没有不算', isManagedDir(plain) === false)
  check('prompt.md + prompt-reader.mjs 算', isManagedDir(makePreset('mine', ['prompt.md', 'prompt-reader.mjs'])) === true)
  check(
    'reader 被误删但组成文件仍引用它 → 仍算（这样才能被补全）',
    isManagedDir(makePreset('broken', ['prompt.md', 'agent.cordis.yml'], "  name: './prompt-reader.mjs'\n")) === true,
  )
  check(
    '组成文件引用别的 reader → 不算',
    isManagedDir(makePreset('other', ['prompt.md', 'agent.cordis.yml'], "  name: './my-own-reader.mjs'\n")) === false,
  )
  check('不存在的目录不算', isManagedDir(join(root, 'nope')) === false)
}

console.log()
console.log('=== 2. scanManagedDirs：只认本工具的模式 ===')
{
  const found = scanManagedDirs(root)
  check('只列出 2 个（mine 与 broken；half/other/hand-made 都不算）', found.length === 2, JSON.stringify(found.map((item) => item.split('/').pop())))
  check('按目录名排序', JSON.stringify(found) === JSON.stringify([...found].sort()))
  check('不含手写模式', !found.some((item) => item.endsWith('/hand-made')))
  check('根目录不存在时返回空数组而不是抛错', scanManagedDirs(join(dir, 'missing')) .length === 0)
}

console.log()
console.log('=== 3. 从 roster 解析用户根目录 ===')
{
  const rows = [
    { id: 'standard', trust: 'system', path: '/usr/lib/presets/standard/agent.cordis.yml' },
    { id: 'mine', trust: 'user', path: join(root, 'mine', 'agent.cordis.yml') },
  ]
  check('取用户行的祖父目录', userPresetRoot(rows) === root, userPresetRoot(rows))
  check('没有用户行时回落到自定义默认', userPresetRoot([], '/fallback/root') === '/fallback/root', userPresetRoot([], '/fallback/root'))
  check('roster 不是数组也不崩', typeof userPresetRoot(undefined, '/fallback/root') === 'string')
}

console.log()
console.log('=== 4. assistantsFromRoster / assistantDir ===')
{
  const rows = [
    { id: 'standard', trust: 'system', path: '/usr/lib/presets/standard/agent.cordis.yml' },
    { id: 'mine', trust: 'user', path: join(root, 'mine', 'agent.cordis.yml'), name: '我的助手' },
    { id: 'hand-made', trust: 'user', path: join(root, 'hand-made', 'agent.cordis.yml'), name: '手写' },
    { id: 'ghost', trust: 'user', path: join(root, 'ghost', 'agent.cordis.yml') },
  ]
  const assistants = assistantsFromRoster(rows)
  check('只列出本工具管理的用户模式', assistants.length === 1 && assistants[0].id === 'mine', JSON.stringify(assistants))
  check('带上显示名', assistants[0].name === '我的助手')
  check('出厂模式永远不在列表里', !assistants.some((item) => item.id === 'standard'))
  check('assistantDir 解析出目录', assistantDir(rows, 'mine') === join(root, 'mine'))
  check('assistantDir 拒绝出厂模式', assistantDir(rows, 'standard') === undefined)
  check('assistantDir 拒绝手写模式', assistantDir(rows, 'hand-made') === undefined)
  check('assistantDir 拒绝未知 id', assistantDir(rows, 'nope') === undefined)
  check('assistantDir 拒绝空 id', assistantDir(rows, '') === undefined)
}

console.log()
console.log('=== 5. allocateId：命名规则 ===')
{
  check('英文名直接当 id', allocateId('Writer', new Set()) === 'writer')
  check('重名时加序号', allocateId('Writer', new Set(['writer'])) === 'writer-2')
  check('连续重名继续加序号', allocateId('Writer', new Set(['writer', 'writer-2'])) === 'writer-3')
  check('中文名回落到 custom', allocateId('写作助手', new Set()) === 'custom')
  check('custom 被占用就用 custom-2', allocateId('写作助手', new Set(['custom'])) === 'custom-2')
  check('标点被压成连字符', allocateId('my writer!', new Set()) === 'my-writer')
  check('不能与出厂 id 冲突', allocateId('Standard', new Set(['standard'])) === 'standard-2')
  check('空名字也能拿到 id', allocateId('', new Set()) === 'custom')
  check('id 全部满足预设 id 规则', ['Writer', '写作助手', 'my writer!', 'A B C'].every((name) => /^[a-z0-9][a-z0-9-]*$/.test(allocateId(name, new Set(['custom'])))))
}

console.log()
console.log('=== 6. createAssistantDir：从模板建目录 ===')
{
  rmSync(root, { recursive: true, force: true })
  const created = createAssistantDir({ root, id: 'writer', composition: '# composition\n', templateDir: TEMPLATE })
  check('返回成功', created.ok === true, JSON.stringify(created))
  check('目录建立', existsSync(join(root, 'writer')))
  for (const name of ['agent.cordis.yml', 'prompt.md', 'prompt-reader.mjs', 'prompt-tool.mjs', 'preset.yml']) {
    check(`模板文件 ${name} 就位`, existsSync(join(root, 'writer', name)))
  }
  check('组成文件是传入的那份', readFileSync(join(root, 'writer', 'agent.cordis.yml'), 'utf8') === '# composition\n')
  check('新目录立刻被识别为本工具的模式', isManagedDir(join(root, 'writer')) === true)

  const again = createAssistantDir({ root, id: 'writer', composition: '# x\n', templateDir: TEMPLATE })
  check('同名目录已存在 → 拒绝（不覆盖）', again.ok === false && /已存在/.test(again.error), JSON.stringify(again))

  const bad = createAssistantDir({ root, id: '../escape', composition: '# x\n', templateDir: TEMPLATE })
  check('越界的 id → 拒绝', bad.ok === false && /不合法/.test(bad.error), JSON.stringify(bad))
  check('越界 id 没有在根目录外建东西', !existsSync(join(dir, 'escape')))
}

console.log()
console.log('=== 7. seedOnActivation：首次播种 / 收养 / 不复活 ===')
{
  rmSync(root, { recursive: true, force: true })
  const logs = []
  const infos = []

  const first = seedOnActivation({ root, templateDir: TEMPLATE, log: (m) => logs.push(m), info: (m) => infos.push(m) })
  check('首次运行创建了 custom', first.created === true && existsSync(join(root, 'custom')))
  check('首次运行不是收养', first.adopted === false)
  check('写了播种标记', existsSync(seedMarkerPath(root)))
  check('标记是文件不是目录（discovery 会跳过）', !scanManagedDirs(root).includes(seedMarkerPath(root)))

  const quiet = { logs: logs.length, infos: infos.length }
  const second = seedOnActivation({ root, templateDir: TEMPLATE, log: (m) => logs.push(m), info: (m) => infos.push(m) })
  check('第二次不重复创建', second.created === false)
  // "第二次完全安静"原本要求一条日志都没有 —— 但 1.9.3 之后，激活时若组成文件里有**本线解析不到的行**
  // 会主动喊一声（这是有意的功能，而且稳定线上真会触发）。所以这里改成：**除了那条按需告警，不该有别的日志**，
  // 并用同一判据自证"有则喊、没有则沉默" —— 预览线与稳定线都能过。
  const newLogs = logs.slice(quiet.logs)
  const warns = newLogs.filter((m) => m.includes('无法解析'))
  const others = newLogs.filter((m) => !m.includes('无法解析'))
  check('第二次不再有其它日志', others.length === 0 && infos.length === quiet.infos,
    JSON.stringify({ others, infos: infos.slice(quiet.infos) }))
  const expectedWarn = unresolvableRows(readFileSync(join(root, 'custom', 'agent.cordis.yml'), 'utf8')).length > 0
  check('「本线无法解析」告警按需出现（有则喊、没有则沉默）', (warns.length > 0) === expectedWarn,
    JSON.stringify({ warns, expectedWarn }))

  // 用户删掉唯一一个助手：重启不能把它变回来。
  rmSync(join(root, 'custom'), { recursive: true, force: true })
  const third = seedOnActivation({ root, templateDir: TEMPLATE, log: (m) => logs.push(m), info: (m) => infos.push(m) })
  check('删光之后不会被复活', third.created === false && !existsSync(join(root, 'custom')))

  // 老装机（有 custom，没有标记）要被静默收养，而不是重建。
  rmSync(seedMarkerPath(root), { force: true })
  mkdirSync(join(root, 'custom'), { recursive: true })
  for (const name of ['agent.cordis.yml', 'prompt.md', 'prompt-reader.mjs', 'prompt-tool.mjs', 'preset.yml']) {
    writeFileSync(join(root, 'custom', name), name === 'prompt.md' ? 'USER PROMPT\n' : `# ${name}\n`, 'utf8')
  }
  const fourth = seedOnActivation({ root, templateDir: TEMPLATE, log: (m) => logs.push(m), info: (m) => infos.push(m) })
  check('已有助手时是收养', fourth.adopted === true && fourth.created === false)
  check('收养不会覆盖用户提示词', readFileSync(join(root, 'custom', 'prompt.md'), 'utf8') === 'USER PROMPT\n')
  check('收养后标记落地', existsSync(seedMarkerPath(root)))
}

console.log()
console.log('=== 8. seedOnActivation：补全缺失的模板文件 ===')
{
  rmSync(join(root, 'custom', 'prompt-tool.mjs'), { force: true })
  const logs = []
  const infos = []
  const result = seedOnActivation({ root, templateDir: TEMPLATE, log: (m) => logs.push(m), info: (m) => infos.push(m) })
  check('补回了缺失的模块', existsSync(join(root, 'custom', 'prompt-tool.mjs')))
  check('记下了补全了哪个目录', result.repaired === 1, JSON.stringify(result))
  check('补全时说明了做了什么', infos.some((line) => line.includes('补全')), JSON.stringify(infos))
  check('用户的提示词仍然没被动', readFileSync(join(root, 'custom', 'prompt.md'), 'utf8') === 'USER PROMPT\n')
}

console.log()
console.log('=== 9. reorderAssistant：顺序写进 preset.yml 的 order ===')
{
  rmSync(root, { recursive: true, force: true })
  const managed = ['a-first', 'b-second', 'c-third']
  for (const id of managed) {
    makePreset(id, ['agent.cordis.yml', 'prompt.md', 'prompt-reader.mjs', 'preset.yml'], "  name: './prompt-reader.mjs'\n")
    writeFileSync(join(root, id, 'preset.yml'), `name: "${id}"\n`, 'utf8')
  }
  // 手写的 preset：既不该出现在列表里，也不该被写上 order。
  makePreset('hand-made', ['agent.cordis.yml', 'preset.yml'], "- id: persona\n  name: '@deepseek-ai/dsh-persona'\n")

  /** 镜像 discovery：按 (order ?? Infinity, id) 排序。 */
  const roster = () =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(entry.name))
      .map((entry) => {
        const directory = join(root, entry.name)
        return { id: entry.name, trust: 'user', path: join(directory, 'agent.cordis.yml'), ...readPresetMeta(directory) }
      })
      .sort((left, right) => ((left.order ?? Infinity) - (right.order ?? Infinity)) || left.id.localeCompare(right.id))
  const ids = () => assistantsFromRoster(roster()).map((item) => item.id)

  check('初始顺序按 id', JSON.stringify(ids()) === JSON.stringify(managed), JSON.stringify(ids()))

  const up = reorderAssistant(roster(), { id: 'b-second', direction: 'up' })
  check('上移成功', up.ok === true, JSON.stringify(up))
  check('顺序变成 b,a,c', JSON.stringify(ids()) === JSON.stringify(['b-second', 'a-first', 'c-third']), JSON.stringify(ids()))
  check('三个都写了 1..N 的 order', JSON.stringify(managed.map((id) => readPresetMeta(join(root, id)).order)) === JSON.stringify([2, 1, 3]), JSON.stringify(managed.map((id) => readPresetMeta(join(root, id)).order)))
  check('手写 preset 没有被写上 order', readPresetMeta(join(root, 'hand-made')).order === undefined, String(readPresetMeta(join(root, 'hand-made')).order))

  check('最前面再上移 → 拒绝', reorderAssistant(roster(), { id: 'b-second', direction: 'up' }).ok === false)
  check('最后面再下移 → 拒绝', reorderAssistant(roster(), { id: 'c-third', direction: 'down' }).ok === false)
  check('未知方向 → 拒绝', reorderAssistant(roster(), { id: 'a-first', direction: 'sideways' }).ok === false)
  check('不存在的 id → 拒绝', reorderAssistant(roster(), { id: 'nope', direction: 'up' }).ok === false)
  check('被拒时不改动磁盘', readPresetMeta(join(root, 'b-second')).order === 1, String(readPresetMeta(join(root, 'b-second')).order))

  const down = reorderAssistant(roster(), { id: 'b-second', direction: 'down' })
  check('下移成功并落盘', down.ok === true && readPresetMeta(join(root, 'b-second')).order === 2, JSON.stringify({ ok: down.ok, order: readPresetMeta(join(root, 'b-second')).order }))
  check('最终顺序回到 a,b,c', JSON.stringify(ids()) === JSON.stringify(managed), JSON.stringify(ids()))
}

rmSync(dir, { recursive: true, force: true })

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
process.exit(failed === 0 ? 0 : 1)
