/**
 * Atomic file writes — one implementation for every writer in the host half.
 *
 * **Why this is a module and not a helper inside `index.mjs`**: the settings page, the preset meta writer and
 * the seeder all write user-visible files, and "we are careful here but not there" is how a project gets a
 * half-written `preset.yml` (whose failure mode is the whole mode disappearing from every picker). A review
 * found exactly that split: `index.mjs` had the retrying atomic write while `meta.mjs` used a bare
 * `writeFileSync` under a comment promising the opposite. Sharing the function makes the discipline structural.
 *
 * The two things it buys:
 *  - **temporary name + rename**, so a reader never observes a half-written file (the prompt reader caches by
 *    mtime+size, and `preset.yml` is parsed by the platform);
 *  - **retry on Windows**, where two concurrent renames onto the same target fail with `EPERM`/`EBUSY`; a
 *    random temporary name does not help with *that* collision, only with temp-vs-temp ones.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

/** Synchronous backoff: these write paths are synchronous, so waiting is simpler than async plumbing. */
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * `rename` with retries.
 *
 * @param {string} from - the temporary file that already holds the content.
 * @param {string} to - the destination.
 * @param {{rename?: Function, sleep?: Function, attempts?: number}} [options] - injectable for tests, which is
 *   how the Windows-only retry behaviour is pinned on Linux.
 * @returns {void}
 */
export function renameWithRetry(from, to, options = {}) {
  const rename = typeof options.rename === 'function' ? options.rename : renameSync
  const sleep = typeof options.sleep === 'function' ? options.sleep : sleepSync
  const attempts = Number.isInteger(options.attempts) ? options.attempts : 8
  for (let attempt = 1; ; attempt += 1) {
    try {
      rename(from, to)
      return
    } catch (error) {
      const code = error !== null && typeof error === 'object' ? error.code : undefined
      const retryable = code === 'EPERM' || code === 'EBUSY' || code === 'EACCES'
      if (retryable !== true || attempt >= attempts) throw error
      // 8 attempts with a growing backoff (20, 40, … 160 ms) — measured: a review still saw 1 failure in 10
      // concurrent saves with the previous 5×20 ms, so the window is wider than that on Windows.
      sleep(20 * attempt)
    }
  }
}

/**
 * Stage content into a temporary file next to its destination, without touching the destination yet.
 *
 * Used when several files must change together (the settings page writes the composition and the prompt):
 * staging both first means a failure while *preparing* one leaves the other untouched, which is the window a
 * review pointed at ("`saveState` is not transactional; the second write failing leaves a mixed state").
 *
 * @param {string} file - destination path.
 * @param {string} text - content to write into the temporary.
 * @returns {{file: string, temporary: string}} handle for {@link commitStaged} / {@link discardStaged}.
 */
export function stageAtomic(file, text) {
  const temporary = `${file}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`
  try {
    writeFileSync(temporary, text, 'utf8')
  } catch (error) {
    try { rmSync(temporary, { force: true }) } catch { /* retain the original failure */ }
    throw error
  }
  return { file, temporary }
}

/** Rename a staged temporary onto its destination (with the Windows retry). */
export function commitStaged(staged) {
  renameWithRetry(staged.temporary, staged.file)
}

/** Remove a staged temporary without touching the destination. */
export function discardStaged(staged) {
  try {
    rmSync(staged.temporary, { force: true })
  } catch {
    /* best effort */
  }
}

