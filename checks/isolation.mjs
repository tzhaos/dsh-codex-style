/**
 * Isolation contract checks for the merged bundle.
 *
 * These checks do not load the host. They splice synthetic features into the
 * shipped `client.js` feature table and drive the production isolation runtime
 * through its test hooks:
 *
 *   __DSH_CODEX_STYLE_FEATURES__  narrows materialization to the synthetic ids;
 *   __DSH_CODEX_STYLE_ISOLATION__ forces the apply/render isolation path that
 *   the shipped page always uses.
 *
 * Covered guarantees: a feature that throws while building, applying, inside an
 * effect, in a slot label/inject callback, or while rendering is contained — its
 * registrations are disposed, its dependents are quarantined, the rest of the
 * bundle keeps running, and the failure is reported and persisted for the
 * settings shell.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const clientSource = read('client.js')

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

/** Wait for the feature runtime's deferred quarantine to run. */
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

/** Synthetic features spliced before the runtime materialization. */
const SYNTHETICS = {
  healthy: `
__DSH_FEATURE('test-healthy', function (require, env) {
  return {
    inject: ['slots'],
    apply(ctx) {
      __isoScratch.log.push('healthy:apply')
      const React = require('react')
      function Healthy(props) {
        __isoScratch.log.push('healthy:render:' + String(props.mark))
        return React.createElement('span', { 'data-test': 'healthy' }, 'healthy')
      }
      ctx.slots.register({ name: 'shell.overlay', id: 'test-healthy.overlay' }, Healthy)
      ctx.effect(function () { __isoScratch.log.push('healthy:effect') }, 'test-healthy')
    },
  }
})
`,
  buildThrows: `
__DSH_FEATURE('test-build-throws', function (require, env) {
  __isoScratch.log.push('build-throws:build')
  throw new Error('build boom')
})
`,
  applyThrows: `
__DSH_FEATURE('test-apply-throws', function (require, env) {
  return {
    inject: ['slots'],
    apply(ctx) {
      __isoScratch.log.push('apply-throws:apply')
      ctx.slots.register({ name: 'shell.overlay', id: 'test-apply-throws.overlay' }, function Broken() { return null })
      ctx.effect(function () { __isoScratch.log.push('apply-throws:effect') }, 'test-apply-throws')
      throw new Error('apply boom')
    },
  }
})
`,
  effectThrows: `
__DSH_FEATURE('test-effect-throws', function (require, env) {
  return {
    inject: ['slots'],
    apply(ctx) {
      __isoScratch.log.push('effect-throws:apply')
      ctx.effect(function () { throw new Error('effect boom') }, 'test-effect-throws')
    },
  }
})
`,
  renderThrows: `
__DSH_FEATURE('test-render-throws', function (require, env) {
  return {
    inject: ['slots'],
    apply(ctx) {
      __isoScratch.log.push('render-throws:apply')
      ctx.slots.register({ name: 'shell.overlay', id: 'test-render-throws.overlay' }, function RenderBoom() {
        throw new Error('render boom')
      })
    },
  }
})
`,
  dependsOnBroken: `
__DSH_FEATURE('test-depends-on-broken', function (require, env) {
  __isoScratch.log.push('depends:build')
  return {
    inject: [],
    requires: ['test-build-throws'],
    apply(ctx) { __isoScratch.log.push('depends:apply') },
  }
})
`,
  dependsOnRenderBoom: `
__DSH_FEATURE('test-depends-on-render-boom', function (require, env) {
  return {
    inject: [],
    requires: ['test-render-throws'],
    apply(ctx) { __isoScratch.log.push('depends-render:apply') },
  }
})
`,
  slotHooksThrow: `
__DSH_FEATURE('test-slot-hooks', function (require, env) {
  return {
    inject: ['slots'],
    apply(ctx) {
      __isoScratch.log.push('slot-hooks:apply')
      ctx.slots.register({
        name: 'shell.overlay',
        id: 'test-slot-hooks.overlay',
        label: function () { throw new Error('label boom') },
        inject: function () { throw new Error('inject boom') },
      }, function HooksComponent() { return null })
    },
  }
})
`,
  healthyReplacement: `
__DSH_FEATURE('test-apply-throws', function (require, env) {
  __isoScratch.log.push('replacement:apply')
  return { inject: [], apply(ctx) { __isoScratch.log.push('replacement:applied') } }
})
`,
}

