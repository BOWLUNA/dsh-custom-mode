/**
 * Record the promo footage from a real instance, through CDP.
 *
 * Why a separate minimal client instead of `tools/screenshots/cdp.mjs`: screencast needs **event handlers**
 * (`Page.screencastFrame` + an ack per frame), and this file also has to drive smooth pointer motion for the
 * "hero shots". It is deliberately self-contained — WebSocket + id-keyed promises + an event map, nothing else.
 *
 * Usage:
 *   CDP_PORT=9222 node tools/media/record.mjs --scene picker --url "http://127.0.0.1:3119/?token=…" --out /tmp/frames-picker
 *
 * Scenes: `picker` · `rows` · `reload`
 * Frames land as `<out>/00001.jpg`, one per compositor frame — encode with:
 *   ffmpeg -framerate 60 -i <out>/%05d.jpg -c:v libx264 -pix_fmt yuv420p out.mp4
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const i = argv.indexOf(name)
  return i === -1 || argv[i + 1] === undefined ? fallback : argv[i + 1]
}
const scene = arg('--scene', 'picker')
const url = arg('--url', '')
const out = arg('--out', `/tmp/frames-${scene}`)
const home = arg('--home', process.env.DSH_HOME ?? '')
const PORT = process.env.CDP_PORT ?? '9222'
if (url === '') {
  console.error('用法: node tools/media/record.mjs --scene <picker|rows|reload> --url <token URL> [--out 目录]')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

// ── minimal CDP client ─────────────────────────────────────────────────────────────────────────────
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
const page = list.find((t) => t.type === 'page')
if (page === undefined) {
  console.error('CDP 里没有 page 目标')
  process.exit(2)
}
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})
let nextId = 1
const pending = new Map()
const listeners = new Map()
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data)
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) reject(new Error(`${msg.method ?? 'cdp'}: ${msg.error.message}`))
    else resolve(msg.result)
    return
  }
  for (const cb of listeners.get(msg.method) ?? []) cb(msg.params)
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const on = (method, cb) => {
  const list_ = listeners.get(method) ?? []
  list_.push(cb)
  listeners.set(method, list_)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.value
}

// ── pointer motion ─────────────────────────────────────────────────────────────────────────────────
const moveTo = async (x, y, steps = 24) => {
  const from = await evaluate('window.__mediaPointer ?? { x: 0, y: 0 }')
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    const ease = t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t) // ease-in-out: 更像人手的加减速
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + (x - from.x) * ease),
      y: Math.round(from.y + (y - from.y) * ease),
    })
    await sleep(10)
  }
  await evaluate(`window.__mediaPointer = { x: ${String(x)}, y: ${String(y)} }`)
}
const clickAt = async (x, y) => {
  await moveTo(x, y)
  await sleep(120)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await sleep(60)
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(150)
}
const center = async (expression) => {
  const box = await evaluate(`(() => { const el = ${expression}; if (el === null || el === undefined) return null;
    const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) } })()`)
  return box
}
// 按"节点自身的文本"定位（取最深的那个）：只按 textContent 找会命中外层容器，
// 点过去落在容器中心 —— 引导层的按钮就是这么被点偏的。
const clickText = async (pattern) => {
  const box = await center(
    `[...document.querySelectorAll('button,[role=button],a,div,span')].filter((e) => {
      const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim()
      const t = own !== '' ? own : (e.children.length === 0 ? (e.textContent || '').trim() : '')
      const r = e.getBoundingClientRect()
      return new RegExp(${JSON.stringify(pattern)}).test(t) && r.width > 10 && r.height > 8
    }).pop()`,
  )
  if (box === null) return false
  await clickAt(box.x, box.y)
  return true
}
const dismissGates = async () => {
  for (let round = 0; round < 4; round += 1) {
    let hit = false
    for (const label of ['Configure later', 'Continue', 'Got it', 'Close', 'Skip']) {
      if (await clickText(`^${label}$`)) {
        hit = true
        break
      }
    }
    if (!hit) break
    await sleep(800)
  }
}

// ── screencast ─────────────────────────────────────────────────────────────────────────────────────
let frame = 0
await send('Page.enable')
await send('Runtime.enable')
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url })
await sleep(7000)
await dismissGates()
await sleep(600)
const gateGone = await evaluate(`!document.body.innerText.includes('Add an API key')`)
// CDP 的 screencast 是"有 damage 才出帧" —— 静态页面只给一两帧（实测过）。录制要固定节奏，
// 所以改成轮询抓帧：每次 captureScreenshot ≈ 40–80ms，实际约 15–20fps，编码时统一到 24fps。
const FPS = Number(process.env.RECORD_FPS ?? 20)
// 截图类场景（shots / control）不抓帧：它们只要状态 PNG，抓帧只会污染输出目录。
const RECORD_FRAMES = !['shots', 'control', 'states2'].includes(scene)
let capturing = RECORD_FRAMES
const captureLoop = (async () => {
  if (RECORD_FRAMES !== true) return
  const gap = Math.round(1000 / FPS)
  while (capturing) {
    const started = Date.now()
    try {
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 90 })
      frame += 1
      writeFileSync(join(out, `${String(frame).padStart(5, '0')}.jpg`), Buffer.from(shot.data, 'base64'))
    } catch {
      /* 抓帧失败就跳过这一帧 */
    }
    const spent = Date.now() - started
    if (spent < gap) await sleep(gap - spent)
  }
})()
console.log(`  录制开始（场景 ${scene}，目标 ${FPS}fps）· 引导层已关=${String(gateGone)}`)




