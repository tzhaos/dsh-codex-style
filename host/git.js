/** Git operations in the calling DSH execution world, under its unchanged sandbox policy. */
import { createHash } from 'node:crypto'
import path from 'node:path'
import { createGitContribution } from '../git-contract.js'

const LIMIT = 1024 * 1024
const GIT_ENV = Object.fromEntries(
  [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_NAMESPACE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_CONFIG',
    'GIT_CONFIG_PARAMETERS',
    'GIT_CONFIG_COUNT',
    'GIT_CEILING_DIRECTORIES',
    'GIT_PREFIX',
    'GIT_SHALLOW_FILE',
    'GIT_GRAFT_FILE',
    'GIT_REPLACE_REF_BASE',
    'GIT_ATTR_SOURCE',
  ].map((key) => [key, undefined]),
)
class GitFailure extends Error {
  constructor(reason, stderr = '') {
    super(reason)
    this.reason = reason
    this.stderr = stderr
  }
}
const normalized = (value) =>
  process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value)
const within = (root, cwd) => {
  const relative = path.relative(normalized(root), normalized(cwd))
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  )
}

/** The format uses NUL fields so Unicode names and worktree paths remain literal. */
function branchesOf(output, root) {
  const fields = output.split('\0'),
    branches = []
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const ref = fields[index].replace(/^\r?\n/, '')
    if (!ref.startsWith('refs/heads/')) continue
    const worktree = fields[index + 2]
    branches.push({
      name: ref.slice(11),
      inUse: !!worktree && normalized(worktree) !== normalized(root),
    })
  }
  if (branches.length > 20000) throw new GitFailure('too-large')
  return branches
}