/** Miniature React runtime supporting function and class components. */
function createReactRuntime() {
  class FakeComponent {
    constructor(props) {
      this.props = props
      this.state = {}
    }

    setState(next) {
      this.state = { ...this.state, ...next }
    }
  }

  const React = {
    Component: FakeComponent,
    createElement(type, props, ...children) {
      const childList = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
      return { type, props: { ...(props ?? {}), children: childList } }
    },
  }

  /** Render one element tree, invoking functions and classes (with boundaries). */
  function renderNode(node) {
    if (node === null || node === undefined) return node
    if (typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(renderNode)
    if (typeof node.type === 'function' && node.type.prototype instanceof FakeComponent) {
      const Ctor = node.type
      const instance = new Ctor(node.props)
      try {
        return renderNode(instance.render())
      } catch (error) {
        if (typeof Ctor.getDerivedStateFromError !== 'function') throw error
        instance.state = { ...instance.state, ...Ctor.getDerivedStateFromError(error) }
        if (typeof instance.componentDidCatch === 'function') instance.componentDidCatch(error, {})
        return renderNode(instance.render())
      }
    }
    if (typeof node.type === 'function') return renderNode(node.type(node.props))
    return { type: node.type, props: { ...node.props, children: renderNode(node.props.children) } }
  }

  return { React, render: (Component, props) => renderNode(React.createElement(Component, props)) }
}

/** In-memory localStorage facade shared with the sandbox. */
function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed))
  return {
    map,
    localStorage: {
      getItem: (key) => map.has(key) ? map.get(key) : null,
      setItem: (key, value) => map.set(key, String(value)),
      removeItem: (key) => map.delete(key),
    },
  }
}

/**
 * Evaluate the shipped bundle with synthetic features spliced in.
 * @param {{ React: object, synthetics: string[], filter: string[], isolation: boolean, seedStorage?: object }} options - load options.
 */
function loadBundle(options) {
  const runtime = options.React
  const registrations = []
  const storage = createStorage(options.seedStorage ?? {})
  const scratch = { log: [] }
  const consoleErrors = []
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: options.filter,
    __isoScratch: scratch,
    window: {
      __ModuleLoader__: { load: (definition) => registrations.push(definition) },
      localStorage: storage.localStorage,
    },
    document: {
      createElement: () => ({ dataset: {}, style: {}, textContent: '', remove() {} }),
      head: { appendChild() {} },
      querySelector: () => null,
    },
    console: {
      log: (...args) => consoleErrors.push(args.map(String).join(' ')),
      error: (...args) => consoleErrors.push(args.map(String).join(' ')),
      warn: () => {},
    },
    setTimeout: (callback, delay) => setTimeout(callback, delay ?? 0),
    clearTimeout: (handle) => clearTimeout(handle),
  }
  if (options.isolation) sandbox.__DSH_CODEX_STYLE_ISOLATION__ = true

  const marker = '    const runtime = __dshCreateRuntime(require, env, __DSH_FEATURE_TABLE__)'
  assert(clientSource.includes(marker), 'materialization marker exists')
  const source = clientSource.replace(marker, options.synthetics.join('\n') + '\n\n' + marker)
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.equal(registrations.length, 1, 'one bundle registration')
  const module = registrations[0].factory((specifier) => {
    if (specifier === 'react') return runtime.React
    if (specifier === 'react-dom') return { createPortal: (node) => node }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Tooltip: function Tooltip() { return null } }
    if (specifier === '@deepseek-ai/dsh-client-store') return { defineStore: () => ({}) }
    throw new Error('unexpected require ' + specifier)
  })
  return { module, sandbox, storage, scratch, consoleErrors }
}

