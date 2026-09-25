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

// 触发控件：优先 composer 里的模式锚点（实测 0.1.7-rc.2 的 class 带 `menuAnchor`），退而求其次找
// 「文本恰好等于某个已知模式名」的可见按钮。老版本只认后者、还额外要求 y>300，于是同一实例连跑两次
// 时第二次就报「找不到按钮」（实测）—— 那是探测自己的问题，不是产品问题。
const trigger = await session.evaluate(`(() => {
  const names = ${JSON.stringify(KNOWN)};
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const anchor = [...document.querySelectorAll('[class*=menuAnchor]')].filter(visible)[0];
  const byText = [...document.querySelectorAll('button,[role=button]')]
    .filter((el) => visible(el) && names.includes((el.textContent || '').trim()))[0];
  const cand = anchor === undefined ? byText : anchor.querySelector('button') || anchor;
  if (cand === undefined || cand === null) return null;
  const rect = cand.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: (cand.textContent || '').trim().slice(0, 24) };
})()`)
if (trigger === null) {
  console.error('打不开模式选择器：页面上找不到显示当前模式的控件（选择器没渲染，或遮罩没关掉）。')
  console.error('页面可见文本：' + (await session.visibleText()).replace(/\n+/g, ' | ').slice(0, 300))
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
 * Shape: read the popup's own option rows (`[role=menuitem]`, measured 2026-09-25: 316×66 each, name = the
 * first short leaf inside). Only when no menuitem exists does it fall back to anchoring on a shipped name and
 * climbing to the common ancestor. Option titles are short; the one-line descriptions under them are not.
 */
const modes = await session.evaluate(`(() => {
  const names = ${JSON.stringify(KNOWN)};
  const shortLeaves = (root, max) =>
    [...root.querySelectorAll('*')]
      .filter((e) => e.children.length === 0)
      .map((e) => (e.textContent || '').trim())
      .filter((t) => t !== '' && t.length <= max);

  // ★ 首选：读弹层自己的选项行。实测 2026-09-25（0.1.7-rc.2 + Chromium 153，1440×900）：每一项是
  //   [role=menuitem]（316×66），innerText 把「名称 + 一行描述」拼在同一行，所以名称取该项内部
  //   第一个短叶子文本；用户自己命名的助手同样在这里，不需要任何名字白名单。
  //   老办法（锚定已知名字 → 爬公共祖先 → 读短叶子）在 CI 上返回过空数组 —— 而「探测失败」与
  //   「模式真的不见了」必须区分开，所以只在拿不到 menuitem 时才回退。
  const items = [...document.querySelectorAll('[role=menuitem]')].filter((el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 100 && rect.height > 10;
  });
  if (items.length > 0) {
    const out = items.map((el) => {
      const leaves = shortLeaves(el, 24);
      if (leaves.length > 0) return leaves[0];
      return (el.innerText || '').trim().split('\\n')[0].slice(0, 24);
    });
    return [...new Set(out.filter((t) => t !== ''))];
  }

  // 回退：老办法。选项行比触发按钮宽（实测 280px vs ~52px），按宽度过滤即可排除触发按钮。
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
  return [...new Set(shortLeaves(panel, 24).filter((t) => t.length > 0))];
})()`)
console.log(`  选择器里的模式：${JSON.stringify(modes)}`)
if (out !== undefined) {
  await session.screenshot(out)
  writeFileSync(`${out}.modes.txt`, modes.join('\n') + '\n', 'utf8')
}
// 收尾：把弹层关掉。留着开着的选择器会让下一次运行（同一浏览器、同一实例）读不到东西。
await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
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
