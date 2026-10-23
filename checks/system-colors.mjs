/**
 * Zero-dependency verification for the Windows system palette that drives the
 * window material.
 *
 * The registry samples below are the shell's real payloads; the fake
 * subprocess keeps the check offline and exposes a mutable answer table so a
 * watcher notification can be simulated. The routes are exercised through the
 * shipped Host half so registration, admission, the JSON contract and the
 * event stream stay covered.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyHostPlugin } from '../index.js'
import {
  createSystemColorsService,
  deriveAccentShades,
  parseAccentPalette,
  parseDwmAccent,
  SYSTEM_COLORS_EVENTS_PATH,
  SYSTEM_COLORS_PATH,
} from '../host/system-colors.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const manifest = JSON.parse(read('package.json'))

/** Real `reg query ... AccentPalette` output from a Windows 11 shell. */
const PALETTE_OUTPUT =
  '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent\r\n' +
  '    AccentPalette    REG_BINARY    99EBFF004CC2FF000091F8000078D4000067C000003E9200001A6800F7630C00\r\n\r\n'
/** Real `reg query ... AccentColor` output from the same shell. */
const DWM_OUTPUT =
  '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\DWM\r\n' +
  '    AccentColor    REG_DWORD    0xffd47800\r\n\r\n'
/** DWM answer for a red accent (`0xAABBGGRR`), used to simulate a live change. */
const DWM_RED_OUTPUT =
  '\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\DWM\r\n' +
  '    AccentColor    REG_DWORD    0xff0000e3\r\n\r\n'

let checks = 0

/** Run one named check. */
async function check(name, body) {
  try {
    await body()
    checks += 1
    console.log('ok ' + name)
  } catch (error) {
    console.error('FAIL ' + name)
    console.error('     ' + (error?.message ?? error))
    process.exitCode = 1
  }
}

/** Event-emitter-shaped fake used for the long-lived watcher child. */
function fakeStream() {
  return {
    handlers: [],
    on(event, handler) {
      if (event === 'data') this.handlers.push(handler)
      return this
    },
    push(chunk) {
      for (const handler of this.handlers) handler(chunk)
    },
  }
}

/**
 * Fake subprocess whose registry answers stay mutable so a change can be
 * simulated; the watcher child keeps a pending outcome so no restart timer is
 * scheduled during checks.
 */
function fakeSubprocess(answers) {
  const calls = []
  const stdout = fakeStream()
  return {
    calls,
    service: {
      async resolveExecutable(name) {
        return name + '.exe'
      },
      spawn(request) {
        calls.push(request.argv.join(' '))
        if (request.argv[1] !== 'query') {
          return {
            stdout,
            done: new Promise(() => {}),
            terminate() {},
            async waitForExit() {},
          }
        }
        const key = String(request.argv[2] ?? '')
        const output = key.includes('DWM') ? answers.dwm : answers.palette
        const failed = output === null || output === undefined
        return {
          done: Promise.resolve({ exitCode: failed ? 1 : 0, signal: null }),
          collected: {
            stdout: {
              readFrom: () => ({ text: failed ? '' : output, lossy: false }),
            },
            stderr: { readFrom: () => ({ text: '', lossy: false }) },
          },
          terminate() {},
          async waitForExit() {},
        }
      },
    },
  }
}

/**
 * Minimal Host context that captures the routes the real Host half registers
 * and records effect disposers so the watcher lifetime can be released.
 */
function hostFixture(answers) {
  const routes = new Map()
  const disposers = []
  const fake = fakeSubprocess(answers)
  const ctx = {
    effect: (factory) => {
      const dispose = factory()
      if (typeof dispose === 'function') disposers.push(dispose)
      return () => {}
    },
    connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
    waterfall: async (_event, _request, _response, next) => next(),
    webServer: {
      register: (definition) => {
        routes.set(definition.path, definition)
        return () => {}
      },
    },
    agents: { get: () => undefined },
    subprocess: fake.service,
  }
  applyHostPlugin(ctx)
  const cleanup = async () => {
    while (disposers.length > 0) {
      const dispose = disposers.pop()
      try {
        await dispose()
      } catch {
        /* one failed disposal must not hide the rest */
      }
    }
  }
  return { routes, calls: fake.calls, answers, cleanup }
}