/**
 * Write several files together, as close to a transaction as a filesystem will give us.
 *
 * **Why this is not the old two-phase version.** The previous implementation staged everything and then
 * renamed them one by one, and said so honestly in a comment ("not a true transaction — a rename can still
 * fail between two commits"). But the callers' contracts do not say that: `savePromptOnly` promises
 * "提示词与 preset.yml 一起换名，失败则两个都不动", and `saveState` says the three files are written
 * together (issue #5). A caller that returns `ok:false` while the disk holds new-prompt + old-name is
 * exactly the state those promises rule out — the user is told nothing was saved and half of it was.
 *
 * Two defects were measured by `probes/probe-io.mjs`:
 *
 *   L   staging happened **outside** the try, so a staging failure left its `.tmp-…` behind — and the
 *       module's own comment says an orphan temporary in an assistant directory is not just litter,
 *       because the roster scans that directory;
 *   K   committing renamed them in order and gave up on the first failure — the earlier targets were
 *       already replaced, and the caller saw a plain failure.
 *
 * **How it is transactional now**: stage everything, then move every existing target aside to a backup,
 * then put the new files in place. Any failure anywhere in that sequence restores from the backups and
 * removes what it had already installed, so the caller's "nothing changed" is true. The backups are
 * removed only after every destination is in place.
 *
 * @param {Array<[string, string]>} entries - `[file, text]` pairs.
 * @returns {void}
 */
export function writeAtomicPair(entries) {
  if (entries.length === 0) return
  const directory = dirname(resolve(entries[0][0]))
  const names = entries.map(([file]) => basename(file))
  if (new Set(names).size !== names.length || entries.some(([file]) => dirname(resolve(file)) !== directory || !TRANSACTION_FILES.includes(basename(file)))) {
    throw new Error('Atomic preset transactions require distinct preset files in one directory')
  }
  const recovery = restoreBackups(directory)
  if (recovery.ok !== true) throw new Error(recovery.detail)
  const stamp = `${String(process.pid)}-${randomBytes(4).toString('hex')}`

  // ── phase 0: refuse to touch a destination that is a directory. ──
  //
  // Measured: `probes/probe-io.mjs` K injects the failure by making the second target a directory.
  // A naive "move the old target aside, then install" transaction **succeeds** on that input — it renames
  // the user's directory to `.bak-…` and leaves a file where it was. That is worse than failing: it obeys
  // the letter of "transactional" while quietly relocating a directory nobody asked it to touch.
  // Being transactional must not mean "willing to move anything out of the way". A directory at a path that
  // should hold a file is not a target to replace — it is a reason to refuse before anything moves.
  for (const [file] of entries) {
    if (existsSync(file) && statSync(file).isDirectory()) {
      throw new Error(`拒绝写入：目标已存在且是目录 — ${file}（未改动任何文件）`)
    }
  }

  // ── phase 1: stage everything. A failure here must not leave a temporary behind. ──
  const staged = []
  try {
    for (const [file, text] of entries) staged.push(stageAtomic(file, text))
  } catch (error) {
    for (const one of staged) discardStaged(one)
    throw error
  }

  // A prepared journal is on disk BEFORE any original moves. Recovery rolls the WHOLE transaction
  // back, including files already installed; a committed journal keeps the whole new generation.
  const journal = join(directory, `${TRANSACTION_PREFIX}${stamp}.json`)
  const transaction = {
    version: 1,
    stamp,
    ownerPid: process.pid,
    phase: 'prepared',
    entries: staged.map((one) => ({
      name: basename(one.file),
      temporary: basename(one.temporary),
      backup: `${basename(one.file)}.bak-${stamp}`,
      existed: existsSync(one.file),
    })),
  }
  ACTIVE_TRANSACTIONS.add(directory)
  try {
    writeAtomic(journal, JSON.stringify(transaction) + '\n')
    for (const one of transaction.entries) {
      if (one.existed) renameWithRetry(join(directory, one.name), join(directory, one.backup))
    }
    for (const one of staged) commitStaged(one)
    writeAtomic(journal, JSON.stringify({ ...transaction, phase: 'committed' }) + '\n')
  } catch (error) {
    // If writing the journal itself failed no target moved. Otherwise leave recovery evidence until
    // rollback has completed; a failed restore must not be hidden as "nothing changed".
    const outcome = existsSync(journal) ? recoverTransaction(directory, journal, transaction) : { ok: true }
    for (const one of staged) discardStaged(one)
    ACTIVE_TRANSACTIONS.delete(directory)
    if (outcome.ok !== true) throw new Error(String(error.message ?? error) + '; recovery required: ' + outcome.detail, { cause: error })
    throw error
  }
  // Cleanup failure is recoverable from the committed journal and cannot undo a successful write.
  recoverTransaction(directory, journal, { ...transaction, phase: 'committed' })
  ACTIVE_TRANSACTIONS.delete(directory)
}

