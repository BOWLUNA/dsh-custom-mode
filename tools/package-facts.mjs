#!/usr/bin/env node
/**
 * Print facts from a package manifest, for the two shell scripts.
 *
 * **Why this file exists** (measured on Windows, Git Bash): `install.sh` used to do
 * `node -e "require('$ROOT/editor/package.json')"`. In Git Bash `$(pwd)` is an MSYS path
 * (`/c/Users/…`), and a path embedded *inside* a larger argument is not translated the way a
 * standalone argument is — so Windows' node received `/c/Users/…` and died with MODULE_NOT_FOUND,
 * taking the version self-check down with it (it silently printed `?`). Passing a **relative** path
 * to this script removes the ambiguity: no MSYS path ever reaches node.
 *
 * Usage (run from the repository root):
 *   node tools/package-facts.mjs editor name      → the package name
 *   node tools/package-facts.mjs editor version   → the package version
 *   node tools/package-facts.mjs editor ranges    → declared dsh ranges, "engines / peer"
 *
 * Exits non-zero with a message on stderr when the manifest or a field is missing, so callers can
 * tell "could not read" from "read as empty".
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const [directory, field] = process.argv.slice(2)
if (directory === undefined || field === undefined) {
  console.error('用法: node tools/package-facts.mjs <目录> <name|version|ranges>')
  process.exit(2)
}

let manifest
try {
  manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
} catch (error) {
  console.error(`读不到 ${directory}/package.json: ${String((error && error.message) || error)}`)
  process.exit(1)
}

const engines = manifest.engines?.dsh
const peer = manifest.peerDependencies?.['@deepseek-ai/dsh']
switch (field) {
  case 'name':
    if (typeof manifest.name !== 'string' || manifest.name === '') {
      console.error('package.json 里没有 name')
      process.exit(1)
    }
    process.stdout.write(manifest.name)
    break
  case 'version':
    if (typeof manifest.version !== 'string' || manifest.version === '') {
      console.error('package.json 里没有 version')
      process.exit(1)
    }
    process.stdout.write(manifest.version)
    break
  case 'ranges':
    process.stdout.write([engines, peer].filter(Boolean).join(' / '))
    break
  default:
    console.error(`未知字段: ${field}`)
    process.exit(2)
}
