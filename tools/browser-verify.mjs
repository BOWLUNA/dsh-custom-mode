/**
 * Browser verification: drive the real settings page and assert what it renders.
 *
 * Why this exists: every other check in this repo is blind to the last mile. The unit
 * suites prove the host half answers correctly and the bundle registers, and
 * `test/client-bundle.test.mjs` proves the registration contract — but none of them can
 * see a rendered page. The failure that motivated this file was exactly of that kind: every
 * function was correct, the page appeared, and it was a wall of raw keys
 * (`assistant.heading`, `btn.create`) because the `settings.section` contract had dropped the
 * `locale:` option. Nothing in the suite could have caught it; one look could.
 *
 * So this drives a real browser against a real instance and asserts:
 *
 *   1. no raw translation keys are visible anywhere in the section;
 *   2. the section's copy is translated (Chinese here, from the dictionaries);
 *   3. the controls this feature adds are present (order, duplicate, import/export);
 *   4. the assistant round trip works through the UI: create → it appears → delete via the
 *      shell's risk confirmation → it is gone.
 *
 * It needs a browser with a DevTools port, not a running dsh — booting the instance is the
 * caller's job (see `docs/ARCHITECTURE.md` §17 and the repository AGENTS.md for the lab).
 *
 * Usage:
 *   node tools/browser-verify.mjs --url "http://127.0.0.1:3082/?token=…" [--out shot.png]
 *
 * Environment: `CDP_HOST` (default 127.0.0.1) and `CDP_PORT` (default 9222), the same knobs
 * `tools/screenshots/cdp.mjs` reads.
 */

import { writeFileSync } from 'node:fs'
import { connect } from './screenshots/cdp.mjs'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 || argv[index + 1] === undefined ? fallback : argv[index + 1]
}

const url = arg('--url', '')
const out = arg('--out', '')
if (url === '') {
  console.error('用法: node tools/browser-verify.mjs --url "<带 token 的 URL>" [--out 截图.png]')
  process.exit(2)
}

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

/** Every key this page can render. A raw key on screen is the bug this file exists for. */
const RAW_KEYS = [
  'assistant.heading',
  'assistant.hint',
  'assistant.newPlaceholder',
  'assistant.switchHint',
  'assistant.broken',
  'assistant.empty',
  'assistant.loadingList',
  'name.heading',
  'name.hint',
  'mode.heading',
  'mode.hint',
  'rows.heading',
  'rows.hint',
  'prompt.heading',
  'prompt.hint',
  'btn.create',
  'btn.duplicate',
  'btn.moveUp',
  'btn.moveDown',
  'btn.import',
  'btn.export',
  'btn.delete',
  'btn.save',
  'btn.reload',
  'status.enabled',
  'status.disabled',
  'tag.essential',
  'tag.followPlatform',
  'status.changed',
  'msg.readOnlyHint',
  'msg.unsaved',
  'delete.title',
  'delete.acknowledge',
  'delete.confirm',
  'nav',
]