/** Invoke one captured route and collect its JSON response. */
async function invoke(route, method = 'GET') {
  const response = { status: null, payload: null }
  const request = { method, on() {} }
  const reply = {
    writeHead(status) {
      response.status = status
    },
    end(text) {
      response.payload = text === undefined ? null : JSON.parse(text)
    },
  }
  await route.handler(request, reply)
  return response
}

/** Fake streaming response used by the event-stream check. */
function fakeEventResponse() {
  const frames = []
  let status = null
  let headers = null
  const listeners = new Map()
  return {
    frames,
    get status() {
      return status
    },
    get headers() {
      return headers
    },
    writeHead(code, values) {
      status = code
      headers = values
    },
    write(chunk) {
      frames.push(String(chunk))
      return true
    },
    end() {},
    on(event, handler) {
      listeners.set(event, handler)
    },
  }
}

await check('the accent palette decodes to the shell light, base and dark shades', () => {
  assert.deepEqual(parseAccentPalette(PALETTE_OUTPUT), {
    accent: '#0078d4',
    accentLight: '#0091f8',
    accentDark: '#0067c0',
  })
})

await check('malformed or truncated palette payloads stay rejected', () => {
  assert.equal(parseAccentPalette(''), null)
  assert.equal(parseAccentPalette('AccentPalette    REG_BINARY    99EBFF00'), null)
  assert.equal(parseAccentPalette(null), null)
})

await check('the DWM accent DWORD decodes ABGR to the same system color', () => {
  assert.equal(parseDwmAccent(DWM_OUTPUT), '#0078d4')
  assert.equal(parseDwmAccent('AccentColor    REG_SZ    nope'), null)
})

await check('a stale shell palette falls back to derived shades of the live DWM accent', () => {
  assert.deepEqual(deriveAccentShades('#e30000'), { accentLight: '#e93838', accentDark: '#b10000' })
})

await check('the host half registers the palette route and the change event stream', () => {
  const { routes, cleanup } = hostFixture({ palette: PALETTE_OUTPUT, dwm: DWM_OUTPUT })
  assert(routes.has(SYSTEM_COLORS_PATH), 'palette route registered')
  assert(routes.has(SYSTEM_COLORS_EVENTS_PATH), 'event stream registered')
  assert.equal(routes.get(SYSTEM_COLORS_PATH).kind, 'exact')
  assert.equal(routes.get(SYSTEM_COLORS_EVENTS_PATH).kind, 'exact')
  return cleanup()
})

await check('the host half answers with the live palette and rejects other methods', async () => {
  const { routes, calls, cleanup } = hostFixture({ palette: PALETTE_OUTPUT, dwm: DWM_OUTPUT })
  const route = routes.get(SYSTEM_COLORS_PATH)
  const rejected = await invoke(route, 'POST')
  assert.equal(rejected.status, 405)
  const answered = await invoke(route)
  if (process.platform === 'win32') {
    assert.equal(answered.status, 200)
    assert.deepEqual(answered.payload, {
      ok: true,
      platform: 'win32',
      accent: '#0078d4',
      accentLight: '#0091f8',
      accentDark: '#0067c0',
      source: 'palette',
    })
    const paletteCall = calls.find((call) => call.includes('AccentPalette'))
    const dwmCall = calls.find((call) => call.includes('/v AccentColor'))
    assert(paletteCall !== undefined, 'reads the palette through reg query')
    assert(dwmCall !== undefined, 'reads the live DWM accent through reg query')
  } else {
    assert.equal(answered.status, 200)
    assert.deepEqual(answered.payload, { ok: false, platform: process.platform })
    assert(!calls.some((call) => call.includes('reg.exe')), 'non-Windows hosts do not spawn reg')
  }
  return cleanup()
})

await check('a DWM accent that disagrees with the shell palette wins as the base tone', async () => {
  const { routes, cleanup } = hostFixture({ palette: PALETTE_OUTPUT, dwm: DWM_RED_OUTPUT })
  const answered = await invoke(routes.get(SYSTEM_COLORS_PATH))
  if (process.platform === 'win32') {
    assert.deepEqual(answered.payload, {
      ok: true,
      platform: 'win32',
      accent: '#e30000',
      accentLight: '#e93838',
      accentDark: '#b10000',
      source: 'dwm',
    })
  }
  return cleanup()
})

