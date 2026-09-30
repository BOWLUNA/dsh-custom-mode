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
import { renameSync, rmSync, writeFileSync } from 'node:fs'

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
  writeFileSync(temporary, text, 'utf8')
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
 * Write several files together: stage them all, then commit them all.
 *
 * Not a true transaction — a rename can still fail between two commits — but it shrinks the mixed-state window
 * to a single rename, and any failure discards the staged temporaries so no `.tmp-…` is left behind.
 *
 * @param {Array<[string, string]>} entries - `[file, text]` pairs.
 * @returns {void}
 */
export function writeAtomicPair(entries) {
  const staged = entries.map(([file, text]) => stageAtomic(file, text))
  try {
    for (const one of staged) commitStaged(one)
  } catch (error) {
    for (const one of staged) discardStaged(one)
    throw error
  }
}

/**
 * Write a file so that readers see either the old content or the new one, never a mix.
 *
 * The temporary name is unique per call (pid + random suffix). On failure the temporary file is removed —
 * an orphan `.tmp-…` inside an assistant directory is not just litter: the roster scans that directory.
 *
 * @param {string} file - destination path.
 * @param {string} text - content to write.
 * @returns {void}
 */
export function writeAtomic(file, text) {
  const temporary = `${file}.tmp-${String(process.pid)}-${randomBytes(4).toString('hex')}`
  writeFileSync(temporary, text, 'utf8')
  try {
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
