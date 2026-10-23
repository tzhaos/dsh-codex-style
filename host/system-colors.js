/**
 * Windows 11 system accent palette for the Codex-style window material.
 *
 * Personalization → Colors persists the user's accent as the eight-entry
 * `AccentPalette` blob (three light shades, the base accent, three dark shades
 * and one complementary shade) and mirrors the base tone in the DWM
 * `AccentColor` value. The Host half watches both keys with a native
 * registry-change notification (`RegNotifyChangeKeyValue`) instead of
 * polling, then joins the browser half on a small event stream, so the
 * material repaints as soon as the user picks another Windows accent color.
 *
 * The watcher is a single long-lived, read-only PowerShell helper started
 * through the Host subprocess service; it only prints `changed` lines. If the
 * helper cannot run, the browser keeps a slow GET poll as a fallback, so the
 * material still settles on the live color. Every failure degrades to
 * `{ ok: false }` and the neutral theme surface.
 *
 * @module dsh-codex-style/system-colors
 */
import os from 'node:os'

/** Same-origin route read by the Client half. */
export const SYSTEM_COLORS_PATH = '/dsh-codex-style/system-colors'

/** Same-origin event stream that pushes every accent change. */
export const SYSTEM_COLORS_EVENTS_PATH = '/dsh-codex-style/system-colors/events'

const PALETTE_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent'
const DWM_KEY = 'HKCU\\Software\\Microsoft\\Windows\\DWM'
const TIMEOUT_MS = 3_000
const MAX_OUTPUT = 8 * 1024
const WATCH_RESTART_MS = 5_000
const WATCH_MAX_RESTARTS = 3
const HEARTBEAT_MS = 20_000

/**
 * Native registry-change notifier. The C# class opens each key with
 * `KEY_NOTIFY` and blocks in `RegNotifyChangeKeyValue` with
 * `REG_NOTIFY_CHANGE_LAST_SET`; each completed wait prints `changed`. Console
 * writes happen on plain .NET threads so no PowerShell runspace is needed off
 * the pipeline thread.
 */
const WATCH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;

public static class DshCodexStyleAccentNotify
{
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int RegOpenKeyEx(IntPtr hKey, string subKey, uint options, int samDesired, out IntPtr result);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int RegNotifyChangeKeyValue(IntPtr hKey, bool watchSubtree, int notifyFilter, IntPtr hEvent, bool asynchronous);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int RegCloseKey(IntPtr hKey);

    private static readonly IntPtr HKEY_CURRENT_USER = new IntPtr(unchecked((int)0x80000001));
    private const int KEY_NOTIFY = 0x0010;
    private const int REG_NOTIFY_CHANGE_LAST_SET = 0x00000004;

    private static void Notify(string line)
    {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }

    private static void WatchOne(string subKey)
    {
        while (true)
        {
            IntPtr key;
            int status = RegOpenKeyEx(HKEY_CURRENT_USER, subKey, 0, KEY_NOTIFY, out key);
            if (status != 0)
            {
                Notify("open-error " + status);
                Thread.Sleep(3000);
                continue;
            }

            try
            {
                while (true)
                {
                    status = RegNotifyChangeKeyValue(key, false, REG_NOTIFY_CHANGE_LAST_SET, IntPtr.Zero, false);
                    if (status != 0)
                    {
                        Notify("notify-error " + status);
                        Thread.Sleep(3000);
                        break;
                    }

                    Notify("changed");
                }
            }
            finally
            {
                RegCloseKey(key);
            }
        }
    }

    public static void Start(string[] subKeys)
    {
        foreach (var subKey in subKeys)
        {
            var thread = new Thread(() => WatchOne(subKey)) { IsBackground = true };
            thread.Start();
        }

        Notify("ready");
        Thread.Sleep(Timeout.Infinite);
    }
}
'@

[DshCodexStyleAccentNotify]::Start(@(%WATCH_KEYS%))
`

/** Registry keys whose value writes mean "the user picked another accent". */
const WATCH_KEYS = [
  'Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent',
  'Software\\Microsoft\\Windows\\DWM',
]

/**
 * Render the helper script with one PowerShell string array of watched keys.
 * @param {string[]} keys - HKCU-relative key paths.
 * @returns {string} complete PowerShell script.
 */
function watchScript(keys) {
  const rendered = keys.map((key) => `'${key.replaceAll("'", "''")}'`).join(', ')
  return WATCH_SCRIPT.replace('%WATCH_KEYS%', rendered)
}