/** Fake client host that records slot registrations and disposals. */
function createHost() {
  const registrations = []
  const disposals = []
  const effects = []
  const host = {
    effect(factory, label) {
      const cleanup = factory()
      effects.push(label)
      return () => { if (typeof cleanup === 'function') cleanup() }
    },
    slots: {
      inject(name, callback) {
        const disposer = callback()
        return typeof disposer === 'function' ? disposer : () => {}
      },
      register(options, component) {
        const entry = { options, component, disposed: false }
        registrations.push(entry)
        return () => {
          entry.disposed = true
          disposals.push(options.id ?? options.name)
        }
      },
      getVersion() { return registrations.length },
      entries() { return registrations.map((entry) => ({ options: entry.options })) },
      subscribe() { return () => {} },
    },
    inject(deps, callback) { callback(host) },
    locale: { register() {}, bind: () => (key) => key },
    get() { return undefined },
    sessions: {},
  }
  return { host, registrations, disposals, effects }
}

/** Load + apply, returning everything the assertions need. */
function boot(options) {
  const runtime = createReactRuntime()
  const loaded = loadBundle({ React: runtime, ...options })
  const host = createHost()
  loaded.module.apply(host.host)
  return { ...loaded, runtime, host: host.host, registrations: host.registrations, disposals: host.disposals, effects: host.effects }
}

const registrationOf = (registrations, id) => registrations.find((entry) => entry.options.id === id)

// ---------------------------------------------------------------------------
// Isolation mode and build failures
// ---------------------------------------------------------------------------

await check('the shipped page enables apply/render isolation', () => {
  const booted = boot({ synthetics: [SYNTHETICS.healthy], filter: ['test-healthy'], isolation: true })
  assert.equal(booted.module.__isolationEnabled, true)
  assert.equal(booted.module.__features.join(','), 'test-healthy')
})

await check('a throwing feature builder is skipped while the others still build', () => {
  const booted = boot({
    synthetics: [SYNTHETICS.buildThrows, SYNTHETICS.healthy],
    filter: ['test-build-throws', 'test-healthy'],
    isolation: true,
  })
  assert.equal(booted.module.__features.join(','), 'test-healthy')
  assert(booted.scratch.log.includes('healthy:apply'), 'healthy feature applies')
  assert(!booted.scratch.log.includes('build-throws:apply'), 'broken feature never applies')
  const status = booted.module.__statuses()['test-build-throws']
  assert.equal(status.state, 'failed')
  assert.equal(status.phase, 'build')
  assert(status.message.includes('build boom'))
  assert(booted.consoleErrors.some((line) => line.includes('feature "test-build-throws" build failed')), 'failure is reported')
})

await check('a build failure is persisted for the settings shell', () => {
  const booted = boot({
    synthetics: [SYNTHETICS.buildThrows, SYNTHETICS.healthy],
    filter: ['test-build-throws', 'test-healthy'],
    isolation: true,
  })
  const persisted = JSON.parse(booted.storage.map.get('dsh.codexStyle.failures'))
  assert.equal(persisted['test-build-throws'].state, 'failed')
  assert.equal(persisted['test-build-throws'].phase, 'build')
})

// ---------------------------------------------------------------------------
// Apply failures and scope disposal
// ---------------------------------------------------------------------------

await check('a throwing apply is quarantined with its registrations disposed', () => {
  const booted = boot({
    synthetics: [SYNTHETICS.applyThrows, SYNTHETICS.healthy],
    filter: ['test-apply-throws', 'test-healthy'],
    isolation: true,
  })
  assert(booted.scratch.log.includes('healthy:apply'), 'healthy feature applies')
  const brokenSlot = registrationOf(booted.registrations, 'test-apply-throws.overlay')
  assert(brokenSlot !== undefined, 'broken feature registered its slot before throwing')
  assert.equal(brokenSlot.disposed, true, 'its slot registration was released')
  const healthySlot = registrationOf(booted.registrations, 'test-healthy.overlay')
  assert.equal(healthySlot.disposed, false, 'healthy registrations stay live')
  const status = booted.module.__statuses()['test-apply-throws']
  assert.equal(status.state, 'failed')
  assert.equal(status.phase, 'apply')
  assert(status.message.includes('apply boom'))
})