if (scene === 'states2') {
  const shot = async (name) => {
    const png = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(out, `${name}.png`), Buffer.from(png.data, 'base64'))
    console.log(`  ✓ ${name}.png`)
  }
  await clickText('^(Settings|设置)$'); await sleep(1300)
  const nav = await center(`[...document.querySelectorAll('[role=dialog] button,[role=dialog] [role=button],[role=dialog] div,[role=dialog] span')].filter((e) => { const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect(); return (t==='Custom mode'||t==='自定义模式') && r.width>20 && r.height>8 && r.height<60 }).pop()`)
  if (nav !== null) { await clickAt(nav.x, nav.y); await sleep(1800) }
  // 基础模式三种
  for (const [label, tag] of [['PTC', 'ptc'], ['Minimal', 'minimal'], ['Cordis', 'cordis']]) {
    const chip = await center(`[...document.querySelectorAll('.cpfe *')].find((e) => (e.textContent||'').trim() === ${JSON.stringify(label)} && e.children.length === 0 && e.getBoundingClientRect().height > 8)`)
    if (chip !== null) { await clickAt(chip.x, chip.y); await sleep(1200); await shot(`ui-11-基础模式-${tag}`) }
  }
  // 历史下拉
  const hist = await center(`[...document.querySelectorAll('.cpfe *')].find((e) => /Change history|改动历史/.test((e.textContent||'').trim()) && e.getBoundingClientRect().width > 40)`)
  if (hist !== null) { await clickAt(hist.x, hist.y); await sleep(1200); await shot('ui-12-改动历史下拉') }
  // 删除确认（点了立刻截图，然后取消）
  const del = await center(`[...document.querySelectorAll('.cpfe button')].find((b) => /删除|Delete/.test((b.textContent||'').trim()))`)
  if (del !== null) { await clickAt(del.x, del.y); await sleep(1200); await shot('ui-13-删除确认弹窗'); await clickText('^(Cancel|取消)$'); await sleep(600) }
  await sleep(400)
}

if (scene === 'control') {
  // "无插件对照"素材：同一套界面、同一个工作区，只是没装我们的插件 —— 用于宣传片的 before 画面。
  const shot = async (name) => {
    const png = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(join(out, `${name}.png`), Buffer.from(png.data, 'base64'))
    console.log(`  ✓ ${name}.png`)
  }
  await shot('no-01-新会话')
  const chip = await center(`[...document.querySelectorAll('button,[role=button],div,span')].find((e) => { const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect(); return ['Standard mode','标准模式','Custom mode','自定义模式'].includes(t) && r.width>20 && r.y>300 })`)
  if (chip !== null) { await clickAt(chip.x, chip.y); await sleep(1400); await shot('no-02-模式选择器'); await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }); await sleep(600) }
  await clickText('^(Settings|设置)$'); await sleep(1400)
  await shot('no-03-设置页导航')
  // 官方 Agent presets 一节（我们插件不存在时，用户只能看这里）
  const presets = await center(`[...document.querySelectorAll('button,[role=button],div,span')].filter((e) => /^(Agent presets|Agent 预设)$/.test((e.textContent||'').trim()) && e.getBoundingClientRect().width>20).pop()`)
  if (presets !== null) { await clickAt(presets.x, presets.y); await sleep(1600); await shot('no-04-官方预设一节') }
  await sleep(400)
}

