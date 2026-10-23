/**
 * Host-side temporary pasteboard for long pasted text.
 *
 * Long composer pastes are stored as small UTF-8 text files under the plugin's
 * own folder in `$DSH_HOME`, so the composer can show them as an ordinary
 * `@path` file reference (with native preview and file actions) instead of an
 * uploaded blob. Storage stays bounded:
 *
 *   - the folder is emptied when the Host plugin starts, so files from a
 *     stopped session never survive into the next DSH run;
 *   - a write that pushes the folder past `MAX_FILES` prunes the oldest files
 *     down to the cap, keeping the most recent pastes usable.
 *
 * @module dsh-codex-style/host/pasteboard
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Same-origin route that accepts one pasted text. */
export const PASTEBOARD_PATH = '/dsh-codex-style/pasteboard'

/** Most files kept at any time; older ones are pruned on write. */
export const MAX_FILES = 100

/** Largest accepted paste; the composer threshold is far below this. */
export const MAX_TEXT_BYTES = 8 * 1024 * 1024

/**
 * @returns {string} DSH home directory (the Host honours `DSH_HOME`).
 */
export function dshHome() {
  return typeof process.env.DSH_HOME === 'string' && process.env.DSH_HOME !== ''
    ? process.env.DSH_HOME
    : path.join(os.homedir(), '.dsh')
}

/** @returns {string} this plugin's temporary paste folder. */
export function pasteboardDir() {
  return path.join(dshHome(), 'dsh-codex-style', 'pasteboard')
}

/** @param {string} value @returns {string} human readable character count. */
function countText(value) {
  return value.length.toLocaleString('en-US')
}

/**
 * Delete every regular file inside the paste folder (and stray directories).
 * Missing folders are fine; unreadable entries are skipped.
 * @param {string} dir - folder to empty.
 */
export function clearPasteboard(dir) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    try {
      fs.rmSync(path.join(dir, entry.name), { recursive: true, force: true })
    } catch {
      /* a locked file simply stays until the next start */
    }
  }
}

/**
 * Keep only the newest `maxFiles` files in the folder.
 * @param {string} dir - paste folder.
 * @param {number} [maxFiles] - retained file count.
 */
export function prunePasteboard(dir, maxFiles = MAX_FILES) {
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  const files = []
  for (const entry of entries) {
    if (entry.isFile() !== true) continue
    const target = path.join(dir, entry.name)
    try {
      files.push({ path: target, mtime: fs.statSync(target).mtimeMs })
    } catch {
      /* raced with another cleanup */
    }
  }
  if (files.length <= maxFiles) return
  files.sort((left, right) => left.mtime - right.mtime)
  for (const file of files.slice(0, files.length - maxFiles)) {
    try {
      fs.unlinkSync(file.path)
    } catch {
      /* already gone */
    }
  }
}

/**
 * Create the pasteboard service for one Host process.
 * Constructing the service empties the folder, matching "a new DSH run starts
 * with an empty pasteboard".
 * @param {{ dir?: string, maxFiles?: number }} [options] - test seams.
 * @returns {{ dir: string, write: (text: string) => { path: string, name: string }, clear: () => void }}
 */
export function createPasteboard(options = {}) {
  const dir = options.dir ?? pasteboardDir()
  const maxFiles = options.maxFiles ?? MAX_FILES
  clearPasteboard(dir)
  let sequence = 0
  return {
    dir,
    clear: () => clearPasteboard(dir),
    /**
     * Persist one pasted text and return its absolute path and display name.
     * @param {string} text - pasted plain text.
     * @returns {{ path: string, name: string }} saved file identity.
     */
    write(text) {
      if (typeof text !== 'string' || text.trim() === '') throw new Error('empty paste')
      if (Buffer.byteLength(text, 'utf8') > MAX_TEXT_BYTES) throw new Error('paste too large')
      fs.mkdirSync(dir, { recursive: true })
      let name
      let target
      for (;;) {
        sequence += 1
        name = 'Pasted text (' + countText(text) + ' chars) ' + String(sequence) + '.txt'
        target = path.join(dir, name)
        try {
          fs.writeFileSync(target, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
          break
        } catch (error) {
          if (error?.code !== 'EEXIST') throw error
        }
      }
      prunePasteboard(dir, maxFiles)
      return { path: target, name }
    },
  }
}
