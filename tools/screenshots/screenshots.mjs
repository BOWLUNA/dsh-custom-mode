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

/**
 * 每张图都是同一块画布，且都是设置弹窗本身的大小。
 *
 * 不这么做的话，图会变成"这张 1600x1600、那张 3360x2100"——README 里四张图高度不一，
 * 排版参差，加载也慢。固定画布同时解决了三件事：尺寸统一、文件小、字还看得清
 * （800 宽的图在 GitHub 正文里按原尺寸显示，不会被缩小）。
 */
const VIEWPORT = { width: 1440, height: 900 }
const CANVAS = { width: 800, height: 800 }

const url = process.argv[2]
const outDir = process.argv[3] ?? '/home/bowluna/dsh/dsh-custom-mode/docs/images'
mkdirSync(outDir, { recursive: true })

const session = await connect()
// scale 1（不是 2）：README 里的图会被 GitHub 缩到正文宽度，2 倍图只会让体积翻两番。
// 1440x900 下设置弹窗正好是 800x800，四张图都裁成这个尺寸，整整齐齐。
await session.setViewport(VIEWPORT.width, VIEWPORT.height, 1)

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

/** 把一块区域夹到画布尺寸，并保证不越出视口。 */
function canvasBox(rect) {
  const x = Math.max(0, Math.min(VIEWPORT.width - CANVAS.width, Math.round(rect.x ?? rect.left)))
  const y = Math.max(0, Math.min(VIEWPORT.height - CANVAS.height, Math.round(rect.y ?? rect.top)))
  return { x, y, width: CANVAS.width, height: CANVAS.height }
}

/** Capture the settings dialog, cropped to the shared canvas. */
async function shotDialog(name) {
  const rect = await session.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(DIALOG)});
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: Math.round(r.width), height: Math.round(r.height) };
  })()`)
  if (rect === null) throw new Error('找不到设置弹窗')
  await session.screenshotBox(`${outDir}/${name}`, canvasBox(rect))
  console.log(`  → ${name}（${CANVAS.width}x${CANVAS.height}）`)
}

/** Capture an arbitrary area, cropped to the shared canvas. */
async function shotCanvas(name, anchor) {
  await session.screenshotBox(`${outDir}/${name}`, canvasBox(anchor))
  console.log(`  → ${name}（${CANVAS.width}x${CANVAS.height}）`)
}

/**
 * Ask the plugin's own endpoints, in the order the page does:
 * `GET /custom-mode` is the assistant list, then `GET /custom-mode/state` is the
 * one assistant the editor opens on. Reading only the list would silently report
 * nulls for every editor field, which is exactly the staleness this script exists
 * to prevent.
 */
async function pluginState() {
  return session.evaluate(`(async () => {
    const list = await fetch('/custom-mode', { headers: { accept: 'application/json' } }).then((r) => r.json());
    const assistants = Array.isArray(list.assistants) ? list.assistants : [];
    const first = assistants.length > 0 ? assistants[0].id : null;
    const detail = first === null
      ? null
      : await fetch('/custom-mode/state?id=' + encodeURIComponent(first), { headers: { accept: 'application/json' } }).then((r) => r.json());
    return { list, detail, assistants };
  })()`)
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

const probe = await pluginState()
report.loadedState = {
  ok: probe?.list?.ok,
  assistants: Array.isArray(probe?.assistants) ? probe.assistants.map((item) => item.name || item.id) : null,
  editing: probe?.detail?.id ?? null,
  mode: probe?.detail?.mode,
  topLevelRows: Array.isArray(probe?.detail?.rows) ? probe.detail.rows.length : null,
  promptChars: typeof probe?.detail?.prompt === 'string' ? probe.detail.prompt.length : null,
}
console.log('  插件 GET /custom-mode →', JSON.stringify(report.loadedState))
if (probe?.list?.ok !== true || probe?.detail?.ok !== true) {
  throw new Error(`设置页读取失败: ${JSON.stringify(probe)}`)
}

// 01：模式名称 + 基础模式（第 2、3 个 section）。助手列表是 05 的题材，这里不再重复拍它。
console.log('截图 01（模式名称 + 基础模式）…')
await scrollTo('.cpfe > section:nth-of-type(2)')
await shotDialog('01-mode-switch.png')

// ── 功能实测 A：拨开关 ────────────────────────────────────────────────────
console.log('实测 A：关闭「网页检索与抓取」（不保存，先让「已改」徽标出现）…')
await scrollTo('.cpfe-rows')
// The switch is the shell's own atom now: `[role=switch]` with `aria-checked`, not an
// `<input type=checkbox>` (measured: 32 rows, 32 `[role=switch]`, 0 checkboxes in the panel).
// React updates the attribute a tick after the click, so the new state is read separately.
const ROW_FINDER = `[...document.querySelectorAll('.cpfe-row')].find((el) => el.textContent.includes('网页检索与抓取') || el.textContent.includes('Web search and fetch'))`
report.toggle = await session.evaluate(`(() => {
  const row = ${ROW_FINDER};
  if (row === undefined) return null;
  const box = row.querySelector('[role=switch]');
  if (box === null) return { missingSwitch: true };
  const before = box.getAttribute('aria-checked') === 'true';
  if (before !== true) return { alreadyOff: true };
  box.click();
  return { before };
})()`)
await session.sleep(500)
report.toggleAfter = await session.evaluate(`(() => {
  const row = ${ROW_FINDER};
  const box = row === undefined ? null : row.querySelector('[role=switch]');
  return box === null ? null : box.getAttribute('aria-checked') === 'true';
})()`)
console.log('  tool-web 开关:', JSON.stringify({ ...report.toggle, after: report.toggleAfter }))
await session.sleep(300)

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
  // The save control is a shell Button too: find it by its label, not by the old .cpfe-btn class.
  const candidates = [...document.querySelectorAll('button,[role=button]')];
  const button = candidates.find((el) => /^(保存|Save)$/.test(el.textContent.trim()))
    ?? candidates.find((el) => /保存|Save/.test(el.textContent.trim()));
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
console.log('截图 03（系统提示词 + 保存栏）…')
await scrollTo('.cpfe-editor')
await session.sleep(500)
await shotDialog('03-system-prompt.png')

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
report.englishShot = '（不再单独存图：语言切换已由上面的断言与 observed.json 记录）'

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
report.darkShot = '（同上，不再单独存图）'
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
  // 触发器 + 下拉列表的并集；shotCanvas 会把它夹成与其余三张相同的画布
  const anchor = box === null ? { x: 320, y: 60 } : { x: box.x, y: box.y }
  await shotCanvas('04-preset-picker.png', anchor)
} else {
  await shotCanvas('04-preset-picker.png', { x: 320, y: 60 })
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
