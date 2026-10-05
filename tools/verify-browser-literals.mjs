#!/usr/bin/env node
/**
 * Page copy in tools/browser-verify.mjs must still exist in locales.mjs.
 *
 * 44f7fdb shortened the Chinese dictionary and left this file clicking the old
 * buttons. A short Chinese literal that is not a check() title, not shell
 * chrome, and not a string the script itself types, must be a current `zh` value.
 *
 * Run: node tools/verify-browser-literals.mjs [path-to-browser-verify.mjs]
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { zh } from '../locales.mjs'

const file = process.argv[2] !== undefined && process.argv[2] !== ''
  ? process.argv[2]
  : join(dirname(fileURLToPath(import.meta.url)), 'browser-verify.mjs')
const src = readFileSync(file, 'utf8')

const SHELL = new Set([
  '设置', '通用设置', '知道了', '我明白', '跳过', '以后再说', '稍后', '稍后配置',
  '关闭', '继续', '开始使用', '中文', '语言',
])
const FIXTURE = new Set([
  '被改坏的提示词（浏览器验证）',
  '浏览器验证：第一版\n',
  '浏览器验证：第二版\n',
  '浏览器验证助手',
  'D2 语言检查：这一版从英文界面保存。\n',
])
const STALE = new Set(['新建会话即生效', '已保存', '基础模式'])
const values = Object.values(zh).filter((value) => typeof value === 'string')

function stripComments(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      out += ' '
      continue
    }
    const q = text[i]
    if (q === "'" || q === '"' || q === '`') {
      const start = i
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (text[i] === q) {
          i += 1
          break
        }
        i += 1
      }
      out += text.slice(start, i)
      continue
    }
    if (text[i] === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i)
      i = end === -1 ? text.length : end
      continue
    }
    out += text[i]
    i += 1
  }
  return out
}

function unescape(body) {
  return body.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\(.)/g, '$1')
}

function allowed(value) {
  if (SHELL.has(value) || FIXTURE.has(value) || STALE.has(value)) return true
  return values.some((entry) => entry === value || (value.length >= 2 && entry.includes(value)))
}

const stripped = stripComments(src)
const problems = []
const re = /(['"`])((?:\\.|(?!\1)[^\\\n]){0,80})\1/g
let match
while ((match = re.exec(stripped)) !== null) {
  const raw = match[2]
  if (/[\u4e00-\u9fff]/.test(raw) === false) continue
  const value = unescape(raw)
  if (value.length > 60) continue
  const before = stripped.slice(Math.max(0, match.index - 80), match.index)
  const after = stripped.slice(match.index + match[0].length, match.index + match[0].length + 16)
  const lineStart = stripped.lastIndexOf('\n', match.index) + 1
  if (stripped.slice(lineStart, match.index).includes('//')) continue
  if (/check\(\s*$/.test(before)) continue
  if (/console\.(log|error)\(\s*$/.test(before)) continue
  if (/,\s*[ze]\(/.test(after)) continue
  if (allowed(value)) continue
  problems.push(`${JSON.stringify(value)}`)
}

const regexRe = /\/((?:\\.|[^/\n]){0,80})\//g
while ((match = regexRe.exec(stripped)) !== null) {
  const body = match[1]
  if (/[\u4e00-\u9fff]/.test(body) === false) continue
  const prev = stripped.slice(Math.max(0, match.index - 16), match.index)
  if (/[=(:,!&|?;{]\s*$/.test(prev) === false && /return\s*$/.test(prev) === false) continue
  const parts = body.split('|').flatMap((part) => part.match(/[\u4e00-\u9fff]{2,}/g) ?? [])
  const bad = parts.filter((part) => allowed(part) === false)
  if (bad.length > 0) problems.push(`/${body}/ → ${bad.map((part) => JSON.stringify(part)).join(' ')}`)
}

if (problems.length > 0) {
  console.error(`verify-browser-literals: ${problems.length} 处词条漂移`)
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
console.log('verify-browser-literals: 页面断言里的中文都能在 locales.mjs 或白名单里找到')
