/** Host pasteboard storage: startup clearing, naming and the file cap. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  clearPasteboard,
  createPasteboard,
  dshHome,
  MAX_FILES,
  MAX_TEXT_BYTES,
  PASTEBOARD_PATH,
  pasteboardDir,
  prunePasteboard,
} from '../host/pasteboard.js'
import { apply as applyHost } from '../index.js'

let checks = 0
async function check(name, body) {
  try {
    await body()
    checks += 1
    console.log('ok ' + name)
  } catch (error) {
    process.exitCode = 1
    console.error('FAIL ' + name + '\n     ' + (error?.stack ?? error))
  }
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-pasteboard-check-'))
}

const remove = (dir) => fs.rmSync(dir, { recursive: true, force: true })

await check('the default folder lives in the DSH home and honours DSH_HOME', () => {
  const previous = process.env.DSH_HOME
  const home = tempDir()
  try {
    process.env.DSH_HOME = home
    assert.equal(dshHome(), home)
    assert.equal(pasteboardDir(), path.join(home, 'dsh-codex-style', 'pasteboard'))
    delete process.env.DSH_HOME
    assert(pasteboardDir().endsWith(path.join('.dsh', 'dsh-codex-style', 'pasteboard')))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    remove(home)
  }
})

await check('creating the service empties leftovers from a previous run', () => {
  const dir = tempDir()
  try {
    fs.mkdirSync(path.join(dir, 'nested'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'old.txt'), 'old')
    fs.writeFileSync(path.join(dir, 'nested', 'deeper.txt'), 'old')
    createPasteboard({ dir })
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    remove(dir)
  }
})

await check('writes keep the text verbatim with a readable counted name', () => {
  const dir = tempDir()
  try {
    const service = createPasteboard({ dir })
    const text = '第一行\nsecond line\n' + 'x'.repeat(2000)
    const saved = service.write(text)
    const counted = text.length.toLocaleString('en-US')
    assert.equal(saved.path, path.join(dir, saved.name))
    assert.equal(saved.name, 'Pasted text (' + counted + ' chars) 1.txt')
    assert.equal(fs.readFileSync(saved.path, 'utf8'), text)
  } finally {
    remove(dir)
  }
})

await check('repeated writes never reuse a file name', () => {
  const dir = tempDir()
  try {
    const service = createPasteboard({ dir })
    const first = service.write('a'.repeat(2000))
    const second = service.write('b'.repeat(2001))
    const third = service.write('c'.repeat(2002))
    assert.equal(new Set([first.name, second.name, third.name]).size, 3)
    assert.deepEqual(fs.readdirSync(dir).sort(), [first.name, second.name, third.name].sort())
  } finally {
    remove(dir)
  }
})

await check('empty, blank and oversized pastes are refused', () => {
  const dir = tempDir()
  try {
    const service = createPasteboard({ dir })
    assert.throws(() => service.write(''), /empty paste/)
    assert.throws(() => service.write('   \n'), /empty paste/)
    assert.throws(() => service.write('x'.repeat(MAX_TEXT_BYTES + 1)), /too large/)
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    remove(dir)
  }
})

await check('the folder keeps only the newest files past the cap', () => {
  const dir = tempDir()
  try {
    const service = createPasteboard({ dir, maxFiles: 3 })
    const names = []
    for (let index = 0; index < 5; index += 1) {
      const saved = service.write('x'.repeat(2000 + index))
      names.push(saved.name)
      const stamp = new Date(2024, 0, 1, 0, 0, index)
      fs.utimesSync(saved.path, stamp, stamp)
    }
    const remaining = fs.readdirSync(dir).sort()
    assert.equal(remaining.length, 3)
    assert(remaining.includes(names[4]), 'newest file kept')
    assert(remaining.includes(names[3]))
    assert(remaining.includes(names[2]))
    assert(!remaining.includes(names[0]), 'oldest file pruned')
  } finally {
    remove(dir)
  }
})

await check('pruning orders by modification time and is safe on a missing folder', () => {
  const dir = tempDir()
  try {
    fs.writeFileSync(path.join(dir, 'a.txt'), 'a')
    fs.writeFileSync(path.join(dir, 'b.txt'), 'b')
    fs.writeFileSync(path.join(dir, 'c.txt'), 'c')
    fs.utimesSync(path.join(dir, 'a.txt'), new Date(2020, 0, 1), new Date(2020, 0, 1))
    fs.utimesSync(path.join(dir, 'b.txt'), new Date(2021, 0, 1), new Date(2021, 0, 1))
    fs.utimesSync(path.join(dir, 'c.txt'), new Date(2022, 0, 1), new Date(2022, 0, 1))
    prunePasteboard(dir, 2)
    assert.deepEqual(fs.readdirSync(dir).sort(), ['b.txt', 'c.txt'])
    prunePasteboard(path.join(dir, 'missing'), 1)
    clearPasteboard(dir)
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    remove(dir)
  }
})

await check('the cap defaults to one hundred files', () => {
  assert.equal(MAX_FILES, 100)
})

await check('the Host applies one pasteboard route that writes the text', async () => {
  const previous = process.env.DSH_HOME
  const home = tempDir()
  process.env.DSH_HOME = home
  const routes = []
  const disposers = []
  let ctx
  const request = (method, body) => {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')]
    return {
      method,
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) yield chunk
      },
    }
  }
  const invoke = async (method, body) => {
    const calls = []
    const res = {
      writeHead(status, headers) { calls.push({ kind: 'head', status, headers }) },
      end(payload) { calls.push({ kind: 'end', payload }) },
    }
    const route = routes.find((candidate) => candidate.path === PASTEBOARD_PATH)
    assert(route, 'pasteboard route registered')
    await route.handler(request(method, body), res)
    return calls
  }
  try {
    ctx = {
      effect(factory) {
        const dispose = factory()
        if (typeof dispose === 'function') disposers.push(dispose)
      },
      webServer: { register(route) { routes.push(route); return () => {} } },
      connection: { admit: () => ({ peer: { principal: { kind: 'owner' } } }) },
      waterfall: async (name, req, res, next) => next(),
    }
    applyHost(ctx)
    assert(routes.some((route) => route.path === PASTEBOARD_PATH), 'route path registered')

    const text = 'integration paste\n' + 'y'.repeat(2400)
    const ok = await invoke('POST', { text })
    assert.equal(ok[0].status, 200)
    const payload = JSON.parse(ok[1].payload)
    assert.equal(payload.ok, true)
    assert(fs.existsSync(payload.path), 'file written')
    assert.equal(fs.readFileSync(payload.path, 'utf8'), text)
    assert(payload.path.startsWith(pasteboardDir()))

    const get = await invoke('GET')
    assert.equal(get[0].status, 405)
    assert.equal(JSON.parse(get[1].payload).reason, 'method-not-allowed')
    const invalid = await invoke('POST', { text: 42 })
    assert.equal(invalid[0].status, 400)
    assert.equal(JSON.parse(invalid[1].payload).reason, 'invalid-request')
  } finally {
    for (const dispose of disposers.reverse()) {
      try {
        await dispose()
      } catch {
        /* the fake Host ignores teardown errors */
      }
    }
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    remove(home)
  }
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
