/**
 * The README / storefront screenshot set — English, fresh instance, `<= 800x800` each.
 *
 * Run:  CDP_PORT=9222 node tools/screenshots/shoot-fresh.mjs "<token URL>" <outdir>
 *
 * Why a separate script from `run-shots.sh` / `run-shots-en.mjs`: those drive a *lab* instance and
 * deliberately switch theme and language, so their images carry whatever state that instance had. This
 * one is for the **public** images, and it pins everything the reader would otherwise wonder about:
 *
 *   - a **fresh English** profile (`DSH_HOME` with no sessions and no user data), so nothing on screen is
 *     somebody's private state;
 *   - **one canvas size**: every page shot is the settings dialog itself, cropped by
 *     {@link Session.screenshotElement}, so 01/02/03 come out 800x800 and line up in the README table.
 *     GitHub renders a 1440x900 shot as a wall of mostly-empty shell — that is what "too big" looks like;
 *   - generated content is **English** (the seeded assistant is renamed, and a second one is created) so
 *     the images match the README they illustrate;
 *   - no absolute paths from the shooting machine end up in the frame (`bottomInset`).
 *
 * Output (five canonical names + the four storefront copies the catalogue reads):
 *
 *   01-mode-switch.png        800x800  settings dialog: mode name + base mode
 *   02-plugin-switches.png    800x800  settings dialog: plugin rows, tri-state badges
 *   03-system-prompt.png      800x800  settings dialog: prompt editor + change history
 *   04-preset-picker.png      <=800    new-session mode picker with the custom modes listed
 *   05-assistant-manager.png  <=800    the assistant section, dropdown open, two assistants
 *
 * plus `storefront-0{1..4}-*.png` (the same four views under the names `editor/screenshots.json`
 * declares for the plugin directory).
 */

