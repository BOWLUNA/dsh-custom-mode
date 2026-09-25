#!/usr/bin/env node
/**
 * Mode-picker probe: does a mode actually show up in the new-session picker?
 *
 * **Why this exists**: a review found that on the stable dsh line our preset was marked broken and therefore
 * silently dropped from every picker — while the settings page kept working, so `tools/browser-verify.mjs`
 * (which drives the settings page) stayed green and the double-line CI never noticed. "The mode appears in the
 * picker" is the one user-visible fact none of our checks covered, and it needs a rendered page.
 *
 * Usage:
 *   node tools/picker-probe.mjs --url "http://127.0.0.1:3080/?token=…" [--expect 自定义模式] [--out shot.png]
 *
 * Needs a browser with a DevTools port (`CDP_PORT`, default 9222) and a running instance, exactly like
 * `tools/browser-verify.mjs`. Exit codes: 0 when every `--expect` mode is present, 1 when one is missing,
 * 2 when the picker could not be opened at all (a failure of the probe, not of the product).
 */
import { writeFileSync } from 'node:fs'
import { connect } from './screenshots/cdp.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 ? fallback : argv[index + 1]
}
const expectations = argv.flatMap((value, index) => (value === '--expect' ? [argv[index + 1]] : [])).filter(Boolean)
const url = flag('--url')
const out = flag('--out')
if (url === undefined) {
  console.error('用法: node tools/picker-probe.mjs --url "<token URL>" [--expect 自定义模式] [--out shot.png]')
  process.exit(2)
}

/** Mode names the shell may show in the picker. */
// 注意英文侧的实际文案：dsh 的英文界面是 `Standard mode` / `PTC mode` / `Minimal mode` / `Cordis mode`
// （外部评审实测：老列表里写的是 `Standard`，于是英文 UI 下探针**根本找不到**控件、直接报"打不开"）。
const KNOWN = [
  '标准模式', '自定义模式', 'PTC 模式', '极简模式', 'Cordis 模式', '创造模式',
  'Standard mode', 'Custom mode', 'PTC mode', 'Minimal mode', 'Cordis mode',
]

const session = await connect()
await session.newPage()
await session.setViewport(1440, 1000, 1)
await session.goto(url, { waitMs: 8000 })

// Dismiss first-run overlays the same way the settings-page verifier does.
for (let round = 0; round < 4; round += 1) {
  let clicked = false
  for (const label of ['知道了', '我明白', '跳过', '以后再说', '稍后配置', '稍后', '关闭', '继续', '开始使用', 'Got it', 'Skip', 'Later', 'Continue']) {
    try {
      await session.clickTextReal(label, { exact: false })
      clicked = true
      break
    } catch {
      /* try the next label */
    }
  }
  if (clicked === false) break
  await session.sleep(800)
}

const trigger = await session.evaluate(`(() => {
  const names = ${JSON.stringify(KNOWN)};
  const el = [...document.querySelectorAll('button,[role=button],div,span')].find((e) => {
    const r = e.getBoundingClientRect();
    return names.includes((e.textContent || '').trim()) && r.width > 20 && r.y > 300;
  });
  if (el === undefined) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: (el.textContent || '').trim() };
})()`)
if (trigger === null) {
  console.error('打不开模式选择器：页面上找不到显示当前模式的按钮（选择器没渲染，或遮罩没关掉）。')
  process.exit(2)
}
console.log(`  当前模式按钮：${JSON.stringify(trigger.text)}`)
await session.clickAt(trigger.x, trigger.y)
await session.sleep(1400)

/**
 * Collect every mode the opened picker offers.
 *
 * **Why not filter by a name allow-list** (the old behaviour): user assistants are named by their owner, so a
 * fixed list of "known" names can only ever see the shipped ones (plus the one this feature happens to call
 * 「自定义模式」). Measured 2026-09-25 on a lab instance: the picker visibly listed six modes
 * (standard / PTC / minimal / cordis / 写作助手 / probe-assistant) while this probe reported three, so
 * `--expect <a user mode>` failed while the mode was right there on screen. A false negative in the one check
 * that exists to notice a *missing* mode is worse than no check: it teaches the reader to ignore the check.
 *
 * New shape: anchor on one shipped name, climb to the popup that still carries several of them, then read that
 * popup's leaf texts. Option titles are short; the one-line descriptions under them are not.
 */
const modes = await session.evaluate(`(() => {
  const names = ${JSON.stringify(KNOWN)};
  // Option rows are wide (measured 280px at this viewport); the composer chip that shows the current mode is
  // ~52px. Filtering by width keeps the *popup's* rows and drops the trigger, so the common ancestor below is
  // the popup rather than the whole page.
  const rows = [...document.querySelectorAll('*')].filter((e) => {
    if (e.children.length !== 0) return false;
    const text = (e.textContent || '').trim();
    const rect = e.getBoundingClientRect();
    return names.includes(text) && rect.width > 120 && rect.height > 6;
  });
  if (rows.length === 0) return [];
  let panel = rows[0];
  for (const row of rows) {
    while (panel.contains(row) === false && panel.parentElement !== null) panel = panel.parentElement;
  }
  // Every short leaf inside the popup: shipped modes and user assistants alike (user names are not in KNOWN —
  // that was the whole bug).
  const texts = [...panel.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && (e.textContent || '').trim() !== '' && e.getBoundingClientRect().width > 0)
    .map((e) => (e.textContent || '').trim())
    .filter((text) => text.length <= 24);
  return [...new Set(texts)];
})()`)
console.log(`  选择器里的模式：${JSON.stringify(modes)}`)
if (out !== undefined) {
  await session.screenshot(out)
  writeFileSync(`${out}.modes.txt`, modes.join('\n') + '\n', 'utf8')
}
session.close()

if (modes.length === 0) {
  console.error('选择器打开了但一个模式都没读到 —— 探测本身失败了。')
  process.exit(2)
}
const missing = expectations.filter((mode) => modes.includes(mode) === false)
if (missing.length > 0) {
  console.error(`✗ 选择器里没有：${missing.join('、')}（这通常意味着预设被判为 broken）`)
  process.exit(1)
}
console.log(expectations.length === 0 ? '✓ 选择器可读' : `✓ 期望的模式都在：${expectations.join('、')}`)