/**
 * Write a file so that readers see either the old content or the new one, never a mix.
 *
 * The temporary name is unique per call (pid + random suffix). On failure the temporary file is removed —
 * an orphan `.tmp-…` inside an assistant directory is not just litter: the roster scans that directory.
 * **The staging write itself is inside the try** for the same reason: a `writeFileSync` that fails part way
 * (a full disk, an EACCES) leaves a partial temporary, and that is exactly the litter this promises not to
 * leave. Measured by `probes/probe-io.mjs` — the same defect the pair version had.
 *
 * @param {string} file - destination path.
 * @param {string} text - content to write.
 * @returns {void}
 */
/**
 * 掉电落在「旧文件已改名为 .bak、新文件还没装上」时，把唯一的备份移回原名。
 *
 * 多于一份备份时不动：无法判断哪一份是最后的好内容。
 *
 * @param {string} directory - one assistant directory.
 * @returns {void}
 */
const TRANSACTION_FILES = ['prompt.md', 'agent.cordis.yml', 'preset.yml']
const TRANSACTION_PREFIX = '.custom-mode-transaction-'
const ACTIVE_TRANSACTIONS = new Set()

function pidFromStamp(stamp) {
  const pid = Number(stamp.split('-')[0])
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null
}

/** A different live or uninspectable process might still be writing. Only ESRCH proves death. */
function ownerMayBeActive(pid) {
  // This process runs transactions synchronously and ACTIVE_TRANSACTIONS covers its live writes.
  if (pid === process.pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code !== 'ESRCH'
  }
}

function activeOwnerResult(pid) {
  return { ok: false, code: 'recoveryRequired', detail: `Preset transaction owner ${pid} is active or cannot be inspected; retry after it finishes` }
}

function validTransaction(transaction, journalName) {
  if (transaction?.version !== 1 || !/^\d+-[a-f0-9]{8}$/.test(transaction.stamp ?? '')) return false
  if (journalName !== `${TRANSACTION_PREFIX}${transaction.stamp}.json`) return false
  const stampedPid = pidFromStamp(transaction.stamp)
  const ownerPid = transaction.ownerPid ?? stampedPid
  if (stampedPid === null || !Number.isSafeInteger(ownerPid) || ownerPid <= 0) return false
  if (transaction.legacy !== true && ownerPid !== stampedPid) return false
  if (!['prepared', 'committed'].includes(transaction.phase) || !Array.isArray(transaction.entries) || transaction.entries.length === 0) return false
  const names = new Set()
  for (const one of transaction.entries) {
    if (one === null || typeof one !== 'object') return false
    if (!TRANSACTION_FILES.includes(one.name) || names.has(one.name) || typeof one.existed !== 'boolean') return false
    if (one.backup !== `${one.name}.bak-${transaction.stamp}`) return false
    if (transaction.legacy === true ? one.temporary !== null : !new RegExp(`^${one.name.replaceAll('.', '\\.')}\\.tmp-\\d+-[a-f0-9]{8}$`).test(one.temporary ?? '')) return false
    names.add(one.name)
  }
  return true
}

function recoverTransaction(directory, journal, transaction) {
  try {
    if (transaction.phase === 'prepared') {
      for (const one of transaction.entries) {
        const file = join(directory, one.name)
        const backup = join(directory, one.backup)
        if (one.existed) {
          if (existsSync(backup)) renameWithRetry(backup, file)
          else if (!existsSync(file)) throw new Error(`Missing original and backup for ${one.name}`)
        } else {
          rmSync(file, { force: true })
        }
      }
    }
    for (const one of transaction.entries) {
      rmSync(join(directory, one.backup), { force: true })
      if (one.temporary !== null) rmSync(join(directory, one.temporary), { force: true })
    }
    rmSync(journal, { force: true })
    return { ok: true }
  } catch (error) {
    return { ok: false, code: 'recoveryRequired', detail: String(error.message ?? error) }
  }
}

