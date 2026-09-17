/**
 * Produce the README screenshots from the real, running GUI.
 *
 * Usage: node screenshots.mjs <url> <outDir>
 *
 * Everything here is a real interaction: real settings-panel clicks, a real save through
 * the plugin's own HTTP route, real theme and language switches from the app's own
 * controls. The script prints the state it observed and writes it to `observed.json`
 * next to itself, so the screenshots are evidence rather than decoration.
 *
 * Deterministic: the caller should restore a pristine preset first (see run-shots.sh),
 * so the "toggled a row → saved" narrative is the same on every run. The app's UI
 * language is toggled mid-run, so every label is matched in BOTH languages.
 */
import { connect } from './cdp.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const url = process.argv[2]
const outDir = process.argv[3] ?? '/home/bowluna/dsh/dsh-custom-mode/docs/images'
mkdirSync(outDir, { recursive: true })

const session = await connect()
await session.setViewport(1680, 1050, 2)

const logs = []
session.listeners.push((message) => {
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map((arg) => arg.value ?? arg.description ?? '').join(' ')
    logs.push(`[${message.params.type}] ${text}`)
  }
})

const DIALOG = '[role=dialog]'
const report = {}

/** Labels, in both UI languages. The app is switched mid-run, so nothing is hard-coded. */
const L = {
  settings: ['设置', 'Settings'],
  general: ['通用设置', 'General'],
  light: ['浅色', 'Light'],
  dark: ['深色', 'Dark'],
  close: ['关闭', 'Close'],
  customMode: ['自定义模式', 'Custom mode'],
}

async function click(text, options = {}) {
  const hit = await session.clickTextReal(text, options)
  await session.sleep(options.settle ?? 1000)
  return hit
}

/** Click the first label that exists (bilingual). */
async function clickAny(names, options = {}) {
  for (const name of names) {
    try {
      return await click(name, options)
    } catch {
      /* try the next language */
    }
  }
  throw new Error(`找不到任何可点击文案: ${JSON.stringify(names)}`)
}