await check('a throwing effect quarantines only its own feature', () => {
  const booted = boot({
    synthetics: [SYNTHETICS.effectThrows, SYNTHETICS.healthy],
    filter: ['test-effect-throws', 'test-healthy'],
    isolation: true,
  })
  assert(booted.scratch.log.includes('healthy:apply'))
  const status = booted.module.__statuses()['test-effect-throws']
  assert.equal(status.state, 'failed')
  assert.equal(status.phase, 'effect')
  assert(status.message.includes('effect boom'))
  assert.equal(booted.module.__statuses()['test-healthy'], undefined, 'healthy feature has no failure record')
})

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

await check('a feature depending on a failed build is skipped, not crashed', () => {
  const booted = boot({
    synthetics: [SYNTHETICS.buildThrows, SYNTHETICS.dependsOnBroken, SYNTHETICS.healthy],
    filter: ['test-build-throws', 'test-depends-on-broken', 'test-healthy'],
    isolation: true,
  })
  assert.equal(booted.module.__features.join(','), 'test-healthy')
  assert(!booted.scratch.log.includes('depends:apply'), 'dependent never applies')
  const status = booted.module.__statuses()['test-depends-on-broken']
  assert.equal(status.state, 'skipped')
  assert(status.message.includes('test-build-throws'))
})

await check('quarantining a feature also quarantines its dependents', async () => {
  const booted = boot({
    synthetics: [SYNTHETICS.renderThrows, SYNTHETICS.dependsOnRenderBoom, SYNTHETICS.healthy],
    filter: ['test-render-throws', 'test-depends-on-render-boom', 'test-healthy'],
    isolation: true,
  })
  assert.equal(booted.module.__features.join(','), 'test-render-throws,test-depends-on-render-boom,test-healthy')
  const registration = registrationOf(booted.registrations, 'test-render-throws.overlay')
  assert(registration !== undefined)
  const tree = booted.runtime.render(registration.component, { mark: 'crash' })
  assert.equal(tree, null, 'crashed component renders nothing')
  await tick()
  const statuses = booted.module.__statuses()
  assert.equal(statuses['test-render-throws'].state, 'quarantined')
  assert.equal(statuses['test-depends-on-render-boom'].state, 'quarantined')
  assert.equal(statuses['test-healthy'], undefined)
  assert.equal(registration.disposed, true, 'crashed feature slot released')
  assert.equal(registrationOf(booted.registrations, 'test-healthy.overlay').disposed, false, 'healthy slot survives')
})

// ---------------------------------------------------------------------------
// Render boundaries
// ---------------------------------------------------------------------------

await check('the error boundary renders nothing for the crashed feature only', async () => {
  const booted = boot({
    synthetics: [SYNTHETICS.renderThrows, SYNTHETICS.healthy],
    filter: ['test-render-throws', 'test-healthy'],
    isolation: true,
  })
  const broken = registrationOf(booted.registrations, 'test-render-throws.overlay')
  const healthy = registrationOf(booted.registrations, 'test-healthy.overlay')
  assert.equal(String(broken.component.displayName ?? broken.component.name).startsWith('CodexStyleIsolated('), true)
  const brokenTree = booted.runtime.render(broken.component, {})
  assert.equal(brokenTree, null)
  const healthyTree = booted.runtime.render(healthy.component, { mark: 'x' })
  assert.equal(healthyTree.type, 'span', 'healthy component still renders')
  assert(booted.scratch.log.includes('healthy:render:x'), 'props are forwarded through the boundary')
  await tick()
})

