#!/usr/bin/env node
/**
 * Assert that the DSH version CI tests against is the version this package
 * claims to be.
 *
 * Why this exists: the versioning policy says "this plugin's version mirrors the
 * DSH release it targets, so bump `editor/package.json` when dsh releases". The
 * CI workflow pins a concrete `@deepseek-ai/dsh@<version>` to get the real
 * shipped presets. Nothing used to link them: bumping one and forgetting the
 * other leaves CI green while it tests the OLD runtime — so the released package
 * claims compatibility with a version it was never tested against. A comment
 * asking a human to keep them in step is not a check; this is.
 *
 * Usage: node tools/verify-version-consistency.mjs
 * Exit: 0 when consistent, 1 when not.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

const pkg = JSON.parse(readFileSync(join(REPO, 'editor', 'package.json'), 'utf8'))
const claimed = pkg.version

const workflow = readFileSync(join(REPO, '.github', 'workflows', 'test.yml'), 'utf8')
const pinned = /@deepseek-ai\/dsh@([0-9A-Za-z.\-+]+)/.exec(workflow)

if (pinned === null) {
  console.error('版本一致性: 无法在 CI workflow 里找到 @deepseek-ai/dsh@<version> 的钉定。')
  console.error('若 CI 改成从别处取版本，请同步更新本脚本。')
  process.exit(1)
}

const tested = pinned[1]

if (claimed !== tested) {
  console.error('版本不一致：')
  console.error(`  editor/package.json       ${claimed}   ← 对外声称适配的版本`)
  console.error(`  CI 实际安装并测试的 DSH    ${tested}   ← 真正跑过测试的版本`)
  console.error('')
  console.error('升 dsh 时请同时改动这两处：')
  console.error('  1. editor/package.json 的 version')
  console.error('  2. .github/workflows/test.yml 里的 @deepseek-ai/dsh@<version>')
  console.error('否则 CI 会在旧版本上通过，而发布的包声称适配了未测过的新版本。')
  process.exit(1)
}

console.log(`版本一致性: OK —— 声称适配 ${claimed}，CI 也正是在 ${tested} 上测试。`)
