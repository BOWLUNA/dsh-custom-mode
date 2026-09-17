/**
 * Model-facing row for the `custom` agent preset: read and rewrite the system
 * prompt this preset uses.
 *
 * This exists because the graphical editor in Settings is a dynamic Cordis
 * plugin and therefore vanishes when the process restarts. The prompt FILE and
 * this preset survive; this row is what makes the prompt durably editable
 * without any ephemeral UI — in a fresh session you can simply say
 * "把系统提示词改成……" and the agent calls this tool.
 *
 * It writes the same file `prompt-reader.mjs` reads, so a write here takes
 * effect on the next model step of the current session, exactly like a save
 * from the Settings page.
 *
 * Scope: registered in the preset's own scope via `ctx.tools.register`, which
 * is how every shipped tool row contributes. It provides no service, so it
 * needs no isolate realm.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Absolute path of the prompt file this preset reads. */
const PROMPT_PATH = fileURLToPath(new URL('./prompt.md', import.meta.url))

/** Missing-file text the model gets, so a read never looks like an empty prompt. */
const MISSING = '（prompt.md 不存在，当前模式会退回上一次成功的提示词文本）'

/**
 * Variable names the prompt renderer accepts, mirroring
 * `VARIABLE_NAME = /^[a-z][a-z0-9_]*$/` in `@deepseek-ai/dsh-system-prompt`.
 */
const VARIABLE_NAME = /^[a-z][a-z0-9_]*$/

/**
 * Variables this deployment registers for every agent (`dsh-agent-loop`).
 *
 * The persona section renders with strict interpolation: an unknown `{{name}}`
 * or a malformed group makes the renderer THROW, so one typo here would fail
 * every model request in this mode. Refusing it at the write is the guard.
 *
 * This mirrors `checkPromptText` in the editor package's `index.mjs`, which
 * guards the Settings-page write path to the same file. The two must stay in
 * step; the duplication is deliberate so neither side depends on the other's
 * install location.
 */
const KNOWN_VARIABLES = ['model', 'cwd', 'provider']

/**
 * Check prompt text against the renderer's interpolation rules.
 *
 * A complete `{{...}}` group must hold a valid, registered name; a lone `{{`
 * with no later `}}` is literal prose and passes.
 *
 * @param {string} text - the candidate prompt text.
 * @returns {{ok: true} | {ok: false, error: string}} the verdict.
 */
function checkPromptText(text) {
  let index = 0
  for (;;) {
    const open = text.indexOf('{{', index)
    if (open === -1) return { ok: true }
    const close = text.indexOf('}}', open + 2)
    if (close === -1) return { ok: true }
    const variable = text.slice(open + 2, close)
    if (!VARIABLE_NAME.test(variable)) {
      return {
        ok: false,
        error:
          '写入被拒绝：{{' +
          variable +
          '}} 不是合法的变量引用（合法名只能用小写字母、数字、下划线且以字母开头）。' +
          '若只想要字面量花括号，请用单个 { 或不闭合的 {{。',
      }
    }
    if (!KNOWN_VARIABLES.includes(variable)) {
      return {
        ok: false,
        error:
          '写入被拒绝：{{' +
          variable +
          '}} 不是已注册的变量，渲染时会报错并让本模式每个请求都失败。可用：' +
          KNOWN_VARIABLES.map((item) => '{{' + item + '}}').join('、') +
          '。',
      }
    }
    index = close + 2
  }
}

const definition = {
  name: 'custom_prompt',
  description:
    'Read or replace the system prompt of the 自定义模式 (custom) agent preset. ' +
    'The prompt is a plain file; this tool reads it (action "read", the default) ' +
    'or overwrites it wholesale (action "write" with text). A write takes effect ' +
    'on this session\'s next model step — no restart needed — and only affects ' +
    'sessions running the custom preset. Use it when the user asks to change ' +
    'their system prompt or wants to see what it currently says.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: 'Read the current prompt (default) or replace it.',
      },
      text: {
        type: 'string',
        description: 'Required when action is "write": the complete new prompt text.',
      },
    },
  },
  output: {
    schema: { type: 'string' },
    render(_args, value) {
      return [{ type: 'text', text: String(value) }]
    },
  },
  async execute(args) {
    const action = args !== null && typeof args === 'object' && typeof args.action === 'string'
      ? args.action
      : 'read'

    if (action === 'read') {
      try {
        return '当前系统提示词（' + PROMPT_PATH + '）：\n\n' + readFileSync(PROMPT_PATH, 'utf8')
      } catch {
        return MISSING
      }
    }

    if (typeof args.text !== 'string' || args.text.trim() === '') {
      return '写入被拒绝：action 为 "write" 时必须提供非空的 text。'
    }
    const verdict = checkPromptText(args.text)
    if (verdict.ok !== true) return verdict.error
    try {
      mkdirSync(dirname(PROMPT_PATH), { recursive: true })
      writeFileSync(PROMPT_PATH, args.text, 'utf8')
      return '已写入 ' + PROMPT_PATH + '（' + String(args.text.length) + ' 字符）。本会话下一步模型调用即使用新提示词。'
    } catch (error) {
      return '写入失败：' + String((error && error.message) || error)
    }
  },
}

/** The tool registry is a hard dependency; without it there is no tool. */
export const inject = ['tools']

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(definition), 'custom-prompt.tool')
}