await check('the event stream pushes the current palette and every later change', async () => {
  const fixture = hostFixture({ palette: PALETTE_OUTPUT, dwm: DWM_OUTPUT })
  const stream = fixture.routes.get(SYSTEM_COLORS_EVENTS_PATH)
  const response = fakeEventResponse()
  await stream.handler({ method: 'GET', on() {} }, response)
  assert.equal(response.status, 200)
  assert(response.headers['content-type'].startsWith('text/event-stream'))
  assert(response.frames.join('').includes('"accent":"#0078d4"'), 'initial palette frame')
  if (process.platform === 'win32') {
    fixture.answers.dwm = DWM_RED_OUTPUT
    await invoke(fixture.routes.get(SYSTEM_COLORS_PATH))
    const pushed = response.frames.join('')
    assert(pushed.includes('"accent":"#e30000"'), 'changed palette frame')
  }
  return fixture.cleanup()
})

await check('a watcher-free service still answers reads and publishes on refresh', async () => {
  const answers = { palette: PALETTE_OUTPUT, dwm: DWM_OUTPUT }
  const fake = fakeSubprocess(answers)
  const service = createSystemColorsService({ subprocess: fake.service }, { watch: false })
  if (process.platform === 'win32') {
    const seen = []
    const unsubscribe = service.subscribe((payload) => seen.push(payload.accent))
    const first = await service.read()
    assert.equal(first.accent, '#0078d4')
    assert.deepEqual(seen, ['#0078d4'])
    answers.dwm = DWM_RED_OUTPUT
    const second = await service.read()
    assert.equal(second.accent, '#e30000')
    assert.deepEqual(seen, ['#0078d4', '#e30000'])
    unsubscribe()
  } else {
    assert.deepEqual(await service.read(), { ok: false, platform: process.platform })
  }
  service.dispose()
})

await check('the window material consumes the streamed palette and keeps a fallback poll', () => {
  const clientSource = read('client.js')
  const leftRailSource = read('src/navigation/left-rail.js')
  const presentation = read('src/shared/presentation.js')
  assert(presentation.includes('var(--dshlr-system-accent, var(--dsw-alias-bg-layer-2))'))
  assert(presentation.includes('var(--dshlr-system-accent-on-dark, var(--dsw-alias-bg-layer-2))'))
  assert(leftRailSource.includes("request('/dsh-codex-style/system-colors/events'"))
  assert(leftRailSource.includes("request('/dsh-codex-style/system-colors'"))
  assert(leftRailSource.includes("'--dshlr-system-accent-on-dark'"))
  assert(leftRailSource.includes('setInterval?.(readOnce, 3_000)'), 'fallback poll stays short')
  assert(leftRailSource.includes("addEventListener?.('focus', onFocus)"), 'regaining focus refreshes at once')
  assert(clientSource.includes('--dshlr-system-accent-on-dark'))
  assert(clientSource.includes("request('/dsh-codex-style/system-colors/events'"))
})

await check('the host watches the shell keys natively instead of polling', () => {
  const hostSource = read('host/system-colors.js')
  const indexSource = read('index.js')
  assert(hostSource.includes('RegNotifyChangeKeyValue'))
  assert(hostSource.includes('REG_NOTIFY_CHANGE_LAST_SET'))
  assert(hostSource.includes("stdout: 'pipe'"), 'the watcher streams change lines')
  assert(hostSource.includes("resolveExecutable('powershell'"))
  assert(hostSource.includes("resolveExecutable('pwsh'"))
  assert(hostSource.includes('WATCH_MAX_RESTARTS'))
  assert(hostSource.includes("'text/event-stream; charset=utf-8'"))
  assert(indexSource.includes('createSystemColorsService(ctx)'))
  assert(indexSource.includes('systemColors.stream(req, res)'))
  assert(!hostSource.includes('CACHE_MS'), 'the palette route no longer answers from a poll cache')
})

await check('the manifest still ships the merged client half', () => {
  assert.equal(manifest.exports?.['./client'], './client.js')
  assert.equal(manifest.main, 'index.js')
})

console.log('\n' + checks + ' system color checks passed')
