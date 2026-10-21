/** Git integration uses only a fresh private repository and isolated Git configuration. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, execFileSync } from 'node:child_process'
import { createGitEngine, registerGit } from '../host/git.js'
import { createGitContribution } from '../git-contract.js'

const scratch = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-git-check-')))
const directory = path.join(scratch, 'repository')
fs.mkdirSync(directory)
fs.mkdirSync(path.join(scratch, 'templates'))
fs.writeFileSync(path.join(scratch, 'gitconfig'), '')
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))
Object.assign(gitEnv, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(scratch, 'gitconfig'), GIT_ATTR_NOSYSTEM: '1', GIT_TEMPLATE_DIR: path.join(scratch, 'templates'), GIT_TERMINAL_PROMPT: '0', LC_ALL: 'C' })
const setup = (args, cwd = directory) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'commit.gpgsign=false', '-c', 'user.name=Git Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { cwd, env: gitEnv, encoding: 'utf8', windowsHide: true, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] })
setup(['init', '-b', 'main'])
fs.writeFileSync(path.join(directory, 'sample.txt'), 'private fixture\n')
setup(['add', '--', 'sample.txt'])
setup(['commit', '-m', 'fixture'])
setup(['branch', 'feature/中文'])
setup(['branch', 'occupied'])
setup(['worktree', 'add', path.join(scratch, 'other-tree'), 'occupied'])
const session = { id: 'private-session', header: { cwd: directory } }
let activity = [], mode = 'danger-full-access', switches = 0
let liveSessions = [session]
const activityById = new Map(), directories = new Map()
const ctx = {
  sessions: { get: (id) => liveSessions.find((entry) => entry.id === id), list: () => liveSessions },
  workingDirectory: { get: (entry) => directories.get(entry.id) ?? entry.header.cwd },
  sandboxPolicy: { resolve: () => ({ mode }) },
  sandbox: { confine: async (argv) => ({ argv }) },
  waterfall: async (_event, { sessionId }) => activityById.get(sessionId) ?? activity,
  fs: {
    async resolve(value, options) {
      const target = fs.realpathSync.native(path.resolve(options.cwd, value))
      assert(path.relative(scratch, target) !== '..' && !path.relative(scratch, target).startsWith('..' + path.sep), 'fixture escaped its private directory: ' + JSON.stringify({ scratch, target, value, cwd: options.cwd }))
      return target
    },
    processPath: (value) => value,
  },
  subprocess: {
    resolveExecutable: async () => 'git',
    spawn(options) {
      assert(path.resolve(options.cwd).startsWith(path.resolve(scratch) + path.sep), 'private cwd required')
      if (options.argv.includes('switch')) switches++
      const environment = { ...gitEnv, ...options.env }
      for (const [key, value] of Object.entries(environment)) if (value === undefined) delete environment[key]
      let stdout = '', stderr = '', complete = false, child
      const done = new Promise((resolve) => {
        child = execFile(options.argv[0], options.argv.slice(1), { cwd: options.cwd, env: environment, signal: options.signal, encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 }, (error, out, err) => {
          stdout = out; stderr = err; complete = true
          resolve({ exitCode: error ? (typeof error.code === 'number' ? error.code : null) : 0, signal: error?.signal })
        })
      })
      return { done, collected: { stdout: { readFrom: () => ({ text: stdout, lossy: false }) }, stderr: { readFrom: () => ({ text: stderr, lossy: false }) } }, terminate: () => { if (!complete) child.kill() }, waitForExit: () => done }
    },
  },
}
const engine = createGitEngine()
let checks = 0
async function check(name, run) {
  try { await run(); checks++; console.log('ok ' + name) }
  catch (error) { process.exitCode = 1; console.error('FAIL ' + name + '\n' + error.stack) }
}
try {
  await check('authenticated contract only accepts Session identity and literal branch selections', () => {
    const contribution = createGitContribution()
    assert.deepEqual(contribution.descriptors.map((entry) => entry.parameters.map((arg) => arg.wire)), [['sessionId'], ['sessionId', 'branch', 'expectedHead']])
    const input = contribution.descriptors[0].parameters[0].strictCodec.create()
    assert.throws(() => input.parse({ cwd: directory }))
    assert.throws(() => input.parse('x\0y'))
    const registered = [], services = new Map(), off = []
    registerGit({ ...ctx, provide: (key, service) => services.set(key, service), typert: { register: (entry) => { registered.push(entry); return () => {} } }, effect: (fn) => { off.push(fn()); return () => {} } })
    assert.equal(registered[0].face, 'host')
    assert.equal(services.get('codexGit').typertRemote.service, services.get('codexGit'))
    for (const dispose of off.reverse()) if (typeof dispose === 'function') dispose()
  })
  await check('Git reads the selected Session repository and marks occupied worktrees', async () => {
    const value = await engine.list(ctx, session.id)
    assert(value.ok, JSON.stringify(value))
    assert.equal(value.repository.branch, 'main')
    assert.equal(value.repository.dirty, false)
    assert(value.repository.branches.some((entry) => entry.name === 'feature/中文'))
    assert.equal(value.repository.branches.find((entry) => entry.name === 'occupied').inUse, true)
    assert.equal((await engine.list(ctx, 'unknown')).reason, 'session-unavailable')
  })
  await check('a clean local branch can be switched with a fresh repository token', async () => {
    const before = (await engine.list(ctx, session.id)).repository
    const result = await engine.switch(ctx, session.id, 'feature/中文', before.token)
    assert(result.ok, JSON.stringify(result))
    assert.equal(result.repository.branch, 'feature/中文')
    assert.equal(setup(['branch', '--show-current']).trim(), 'feature/中文')
  })
  await check('dirty changes stay intact and block checkout', async () => {
    const before = (await engine.list(ctx, session.id)).repository
    fs.writeFileSync(path.join(directory, 'sample.txt'), 'unsaved user data\n')
    const result = await engine.switch(ctx, session.id, 'main', before.token)
    assert.equal(result.reason, 'dirty')
    assert.equal(fs.readFileSync(path.join(directory, 'sample.txt'), 'utf8'), 'unsaved user data\n')
    fs.writeFileSync(path.join(directory, 'sample.txt'), 'private fixture\n')
  })
  await check('stale views, unknown branches and other worktrees cannot redirect a switch', async () => {
    const before = (await engine.list(ctx, session.id)).repository
    assert.equal((await engine.switch(ctx, session.id, 'main', '0'.repeat(64))).reason, 'stale')
    assert.equal((await engine.switch(ctx, session.id, 'occupied', before.token)).reason, 'branch-in-use')
    assert.equal((await engine.switch(ctx, session.id, '--discard-changes', before.token)).reason, 'branch-not-found')
    assert.equal(setup(['branch', '--show-current']).trim(), 'feature/中文')
  })
  await check('active work and read-only policy reject mutation before Git switch', async () => {
    const before = (await engine.list(ctx, session.id)).repository, previous = switches
    activity = [{ kind: 'turn' }]
    assert.equal((await engine.switch(ctx, session.id, 'main', before.token)).reason, 'running')
    activity = []; mode = 'read-only'
    assert.equal((await engine.switch(ctx, session.id, 'main', before.token)).reason, 'read-only')
    mode = 'danger-full-access'
    assert.equal(switches, previous)
  })
  await check('inherited Git selectors cannot escape to a different repository', async () => {
    gitEnv.GIT_DIR = path.join(scratch, 'other-tree', '.git')
    gitEnv.GIT_WORK_TREE = path.join(scratch, 'other-tree')
    const result = await engine.list(ctx, session.id)
    delete gitEnv.GIT_DIR; delete gitEnv.GIT_WORK_TREE
    assert(result.ok, JSON.stringify(result))
    assert.equal(result.repository.branch, 'feature/中文')
  })
  await check('an active session that changed into this repository blocks switching', async () => {
    const outside = path.join(scratch, 'unrelated')
    fs.mkdirSync(outside)
    const other = { id: 'other-session', header: { cwd: outside } }
    liveSessions = [session, other]
    activityById.set(other.id, [{ kind: 'turn' }])
    directories.set(other.id, directory)
    const current = (await engine.list(ctx, session.id)).repository
    assert.equal((await engine.switch(ctx, session.id, 'main', current.token)).reason, 'running')
    liveSessions = [session]; activityById.clear(); directories.clear()
  })
  await check('ignored local files are not overwritten by branch switching', async () => {
    setup(['switch', '-c', 'ignored-collision'])
    fs.writeFileSync(path.join(directory, 'collision.txt'), 'target branch data\n')
    setup(['add', '--', 'collision.txt']); setup(['commit', '-m', 'ignored collision fixture'])
    setup(['switch', 'feature/中文'])
    const exclude = path.join(directory, '.git', 'info', 'exclude')
    fs.mkdirSync(path.dirname(exclude), { recursive: true })
    const previous = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : ''
    fs.appendFileSync(exclude, '\ncollision.txt\n')
    fs.writeFileSync(path.join(directory, 'collision.txt'), 'private ignored data\n')
    const current = (await engine.list(ctx, session.id)).repository
    assert.equal(current.dirty, false)
    assert.equal((await engine.switch(ctx, session.id, 'ignored-collision', current.token)).reason, 'dirty')
    assert.equal(fs.readFileSync(path.join(directory, 'collision.txt'), 'utf8'), 'private ignored data\n')
    fs.unlinkSync(path.join(directory, 'collision.txt')); fs.writeFileSync(exclude, previous)
  })
  await check('automatic status reads disable configured executable filters', async () => {
    setup(['config', 'filter.fixture.clean', path.join(scratch, 'nonexistent-private-filter').replaceAll('\\', '/')])
    setup(['config', 'filter.fixture.required', 'true'])
    fs.writeFileSync(path.join(directory, '.gitattributes'), 'sample.txt filter=fixture\n')
    fs.writeFileSync(path.join(directory, 'sample.txt'), 'filter fixture data\n')
    try {
      const current = await engine.list(ctx, session.id)
      assert(current.ok, JSON.stringify(current))
      assert.equal(current.repository.filtersDisabled, true)
      assert.equal(current.repository.dirty, true)
    } finally {
      fs.unlinkSync(path.join(directory, '.gitattributes'))
      fs.writeFileSync(path.join(directory, 'sample.txt'), 'private fixture\n')
      setup(['config', '--unset', 'filter.fixture.clean']); setup(['config', '--unset', 'filter.fixture.required'])
    }
  })
  await check('cancelled reads terminate without changing the branch', async () => {
    const cancelled = new AbortController(); cancelled.abort()
    const previous = switches
    assert.equal((await engine.list(ctx, session.id, cancelled.signal)).reason, 'cancelled')
    assert.equal(switches, previous)
  })
  await check('a failed verification after checkout reports an unknown outcome', async () => {
    const before = (await engine.list(ctx, session.id)).repository
    const original = ctx.subprocess.spawn
    let completed = false
    ctx.subprocess.spawn = (options) => {
      if (completed && options.argv.includes('symbolic-ref')) throw new Error('verification disconnected')
      const child = original(options)
      if (options.argv.includes('switch')) void child.done.then(() => { completed = true })
      return child
    }
    try {
      const result = await engine.switch(ctx, session.id, 'main', before.token)
      assert.equal(setup(['branch', '--show-current']).trim(), 'main')
      assert.equal(result.reason, 'switch-unknown')
    } finally { ctx.subprocess.spawn = original }
  })
} finally {
  await engine.dispose()
  const absolute = path.resolve(scratch)
  if (path.dirname(absolute) !== fs.realpathSync.native(os.tmpdir()) || !path.basename(absolute).startsWith('dsh-git-check-')) throw new Error('Unsafe fixture cleanup target')
  fs.rmSync(absolute, { recursive: true, force: true })
}
console.log('\n' + (process.exitCode ? 'some checks failed' : 'all checks passed (' + checks + ')'))
