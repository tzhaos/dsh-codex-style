/**
 * Zero-dependency verification for the Windows system palette used by the
 * window material.
 *
 * The registry samples below are the shell's real payloads; the fake
 * subprocess keeps the check offline. The route is exercised through the
 * shipped Host half so registration, admission and the JSON contract stay
 * covered.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { apply as applyHostPlugin } from '../index.js'
import {
  parseAccentPalette,
  parseDwmAccent,
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

/** Fake subprocess whose fixed queries answer with the supplied registry text. */
function fakeSubprocess(answers) {
  const calls = []
  return {
    calls,
    service: {
      async resolveExecutable(name) {
        return name + '.exe'
      },
      spawn(request) {
        calls.push(request.argv.join(' '))
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

/** Minimal Host context that captures the routes the real Host half registers. */
function hostFixture(answers) {
  const routes = new Map()
  const fake = fakeSubprocess(answers)
  const ctx = {
    effect: (factory) => {
      factory()
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
  return { routes, calls: fake.calls }
}

/** Invoke one captured route and collect its JSON response. */
async function invoke(route, method = 'GET') {
  const response = { status: null, payload: null }
  const request = { method }
  const reply = {
    writeHead(status) {
      response.status = status
    },
    end(text) {
      response.payload = JSON.parse(text)
    },
  }
  await route.handler(request, reply)
  return response
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

await check('the host half registers the read-only system color route', () => {
  const { routes } = hostFixture({ palette: PALETTE_OUTPUT, dwm: DWM_OUTPUT })
  assert(routes.has(SYSTEM_COLORS_PATH), 'system color route registered')
  const route = routes.get(SYSTEM_COLORS_PATH)
  assert.equal(route.kind, 'exact')
})

await check('the host half answers with the live palette and rejects other methods', async () => {
  const { routes, calls } = hostFixture({ palette: PALETTE_OUTPUT, dwm: DWM_OUTPUT })
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
    })
    assert.equal(calls.length, 1)
    assert(calls[0].includes('AccentPalette'), 'reads the palette through reg query')
  } else {
    assert.equal(answered.status, 200)
    assert.deepEqual(answered.payload, { ok: false, platform: process.platform })
    assert.equal(calls.length, 0, 'non-Windows hosts do not spawn')
  }
})

await check('the window material consumes the accent palette and falls back to the theme surface', () => {
  const clientSource = read('client.js')
  const leftRailSource = read('src/navigation/left-rail.js')
  const presentation = read('src/shared/presentation.js')
  assert(presentation.includes('var(--dshlr-system-accent, var(--dsw-alias-bg-layer-2))'))
  assert(presentation.includes('var(--dshlr-system-accent-on-dark, var(--dsw-alias-bg-layer-2))'))
  assert(leftRailSource.includes("request('/dsh-codex-style/system-colors'"))
  assert(leftRailSource.includes("'--dshlr-system-accent-on-dark'"))
  assert(clientSource.includes('--dshlr-system-accent-on-dark'))
})

await check('the palette refreshes on a short poll with a two-second host cache', () => {
  const hostSource = read('host/system-colors.js')
  const leftRailSource = read('src/navigation/left-rail.js')
  const clientSource = read('client.js')
  assert(hostSource.includes('const CACHE_MS = 2_000'), 'host cache stays short')
  assert(leftRailSource.includes('setInterval?.(refresh, 8_000)'), 'browser polls every eight seconds')
  assert(leftRailSource.includes("addEventListener?.('focus', onFocus)"), 'regaining focus refreshes at once')
  assert(clientSource.includes('setInterval?.(refresh, 8_000)'), 'built client carries the poll cadence')
})

await check('the manifest still ships the merged client half', () => {
  assert.equal(manifest.exports?.['./client'], './client.js')
  assert.equal(manifest.main, 'index.js')
})

console.log('\n' + checks + ' system color checks passed')