/** Recover before ownership discovery: prompt.md itself can be temporarily absent after a crash. */
export function restoreBackups(directory) {
  if (ACTIVE_TRANSACTIONS.has(resolve(directory))) return { ok: true, active: true }
  let entries
  try {
    entries = readdirSync(directory)
  } catch (error) {
    return error.code === 'ENOENT' ? { ok: true } : { ok: false, code: 'recoveryRequired', detail: String(error.message ?? error) }
  }
  const journals = entries.filter((entry) => entry.startsWith(TRANSACTION_PREFIX) && entry.endsWith('.json'))
  // Shared homes across live processes are not a supported transaction boundary. Never guess which of
  // multiple interrupted generations owns a target, and never seed a replacement over their evidence.
  if (journals.length > 1) return { ok: false, code: 'recoveryRequired', detail: 'Multiple preset transactions require manual recovery' }
  for (const name of journals) {
    let transaction
    try {
      transaction = JSON.parse(readFileSync(join(directory, name), 'utf8'))
    } catch (error) {
      return { ok: false, code: 'recoveryRequired', detail: 'Unreadable preset transaction: ' + String(error.message ?? error) }
    }
    if (!validTransaction(transaction, name)) return { ok: false, code: 'recoveryRequired', detail: 'Invalid preset transaction journal' }
    const ownerPid = transaction.ownerPid ?? pidFromStamp(transaction.stamp)
    if (ownerMayBeActive(ownerPid)) return activeOwnerResult(ownerPid)
    const outcome = recoverTransaction(directory, join(directory, name), transaction)
    if (outcome.ok !== true) return outcome
  }
  // Upgrade recovery for v2.2.5 transactions that predate the journal. Restore one whole backup group
  // only when something is missing. Complete targets plus leftover backups denote a completed write.
  try { entries = readdirSync(directory) } catch (error) {
    return { ok: false, code: 'recoveryRequired', detail: String(error.message ?? error) }
  }
  const legacy = entries.map((entry) => ({ entry, match: /^(prompt\.md|agent\.cordis\.yml|preset\.yml)\.bak-(\d+-[a-f0-9]{8})$/.exec(entry) })).filter((one) => one.match !== null)
  if (!legacy.some((one) => !existsSync(join(directory, one.match[1])))) return { ok: true }
  if (new Set(legacy.map((one) => one.match[2])).size !== 1) return { ok: false, code: 'recoveryRequired', detail: 'Ambiguous legacy preset backups require manual recovery' }
  const legacyOwner = pidFromStamp(legacy[0].match[2])
  if (legacyOwner === null) return { ok: false, code: 'recoveryRequired', detail: 'Invalid legacy preset transaction owner' }
  if (ownerMayBeActive(legacyOwner)) return activeOwnerResult(legacyOwner)
  try {
    // Recovery itself can be interrupted. Journal the whole legacy group BEFORE restoring even the
    // first missing target; otherwise that first rename can hide the need to restore the rest.
    const stamp = legacy[0].match[2]
    const journal = join(directory, `${TRANSACTION_PREFIX}${stamp}.json`)
    const transaction = { version: 1, stamp, ownerPid: process.pid, phase: 'prepared', legacy: true, entries: legacy.map((one) => ({
      name: one.match[1], backup: one.entry, temporary: null, existed: true,
    })) }
    writeAtomic(journal, JSON.stringify(transaction) + '\n')
    return recoverTransaction(directory, journal, transaction)
  } catch (error) {
    return { ok: false, code: 'recoveryRequired', detail: String(error.message ?? error) }
  }
}

export function writeAtomic(file, text) {
  const temporary = `${file}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`
  try {
    writeFileSync(temporary, text, 'utf8')
    renameWithRetry(temporary, file)
  } catch (error) {
    try {
      rmSync(temporary, { force: true })
    } catch {
      /* cleaning up must not mask the original error */
    }
    throw error
  }
}