import { mkdirSync, copyFileSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { connect } from './cdp.mjs'

const [url, out] = process.argv.slice(2)
if (url === undefined || out === undefined) {
  console.error('用法: CDP_PORT=9222 node tools/screenshots/shoot-fresh.mjs "<token URL>" <输出目录>')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const session = await connect()
await session.newPage()
await session.setViewport(1440, 900, 1)
await session.goto(url, { waitMs: 6000 })

// 首启弹窗（英文实例）
for (const label of ['Got it', 'Configure later', 'Skip', 'Continue', 'Close', 'Dismiss']) {
  try { await session.clickTextReal(label, { exact: false }) } catch { /* 没有就继续 */ }
}
await session.sleep(1200)

// ── 演示状态：英文名字与描述，外加第二个助手（README 讲的是"多助手"）─────────────────
const seeded = await session.evaluate(`(async () => {
  const list = await fetch('/api/custom-mode', { headers: { accept: 'application/json' } }).then((r) => r.json())
  const first = list.assistants[0]
  const state = await fetch('/api/custom-mode/state?id=' + encodeURIComponent(first.id), { headers: { accept: 'application/json' } }).then((r) => r.json())
  const saved = await fetch('/api/custom-mode/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: first.id,
      mode: state.mode,
      overrides: {},
      prompt: state.prompt,
      name: 'Custom mode',
      description: 'Your own system prompt, base mode and plugin switches — edit them here; the next model step uses them.',
    }),
  }).then((r) => r.json())
  // 幂等：脚本会被反复跑，第二次起不要再造一个 "Writing helper 2"。
  const existing = list.assistants.some((item) => (item.name || '') === 'Writing helper')
  const created = existing
    ? { code: 'existed' }
    : await fetch('/api/custom-mode/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Writing helper' }),
      }).then((r) => r.json())
  return { renamed: saved.code, created: created.code ?? created.error, assistants: list.assistants.length }
})()`)
console.log('演示状态:', JSON.stringify(seeded))

await session.goto(url, { waitMs: 5000 })
await session.sleep(800)

/**
 * 先清掉首启浮层。
 *
 * ★ 这一步是**必需**的，而且必须用真实指针：全新 home 上会弹 "Add an API key to get started"
 * （按钮是 Configure later / Save and continue），它也是一个 `[role=dialog]` —— 不点掉它，
 * 后面"有 dialog 就以为设置已打开"的判据会被**永久**骗过，症状是"设置面板里只有 API key 一项"。
 * 实测踩过：整轮拍摄都在对着那个弹窗找侧栏。
 */
const clearOverlays = async () => {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const target = await session.evaluate(`(() => {
      const modal = [...document.querySelectorAll('[role=dialog]')]
        .find((d) => /API key|Get started|Configure later/i.test(d.innerText || '') && d.getBoundingClientRect().width > 0)
      if (modal === undefined) return null
      const button = [...modal.querySelectorAll('button')]
        .find((b) => /Configure later|Got it|Skip|Close|Dismiss/i.test(b.innerText || ''))
      if (button === undefined) return null
      const r = button.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })()`)
    if (target === null) return true
    await session.clickAt(target.x, target.y)
    await session.sleep(1200)
  }
  return false
}

/** 设置面板是否真的开着：含 General 导航项，或已经渲染出我们那一页。 */
const settingsOpen = () =>
  session.evaluate(`(() => {
    if (document.querySelector('.cpfe') !== null) return true
    const dialog = [...document.querySelectorAll('[role=dialog]')]
      .find((d) => (d.innerText || '').includes('General') && d.getBoundingClientRect().width > 0)
    return dialog !== undefined
  })()`)

/**
 * 打开设置面板。
 *
 * 两条实测教训：① 侧栏那一项要**真实指针**点击（这个壳有意忽略合成 `click()` 的控件不止一个），
 * 坐标 (140, 869) 是 1440x900 下它的位置；② 判据必须是**设置面板**而不是"任意 dialog" ——
 * 首启的 API-key 弹窗也是 dialog。
 */
const openSettings = async () => {
  await clearOverlays()
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if ((await settingsOpen()) === true) return true
    try {
      await session.clickTextReal('Settings', { exact: true })
    } catch {
      await session.clickAt(140, 869)
    }
    await session.sleep(1600)
  }
  return (await settingsOpen()) === true
}
if ((await openSettings()) !== true) {
  console.error('打不开设置面板')
  process.exit(2)
}
await session.sleep(1200)
// 侧栏项要**等它出现**：干净实例首屏先渲染 "Choose workspace"，设置面板与侧栏晚一步才出来
// （实测：不重试就会偶发 "no-nav"）。
let opened = 'no-nav'
for (let attempt = 0; attempt < 8 && opened !== 'ok'; attempt += 1) {
  opened = await session.evaluate(`(() => {
    if (document.querySelector('.cpfe') !== null) return 'ok'
    // 侧栏项的类名不是稳定的接口（实测：干净英文实例上 navCell 选择器命中空数组）。
    // 按**可见文本**找，取最深的那个，并补一次父级点击。
    const cells = [...document.querySelectorAll('button,[role=button],span,div,a')]
      .filter((x) => (x.innerText || '').trim() === 'Custom mode' && x.getBoundingClientRect().width > 0)
    if (cells.length === 0) return 'no-nav'
    const cell = cells[cells.length - 1]
    cell.click()
    if (cell.parentElement !== null) cell.parentElement.click()
    return 'clicked'
  })()`)
  await session.sleep(1500)
  if (opened === 'clicked') await session.sleep(1200)
}
if ((await session.evaluate('document.querySelector(".cpfe") !== null')) !== true) {
  const nav = await session.evaluate(`[...document.querySelectorAll('[class*=navCell]')].map((x) => (x.innerText || '').trim()).slice(0, 8)`)
  console.error('打不开「Custom mode」设置页 —— 侧栏项:', JSON.stringify(nav))
  process.exit(2)
}
await session.sleep(1500)

/** 设置面板自己的滚动容器（内容是它，不是 .cpfe）。 */
const scrollTo = async (px) => {
  const value = await session.evaluate(`(() => {
    const panel = document.querySelector('.cpfe')
    if (panel === null) return null
    const box = [...document.querySelectorAll('[class*=options]')].find((e) => e.contains(panel))
    if (box === undefined) return null
    box.scrollTop = ${px}
    return box.scrollTop
  })()`)
  await session.sleep(650)
  return value
}
const escape = async () => {
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await session.sleep(400)
}

