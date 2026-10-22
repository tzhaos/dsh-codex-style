/**
 * Windows 11 system accent palette for the Codex-style window material.
 *
 * Personalization → Colors persists the user's accent as the eight-entry
 * `AccentPalette` blob (three light shades, the base accent, three dark shades
 * and one complementary shade). The browser half tints the window material
 * with those values, so the gradient follows the system color instead of a
 * fixed brand tone; if the shell cannot be read the browser keeps the neutral
 * theme surface.
 *
 * The route is read-only and argument-free: a fixed `reg query` through the
 * Host subprocess service, cached for only a couple of seconds so a color
 * change in Personalization → Colors reaches the browser on its next poll. No
 * session, sample or user content is involved, and every failure degrades to
 * `{ ok: false }`.
 *
 * @module dsh-codex-style/system-colors
 */
import os from 'node:os'

/** Same-origin route read by the Client half. */
export const SYSTEM_COLORS_PATH = '/dsh-codex-style/system-colors'

const PALETTE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent'
const DWM_KEY = 'HKCU\\Software\\Microsoft\\Windows\\DWM'
const CACHE_MS = 2_000
const TIMEOUT_MS = 3_000
const MAX_OUTPUT = 8 * 1024

let cache = null
let inFlight = null

const channel = (value) => value.toString(16).padStart(2, '0')
const hex = (red, green, blue) => '#' + channel(red) + channel(green) + channel(blue)

/**
 * Decode the shell's `AccentPalette` binary: eight RGBA quads ordered
 * lightest to darkest, then the complementary accent.
 * @param {string} text - `reg query` stdout.
 * @returns {{ accent: string, accentLight: string, accentDark: string }|null} palette, or null when absent.
 */
export function parseAccentPalette(text) {
  if (typeof text !== 'string') return null
  const match = /AccentPalette\s+REG_BINARY\s+([0-9a-f]+)/i.exec(text)
  if (match === null || match[1].length < 8 * 8) return null
  const bytes = match[1]
  const colors = []
  for (let index = 0; index < 8; index += 1) {
    const offset = index * 8
    const red = Number.parseInt(bytes.slice(offset, offset + 2), 16)
    const green = Number.parseInt(bytes.slice(offset + 2, offset + 4), 16)
    const blue = Number.parseInt(bytes.slice(offset + 4, offset + 6), 16)
    if (!Number.isInteger(red) || !Number.isInteger(green) || !Number.isInteger(blue)) return null
    colors.push(hex(red, green, blue))
  }
  // Palette order: light3, light2, light1, accent, dark1, dark2, dark3, complement.
  return { accent: colors[3], accentLight: colors[2], accentDark: colors[4] }
}

/**
 * Decode the DWM `AccentColor` DWORD (`0xAABBGGRR`) used when the palette blob
 * is missing.
 * @param {string} text - `reg query` stdout.
 * @returns {string|null} `#rrggbb`, or null when absent.
 */
export function parseDwmAccent(text) {
  if (typeof text !== 'string') return null
  const match = /AccentColor\s+REG_DWORD\s+0x([0-9a-f]{8})/i.exec(text)
  if (match === null) return null
  const value = Number.parseInt(match[1], 16)
  if (!Number.isFinite(value)) return null
  return hex(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff)
}

/**
 * Run one fixed registry query and collect its stdout.
 * @param {object} ctx - Host context with `subprocess`.
 * @param {string} key - registry key.
 * @param {string} name - value name.
 * @param {AbortSignal} signal - cancellation.
 * @returns {Promise<string|null>} stdout, or null when the query failed.
 */
async function query(ctx, key, name, signal) {
  const executable = await ctx.subprocess.resolveExecutable('reg', undefined, signal)
  const child = ctx.subprocess.spawn({
    argv: [executable, 'query', key, '/v', name],
    cwd: os.homedir(),
    signal,
    graceMs: 1_000,
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: MAX_OUTPUT },
      stderr: { maxBytes: MAX_OUTPUT },
    },
  })
  try {
    const outcome = await child.done
    if (outcome.exitCode !== 0) return null
    const stdout = child.collected.stdout.readFrom(0)
    return stdout.lossy ? null : stdout.text
  } finally {
    try {
      child.terminate()
      await child.waitForExit()
    } catch {
      /* already gone */
    }
  }
}

/**
 * Read the live Windows accent. The palette blob is authoritative; the DWM
 * value only covers shells that predate it or stripped it.
 * @param {object} ctx - Host context with `subprocess`.
 * @returns {Promise<object>} route payload.
 */
async function read(ctx) {
  if (process.platform !== 'win32' || typeof ctx?.subprocess?.spawn !== 'function') {
    return { ok: false, platform: process.platform }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const palette = parseAccentPalette(await query(ctx, PALETTE_KEY, 'AccentPalette', controller.signal))
    if (palette !== null) return { ok: true, platform: 'win32', ...palette }
    const accent = parseDwmAccent(await query(ctx, DWM_KEY, 'AccentColor', controller.signal))
    if (accent !== null) return { ok: true, platform: 'win32', accent, accentLight: accent, accentDark: accent }
    return { ok: false, platform: 'win32' }
  } catch {
    return { ok: false, platform: process.platform }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Cached system-color payload for the browser-visible route.
 * @param {object} ctx - Host context with `subprocess`.
 * @returns {Promise<object>} route payload.
 */
export function readSystemColors(ctx) {
  const now = Date.now()
  if (cache !== null && now - cache.at < CACHE_MS) return Promise.resolve(cache.value)
  if (inFlight !== null) return inFlight
  const settle = (value) => {
    cache = { at: Date.now(), value }
    inFlight = null
    return value
  }
  inFlight = read(ctx).then(settle, () => settle({ ok: false, platform: process.platform }))
  return inFlight
}