async function scrollTo(selector) {
  const ok = await session.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (el === null) return false;
    el.scrollIntoView({ block: 'start', behavior: 'instant' });
    return true;
  })()`)
  if (!ok) throw new Error(`scrollTo(${selector}) found nothing`)
  await session.sleep(600)
}

/** Capture the settings dialog only — the framing a reader actually needs. */
async function shotDialog(name, options = {}) {
  await session.screenshotElement(DIALOG, `${outDir}/${name}`, options)
  console.log(`  → ${name}`)
}

/** Capture the whole window (home screen / mode picker). */
async function shotWindow(name) {
  await session.screenshot(`${outDir}/${name}`)
  console.log(`  → ${name}`)
}

async function pluginState() {
  return session.evaluate(
    `fetch('/custom-mode', { headers: { accept: 'application/json' } }).then((r) => r.json())`,
  )
}

/** Switch UI language through the app's own control (its label shows the CURRENT language). */
async function switchLanguage(optionText) {
  const opened = await session.evaluate(`(() => {
    const labels = [...document.querySelectorAll('div, span')].filter((el) => {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
      return own === '语言' || own === 'Language';
    });
    if (labels.length === 0) return null;
    let node = labels[0];
    for (let depth = 0; depth < 6 && node !== null; depth += 1) {
      const button = node.querySelector === undefined ? null : node.querySelector('button');
      if (button !== null && button !== undefined) {
        const rect = button.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, current: button.textContent.trim() };
      }
      node = node.parentElement;
    }
    return null;
  })()`)
  if (opened === null) throw new Error('找不到语言选择器')
  console.log(`  语言选择器当前是「${opened.current}」`)
  await session.clickAt(opened.x, opened.y)
  await session.sleep(900)
  await clickAny([optionText], { exact: true })
  await session.sleep(1500)
}

console.log('打开应用…')
await session.goto(url, { waitMs: 4500 })

// 统一回中文，避免上一次运行的残留语言影响后续按文案定位
console.log('设置面板：统一到中文 + 浅色')
await clickAny(L.settings, { exact: true })
await clickAny(L.general, { exact: true })
const languageButton = await session.evaluate(`(() => {
  const labels = [...document.querySelectorAll('div, span')].filter((el) => {
    const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    return own === '语言' || own === 'Language';
  });
  if (labels.length === 0) return null;
  let node = labels[0];
  for (let depth = 0; depth < 6 && node !== null; depth += 1) {
    const button = node.querySelector === undefined ? null : node.querySelector('button');
    if (button !== null && button !== undefined) return button.textContent.trim();
    node = node.parentElement;
  }
  return null;
})()`)
if (languageButton !== '中文') await switchLanguage('中文')
await clickAny(L.light, { exact: true })
report.theme = '浅色（由界面自己的外观控件切换）'

console.log('打开「自定义模式」设置页…')
await clickAny(L.customMode, { exact: true })
await session.sleep(1800)

const state = await pluginState()
report.loadedState = {
  ok: state?.ok,
  mode: state?.mode,
  topLevelRows: Array.isArray(state?.rows) ? state.rows.length : null,
  promptChars: typeof state?.prompt === 'string' ? state.prompt.length : null,
}
console.log('  插件 GET /custom-mode →', JSON.stringify(report.loadedState))
if (state?.ok !== true) throw new Error(`设置页读取失败: ${JSON.stringify(state)}`)

// 01：模式名称 + 基础模式
console.log('截图 01（模式名称 + 基础模式）…')
await scrollTo('.cpfe > section:nth-of-type(1)')
await shotDialog('01-mode-switch.png')

// ── 功能实测 A：拨开关 ────────────────────────────────────────────────────
console.log('实测 A：关闭「网页检索与抓取」（不保存，先让「已改」徽标出现）…')
await scrollTo('.cpfe-rows')
report.toggle = await session.evaluate(`(() => {
  const row = [...document.querySelectorAll('.cpfe-row')].find((el) => el.textContent.includes('网页检索与抓取') || el.textContent.includes('Web search and fetch'));
  if (row === undefined) return null;
  const box = row.querySelector('input[type=checkbox]');
  if (box.checked !== true) return { alreadyOff: true };
  box.click();
  return { before: true, after: box.checked };
})()`)
console.log('  tool-web 复选框:', JSON.stringify(report.toggle))
await session.sleep(600)

// 02：插件开关（含分组 + 已改徽标）
console.log('截图 02（插件开关，含分组缩进）…')
await session.evaluate(`(() => {
  const group = [...document.querySelectorAll('.cpfe-group')].find((el) => el.querySelector('.cpfe-kids') !== null);
  if (group !== undefined) group.scrollIntoView({ block: 'start', behavior: 'instant' });
  return true;
})()`)
await session.sleep(700)
await shotDialog('02-plugin-switches.png')

// ── 功能实测 B：保存 ─────────────────────────────────────────────────────
console.log('实测 B：点保存…')
report.save = await session.evaluate(`(() => {
  const button = [...document.querySelectorAll('.cpfe-btn')].find((el) => /保存|Save/.test(el.textContent.trim()));
  if (button === undefined) return { clicked: false, reason: 'no button' };
  if (button.disabled) return { clicked: false, reason: 'disabled' };
  button.click();
  return { clicked: true };
})()`)
await session.sleep(2600)
report.saveStatus = await session.evaluate(`(() => {
  const el = document.querySelector('.cpfe-status');
  return el === null ? null : el.textContent.trim();
})()`)
console.log('  保存后状态栏:', JSON.stringify(report.saveStatus))

// 03：系统提示词 + 保存栏（紧接着保存，状态栏正是「已保存」）
// 底部 34px 是组成文件的绝对路径（含本机用户名），截图里没有必要露出来。
console.log('截图 03（系统提示词 + 保存栏）…')
await scrollTo('.cpfe-editor')
await session.sleep(500)
await shotDialog('03-system-prompt.png', { bottomInset: 34 })

// ── 英文界面：顺带验证「导航项跟随语言」 ─────────────────────────────────
console.log('切 English…')
await clickAny(L.general, { exact: true })
await switchLanguage('English')
report.languageSwitch = '中文 → English（界面自己的语言控件）'
await clickAny(L.customMode, { exact: true })
await session.sleep(1800)
report.englishNav = await session.evaluate(`(() => {
  const el = [...document.querySelectorAll('*')].find((node) =>
    [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim() === 'Custom mode');
  return el === undefined || el === null ? null : el.textContent.trim();
})()`)
report.englishHeadings = (await session.visibleText()).split('\n').filter((line) => /Mode name|Base mode|Plugin switches|System prompt/.test(line))
console.log('  英文导航项标签:', JSON.stringify(report.englishNav))
console.log('  英文小节标题:', JSON.stringify(report.englishHeadings))
await scrollTo('.cpfe > section:nth-of-type(1)')
await shotDialog('06-english.png')

// ── 深色主题 ─────────────────────────────────────────────────────────────
console.log('切回中文 + 深色…')
await clickAny(L.general, { exact: true })
await switchLanguage('中文')
await clickAny(L.dark, { exact: true })
await session.sleep(700)
report.themeSwitch = '浅色 → 深色（同上）'
await clickAny(L.customMode, { exact: true })
await session.sleep(1800)
await scrollTo('.cpfe > section:nth-of-type(1)')
await shotDialog('05-dark.png')
report.darkDom = await session.evaluate(`(() => {
  const dark = [...document.querySelectorAll('*')].some((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg === 'rgb(24, 24, 26)' || bg === 'rgb(20, 20, 22)';
  });
  return { foundKnownDarkBackground: dark, bodyClass: document.body.className };
})()`)

// ── 新建会话的模式选择器 ─────────────────────────────────────────────────
console.log('回到浅色，关闭设置面板…')
await clickAny(L.general, { exact: true })
await clickAny(L.light, { exact: true })
await session.sleep(700)
try {
  await clickAny(L.close, { exact: true })
} catch {
  // 关闭按钮的文案随版本/布局可能定位不到；Esc 是同一件事的稳定做法。
  console.log('  （找不到关闭文案，改用 Esc）')
  await session.pressEscape()
}
await session.sleep(1800)
report.dialogClosed = await session.evaluate(`document.querySelector('[role=dialog]') === null`)

report.picker = await session.evaluate(`(() => {
  // 触发器的文案在叶子节点上（span），所以先找「自己带这串文字」的最小可见元素，
  // 再交给它可点击的祖先。
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
  const candidates = [...document.querySelectorAll('*')].filter((el) => {
    const own = ownText(el);
    const rect = el.getBoundingClientRect();
    return own !== '' && own.length < 20 && /模式|Mode/.test(own) && rect.width > 0 && rect.height > 0 && rect.y > 100;
  });
  if (candidates.length === 0) return { found: 0 };
  const leaf = candidates[candidates.length - 1];
  const target = leaf.closest('button, [role=button]') ?? leaf.parentElement ?? leaf;
  const rect = target.getBoundingClientRect();
  return { found: candidates.length, text: target.textContent.trim(), x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
})()`)
console.log('  模式选择器触发器:', JSON.stringify(report.picker))
if ((report.picker?.found ?? 0) > 0) {
  await session.clickAt(report.picker.x, report.picker.y)
  await session.sleep(1600)
  // 整窗截图里下拉框只占一小块；裁到「触发器 + 下拉列表」的并集，读者才看得清。
  const box = await session.evaluate(`(() => {
    const owns = (el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    const trigger = [...document.querySelectorAll('*')].filter((el) => {
      const own = owns(el);
      const rect = el.getBoundingClientRect();
      return own !== '' && own.length < 20 && /模式|Mode/.test(own) && rect.width > 0 && rect.y > 100;
    }).pop();
    const menu = [...document.querySelectorAll('*')].filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 200 && rect.height > 200 && (el.textContent || '').includes('自定义模式') && rect.y > 100;
    }).sort((a, b) => a.textContent.length - b.textContent.length)[0];
    if (trigger === undefined || menu === undefined) return null;
    const a = trigger.getBoundingClientRect();
    const b = menu.getBoundingClientRect();
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return { x: x - 16, y: y - 16, width: Math.max(a.right, b.right) - x + 16, height: Math.max(a.bottom, b.bottom) - y + 16 };
  })()`)
  if (box === null) {
    await shotWindow('04-preset-picker.png')
  } else {
    await session.screenshotBox(`${outDir}/04-preset-picker.png`, box)
    console.log('  → 04-preset-picker.png（裁到触发器 + 下拉列表）')
  }
} else {
  await shotWindow('04-preset-picker.png')
}
report.pickerVisible = (await session.visibleText()).split('\n').filter((line) => /模式|Mode/.test(line)).slice(0, 12)
console.log('  选择器里的模式：', JSON.stringify(report.pickerVisible))

/**
 * Where the observed-state log goes: beside THIS script, not into the images directory.
 *
 * It is evidence about the capture run (which theme, which language, what the save
 * endpoint answered), so it belongs with the tooling that produced it — the images
 * directory should hold images.
 */
const observedFile = fileURLToPath(new URL('./observed.json', import.meta.url))
writeFileSync(observedFile, JSON.stringify({ ...report, consoleLogs: logs }, null, 2))
console.log(`\n观察结果已写入 ${observedFile}`)
console.log('=== 观察到的状态 ===')
console.log(JSON.stringify(report, null, 1))
console.log('=== 页面 console ===')
console.log(logs.join('\n') || '(无)')
session.close()