const report = []
const shoot = async (name, fn) => {
  const file = join(out, name)
  await fn(file)
  const { width, height } = pngSize(file)
  report.push({ name, width, height, kb: Math.round(statSync(file).size / 1024) })
  console.log(`  ${name}  ${width}x${height}  ${Math.round(statSync(file).size / 1024)} KB`)
}

// ── 01 / 02 / 03：设置面板的**可见区域**（800x800 @1440x900 实测位置）──
//
// ★ 不能用 screenshotElement('.cpfe')：那截的是整个**滚动列**（实测 559x3859），
//   远超出 800x800 的上限，README 里会变成一条细高的长图。
const PANEL = { x: 320, y: 100, width: 800, height: 800 }
await scrollTo(300)
await shoot('01-mode-switch.png', (file) => session.screenshotBox(file, PANEL))

await scrollTo(1150)
await shoot('02-plugin-switches.png', (file) => session.screenshotBox(file, PANEL))

await scrollTo(2760)
await shoot('03-system-prompt.png', (file) => session.screenshotBox(file, { ...PANEL, height: 774 }))

// ── 05：助手区块（下拉打开，两个助手）─────────────────────────────────
await scrollTo(0)
await session.evaluate(`(() => { const a = document.querySelector('.cpfe-picker button'); if (a) a.click(); return true })()`)
await session.sleep(900)
await shoot('05-assistant-manager.png', (file) =>
  session.screenshotBox(file, { x: 320, y: 100, width: 800, height: 360 }),
)
await escape()

// ── 04：新会话的模式选择器（含自定义模式的浮层）───────────────────────
//
// ★ 先关掉设置面板。模式选择器在**首屏**上：面板还开着时，程序化点击会把浮层开在面板**上面**，
//   拍出来是"弹层叠着设置页"，既看不懂也不是产品真实的样子（实测踩过一次）。
for (let attempt = 0; attempt < 4; attempt += 1) {
  if ((await session.evaluate("document.querySelector('.cpfe') === null")) === true) break
  await session.pressEscape()
  await session.sleep(700)
}
if ((await session.evaluate("document.querySelector('.cpfe') === null")) !== true) {
  console.error('设置面板没关掉，模式选择器会在面板上打不开')
  process.exit(2)
}
await session.sleep(800)
await session.evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find((x) => /mode/i.test(x.innerText || ''))
  if (button !== undefined) button.click()
  return true
})()`)
await session.sleep(1200)
const popup = await session.evaluate(`(() => {
  const item = document.querySelector('[role=menuitem]')
  if (item === null) return null
  const list = item.closest('[role=menu]') ?? item.parentElement
  const rect = list.getBoundingClientRect()
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
})()`)
if (popup === null) {
  console.error('模式选择器没打开 —— 04/选择器图会有问题')
  process.exit(2)
}
await shoot('04-preset-picker.png', (file) =>
  session.screenshotBox(file, {
    x: Math.max(0, popup.x - 96),
    y: Math.max(0, popup.y - 96),
    width: Math.min(800, 1440 - Math.max(0, popup.x - 96)),
    height: Math.min(800, popup.height + 120),
  }),
)
await session.close()

// ── 商店用的一组（editor/screenshots.json 声明的名字）─────────────────
const STOREFRONT = [
  ['01-mode-switch.png', 'storefront-01-assistant-manager.png'],
  ['02-plugin-switches.png', 'storefront-02-plugin-switches.png'],
  ['03-system-prompt.png', 'storefront-03-system-prompt.png'],
  ['04-preset-picker.png', 'storefront-04-mode-picker.png'],
]
for (const [from, to] of STOREFRONT) copyFileSync(join(out, from), join(out, to))
console.log('商店副本:', STOREFRONT.map((pair) => pair[1]).join(', '))
console.log(JSON.stringify(report, null, 1))

/** PNG 的宽高就在 IHDR 里（前 24 字节），不必装图像库。 */
function pngSize(file) {
  const head = readFileSync(file).subarray(16, 24)
  return { width: head.readUInt32BE(0), height: head.readUInt32BE(4) }
}
