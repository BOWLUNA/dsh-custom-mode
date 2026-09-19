/**
 * Capture the README screenshots from an **English** instance.
 *
 * Why this exists next to `screenshots.mjs`: that script is built around pixel crops of a Chinese UI (it forces
 * the language to 中文 and clicks Chinese-only labels). GitHub and the npm page are read in English, so the
 * images we ship there are captured here instead — fewer assumptions, and every image is cropped to the
 * settings dialog itself rather than to a full viewport with grey margins.
 *
 * Usage:
 *   node tools/screenshots/run-shots-en.mjs <url-with-token> [outDir]
 *
 * Environment: `CDP_HOST` (default 127.0.0.1) and `CDP_PORT` (default 9222) — the same knobs `cdp.mjs` reads.
 * The instance must already be in an English locale with this plugin installed; the caller boots it (see the
 * repository AGENTS.md for the throwaway-home recipe).
 *
 * Order matters: the mode picker (04) is captured **first**, because opening the settings page leaves the
 * new-session view, and a fresh instance only shows the empty new-session landing once.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './cdp.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const url = process.argv[2]
const out = process.argv[3] ?? join(REPO, 'docs', 'images')
if (url === undefined || url === '') {
  console.error('用法: node tools/screenshots/run-shots-en.mjs <带 token 的 URL> [输出目录]')
  process.exit(2)
}
mkdirSync(out, { recursive: true })

const session = await connect()
await session.newPage()
await session.setViewport(1280, 720, 1)
console.log('打开应用…')
await session.goto(url, { waitMs: 6000 })

// A throwaway home shows an "Add an API key" gate and/or a testing notice, both of which cover the UI.
for (let round = 0; round < 4; round += 1) {
  let clicked = false
  for (const label of ['Configure later', 'Continue', 'Got it', 'Close', 'Skip']) {
    try {
      await session.clickTextReal(label, { exact: false })
      clicked = true
      break
    } catch {
      /* try the next label */
    }
  }
  if (clicked === false) break
  await session.sleep(900)
}

const clickText = async (pattern, exact = false) => {
  try {
    await session.clickTextReal(pattern, { exact })
    await session.sleep(1500)
    return true
  } catch {
    return false
  }
}

/**
 * Every image is the **same frame** (1280×720 viewport, panel scrolled to the subject). Earlier versions cropped
 * to the panel, which produced five different sizes and aspect ratios in one README table; a review of our own
 * docs called that out, so uniformity wins over tight crops.
 */
const shootFrame = async (file) => {
  await session.screenshot(join(out, file))
  console.log(`  ✓ ${file}`)
}

const dialogClip = async () =>
  session.evaluate(`(() => {
    const dialog = document.querySelector('.cpfe') ?? document.querySelector('[role=dialog]');
    if (dialog === null) return null;
    const r = dialog.getBoundingClientRect();
    return { x: Math.max(0, r.x - 16), y: Math.max(0, r.y - 16), width: Math.min(r.width + 32, 1440), height: Math.min(r.height + 32, 1100) };
  })()`)

// ── 04 first: the mode picker in a brand-new session ───────────────────────────────────────────────
console.log('新建会话 → 打开模式选择器…')
const chip = await session.evaluate(`(() => {
  const names = ['Custom mode', 'Standard mode', 'PTC mode', 'Minimal mode'];
  const el = [...document.querySelectorAll('button,[role=button],div,span')].find((e) => {
    const t = (e.textContent || '').trim();
    const r = e.getBoundingClientRect();
    return names.includes(t) && r.width > 20 && r.y > 300;
  });
  if (el === undefined) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`)
if (chip === null) {
  console.log('  ! 04: 找不到模式按钮（实例可能已经进入某个会话）')
} else {
  await session.clickAt(chip.x, chip.y)
  await session.sleep(1500)
  await session.screenshot(join(out, '04-preset-picker.png'))
  console.log('  ✓ 04-preset-picker.png')
}

// ── Settings → Custom mode. The mode chip carries the same label, so only look inside the dialog. ──
console.log('打开 Settings → Custom mode…')
await clickText('Settings', true)
const navPoint = await session.evaluate(`(() => {
  const dialog = document.querySelector('[role=dialog]') ?? document.body;
  const items = [...dialog.querySelectorAll('button,[role=button],[role=tab],a,li,div,span')].filter((e) => {
    const t = (e.textContent || '').trim();
    const r = e.getBoundingClientRect();
    return (t === 'Custom mode' || t === '自定义模式') && r.width > 20 && r.height > 8 && r.height < 60;
  });
  const el = items[items.length - 1];
  if (el === undefined) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
})()`)
if (navPoint === null) {
  console.error('找不到设置面板里的「Custom mode」章节')
  process.exit(2)
}
await session.clickAt(navPoint.x, navPoint.y)
await session.sleep(2200)

/** Scroll an element into view inside its nearest scrollable ancestor (the panel scrolls, not the window). */
const scrollTo = async (selector, offset = 0) =>
  session.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return false;
    let node = el.parentElement;
    while (node !== null) {
      const style = getComputedStyle(node);
      if (node.scrollHeight > node.clientHeight + 8 && /(auto|scroll|overlay)/.test(style.overflowY)) break;
      node = node.parentElement;
    }
    if (node === null) { el.scrollIntoView({ block: 'start' }); return true; }
    node.scrollTop = node.scrollTop + (el.getBoundingClientRect().top - node.getBoundingClientRect().top) - 32 + ${String(offset)};
    return true;
  })()`)

for (const [file, selector, offset] of [
  // 05 是"助手管理"块（面板顶部）；01 稍微下移，让 Mode name / Base mode 一起入镜，避免两张图一样。
  ['05-assistant-manager.png', '.cpfe', 0],
  ['01-mode-switch.png', '.cpfe', 300],
  ['02-plugin-switches.png', '.cpfe-row', 0],
  ['03-system-prompt.png', '.cpfe-editor', 0],
]) {
  const positioned = await scrollTo(selector, offset ?? 0)
  if (positioned !== true) {
    console.log(`  ! ${file}: 没找到 ${selector ?? '对话框滚动容器'}`)
    continue
  }
  await session.sleep(700)
  await shootFrame(file)
}

session.close()
console.log(`图已写入 ${out}`)
