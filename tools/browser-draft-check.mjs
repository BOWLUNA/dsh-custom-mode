#!/usr/bin/env node
/** Additional rendered regression checks, independent of browser-verify's 74 checks.
 * Uses the real packed plugin, native dialogs, two Chrome pages and synthetic files only.
 * --url <isolated host URL> --home <compat boot-home> --out <screenshot prefix.png>
 * CDP_PORT selects the independently launched headless browser.
 * runtime-check installs its read-only official-registry observer for this script.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { en, zh } from '../locales.mjs'
import { Session } from './screenshots/cdp.mjs'

const argv = process.argv.slice(2)
const arg = (name) => { const i = argv.indexOf('--' + name); return i < 0 ? undefined : argv[i + 1] }
const url = arg('url')
const home = arg('home') && resolve(arg('home'))
const out = arg('out') && resolve(arg('out'))
if (!url || !home || !out || home === resolve(homedir(), '.dsh') || !existsSync(join(home, 'profiles', 'web', 'package.json'))) {
  console.error('Use --url, --home <isolated compat boot-home> and --out <picture.png>.')
  process.exit(2)
}
mkdirSync(dirname(out), { recursive: true })
const prefix = out.replace(/\.png$/i, '')
const reportFile = prefix + '-report.json'
const report = {
  scope: 'Rendered packed plugin with synthetic assistants, files and isolated headless Chrome. No model call or Electron claim.',
  inputBoundary: 'CompositionEvent/KeyboardEvent checks exercise DOM composition flags and keyCode 229; they do not operate an OS IME.',
  scriptSha256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  checks: [], screenshots: [],
}
const redact = (value) => String(value ?? '').replace(/([?&]token=)[A-Za-z0-9_-]+/g, '$1[redacted]')
const persist = () => writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
const check = (label, passed, details = undefined) => {
  report.checks.push({ label, passed: Boolean(passed), ...(details === undefined ? {} : { details }) })
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}${passed || details === undefined ? '' : ' ' + redact(JSON.stringify(details))}`)
  persist()
}
const requireCheck = (label, passed, details) => {
  check(label, passed, details)
  if (!passed) throw new Error('Required browser setup failed: ' + label)
}
const sessions = []
const pages = []
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function newPage() {
  const response = await fetch(`http://${process.env.CDP_HOST ?? '127.0.0.1'}:${process.env.CDP_PORT ?? 9222}/json/version`)
  const endpoint = (await response.json()).webSocketDebuggerUrl
  const socket = new WebSocket(endpoint)
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const session = new Session(socket)
  session.dialogPolicy = 'dismiss'
  await session.newPage()
  const { targetInfo } = await session.send('Target.getTargetInfo')
  session.testTargetId = targetInfo.targetId
  sessions.push(session)
  pages.push(session.testTargetId)
  await session.setViewport(1440, 1000, 1)
  await session.goto(url, { waitMs: 1300 })
  return session
}
async function api(session, path) {
  return session.evaluate(`(async () => {
    const response = await fetch(${JSON.stringify(path)}, { headers: { accept: 'application/json' } });
    return { status: response.status, data: response.headers.get('content-type')?.includes('json') ? await response.json() : null };
  })()`)
}
const state = async (session, id) => (await api(session, '/api/custom-mode/state?id=' + encodeURIComponent(id))).data
const roster = async (session) => (await api(session, '/api/custom-mode')).data.assistants
const text = (session, selector) => session.evaluate(`document.querySelector(${JSON.stringify(selector)})?.value ?? null`)
const disk = (id) => Object.fromEntries(['prompt.md', 'preset.yml', 'agent.cordis.yml'].map((file) => {
  const bytes = readFileSync(join(home, '.agent-presets', id, file))
  return [file, createHash('sha256').update(bytes).digest('hex')]
}))
const sameDisk = (id, before) => JSON.stringify(disk(id)) === JSON.stringify(before)
async function realSelector(session, selector) {
  const point = await session.centreOf(selector)
  await session.clickAt(point.x, point.y)
}
async function clickButton(session, labels) {
  await session.waitFor(`document.querySelector('.cpfe')?.getAttribute('aria-busy') === 'false'`, { label: 'plugin operation finishes before next button' })
  const clicked = await session.evaluate(`(() => {
    const labels = ${JSON.stringify(Array.isArray(labels) ? labels : [labels])};
    const button = [...document.querySelectorAll('.cpfe button')].find(el => labels.includes((el.textContent || '').trim()) && !el.disabled);
    if (!button) return false;
    button.click(); return true;
  })()`)
  if (!clicked) throw new Error('No enabled plugin button: ' + labels)
  await pause(180)
}
async function nav(session, labels) {
  for (const label of labels) {
    try { await session.clickTextReal(label, { exact: true }); await pause(180); return } catch {}
  }
  throw new Error('No native navigation item: ' + labels.join('/'))
}
async function openSection(session) {
  await nativeSettings(session)
  await nav(session, [zh.nav, en.nav])
  await session.waitFor(`document.querySelector('.cpfe-editor') !== null && document.querySelector('.cpfe')?.getAttribute('aria-busy') === 'false'`, { timeoutMs: 15000, label: 'real custom mode editor' })
}
async function initialize(session) {
  for (let round = 0; round < 5; round += 1) {
    let clicked = false
    for (const label of ['Got it', '知道了', 'Configure later', '稍后配置', 'Continue', '继续', 'Close', '关闭']) {
      try { await session.clickTextReal(label); clicked = true; await pause(150); break } catch {}
    }
    if (!clicked) break
  }
  await nativeSettings(session)
  await general(session)
  await language(session, '中文')
  await openSection(session)
}
async function general(session) {
  await nav(session, ['通用设置', 'General'])
}
async function nativeSettings(session) {
  const settingsMounted = `document.querySelector('[class*=navCell],.cpfe') !== null`
  if (await session.evaluate(settingsMounted)) return
  // Page.close's canceled beforeunload can change the active Chrome target.
  // Pointer commands must address the foreground page after a refresh/close test.
  await session.send('Page.bringToFront')
  // rc1 has two unrelated "More" buttons. Wait for the exact native account
  // launcher after a document reload; the upper panels launcher has no Settings.
  const ready = `(() => {
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const buttons = [...document.querySelectorAll('button')].filter(visible);
    const account = buttons.find(el => ['Account menu','账户菜单','账号菜单'].includes(el.getAttribute('aria-label')));
    if (account) return { kind: 'account', label: account.getAttribute('aria-label') };
    const direct = buttons.find(el => ['Settings','设置'].includes((el.textContent || '').trim()) || ['Settings','设置'].includes(el.getAttribute('aria-label')));
    return direct ? { kind: 'direct', label: direct.getAttribute('aria-label') || direct.textContent.trim() } : false;
  })()`
  const launcher = await session.waitFor(ready, { timeoutMs: 15000, label: 'native settings launcher finishes mounting' })
  const navigation = { target: session.testTargetId, launcher }
  report.navigationAttempts ??= []
  report.navigationAttempts.push(navigation)
  const focused = await session.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === ${JSON.stringify(launcher.label)} || el.textContent.trim() === ${JSON.stringify(launcher.label)});
    button?.focus();
    window.__draftNavigationEvents = [];
    for (const type of ['keydown','keyup','click']) document.addEventListener(type, event => {
      const button = event.target.closest('button');
      window.__draftNavigationEvents.push({ type, trusted: event.isTrusted, label: button?.getAttribute('aria-label') ?? null });
    }, { once: true, capture: true });
    return Boolean(button && document.activeElement === button);
  })()`)
  if (!focused) throw new Error('Native settings launcher could not receive focus')
  // Use its actual focused Button and trusted keyboard activation. On Windows
  // headless Chrome a reload after canceled Page.close produced a pointer target
  // outside the hit-tested Button; the retained failed attempts record that.
  navigation.activation = 'native focused Button with trusted Enter'
  for (const type of ['keyDown', 'keyUp']) await session.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) })
  navigation.afterActivation = await session.evaluate(`({ focused: document.hasFocus(), visibility: document.visibilityState, events: window.__draftNavigationEvents, expanded: [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label') === ${JSON.stringify(launcher.label)})?.getAttribute('aria-expanded') })`)
  persist()
  if (launcher.kind === 'account') {
    const optionExpression = `(() => {
      const item = [...document.querySelectorAll('[role=menuitem]')].find(el => /^(设置|Settings)/.test((el.textContent || '').trim()));
      if (!item) return false; const r = item.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : false;
    })()`
    const option = await session.waitFor(optionExpression, { timeoutMs: 8000, label: 'native account menu exposes Settings' })
    await session.clickAt(option.x, option.y)
  }
  await session.waitFor(settingsMounted, { timeoutMs: 10000, label: 'native settings dialog finishes mounting' })
}
async function language(session, label) {
  const selector = await session.evaluate(`(() => {
    const node = [...document.querySelectorAll('div,span')].find(el => [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim().match(/^(语言|Language)$/));
    let current = node;
    for (let depth = 0; current && depth < 7; depth++, current = current.parentElement) {
      const button = current.querySelector('button');
      if (button) { const r = button.getBoundingClientRect(); return { current: (button.textContent || '').trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    }
    return null;
  })()`)
  if (!selector) throw new Error('No native language control')
  if (selector.current === label) return
  await session.clickAt(selector.x, selector.y)
  await pause(180)
  await nav(session, [label])
}
async function pickAssistant(session, name) {
  // The API can expose a newly created assistant before the page's own follow-up
  // reload finishes. Wait for that UI operation before touching its native menu.
  await session.waitFor(`document.querySelector('.cpfe')?.getAttribute('aria-busy') === 'false' && document.querySelector('.cpfe-picker button')?.disabled === false`, { label: 'assistant picker finishes loading' })
  await realSelector(session, '.cpfe-picker button')
  await session.waitFor(`document.querySelector('[role=menuitem]') !== null`, { label: 'native assistant menu opens' })
  const picked = await session.evaluate(`(() => {
    const item = [...document.querySelectorAll('[role=menuitem]')].find(el => (el.textContent || '').trim().startsWith(${JSON.stringify(name)}));
    if (!item) return false; item.click(); return true;
  })()`)
  if (!picked) {
    const observed = await session.evaluate(`[...document.querySelectorAll('[role=menuitem]')].map(el => el.textContent.trim())`)
    throw new Error('Assistant is missing from native menu: ' + JSON.stringify(observed))
  }
  await session.waitFor(`document.querySelector('.cpfe-field input')?.value === ${JSON.stringify(name)} && document.querySelector('.cpfe')?.getAttribute('aria-busy') === 'false'`, { label: 'selected synthetic assistant' })
}
async function dialogAction(session, accept, action, message) {
  const before = session.dialogs.length
  session.dialogPolicy = accept ? 'accept' : 'dismiss'
  await action()
  await session.waitFor(`true`, { timeoutMs: 500 })
  const deadline = Date.now() + 2500
  while (session.dialogs.length === before && Date.now() < deadline) await pause(30)
  const seen = session.dialogs.slice(before)
  session.dialogPolicy = 'dismiss'
  return seen.length === 1 && seen[0].accepted === accept && (message === undefined || seen[0].message === message) ? seen[0] : null
}
async function discard(session) {
  const dialog = await dialogAction(session, true, () => clickButton(session, [zh['btn.reloadDiscard'], en['btn.reloadDiscard']]), zh['btn.reloadConfirm'])
  await session.waitFor(`document.querySelector('.cpfe-editor')?.readOnly === false && ![...document.querySelectorAll('.cpfe button')].some(el => ${JSON.stringify([zh['btn.reloadDiscard'], en['btn.reloadDiscard']])}.includes(el.textContent.trim()))`, { label: 'explicit discard finishes' })
  return dialog
}
async function save(session, id, prompt) {
  await session.waitFor(`document.querySelector('.cpfe')?.getAttribute('aria-busy') === 'false'`, { label: 'editor is ready for synthetic input' })
  await session.fill('.cpfe-editor', prompt)
  await clickButton(session, [zh['btn.save'], en['btn.save']])
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const loaded = await state(session, id)
    if (loaded.prompt === prompt && await text(session, '.cpfe-editor') === prompt && await session.evaluate(`document.querySelector('.cpfe-editor')?.readOnly === false`)) return loaded
    await pause(80)
  }
  throw new Error('Synthetic prompt save did not reach disk')
}
async function reloadPage(session) {
  const before = session.dialogs.length
  const loaded = session.once('Page.loadEventFired', 10000)
  await session.send('Page.reload')
  await loaded
  await session.setViewport(1440, 1000, 1)
  await session.send('Page.bringToFront')
  await pause(250)
  return session.dialogs.length === before
}

let session, other, id
try {
  session = await newPage()
  await initialize(session)
  requireCheck('real custom settings page is mounted', await session.evaluate(`document.querySelector('.cpfe') !== null`))
  const top = await session.evaluate(`(() => {
    const el = document.querySelector('[data-create-entry]');
    return el && { tag: el.tagName, native: [...el.classList].some(name => !name.startsWith('cpfe-')), label: el.textContent.trim() };
  })()`)
  check('top creation entry is a native Button with translated text', top?.tag === 'BUTTON' && top.native && top.label === zh['btn.newAssistant'], top)
  await realSelector(session, '[data-create-entry]')
  check('real pointer click on top entry focuses creation name', await session.evaluate(`document.activeElement === document.querySelector('.cpfe-newinput input')`))
  const before = await roster(session)
  const name = 'Synthetic browser draft ' + Date.now()
  await session.fill('.cpfe-newinput input', name)
  const compositionBoundary = await session.evaluate(`(() => {
    const el = document.querySelector('.cpfe-newinput input');
    el.dispatchEvent(new CompositionEvent('compositionstart', { data: '中', bubbles: true }));
    const key = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true, bubbles: true, cancelable: true });
    el.dispatchEvent(key);
    el.dispatchEvent(new CompositionEvent('compositionend', { data: '中文', bubbles: true }));
    return { composing: key.isComposing, keyCode: key.keyCode, trusted: key.isTrusted };
  })()`)
  await pause(220)
  check('DOM composition Enter does not create an assistant', compositionBoundary.composing === true && compositionBoundary.keyCode === 13 && compositionBoundary.trusted === false && (await roster(session)).length === before.length && await text(session, '.cpfe-newinput input') === name, compositionBoundary)
  const fallbackBoundary = await session.evaluate(`(() => { const key = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, bubbles: true, cancelable: true }); document.querySelector('.cpfe-newinput input').dispatchEvent(key); return { composing: key.isComposing, keyCode: key.keyCode, trusted: key.isTrusted }; })()`)
  await pause(220)
  check('DOM IME keyCode 229 Enter does not create an assistant', fallbackBoundary.composing === false && fallbackBoundary.keyCode === 229 && fallbackBoundary.trusted === false && (await roster(session)).length === before.length, fallbackBoundary)
  await realSelector(session, '.cpfe-newinput input')
  for (const type of ['keyDown', 'keyUp']) await session.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 })
  await session.waitFor(`document.querySelector('.cpfe-picker button')?.textContent.includes(${JSON.stringify(name)}) && document.querySelector('.cpfe')?.getAttribute('aria-busy') === 'false'`, { label: 'ordinary Enter creates selected assistant' })
  const created = (await roster(session)).filter(item => item.name === name)
  id = created[0]?.id
  requireCheck('ordinary trusted Enter creates exactly one synthetic assistant', created.length === 1 && (await roster(session)).length === before.length + 1)
  check('creation selects and focuses the editor', await session.evaluate(`document.activeElement?.hasAttribute('data-assistant-editor') === true && document.activeElement.getBoundingClientRect().top >= 0 && document.activeElement.getBoundingClientRect().top < innerHeight`))
  check('successful creation clears the pending name', await text(session, '.cpfe-newinput input') === '')
  const createdState = await state(session, id)
  check('fresh Standard assistant has no failed platform predicate', createdState.mode === 'standard' && !createdState.warnings.includes('predicateFailed'), { mode: createdState.mode, warnings: createdState.warnings })
  const nativeResponse = await api(session, '/api/dsh-browser-native-row-probe?id=' + encodeURIComponent(id))
  const nativeManager = nativeResponse.data
  const flattenRows = (rows) => rows.flatMap(row => [row, ...flattenRows(row.children ?? [])])
  const managerRow = flattenRows(createdState.rows).find(row => row.id === 'tool-plugin-manager')
  const effectiveManager = managerRow ? createdState.overrides['tool-plugin-manager'] ?? !managerRow.disabled : undefined
  await session.evaluate(`(() => { const toggle = document.querySelector('[data-cap=toggle]'); if (toggle?.getAttribute('aria-expanded') !== 'true') toggle?.click(); return true; })()`)
  await session.waitFor(`document.querySelector('.cpfe-row [role=switch]') !== null`, { label: 'native plugin switches render' })
  const managerSwitch = await session.evaluate(`(() => {
    const row = [...document.querySelectorAll('.cpfe-row')].find(el => el.querySelector('.cpfe-row-head')?.textContent.trim() === ${JSON.stringify(zh['row.tool-plugin-manager.label'])});
    return row?.querySelector('[role=switch]')?.getAttribute('aria-checked') ?? null;
  })()`)
  const profileCondition = typeof nativeManager?.row?.condition === 'string' && /^!\s*ctx\s*\.\s*get\s*\(\s*(['"])profileContext\1\s*\)\s*$/.test(nativeManager.row.condition)
  check('plugin manager effective state and native Switch match official host inventory', nativeManager?.ok === true && typeof nativeManager.profileContext === 'boolean' && typeof nativeManager.row?.enabled === 'boolean' &&
    (!profileCondition || nativeManager.row.enabled === nativeManager.profileContext) && effectiveManager === nativeManager.row.enabled && managerSwitch === String(nativeManager.row.enabled),
    { status: nativeResponse.status, native: nativeManager, profileCondition, declaredEnabled: effectiveManager, switchChecked: managerSwitch })
  await session.evaluate(`document.querySelector('[data-cap=toggle]')?.click()`)
  const first = 'Synthetic browser history one.\n'
  const second = 'Synthetic browser history two.\n'
  await save(session, id, first)
  await save(session, id, second)
  requireCheck('real UI saves two versions and writes the synthetic prompt', readFileSync(join(home, '.agent-presets', id, 'prompt.md'), 'utf8') === second)
  const diskBefore = disk(id)
  const draft = 'Synthetic unsaved replacement draft.\n'
  await session.fill('.cpfe-editor', draft)
  const resetCancel = await dialogAction(session, false, () => clickButton(session, zh['btn.reset']), zh['prompt.replaceConfirm'])
  check('dirty reset has a real cancelable native confirmation', resetCancel?.type === 'confirm')
  check('canceling reset preserves draft and all three disk files', await text(session, '.cpfe-editor') === draft && sameDisk(id, diskBefore))
  const factory = (await state(session, id)).factoryPrompt
  const resetAccept = await dialogAction(session, true, () => clickButton(session, zh['btn.reset']), zh['prompt.replaceConfirm'])
  check('accepting reset changes only the draft', resetAccept?.type === 'confirm' && await text(session, '.cpfe-editor') === factory && sameDisk(id, diskBefore))
  requireCheck('explicit discard restores saved prompt', (await discard(session))?.type === 'confirm' && await text(session, '.cpfe-editor') === second)

  const imported = 'Synthetic UTF-8 imported prompt 中文.\n'
  const importedFile = prefix + '-import.md'
  writeFileSync(importedFile, imported)
  const importFile = async () => {
    const { root } = await session.send('DOM.getDocument')
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.cpfe input[type=file]' })
    if (!nodeId) throw new Error('No real import file input')
    await session.send('DOM.setFileInputFiles', { nodeId, files: [importedFile] })
    await pause(150)
  }
  await session.fill('.cpfe-editor', draft)
  const importCancel = await dialogAction(session, false, importFile, zh['prompt.replaceConfirm'])
  check('canceling dirty file import preserves draft and disk', importCancel?.type === 'confirm' && await text(session, '.cpfe-editor') === draft && sameDisk(id, diskBefore))
  const importAccept = await dialogAction(session, true, importFile, zh['prompt.replaceConfirm'])
  await session.waitFor(`document.querySelector('.cpfe-editor')?.value === ${JSON.stringify(imported)}`, { label: 'real FileReader loads synthetic file' })
  check('accepting real file import changes only the draft', importAccept?.type === 'confirm' && sameDisk(id, diskBefore))

  const history = (await state(session, id)).history
  const oldest = history.at(-1)
  requireCheck('real saved history is available for replacement', history.length >= 2 && Number.isInteger(oldest?.n))
  const version = (await api(session, '/api/custom-mode/history?id=' + encodeURIComponent(id) + '&n=' + oldest.n)).data.text
  await realSelector(session, '.cpfe-history button')
  await session.evaluate(`(() => { const options = [...document.querySelectorAll('[role=menuitem]')]; if (!options.length) throw new Error('History menu is empty'); options.at(-1).click(); return true; })()`)
  const historyCancel = await dialogAction(session, false, () => clickButton(session, zh['history.load']), zh['prompt.replaceConfirm'])
  check('canceling dirty history load preserves draft and disk', historyCancel?.type === 'confirm' && await text(session, '.cpfe-editor') === imported && sameDisk(id, diskBefore))
  const historyAccept = await dialogAction(session, true, () => clickButton(session, zh['history.load']), zh['prompt.replaceConfirm'])
  await session.waitFor(`document.querySelector('.cpfe-editor')?.value === ${JSON.stringify(version)}`, { label: 'accepted history draft' })
  check('accepting history load changes only the draft', historyAccept?.type === 'confirm' && sameDisk(id, diskBefore))
  requireCheck('discard after replacement restores disk baseline', (await discard(session))?.type === 'confirm' && await text(session, '.cpfe-editor') === second)

  await session.fill('.cpfe-editor', draft)
  const beforeDuplicate = await roster(session)
  const duplicateCancel = await dialogAction(session, false, () => clickButton(session, zh['btn.duplicate']), zh['assistant.duplicateSavedConfirm'])
  check('canceling duplicate explicitly preserves the unsaved source', duplicateCancel?.type === 'confirm' && (await roster(session)).length === beforeDuplicate.length && await text(session, '.cpfe-editor') === draft && sameDisk(id, diskBefore))
  const duplicateAccept = await dialogAction(session, true, () => clickButton(session, zh['btn.duplicate']), zh['assistant.duplicateSavedConfirm'])
  const duplicateDeadline = Date.now() + 10000
  let duplicate
  while (Date.now() < duplicateDeadline) {
    duplicate = (await roster(session)).find(item => !beforeDuplicate.some(known => known.id === item.id))
    if (duplicate) break
    await pause(70)
  }
  requireCheck('confirmed duplicate really creates a separate assistant', duplicateAccept?.type === 'confirm' && Boolean(duplicate))
  check('duplicate uses saved source bytes while source disk remains unchanged', (await state(session, duplicate.id)).prompt === second && sameDisk(id, diskBefore))
  await pickAssistant(session, name)
  check('returning from the duplicate preserves the source draft', await text(session, '.cpfe-editor') === draft)

  await session.fill('.cpfe-field input', name + ' local draft')
  await session.fill('.cpfe-desc', 'Synthetic local description draft')
  await session.fill('.cpfe-newinput input', 'Synthetic unfinished creation')
  await general(session)
  check('host navigation really unmounts the plugin section', await session.evaluate(`document.querySelector('.cpfe') === null`))
  await session.evaluate(`window.__draftReloadMarker = 'synthetic document marker'`)
  const refreshDialog = await dialogAction(session, false, () => session.send('Page.reload'))
  check('refresh from another host settings page shows real beforeunload', refreshDialog?.type === 'beforeunload')
  check('canceling refresh retains the original document', await session.evaluate(`window.__draftReloadMarker === 'synthetic document marker'`))
  const closeDialog = await dialogAction(session, false, () => session.send('Page.close'))
  const targetsAfterClose = (await session.send('Target.getTargets')).targetInfos
  check('closing the dirty page has a cancelable real beforeunload', closeDialog?.type === 'beforeunload' && targetsAfterClose.some(page => page.targetId === session.testTargetId))
  await openSection(session)
  check('returning from host settings preserves prompt metadata and pending creation', await text(session, '.cpfe-editor') === draft && await text(session, '.cpfe-field input') === name + ' local draft' && await text(session, '.cpfe-desc') === 'Synthetic local description draft' && await text(session, '.cpfe-newinput input') === 'Synthetic unfinished creation' && sameDisk(id, diskBefore))
  await session.fill('.cpfe-newinput input', '')
  requireCheck('explicit discard removes the retained assistant draft', (await discard(session))?.type === 'confirm' && await text(session, '.cpfe-editor') === second)
  check('refresh after explicit discard has no beforeunload dialog', await reloadPage(session))
  await openSection(session)
  await pickAssistant(session, name)
  await save(session, id, first)
  check('refresh after successful UI save has no beforeunload dialog', await reloadPage(session))
  await openSection(session)
  await pickAssistant(session, name)

  const beforeReorder = await state(session, id)
  const reorderDraft = 'Synthetic prompt retained through own reorder.\n'
  await session.fill('.cpfe-editor', reorderDraft)
  await clickButton(session, zh['btn.moveUp'])
  const reorderDeadline = Date.now() + 10000
  let reordered = beforeReorder
  while (Date.now() < reorderDeadline) {
    reordered = await state(session, id)
    if (reordered.revision !== beforeReorder.revision && await session.evaluate(`document.querySelector('.cpfe')?.getAttribute('aria-busy') === 'false'`)) break
    await pause(70)
  }
  check('own UI reorder advances metadata revision and retains prompt draft', reordered.revision !== beforeReorder.revision && await text(session, '.cpfe-editor') === reorderDraft && readFileSync(join(home, '.agent-presets', id, 'prompt.md'), 'utf8') === first)
  await clickButton(session, zh['btn.save'])
  await session.waitFor(`document.querySelector('.cpfe-editor')?.readOnly === false && ![...document.querySelectorAll('.cpfe button')].some(el => el.textContent.trim() === ${JSON.stringify(zh['btn.reloadDiscard'])})`, { label: 'save after own reorder completes without conflict' })
  check('save after own reorder accepts the advanced revision', readFileSync(join(home, '.agent-presets', id, 'prompt.md'), 'utf8') === reorderDraft)
  await save(session, id, first)

  other = await newPage()
  await initialize(other)
  await pickAssistant(other, name)
  const localConflictDraft = 'Synthetic tab A draft survives metadata conflict.\n'
  await session.fill('.cpfe-editor', localConflictDraft)
  await other.fill('.cpfe-desc', 'Synthetic tab B saved metadata')
  await clickButton(other, zh['btn.save'])
  const savedDeadline = Date.now() + 10000
  while ((await state(other, id)).description !== 'Synthetic tab B saved metadata' && Date.now() < savedDeadline) await pause(70)
  const remote = await state(other, id)
  requireCheck('second real browser page saves metadata without changing prompt', remote.description === 'Synthetic tab B saved metadata' && remote.prompt === first)
  const afterRemote = disk(id)
  await clickButton(session, zh['btn.save'])
  await session.waitFor(`document.querySelector('.cpfe-status')?.textContent.includes(${JSON.stringify(zh['api.conflict'])})`, { label: 'real UI metadata revision conflict' })
  check('stale real UI save displays translated metadata conflict and keeps draft', await text(session, '.cpfe-editor') === localConflictDraft && sameDisk(id, afterRemote))
  check('conflict result leaves remote metadata and prompt intact', (await state(session, id)).description === remote.description && readFileSync(join(home, '.agent-presets', id, 'prompt.md'), 'utf8') === first)
  const cleanCloseBefore = other.dialogs.length
  await other.send('Page.close')
  await pause(180)
  const afterCleanClose = (await session.send('Target.getTargets')).targetInfos
  check('closing a saved clean page shows no beforeunload', other.dialogs.length === cleanCloseBefore && !afterCleanClose.some(page => page.targetId === other.testTargetId))
  requireCheck('explicit discard after conflict loads remote metadata', (await discard(session))?.type === 'confirm' && await text(session, '.cpfe-desc') === remote.description && await text(session, '.cpfe-editor') === first)

  for (const locale of ['zh', 'en']) {
    const dictionary = locale === 'zh' ? zh : en
    for (const theme of ['light', 'dark']) {
      await session.setViewport(1440, 1000, 1)
      await general(session)
      await language(session, locale === 'zh' ? '中文' : 'English')
      await nav(session, theme === 'light' ? ['浅色', 'Light'] : ['深色', 'Dark'])
      await openSection(session)
      const themeFact = await session.evaluate(`({ html: document.documentElement.className, body: document.body.className, scheme: getComputedStyle(document.documentElement).colorScheme, background: getComputedStyle(document.querySelector('[role=dialog]')).backgroundColor, label: getComputedStyle(document.querySelector('.cpfe-h')).color, inputBackground: getComputedStyle(document.querySelector('.cpfe-editor')).backgroundColor })`)
      for (const width of [1440, 480]) {
        await session.setViewport(width, 1000, 1)
        await session.evaluate(`document.querySelector('.cpfe').scrollIntoView({ block: 'start', behavior: 'instant' })`)
        // Resizing can leave the old desktop pointer over a different narrow-
        // screen Button. Compare default native states, including the clone.
        await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0, button: 'none' })
        await pause(180)
        const facts = await session.evaluate(`(() => {
          const panel = document.querySelector('.cpfe');
          const dialog = panel.closest('[role=dialog]');
          const controls = [...panel.querySelectorAll('[data-create-entry],.cpfe-newrow button,.cpfe-newinput')];
          const props = ['fontFamily','fontSize','fontWeight','lineHeight','paddingLeft','paddingRight','height','borderTopLeftRadius','backgroundColor','color','opacity'];
          const nativeDiffs = [];
          const native = controls.every(el => {
            const clone = el.cloneNode(true); clone.className = [...el.classList].filter(name => !name.startsWith('cpfe-')).join(' ');
            clone.style.position = 'absolute'; clone.style.visibility = 'hidden'; el.parentElement.append(clone);
            const original = getComputedStyle(el), reference = getComputedStyle(clone);
            const differences = props.filter(prop => original[prop] !== reference[prop]).map(prop => ({ property: prop, original: original[prop], native: reference[prop] }));
            if (differences.length) nativeDiffs.push({ label: el.textContent.trim(), classes: el.className, differences });
            clone.remove(); return differences.length === 0;
          });
          return { label: panel.querySelector('[data-create-entry]')?.textContent.trim(),
            docWidth: document.documentElement.scrollWidth, viewport: innerWidth,
            panelScroll: panel.scrollWidth, panelWidth: panel.clientWidth,
            dialogWidth: dialog?.getBoundingClientRect().width, native, nativeDiffs, controls: controls.length,
            raw: /btn\.newAssistant|assistant\.heading|prompt\.replaceConfirm/.test(panel.innerText),
            predicateWarning: panel.innerText.includes(${JSON.stringify(dictionary['warn.predicateFailed'])}) };
        })()`)
        check(`${locale} ${theme} ${width}px renders translated native controls without horizontal overflow`, facts.label === dictionary['btn.newAssistant'] && !facts.raw && !facts.predicateWarning && facts.native && facts.controls >= 3 && facts.docWidth <= width + 1 && facts.panelScroll <= facts.panelWidth + 1 && facts.dialogWidth <= width + 1, { ...facts, theme: themeFact })
        const picture = `${prefix}-${locale}-${theme}-${width}.png`
        await session.screenshot(picture)
        report.screenshots.push({ locale, theme, width, path: picture, observedTheme: themeFact })
        persist()
      }
    }
  }
  const light = report.screenshots.find(shot => shot.locale === 'zh' && shot.theme === 'light')?.observedTheme
  const dark = report.screenshots.find(shot => shot.locale === 'zh' && shot.theme === 'dark')?.observedTheme
  check('native UI theme choices produce different rendered theme facts', JSON.stringify(light) !== JSON.stringify(dark), { light, dark })
} catch (error) {
  check('browser draft regression exception', false, redact(error.stack ?? error.message))
  if (session) {
    try {
      report.failureDom = await session.evaluate(`({ text: document.body.innerText.slice(0, 4000), buttons: [...document.querySelectorAll('button')].map(el => ({ text: el.textContent.trim(), label: el.getAttribute('aria-label'), expanded: el.getAttribute('aria-expanded') })), menus: [...document.querySelectorAll('[role=menuitem]')].map(el => el.textContent.trim()) })`)
      await session.screenshot(prefix + '-failed.png')
    } catch {}
  }
} finally {
  const browserConnection = sessions[0]
  if (browserConnection) {
    browserConnection.sessionId = undefined
    for (const targetId of pages) await browserConnection.send('Target.closeTarget', { targetId }).catch(() => undefined)
  }
  for (const active of sessions) active.close()
  const passed = report.checks.filter(item => item.passed).length
  report.passed = passed
  report.failed = report.checks.length - passed
  persist()
  console.log(`Draft regression: ${passed} passed, ${report.failed} failed`)
}
process.exitCode = report.failed > 0 ? 1 : 0