const session = await connect()
const logs = []
session.listeners.push((message) => {
  if (message.method === 'Runtime.consoleAPICalled') {
    const text = (message.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ')
    logs.push(`[${message.params.type}] ${text}`)
  }
})

try {
  await session.setViewport(1440, 900, 1)
  await session.setColorScheme('dark')
  await session.goto(url, { waitMs: 3500 })

  /**
   * Clear first-run overlays.
   *
   * A fresh `DSH_HOME` shows a testing notice and an API-key prompt, each behind a mask that
   * intercepts pointer events — and an intercepted click is indistinguishable from a dead
   * control, so this runs until no overlay is left rather than assuming one.
   */
  const clearOverlays = async () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const present = await session.evaluate(`(() => {
        const dialogs = [...document.querySelectorAll('[role=dialog]')].filter((el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        return dialogs.length;
      })()`)
      if (present === 0) return attempt
      // A notice can gate its button behind an acknowledgement checkbox.
      await session.evaluate(`(() => {
        const box = document.querySelector('[role=dialog] input[type=checkbox]');
        if (box !== null && box.checked !== true) box.click();
        return true;
      })()`)
      let clicked = false
      for (const label of ['知道了', '我明白', '跳过', '以后再说', '稍后', '关闭', '继续', '开始使用', 'Got it', 'I understand', 'Skip', 'Later', 'Close', 'Continue', 'Dismiss']) {
        try {
          await session.clickTextReal(label, { exact: false })
          clicked = true
          break
        } catch {
          /* try the next label */
        }
      }
      if (!clicked) await session.pressEscape()
      await session.sleep(800)
    }
    return -1
  }
  const cleared = await clearOverlays()
  check('首启遮罩被清掉（否则下面的点击都会被拦）', cleared >= 0, `still present after 8 attempts`)

  // ── 打开 设置 → 自定义模式 ─────────────────────────────────────────────────
  const openSection = async () => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await session.clickTextReal('设置', { exact: true })
      } catch {
        await session.clickTextReal('Settings', { exact: true })
      }
      await session.sleep(1200)
      try {
        await session.clickTextReal('自定义模式', { exact: true })
      } catch {
        await session.clickTextReal('Custom mode', { exact: true })
      }
      await session.sleep(2200)
      const ready = await session.evaluate(`document.querySelector('.cpfe') !== null`)
      if (ready === true) return true
    }
    return false
  }
  const opened = await openSection()
  check('能打开「自定义模式」设置页', opened === true, (await session.visibleText()).slice(0, 400).replace(/\n/g, ' | '))

  if (opened === true) {
    const panel = await session.evaluate(`(() => {
      const el = document.querySelector('.cpfe');
      return el === null ? '' : el.innerText;
    })()`)

    // ── 1. 没有裸键 ────────────────────────────────────────────────────────
    const leaked = RAW_KEYS.filter((key) => panel.includes(key))
    check('面板里没有裸翻译键', leaked.length === 0, JSON.stringify(leaked))

    // ── 2. 文案是翻译过的 ──────────────────────────────────────────────────
    for (const [label, needle] of [
      ['区块标题「助手」', '助手'],
      ['「新增助手」按钮', '新增助手'],
      ['「上移」按钮', '上移'],
      ['「下移」按钮', '下移'],
      ['「复制一份」按钮', '复制一份'],
      ['「导出提示词」按钮', '导出提示词'],
      ['「导入提示词」按钮', '导入提示词'],
      ['「恢复出厂提示词」按钮', '恢复出厂提示词'],
      ['系统提示词区块', '系统提示词'],
      ['基础模式区块', '基础模式'],
      ['插件开关区块', '插件开关'],
    ]) {
      check(`渲染出${label}`, panel.includes(needle), panel.slice(0, 300).replace(/\n/g, ' | '))
    }

    // 行标题必须可见：Switch 的 label 只进 aria-label，标题得由页面自己画。
    const rowTitles = await session.evaluate(`(() => {
      const heads = [...document.querySelectorAll('.cpfe-row-head')].map((el) => el.textContent.trim());
      const switches = [...document.querySelectorAll('[role=switch]')].length;
      return { heads, switches };
    })()`)
    check('每个开关都有可见行标题', rowTitles.heads.length > 0 && rowTitles.heads.every((t) => t !== ''), JSON.stringify(rowTitles))

    // 导航项不能是裸键 nav。
    const navLabel = await session.evaluate(`(() => {
      const el = [...document.querySelectorAll('*')].find((node) =>
        (node.textContent || '').trim() === 'nav' && node.children.length === 0);
      return el === undefined ? null : 'nav';
    })()`)
    check('左侧导航项不是裸键 nav', navLabel === null, String(navLabel))

    // ── 2.5 「恢复出厂提示词」：改坏了要能一键回去 ──────────────────────────
    //
    // 这条功能对应用户反馈："提示词改坏之后只能删掉整个助手"。它必须只改**草稿** ——
    // 一次误点不能落盘，所以这里同时验证「点了能回去」与「重新读取能撤销」。
    /**
     * 按文案点一个按钮，用程序化点击而不是真实鼠标坐标。
     *
     * 为什么：真实点击落在元素中心的那个点上，布局一变（比如历史控件把页面撑高）就可能被别的
     * 元素盖住 —— 实测：点「重新读取」没反应，而同一按钮在探针里程序化点击完全正常。
     */
    const clickButton = async (needle) => {
      const result = await session.evaluate(`(() => {
        const buttons = [...document.querySelectorAll('button,[role=button]')];
        const target = buttons.find((el) => (el.textContent || '').includes(${JSON.stringify(needle)}) && el.disabled !== true);
        if (target === undefined) return 'not-found';
        target.click();
        return 'clicked';
      })()`)
      await session.sleep(900)
      return result
    }

    /** 磁盘上真实的提示词：直接问插件（比"页面早先显示过什么"可靠 —— 页面可能被别处改过）。 */
    const savedPrompt = async () => {
      const id = await session.evaluate(`(() => {
        const selected = document.querySelector('.cpfe-assistants button[aria-pressed=true], .cpfe-assistants button.cpfe-pill-active');
        return selected === null ? null : (selected.textContent || '').trim();
      })()`)
      return session.evaluate(`(async () => {
        const list = await fetch('/api/custom-mode', { headers: { accept: 'application/json' } }).then((r) => r.json());
        const first = Array.isArray(list.assistants) && list.assistants.length > 0 ? list.assistants[0].id : null;
        if (first === null) return null;
        const state = await fetch('/api/custom-mode/state?id=' + encodeURIComponent(first), { headers: { accept: 'application/json' } }).then((r) => r.json());
        return state.ok === true ? state.prompt : null;
      })()`)
    }

    const editorText = () =>
      session.evaluate(`(() => { const el = document.querySelector('.cpfe-editor'); return el === null ? null : el.value; })()`)

    const beforeReset = await savedPrompt()
    await session.fill('.cpfe-editor', '被改坏的提示词（浏览器验证）')
    await session.sleep(300)
    const broken = await editorText()
    check('能把编辑器内容改成任意文本（准备阶段）', broken === '被改坏的提示词（浏览器验证）', JSON.stringify(broken))

    check('点得到「恢复出厂提示词」按钮', (await clickButton('恢复出厂提示词')) === 'clicked')
    const afterReset = await editorText()
    check(
      '点「恢复出厂提示词」→ 编辑器变回出厂模板',
      typeof afterReset === 'string' && afterReset.includes('You are a coding agent powered by the {{model}} model'),
      JSON.stringify(afterReset === null ? null : afterReset.slice(0, 80)),
    )
    check('确实与改坏时不同', afterReset !== broken, JSON.stringify(afterReset).slice(0, 60))

    // 只改草稿：磁盘没被写，重新读取即可撤销。
    check('点得到「重新读取」按钮', (await clickButton('重新读取')) === 'clicked')
    const afterReload = await editorText()
    check('恢复只改草稿：重新读取回到磁盘上的文本', afterReload === beforeReset, `页面=${JSON.stringify((afterReload ?? '').slice(0, 40))} 磁盘=${JSON.stringify((beforeReset ?? '').slice(0, 40))}`)

    // ── 2.6 改动历史：会话内/手工改动看得见，旧版本载得回来 ────────────────
    //
    // 这条对应"提示词被谁改过"的可见性：在此之前，会话内的 custom_prompt 工具或手工编辑
    // 改掉 prompt.md，页面只会显示"当前文本"。这里真存两版、真点一次载入，并确认它只改草稿。
    const saveNow = async () => {
      await session.evaluate(`(() => {
        const button = [...document.querySelectorAll('button,[role=button]')]
          .find((el) => /^(保存|Save)$/.test(el.textContent.trim()));
        if (button !== undefined && button.disabled !== true) button.click();
        return true;
      })()`)
      await session.sleep(2600)
    }

    await session.fill('.cpfe-editor', '浏览器验证：第一版\n')
    await saveNow()
    await session.fill('.cpfe-editor', '浏览器验证：第二版\n')
    await saveNow()
    const savedSecond = await editorText()
    check('两次保存后编辑器里是第二版', savedSecond === '浏览器验证：第二版\n', JSON.stringify(savedSecond))

    const historyOptions = await session.evaluate(`(() => {
      const select = document.querySelector('.cpfe-history select');
      return select === null ? null : [...select.options].map((option) => ({ value: option.value, label: option.textContent.trim() }));
    })()`)
    check('出现历史控件且带至少两个版本', Array.isArray(historyOptions) && historyOptions.length >= 3, JSON.stringify(historyOptions))
    check('历史项显示来源（设置页保存）', (historyOptions ?? []).some((option) => option.label.includes('设置页保存')), JSON.stringify(historyOptions))

    // 选最早的一版（最后一个选项）并载入。
    const oldest = (historyOptions ?? [])[(historyOptions ?? []).length - 1]
    await session.evaluate(`(() => {
      const select = document.querySelector('.cpfe-history select');
      if (select === null) return false;
      select.value = ${JSON.stringify(oldest?.value ?? '')};
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`)
    await session.sleep(400)
    check('点得到「载入这一版」按钮', (await clickButton('载入这一版')) === 'clicked')
    const afterLoad = await editorText()
    check('载入旧版本 → 编辑器内容变了', afterLoad !== savedSecond, JSON.stringify(afterLoad === null ? null : afterLoad.slice(0, 50)))

    await clickButton('重新读取')
    {
      const onDisk = await savedPrompt()
      check(
        '载入只改草稿：重新读取回到磁盘上的文本',
        (await editorText()) === onDisk && onDisk === savedSecond,
        `页面=${JSON.stringify(((await editorText()) ?? '').slice(0, 30))} 磁盘=${JSON.stringify((onDisk ?? '').slice(0, 30))}`,
      )
    }

    // ── 3. 浏览器里跑一遍增删 ──────────────────────────────────────────────
    const created = '浏览器验证助手'
    await session.fill('.cpfe-newrow input', created)
    await session.clickTextReal('新增助手', { exact: false })
    await session.sleep(3000)
    /** The assistant pills only — the base-mode selector uses `.cpfe-pills` too. */
    const assistantPills = () =>
      session.evaluate(`[...document.querySelectorAll('.cpfe-assistants button')].map((el) => el.textContent.trim())`)

    const afterCreate = await assistantPills()
    check('新增后在列表里出现', afterCreate.some((text) => text.includes(created)), JSON.stringify(afterCreate))

    /**
     * The settings panel is itself `[role=dialog]`, so a confirmation has to be found by its
     * CONTENT among all dialogs — `querySelector('[role=dialog]')` finds the panel, not the
     * modal, which is how this check failed the first time it ran.
     */
    // 删掉它：走壳的风险确认弹窗，勾选后才真删。
    await session.clickTextReal('删除这个助手', { exact: false })
    await session.sleep(1600)
    const confirmText = await session.evaluate(`(() => {
      const dlg = [...document.querySelectorAll('[role=dialog]')]
        .find((el) => (el.innerText || '').includes('永久删除'));
      return dlg === undefined ? '' : dlg.innerText;
    })()`)
    check('删开风险确认弹窗', confirmText.includes('永久删除'), confirmText.slice(0, 120).replace(/\n/g, ' | '))

    const ticked = await session.evaluate(`(() => {
      const dlg = [...document.querySelectorAll('[role=dialog]')]
        .find((el) => (el.innerText || '').includes('永久删除'));
      if (dlg === undefined) return { ok: false };
      const box = dlg.querySelector('input[type=checkbox]');
      if (box !== null && box.checked !== true) box.click();
      return { ok: true, ticked: box !== null };
    })()`)
    check('弹窗里有「我明白」勾选框', ticked.ok === true && ticked.ticked === true, JSON.stringify(ticked))
    await session.sleep(600)

    const confirmed = await session.evaluate(`(() => {
      const dlg = [...document.querySelectorAll('[role=dialog]')]
        .find((el) => (el.innerText || '').includes('永久删除'));
      if (dlg === undefined) return { ok: false, reason: 'no dialog' };
      const buttons = [...dlg.querySelectorAll('button')];
      const target = buttons.find((b) => b.textContent.trim() === '永久删除');
      if (target === undefined) return { ok: false, reason: 'no confirm button', buttons: buttons.map((b) => b.textContent.trim()) };
      if (target.disabled === true) return { ok: false, reason: 'confirm disabled' };
      target.click();
      return { ok: true };
    })()`)
    check('点「永久删除」', confirmed.ok === true, JSON.stringify(confirmed))
    await session.sleep(3200)
    const afterDelete = await assistantPills()
    check('删除后从列表消失', !afterDelete.some((text) => text.includes(created)), JSON.stringify(afterDelete))

    // ── 4. 截图 ────────────────────────────────────────────────────────────
    if (out !== '') {
      await session.evaluate(`(() => {
        const el = document.querySelector('.cpfe');
        if (el !== null) el.scrollIntoView({ block: 'start', behavior: 'instant' });
        return true;
      })()`)
      await session.sleep(600)
      const shot = await session.screenshotElement('[role=dialog]', out, { margin: 0 })
      console.log(`  截图 → ${shot}`)
    }
  }

  const pageErrors = logs.filter((line) => line.startsWith('[error]') && line.includes('dsh-custom-mode'))
  check('页面没有报 dsh-custom-mode 的错误', pageErrors.length === 0, JSON.stringify(pageErrors))
  if (logs.length > 0) {
    console.log('  页面 console：')
    for (const line of logs.slice(0, 12)) console.log('    ' + line)
  }
} finally {
  session.close()
}

console.log()
console.log(`结果: ${passed} 通过, ${failed} 失败`)
if (failed > 0 && out !== '') {
  try {
    writeFileSync(`${out}.failed`, 'see the FAIL lines\n')
  } catch {
    /* best effort */
  }
}
process.exit(failed === 0 ? 0 : 1)