if (scene === 'shots') {
  // 导演素材：把插件真实页面的关键状态逐个拍下来（1920×1080、深色）。截图与录屏同一台实例、同一套点击逻辑，
  // 保证"素材库"里的图和片子里的动效是同一个界面。
  const shot = async (name) => {
    const file = join(out, `${name}.png`)
    const png = await send('Page.captureScreenshot', { format: 'png' })
    writeFileSync(file, Buffer.from(png.data, 'base64'))
    console.log(`  ✓ ${name}.png`)
  }
  const scrollToEl = async (sel) =>
    evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el === null) return false;
      let n = el.parentElement; while (n !== null) { const st = getComputedStyle(n);
        if (n.scrollHeight > n.clientHeight + 8 && /(auto|scroll|overlay)/.test(st.overflowY)) break; n = n.parentElement }
      if (n === null) { el.scrollIntoView({ block: 'start' }); return true }
      n.scrollTop = n.scrollTop + (el.getBoundingClientRect().top - n.getBoundingClientRect().top) - 40; return true })()`)
  await shot('ui-01-新会话-模式名')
  // 模式选择器
  const chip = await center(`[...document.querySelectorAll('button,[role=button],div,span')].find((e) => { const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect(); return ['Custom mode','自定义模式'].includes(t) && r.width>20 && r.y>300 })`)
  if (chip !== null) { await clickAt(chip.x, chip.y); await sleep(1400); await shot('ui-02-模式选择器'); await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }); await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' }); await sleep(600) }
  // 设置页
  await clickText('^(Settings|设置)$'); await sleep(1200)
  const nav = await center(`[...document.querySelectorAll('[role=dialog] button,[role=dialog] [role=button],[role=dialog] div,[role=dialog] span')].filter((e) => { const t=(e.textContent||'').trim(); const r=e.getBoundingClientRect(); return (t==='Custom mode'||t==='自定义模式') && r.width>20 && r.height>8 && r.height<60 }).pop()`)
  if (nav !== null) { await clickAt(nav.x, nav.y); await sleep(1800) }
  await shot('ui-03-设置页-助手与命名')
  await scrollToEl('.cpfe-row'); await sleep(600); await shot('ui-04-插件行列表')
  const toggle = await center(`[...document.querySelectorAll('.cpfe-row')].map((r) => r.querySelector('button,[role=switch],input[type=checkbox],.cpfe-switch')).filter(Boolean)[1]`)
  if (toggle !== null) { await clickAt(toggle.x, toggle.y); await sleep(800); await shot('ui-05-关掉一行') }
  await scrollToEl('.cpfe-editor'); await sleep(600); await shot('ui-06-系统提示词')
  const save = await center(`[...document.querySelectorAll('button')].filter((b) => /^(Save|保存|✓ Save)$/.test((b.textContent||'').trim().replace(/^✓\s*/, '')))[0]`)
  if (save !== null) { await clickAt(save.x, save.y); await sleep(1600); await shot('ui-07-已保存') }
  // 新增助手
  for (const name of ['Writer', 'Reviewer']) {
    const input = await center(`document.querySelector('.cpfe input[type=text], .cpfe input:not([type])')`)
    if (input === null) break
    await clickAt(input.x, input.y); await sleep(250)
    await send('Input.insertText', { text: name }); await sleep(400)
    const create = await center(`[...document.querySelectorAll('.cpfe button')].find((b) => /(新增助手|New assistant)/.test((b.textContent||'').trim()))`)
    if (create === null) break
    await clickAt(create.x, create.y); await sleep(1500)
  }
  await shot('ui-08-新增助手后')
  const base = await center(`[...document.querySelectorAll('.cpfe *')].find((e) => /^(PTC|极简|Minimal|Cordis)$/.test((e.textContent||'').trim()) && e.children.length === 0)`)
  if (base !== null) { await clickAt(base.x, base.y); await sleep(900); await shot('ui-09-切换基础模式') }
  await shot('ui-10-底部版本行')
  await sleep(500)
}

if (scene === 'picker') {
  // 新建会话 → 打开模式选择器 → 选中自定义模式
  await evaluate('window.__mediaPointer = { x: 960, y: 900 }')
  await sleep(800)
  const chip = await center(
    `[...document.querySelectorAll('button,[role=button],div,span')].find((e) => { const t = (e.textContent || '').trim();
      const r = e.getBoundingClientRect(); return ['Custom mode','自定义模式','Standard mode','标准模式','PTC mode','Minimal mode'].includes(t) && r.width > 20 && r.y > 300 })`,
  )
  if (chip === null) console.log('  ! 找不到模式按钮')
  else {
    await clickAt(chip.x, chip.y)
    await sleep(1200)
    const option = await center(
      `[...document.querySelectorAll('*')].find((e) => ['Custom mode','自定义模式'].includes((e.textContent || '').trim()) && e.children.length === 0 && e.getBoundingClientRect().height > 6)`,
    )
    if (option !== null) await clickAt(option.x, option.y)
    await sleep(1600)
  }
}

if (scene === 'rows') {
  // 设置页 → 自定义模式 → 关掉一个插件行 → 保存
  await clickText('^(Settings|设置)$')
  await sleep(1200)
  const nav = await center(
    `[...document.querySelectorAll('[role=dialog] button,[role=dialog] [role=button],[role=dialog] div,[role=dialog] span')].filter((e) => { const t = (e.textContent || '').trim();
      const r = e.getBoundingClientRect(); return (t === 'Custom mode' || t === '自定义模式') && r.width > 20 && r.height > 8 && r.height < 60 }).pop()`,
  )
  if (nav === null) console.log('  ! 找不到设置页章节')
  else {
    await clickAt(nav.x, nav.y)
    await sleep(1800)
    const scrolled = await evaluate(`(() => { const el = document.querySelector('.cpfe-row'); if (el === null) return false;
      let node = el.parentElement; while (node !== null) { const s = getComputedStyle(node);
        if (node.scrollHeight > node.clientHeight + 8 && /(auto|scroll|overlay)/.test(s.overflowY)) break; node = node.parentElement }
      if (node === null) { el.scrollIntoView({ block: 'start' }); return true }
      node.scrollTop = node.scrollTop + (el.getBoundingClientRect().top - node.getBoundingClientRect().top) - 180; return true })()`)
    await sleep(900)
    const toggle = await center(
      `[...document.querySelectorAll('.cpfe-row')].map((row) => row.querySelector('button,[role=switch],input[type=checkbox],.cpfe-switch')).filter(Boolean)[1]`,
    )
    if (toggle !== null) {
      await clickAt(toggle.x, toggle.y)
      await sleep(900)
      const save = await center(`[...document.querySelectorAll('button')].find((b) => /^(Save|保存)$/.test((b.textContent || '').trim()))`)
      if (save !== null) {
        await clickAt(save.x, save.y)
        await sleep(1500)
      }
    } else {
      console.log(`  ! 找不到开关（滚动=${String(scrolled)}）`)
    }
  }
}

if (scene === 'addassistant') {
  // "多个"镜头：在插件页反复新增助手 —— 每个助手就是一只不同形态的大肥鱼。
  // 在中文实例上录（名字用中文更有梗，同时满足"片子里必须有中文界面"）。
  await clickText('^(Settings|设置)$')
  await sleep(1200)
  const nav = await center(
    `[...document.querySelectorAll('[role=dialog] button,[role=dialog] [role=button],[role=dialog] div,[role=dialog] span')].filter((e) => { const t = (e.textContent || '').trim();
      const r = e.getBoundingClientRect(); return (t === 'Custom mode' || t === '自定义模式') && r.width > 20 && r.height > 8 && r.height < 60 }).pop()`,
  )
  if (nav !== null) await clickAt(nav.x, nav.y)
  await sleep(1800)
  const names = ['咸鱼鱼', '顶盆鱼', '红烧肉鱼', '打码鱼']
  for (const name of names) {
    const input = await center(`document.querySelector('.cpfe input[type=text], .cpfe input:not([type])')`)
    if (input === null) { console.log('  ! 找不到名字输入框'); break }
    await clickAt(input.x, input.y)
    await sleep(250)
    await send('Input.insertText', { text: name })
    await sleep(500)
    const create = await center(
      `[...document.querySelectorAll('.cpfe button')].find((b) => /(新增助手|New assistant)/.test((b.textContent || '').trim()))`,
    )
    if (create === null) { console.log('  ! 找不到新增按钮'); break }
    await clickAt(create.x, create.y)
    await sleep(1600)
    console.log(`  已新增：${name}`)
  }
  await sleep(800)
}

if (scene === 'reload') {
  // 改系统提示词 → 保存（校验并重试）→ 回会话提问：回答应当体现新提示词（这是"下一步生效"的证据）
  await clickText('^(Settings|设置)$')
  await sleep(1200)
  const nav = await center(
    `[...document.querySelectorAll('[role=dialog] button,[role=dialog] [role=button],[role=dialog] div,[role=dialog] span')].filter((e) => { const t = (e.textContent || '').trim();
      const r = e.getBoundingClientRect(); return (t === 'Custom mode' || t === '自定义模式') && r.width > 20 && r.height > 8 && r.height < 60 }).pop()`,
  )
  if (nav !== null) await clickAt(nav.x, nav.y)
  await sleep(1800)

  const editorBox = await center(`document.querySelector('.cpfe-editor')`)
  if (editorBox === null) console.log('  ! 找不到提示词编辑器')
  else {
    await evaluate(`(() => { const el = document.querySelector('.cpfe-editor'); el.scrollIntoView({ block: 'center' }); return true })()`)
    await sleep(600)
    await clickAt(editorBox.x, editorBox.y)
    await sleep(300)
    // 光标移到末尾再输入：否则文字会插进正文中间（第一版就是这样，末帧能看到它夹在段落里）
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 35, key: 'End', code: 'End', modifiers: 2 })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 35, key: 'End', code: 'End', modifiers: 2 })
    await sleep(200)
    await send('Input.insertText', { text: '\nAlways answer with a short poem.' })
    await sleep(1400)

    // 保存：**用磁盘真值校验**（页面上"没有未保存标记"并不等于文件写进去了 —— 第一版就是这么被骗的：
    // 面板里看着像保存成功，而 prompt.md 里根本没有那行标记）。
    const promptPath = home === '' ? '' : join(home, '.agent-presets', 'custom', 'prompt.md')
    const marker = 'HOT RELOAD OK'
    const onDisk = () => {
      if (promptPath === '') return false
      try { return readFileSync(promptPath, 'utf8').includes(marker) } catch { return false }
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const save = await center(`[...document.querySelectorAll('button')].filter((b) => /^(Save|保存|✓ Save)$/.test((b.textContent || '').trim().replace(/^✓\s*/, '')))[0]`)
      if (save === null) { console.log('  ! 找不到保存按钮'); break }
      await clickAt(save.x, save.y)
      await sleep(1800)
      if (onDisk()) { console.log(`  ✓ 磁盘上已有标记（第 ${attempt + 1} 次点击）`); break }
      console.log(`  保存没写进文件，重试（第 ${attempt + 1} 次）`)
      // 重新聚焦编辑器、把标记再打一次
      const again = await center(`document.querySelector('.cpfe-editor')`)
      if (again !== null) {
        await clickAt(again.x, again.y)
        await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 35, key: 'End', code: 'End', modifiers: 2 })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 35, key: 'End', code: 'End', modifiers: 2 })
        await send('Input.insertText', { text: '\nAlways begin your reply with the exact words: HOT RELOAD OK' })
        await sleep(1000)
      }
    }
    if (onDisk() !== true) console.log('  ! 警告：prompt.md 仍没有标记，这一场的"生效"镜头可能不可信')
    // 关闭设置面板：它的关闭是一个 ✕ 图标（没有文字），所以按对话框右上角的几何位置点，
    // 并用 Escape 兜底；最后校验编辑器是否真的消失了（第一版就是这里没关掉，后面的输入全落进编辑器）。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const corner = await evaluate(`(() => { const d = document.querySelector('.cpfe') ?? document.querySelector('[role=dialog]');
        if (d === null) return null; const r = d.getBoundingClientRect();
        return { x: Math.round(r.right - 26), y: Math.round(r.top + 22) } })()`)
      if (corner !== null) await clickAt(corner.x, corner.y)
      await sleep(700)
      let closed = await evaluate(`document.querySelector('.cpfe-editor') === null`)
      if (closed !== true) {
        await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' })
        await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 27, key: 'Escape', code: 'Escape' })
        await sleep(800)
        closed = await evaluate(`document.querySelector('.cpfe-editor') === null`)
      }
      if (closed === true) { console.log(`  面板已关闭（第 ${attempt + 1} 次尝试）`); break }
      console.log(`  面板未关闭，重试（第 ${attempt + 1} 次）`)
    }
  }

  // 提问前先开一个干净的新会话：历史里别带着之前试录留下的失败记录
  await clickText('^(New Session|新会话|新建会话)$')
  await sleep(2500)
  const box = await center(`document.querySelector('[contenteditable=true]')`)
  if (box === null) console.log('  ! 找不到输入框')
  else {
    await clickAt(box.x, box.y)
    await sleep(300)
    await send('Input.insertText', { text: 'What is this plugin, in one line?' })
    await sleep(500)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 13, key: 'Enter', code: 'Enter' })
    for (let i = 0; i < 20; i += 1) {
      await sleep(1500)
      const done = await evaluate(`/1 轮|运行失败|AUTH/.test(document.body.innerText)`)
      if (done === true) break
    }
    await sleep(1500)
  }
}

await sleep(600)
capturing = false
await captureLoop
console.log(`  录制结束：${frame} 帧 → ${out}`)
ws.close()
