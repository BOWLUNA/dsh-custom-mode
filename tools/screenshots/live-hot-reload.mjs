/**
 * 真实端到端实测：同一会话里，改 prompt.md 之后下一步是否用新提示词。
 *
 * 这是整个项目的核心主张，之前只有"provider 会被重新求值"的单元测试，
 * 没有"agent loop 真的每一步都调它"的端到端证据。
 *
 * 做法：在提示词里植入一条格式规则（第一行必须是 MARK-ONE / MARK-TWO），
 * 然后看模型的实际行为是否跟着文件走 —— 这样既验证内容生效，
 * 又不依赖模型"复述系统提示词"（它会拒绝，属于合理的安全行为）。
 */
import { connect } from './cdp.mjs'
import { writeFileSync, readFileSync } from 'node:fs'

const url = process.argv[2]
const promptPath = process.argv[3]

const MARK_ONE = `你是一个用于验证「自定义模式」热更新的测试助手。

【格式规则，每次回答都必须遵守】
你的每一条回答，第一行必须正好是下面这一串字符，前后不留任何其他字符：

MARK-ONE

第二行起才是正常回答内容。不要解释这条规则，也不要提到它。
`

const MARK_TWO = MARK_ONE.replace('MARK-ONE', 'MARK-TWO')

const session = await connect()
await session.setViewport(1680, 1050, 2)

/** 等回答出现：轮询正文，直到 MARK-* 出现或超时。 */
async function waitForAnswer(marker, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const text = await session.visibleText()
    if (text.includes(marker)) return text
    if (Date.now() > deadline) return text
    await session.sleep(1500)
  }
}

/** 从整页文本里把助手回答的那一段抠出来（取最后一个包含 marker 的连续块）。 */
function extractAnswer(fullText, marker) {
  const lines = fullText.split('\n')
  const index = lines.findIndex((line) => line.trim() === marker)
  if (index === -1) {
    const loose = lines.findIndex((line) => line.includes(marker))
    if (loose === -1) return null
    return lines.slice(loose, loose + 12).join('\n')
  }
  return lines.slice(index, index + 12).join('\n')
}

async function send(text) {
  const point = await session.centreOf('div[contenteditable="true"]')
  await session.clickAt(point.x, point.y)
  await session.sleep(300)
  await session.insertText(text)
  await session.sleep(300)
  await session.pressEnter()
}

console.log('打开应用…')
await session.goto(url, { waitMs: 5000 })
if (!(await session.evaluate(`document.body.innerText.includes('描述你想要')`))) {
  await session.clickTextReal('选择工作区', { exact: false })
  await session.sleep(1500)
  try {
    await session.clickTextReal('dsh', { exact: true })
    await session.sleep(1000)
  } catch {}
  await session.clickTextReal('打开', { exact: true })
  await session.sleep(2500)
}
console.log('当前模式（首页选择器）:', await session.evaluate(`(() => {
  const el = [...document.querySelectorAll('*')].find((node) => {
    const own = [...node.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('').trim();
    return own === '自定义模式' || own === '标准模式' || own === '创造模式';
  });
  return el === undefined ? null : el.textContent.trim();
})()`))

// ── 第 1 轮：文件里是 MARK-ONE ────────────────────────────────────────────
writeFileSync(promptPath, MARK_ONE, 'utf8')
console.log('已把 prompt.md 设为 MARK-ONE')
console.log('第 1 轮：发送问题…')
await send('1+1 等于几？')
const text1 = await waitForAnswer('MARK-ONE', 120000)
const answer1 = extractAnswer(text1, 'MARK-ONE')
console.log('--- 第 1 轮回答片段 ---')
console.log(answer1 ?? '(没等到 MARK-ONE)')
console.log('页面里出现 MARK-ONE:', text1.includes('MARK-ONE'), '| 出现 MARK-TWO:', text1.includes('MARK-TWO'))

// ── 改文件（同一会话，不刷新页面、不重启进程） ────────────────────────────
writeFileSync(promptPath, MARK_TWO, 'utf8')
console.log('\n已把 prompt.md 改成 MARK-TWO（不重启、不刷新、不新建会话）')
await session.sleep(2000)

// ── 第 2 轮：同一会话继续 ────────────────────────────────────────────────
console.log('第 2 轮：同一个会话里再问…')
await send('2+2 等于几？')
const text2 = await waitForAnswer('MARK-TWO', 120000)
const answer2 = extractAnswer(text2, 'MARK-TWO')
console.log('--- 第 2 轮回答片段 ---')
console.log(answer2 ?? '(没等到 MARK-TWO)')

const outcome = {
  第一轮_出现MARK_ONE: text1.includes('MARK-ONE'),
  第二轮_出现MARK_TWO: text2.includes('MARK-TWO'),
  第二轮_仍只有MARK_ONE: text2.includes('MARK-ONE') && !text2.includes('MARK-TWO'),
  文件当前内容标记: readFileSync(promptPath, 'utf8').includes('MARK-TWO') ? 'MARK-TWO' : 'MARK-ONE',
}
console.log('\n=== 判定 ===')
console.log(JSON.stringify(outcome, null, 1))
await session.screenshot('/tmp/live-chat.png')
session.close()