export function createGitEngine() {
  const locks = new Set(),
    lifetime = new AbortController(),
    operations = new Set()
  let processes = 0
  async function run(ctx, policy, cwd, args, signal, allowed = [0], filterConfig = []) {
    signal.throwIfAborted()
    if (processes >= 4) throw new GitFailure('busy')
    processes++
    let child
    try {
      let executable
      try {
        executable = await ctx.subprocess.resolveExecutable('git', undefined, signal)
      } catch {
        signal.throwIfAborted()
        throw new GitFailure('git-unavailable')
      }
      const argv = [
        executable,
        '--no-pager',
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        ...filterConfig,
        ...args,
      ]
      const confined =
        policy.mode === 'danger-full-access'
          ? argv
          : (await ctx.sandbox.confine(argv, { ...policy }, signal)).argv
      signal.throwIfAborted()
      child = ctx.subprocess.spawn({
        argv: confined,
        cwd,
        signal,
        graceMs: 2000,
        env: {
          ...GIT_ENV,
          GIT_TERMINAL_PROMPT: '0',
          GIT_LFS_SKIP_SMUDGE: '1',
          GIT_NO_LAZY_FETCH: '1',
          GIT_OPTIONAL_LOCKS: '0',
          LC_ALL: 'C',
        },
        stdio: { stdin: 'ignore', stdout: { maxBytes: LIMIT }, stderr: { maxBytes: LIMIT } },
      })
      const outcome = await child.done
      signal.throwIfAborted()
      const stdout = child.collected.stdout.readFrom(0),
        stderr = child.collected.stderr.readFrom(0)
      if (stdout.lossy || stderr.lossy) throw new GitFailure('too-large')
      if (!allowed.includes(outcome.exitCode)) throw new GitFailure('git-failed', stderr.text)
      return { text: stdout.text, code: outcome.exitCode }
    } finally {
      try {
        if (child) {
          child.terminate()
          await child.waitForExit()
        }
      } finally {
        processes--
      }
    }
  }
  async function context(ctx, sessionId, signal) {
    let session = ctx.sessions.get(sessionId),
      observation
    if (!session && ctx.sessionQuery) {
      observation = await ctx.sessionQuery.observeSession(sessionId, {
        signal,
        projectionMode: 'none',
      })
      try {
        session =
          ctx.sessions.get(sessionId) ??
          ctx.sessions.prepare(sessionId, {
            seed: observation.events,
            meta: structuredClone(observation.header),
            inheritedEventCount: observation.inheritedEventCount,
          })
      } finally {
        observation[Symbol.dispose]()
      }
    }
    if (!session) throw new GitFailure('session-unavailable')
    const cwd = session.header?.cwd
    if (!cwd) throw new GitFailure('no-directory')
    const policy = ctx.sandboxPolicy.resolve({ session })
    const target = await ctx.fs.resolve(cwd, { cwd, signal })
    const directory = ctx.fs.processPath(target)
    let rootOutput
    try {
      rootOutput = await run(ctx, policy, directory, ['rev-parse', '--show-toplevel'], signal)
    } catch (error) {
      if (error.reason === 'git-failed') throw new GitFailure('not-repository')
      throw error
    }
    const root = ctx.fs.processPath(
      await ctx.fs.resolve(rootOutput.text.replace(/\r?\n$/, ''), { cwd: directory, signal }),
    )
    const configured = await run(
      ctx,
      policy,
      root,
      ['config', '--null', '--name-only', '--get-regexp', '^filter\\.'],
      signal,
      [0, 1],
    )
    const drivers = new Set()
    for (const key of configured.text.split('\0')) {
      const separator = key.lastIndexOf('.')
      if (
        separator > 7 &&
        ['clean', 'smudge', 'process', 'required'].includes(key.slice(separator + 1))
      )
        drivers.add(key.slice(7, separator))
    }
    const filterConfig = []
    for (const driver of drivers)
      for (const field of ['clean', 'smudge', 'process', 'required'])
        filterConfig.push('-c', `filter.${driver}.${field}=${field === 'required' ? 'false' : ''}`)
    if (filterConfig.join(' ').length > 12000) throw new GitFailure('too-large')
    return { session, root, policy, filterConfig }
  }
  async function inspect(ctx, info, signal) {
    const { root, policy, filterConfig } = info
    const command = (args, allowed) => run(ctx, policy, root, args, signal, allowed, filterConfig)
    const branchResult = await command(['symbolic-ref', '--quiet', '--short', 'HEAD'], [0, 1])
    const headResult = await command(['rev-parse', '--verify', 'HEAD'], [0, 128])
    const branch = branchResult.code === 0 ? branchResult.text.trimEnd() : null
    const head = headResult.code === 0 ? headResult.text.trim() : ''
    const dirty =
      (await command(['status', '--porcelain=v1', '-z', '--untracked-files=normal'])).text.length >
      0
    const branches = branchesOf(
      (
        await command([
          'for-each-ref',
          '--format=%(refname)%00%(objectname)%00%(worktreepath)%00',
          'refs/heads/',
        ])
      ).text,
      root,
    )
    const token = createHash('sha256')
      .update(JSON.stringify([normalized(root), branch, head]))
      .digest('hex')
    return {
      branch,
      head,
      dirty,
      branches,
      token,
      writable: policy.mode !== 'read-only',
      filtersDisabled: filterConfig.length > 0,
    }
  }
  async function idle(ctx, info, signal) {
    const sessions = [
      info.session,
      ...ctx.sessions.list().filter((entry) => entry.id !== info.session.id),
    ]
    for (const session of sessions) {
      signal.throwIfAborted()
      const activity = await ctx.waterfall(
        'workspace/session-activity',
        { sessionId: session.id },
        () => Promise.resolve([]),
      )
      if (!activity.some((item) => ['turn', 'job', 'subagent'].includes(item.kind))) continue
      const directories = new Set(
        [session.header?.cwd, ctx.workingDirectory?.get(session)].filter(Boolean),
      )
      for (const directory of directories) {
        const activeCwd = ctx.fs.processPath(
          await ctx.fs.resolve(directory, { cwd: directory, signal }),
        )
        if (within(info.root, activeCwd) || within(activeCwd, info.root))
          throw new GitFailure('running')
      }
    }
  }
  async function perform(ctx, sessionId, branch, expectedHead, callerSignal) {
    const deadline = new AbortController()
    const signal = AbortSignal.any([
      lifetime.signal,
      deadline.signal,
      ...(callerSignal ? [callerSignal] : []),
    ])
    const timer = setTimeout(() => deadline.abort(), 20000)
    let lock,
      started = false,
      switched = false
    try {
      const info = await context(ctx, sessionId, signal)
      const key = normalized(info.root)
      if (locks.has(key)) throw new GitFailure('busy')
      if (branch !== undefined) {
        locks.add(key)
        lock = key
      }
      let repository = await inspect(ctx, info, signal)
      if (branch === undefined) return { ok: true, repository }
      if (info.policy.mode === 'read-only') throw new GitFailure('read-only')
      if (repository.token !== expectedHead) throw new GitFailure('stale')
      const selected = repository.branches.find((entry) => entry.name === branch)
      if (!selected) throw new GitFailure('branch-not-found')
      if (selected.inUse) throw new GitFailure('branch-in-use')
      if (repository.branch === branch) return { ok: true, repository }
      if (repository.dirty) throw new GitFailure('dirty')
      await idle(ctx, info, signal)
      // Re-read immediately before the write; never discard, stash, or force.
      repository = await inspect(ctx, info, signal)
      if (repository.token !== expectedHead) throw new GitFailure('stale')
      if (repository.dirty) throw new GitFailure('dirty')
      await idle(ctx, info, signal)
      info.policy = ctx.sandboxPolicy.resolve({
        session: ctx.sessions.get(sessionId) ?? info.session,
      })
      if (info.policy.mode === 'read-only') throw new GitFailure('read-only')
      signal.throwIfAborted()
      started = true
      await run(
        ctx,
        info.policy,
        info.root,
        ['switch', '--no-guess', '--no-overwrite-ignore', '--no-recurse-submodules', '--', branch],
        signal,
        [0],
        info.filterConfig,
      )
      switched = true
      repository = await inspect(ctx, info, signal)
      if (repository.branch !== branch) throw new GitFailure('stale')
      return { ok: true, repository }
    } catch (error) {
      let reason = error instanceof GitFailure ? error.reason : 'git-failed'
      if (signal.aborted)
        reason = started ? 'switch-unknown' : deadline.signal.aborted ? 'timeout' : 'cancelled'
      else if (/while (?:rebasing|merging|cherry-picking|reverting)/i.test(error.stderr ?? ''))
        reason = 'in-progress'
      else if (/already (?:checked out|used) at/i.test(error.stderr ?? '')) reason = 'branch-in-use'
      else if (
        /would be overwritten|local changes|untracked working tree/i.test(error.stderr ?? '')
      )
        reason = 'dirty'
      if (switched) reason = 'switch-unknown'
      return { ok: false, reason }
    } finally {
      clearTimeout(timer)
      if (lock) locks.delete(lock)
    }
  }
  const start = (...args) => {
    const operation = perform(...args)
    operations.add(operation)
    operation.finally(() => operations.delete(operation))
    return operation
  }
  return {
    list: (ctx, sessionId, signal) => start(ctx, sessionId, undefined, undefined, signal),
    switch: (ctx, sessionId, branch, expectedHead, signal) =>
      start(ctx, sessionId, branch, expectedHead, signal),
    async dispose() {
      lifetime.abort()
      await Promise.allSettled([...operations])
    },
  }
}

/** Register through the authenticated Remote gateway, never a raw HTTP write route. */
export function registerGit(ctx) {
  if (!ctx.typert?.register || !ctx.provide) return
  const engine = createGitEngine()
  const service = {
    ctx,
    list(sessionId, signal) {
      return engine.list(this.ctx, sessionId, signal)
    },
    switch(sessionId, branch, expectedHead, signal) {
      return engine.switch(this.ctx, sessionId, branch, expectedHead, signal)
    },
  }
  Object.defineProperty(service, Symbol.for('cordis.tracker'), { value: { property: 'ctx' } })
  // The public bindTypertRemote data contract; SessionController installs the invocation accessor.
  service.typertRemote = Object.freeze({ service, serviceKey: 'codexGit', namespace: 'codexGit' })
  ctx.provide('codexGit', service)
  const contribution = createGitContribution()
  ctx.effect(() => () => engine.dispose(), 'git-switch: managed operations')
  ctx.effect(
    () =>
      ctx.typert.register({
        package: contribution.package,
        face: 'host',
        schemas: [],
        invocations: contribution.descriptors,
        model: {},
      }),
    'git-switch: authenticated contract',
  )
}