await check('a slot label or inject callback that throws degrades safely', async () => {
  const booted = boot({
    synthetics: [SYNTHETICS.slotHooksThrow, SYNTHETICS.healthy],
    filter: ['test-slot-hooks', 'test-healthy'],
    isolation: true,
  })
  const registration = registrationOf(booted.registrations, 'test-slot-hooks.overlay')
  assert(registration !== undefined)
  assert.equal(registration.options.label(), '', 'label falls back to an empty string')
  assert.equal(Object.keys(registration.options.inject()).length, 0, 'inject falls back to an empty payload')
  await tick()
  assert.equal(booted.module.__statuses()['test-slot-hooks'].state, 'quarantined')
  assert.equal(registration.disposed, true)
  assert.equal(registrationOf(booted.registrations, 'test-healthy.overlay').disposed, false)
})

// ---------------------------------------------------------------------------
// Reporting, recovery and legacy mode
// ---------------------------------------------------------------------------

await check('a recovered feature clears its persisted failure record', () => {
  const seed = {
    'dsh.codexStyle.failures': JSON.stringify({
      'test-apply-throws': { state: 'failed', phase: 'apply', message: 'apply boom', at: 1 },
    }),
  }
  const booted = boot({
    synthetics: [SYNTHETICS.healthyReplacement],
    filter: ['test-apply-throws'],
    isolation: true,
    seedStorage: seed,
  })
  assert(booted.scratch.log.includes('replacement:applied'))
  assert.equal(booted.module.__statuses()['test-apply-throws'], undefined)
  const persisted = booted.storage.map.get('dsh.codexStyle.failures')
  assert(persisted === undefined || !persisted.includes('test-apply-throws'), 'stale failure record removed')
})

await check('single-feature checks keep the legacy unfacaded path', () => {
  const booted = boot({
    synthetics: [SYNTHETICS.applyThrows, SYNTHETICS.healthy],
    filter: ['test-apply-throws', 'test-healthy'],
    isolation: false,
  })
  assert.equal(booted.module.__isolationEnabled, false)
  assert(booted.scratch.log.includes('healthy:apply'), 'healthy feature applies')
  const healthy = registrationOf(booted.registrations, 'test-healthy.overlay')
  assert.equal(healthy.component.name, 'Healthy', 'components are registered unwrapped in legacy mode')
  const status = booted.module.__statuses()['test-apply-throws']
  assert.equal(status.state, 'failed')
  assert(status.message.includes('apply boom'))
})

await check('legacy mode still reports every feature failure without throwing', () => {
  const booted = boot({
    synthetics: [SYNTHETICS.effectThrows, SYNTHETICS.healthy],
    filter: ['test-effect-throws', 'test-healthy'],
    isolation: false,
  })
  assert.equal(booted.module.__statuses()['test-effect-throws'].state, 'failed')
  assert(booted.scratch.log.includes('healthy:apply'))
})

await check('nested service effects belong to the service context that installed them', () => {
  const runtime = createReactRuntime()
  const loaded = loadBundle({ React: runtime, isolation: true, filter: ['test-service-lifetime'], synthetics: [`
__DSH_FEATURE('test-service-lifetime', () => ({
  inject: [],
  apply(ctx) {
    ctx.inject(['dynamic'], (child) => child.effect(() => {
      __isoScratch.log.push('child:active')
      return () => __isoScratch.log.push('child:disposed')
    }, 'child-owned-effect'))
  },
}))`] })
  const { host, effects } = createHost()
  const childCleanups = []
  const child = { ...host, effect(factory) {
    const cleanup = factory(); childCleanups.push(cleanup); return () => cleanup?.()
  } }
  host.inject = (_deps, callback) => { callback(child); return () => {} }
  loaded.module.apply(host)
  assert.equal(childCleanups.length, 1)
  assert(!effects.includes('child-owned-effect'))
  childCleanups[0]()
  assert(loaded.scratch.log.includes('child:disposed'))
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