const channel = (value) => value.toString(16).padStart(2, '0')
const hex = (red, green, blue) => '#' + channel(red) + channel(green) + channel(blue)

/**
 * Mix one color channel toward white (`amount` in 0..1) or black (`-amount`).
 * @param {number} value - 0..255 source channel.
 * @param {number} amount - positive lightens, negative darkens.
 * @returns {number} rounded 0..255 channel.
 */
const mixChannel = (value, amount) => {
  const mixed = amount >= 0 ? value + (255 - value) * amount : value * (1 + amount)
  return Math.max(0, Math.min(255, Math.round(mixed)))
}

/**
 * Parse one `#rrggbb` string.
 * @param {string} color - canonical lower-case hex color.
 * @returns {[number, number, number]} channels.
 */
function parseHex(color) {
  return [1, 3, 5].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16))
}

/**
 * Derive the light and dark shade used on dark and light surfaces when the
 * shell palette is missing or stale. The ratios mirror how Windows separates
 * the shell `AccentLight1` and `AccentDark1` shades from the base accent.
 * @param {string} accent - `#rrggbb` base accent.
 * @returns {{ accentLight: string, accentDark: string }} shade pair.
 */
export function deriveAccentShades(accent) {
  const [red, green, blue] = parseHex(accent)
  return {
    accentLight: hex(mixChannel(red, 0.22), mixChannel(green, 0.22), mixChannel(blue, 0.22)),
    accentDark: hex(mixChannel(red, -0.22), mixChannel(green, -0.22), mixChannel(blue, -0.22)),
  }
}

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
 * Decode the DWM `AccentColor` DWORD (`0xAABBGGRR`).
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
 * Read the live Windows accent. The DWM value is used as the base tone because
 * the shell writes it on every accent change; the palette contributes the two
 * derived shades only while it still describes the same base tone.
 * @param {object} ctx - Host context with `subprocess`.
 * @returns {Promise<object>} route payload.
 */
async function readPalette(ctx) {
  if (process.platform !== 'win32' || typeof ctx?.subprocess?.spawn !== 'function') {
    return { ok: false, platform: process.platform }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const [dwmText, paletteText] = await Promise.all([
      query(ctx, DWM_KEY, 'AccentColor', controller.signal),
      query(ctx, PALETTE_KEY, 'AccentPalette', controller.signal),
    ])
    const dwmAccent = parseDwmAccent(dwmText)
    const palette = parseAccentPalette(paletteText)
    const accent = dwmAccent ?? palette?.accent ?? null
    if (accent === null) return { ok: false, platform: 'win32' }
    if (palette !== null && palette.accent === accent) {
      return {
        ok: true,
        platform: 'win32',
        accent,
        accentLight: palette.accentLight,
        accentDark: palette.accentDark,
        source: 'palette',
      }
    }
    return {
      ok: true,
      platform: 'win32',
      accent,
      ...deriveAccentShades(accent),
      source: dwmAccent === null ? 'palette-derived' : 'dwm',
    }
  } catch {
    return { ok: false, platform: process.platform }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Start the native registry watcher. The helper only prints change lines; each
 * line schedules a debounced palette read. Failures restart the helper a
 * bounded number of times and otherwise leave the client fallback poll active.
 * @param {object} ctx - Host context with `subprocess`.
 * @param {AbortSignal} signal - service lifetime.
 * @param {() => void} onChange - debounced change callback.
 * @param {string[]} keys - HKCU-relative keys the helper listens on.
 * @returns {() => void} disposer that terminates the helper.
 */
function startWatcher(ctx, signal, onChange, keys) {
  let child = null
  let disposed = false
  let restarts = 0
  let restartTimer = null
  let debounceTimer = null

  const scheduleRead = () => {
    if (disposed) return
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      onChange()
    }, 40)
  }

  const scheduleRestart = () => {
    if (disposed || restarts >= WATCH_MAX_RESTARTS) return
    restarts += 1
    if (restartTimer !== null) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = null
      void start()
    }, WATCH_RESTART_MS)
  }

  const resolveShell = async () => {
    try {
      return await ctx.subprocess.resolveExecutable('powershell', undefined, signal)
    } catch (error) {
      if (signal.aborted) throw error
      return ctx.subprocess.resolveExecutable('pwsh', undefined, signal)
    }
  }

  const start = async () => {
    if (disposed) return
    try {
      const executable = await resolveShell()
      if (disposed) return
      const running = ctx.subprocess.spawn({
        argv: [
          executable,
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-EncodedCommand',
          Buffer.from(watchScript(keys), 'utf16le').toString('base64'),
        ],
        cwd: os.homedir(),
        signal,
        graceMs: 1_500,
        stdio: {
          stdin: 'ignore',
          stdout: 'pipe',
          stderr: 'ignore',
        },
      })
      child = running
      let buffer = ''
      running.stdout?.on?.('data', (chunk) => {
        buffer += String(chunk)
        let index = buffer.indexOf('\n')
        while (index !== -1) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          if (line === 'changed') scheduleRead()
          index = buffer.indexOf('\n')
        }
      })
      running.done.then(
        () => {
          if (child === running) child = null
          if (disposed) return
          scheduleRestart()
        },
        () => {
          if (child === running) child = null
          if (disposed) return
          scheduleRestart()
        },
      )
    } catch {
      if (!disposed) scheduleRestart()
    }
  }

  void start()

  return () => {
    disposed = true
    if (restartTimer !== null) clearTimeout(restartTimer)
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    try {
      child?.terminate()
    } catch {
      /* already gone */
    }
    child = null
  }
}

/**
 * Create the palette service shared by the GET route and the event stream.
 * @param {object} ctx - Host context with `webServer`, `connection` and `subprocess`.
 * @param {{ watch?: boolean, watchKeys?: string[] }} [options] - `watch: false` keeps checks offline; `watchKeys` narrows the helper for isolated verification.
 * @returns {{ read: () => Promise<object>, stream: (req: object, res: object) => Promise<void>, subscribe: (listener: (payload: object) => void) => (() => void), dispose: () => void }} service.
 */
export function createSystemColorsService(ctx, options = {}) {
  const subscribers = new Set()
  const openStreams = new Set()
  const controller = new AbortController()
  let latest = null
  let latestText = ''
  let pending = null
  let disposed = false
  let stopWatching = null

  const publish = (payload) => {
    const text = JSON.stringify(payload)
    if (text === latestText) return
    latestText = text
    latest = payload
    for (const listener of subscribers) {
      try {
        listener(payload)
      } catch {
        /* one broken listener must not stop the others */
      }
    }
  }

  const read = () => {
    if (disposed) return Promise.resolve({ ok: false, platform: process.platform })
    if (pending !== null) return pending
    const operation = readPalette(ctx)
      .then((payload) => {
        publish(payload)
        return payload
      })
      .finally(() => {
        if (pending === operation) pending = null
      })
    pending = operation
    return operation
  }

  if (options.watch !== false && process.platform === 'win32') {
    stopWatching = startWatcher(ctx, controller.signal, () => {
      void read()
    }, options.watchKeys ?? WATCH_KEYS)
  }

  const subscribe = (listener) => {
    subscribers.add(listener)
    return () => subscribers.delete(listener)
  }

  const stream = async (req, res) => {
    if (req?.method !== 'GET') {
      res.writeHead?.(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' })
      res.end?.('method not allowed')
      return
    }
    res.writeHead?.(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write?.(': connected\n\n')
    let closed = false
    const send = (payload) => {
      if (closed) return
      try {
        res.write?.(`data: ${JSON.stringify(payload)}\n\n`)
      } catch {
        /* the request went away */
      }
    }
    const unsubscribe = subscribe(send)
    const heartbeat = setInterval(() => {
      if (closed) return
      try {
        res.write?.(': keep-alive\n\n')
      } catch {
        /* the request went away */
      }
    }, HEARTBEAT_MS)
    const close = () => {
      if (closed) return
      closed = true
      clearInterval(heartbeat)
      unsubscribe()
      openStreams.delete(close)
      try {
        res.end?.()
      } catch {
        /* already closed */
      }
    }
    openStreams.add(close)
    req?.on?.('close', close)
    res.on?.('close', close)
    res.on?.('error', close)
    if (latest !== null) send(latest)
    else await read()
    if (disposed) close()
  }

  return {
    read,
    stream,
    subscribe,
    dispose() {
      if (disposed) return
      disposed = true
      controller.abort()
      stopWatching?.()
      for (const close of [...openStreams]) close()
      subscribers.clear()
      pending = null
    },
  }
}
