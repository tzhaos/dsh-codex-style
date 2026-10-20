#!/usr/bin/env node
/**
 * Generate the shipped `client.js` for dsh-codex-style.
 *
 * DSH serves exactly one browser bundle per package, so the merged plugin ships
 * one artifact. The sources stay split under `src/` for reviewability:
 *
 *   src/features/<package>.js   one merged feature body, originally the body of
 *                               that package's `factory(require) { ... }`;
 *   src/settings.js             the settings shell that renders one tab per
 *                               feature in Settings -> Codex Style.
 *
 * The generated bundle keeps every feature lazy: a feature body only runs when
 * the feature is enabled (or when a check selects it through the
 * `__DSH_CODEX_STYLE_FEATURES__` test filter). The isolation runtime generated
 * from `src/isolation.js` then keeps one failing feature from affecting the
 * others on build, apply and render.
 *
 * Usage:
 *   node scripts/build-client.mjs          # rewrite client.js
 *   node scripts/build-client.mjs --check  # fail when client.js is stale
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const CLIENT_PATH = join(ROOT, 'client.js')
const SETTINGS_PATH = join(ROOT, 'src', 'settings.js')

/** Feature ids in build (and settings-tab) order. */
export const FEATURE_ORDER = [
  'dsh-sidebar-sections',
  'dsh-left-rail',
  'dsh-nav-back-forward',
  'dsh-hover-polish',
  'dsh-tab-middle-click',
  'dsh-long-paste',
  'dsh-sidebar-file-drop',
  'dsh-file-link-actions',
  'dsh-composer-history',
  'dsh-queue-withdraw',
  'dsh-quick-fork',
]

const SETTINGS_FEATURE_ID = 'dsh-codex-style.settings'

/** Prologue shared by every bundle: feature table, settings registry, env. */
const PROLOGUE = `    /**
     * Lazily registered features. A table entry only holds the id and builder;
     * the body runs when the feature is built, never at bundle-registration time.
     */
    const __DSH_FEATURE_TABLE__ = []
    /** Settings pages registered by features while they build. */
    const __DSH_SETTINGS_PAGES__ = []
    /** Feature id owned by the settings shell itself. */
    const SETTINGS_FEATURE_ID = 'dsh-codex-style.settings'
    /** Browser-local per-feature enable preferences. */
    const FEATURE_PREFS_KEY = 'dsh.codexStyle.features'
    /** Feature ids in bundle order, mirrored by the settings shell tabs. */
    const FEATURE_IDS = ${JSON.stringify(FEATURE_ORDER)}

    /**
     * Register one merged feature.
     * @param {string} id - package name the feature was merged from.
     * @param {(require: Function, env: object) => { inject?: string[], apply: Function, __test?: object }} build - lazy builder.
     */
    function __DSH_FEATURE(id, build) {
      __DSH_FEATURE_TABLE__.push({ id, build })
    }

    /** Shared helper surface handed to every feature builder. */
    const env = {
      /**
       * Register a settings page owned by one feature. The shell renders it in
       * that feature's tab; a feature without a page gets the generated page.
       * @param {{ id: string, title?: () => string, render?: Function }} page - page descriptor.
       */
      registerSettingsPage(page) {
        if (page === null || typeof page !== 'object' || typeof page.id !== 'string') return
        __DSH_SETTINGS_PAGES__.push(page)
      },
      /** @returns {object[]} pages registered by built features. */
      settingsPages() {
        return __DSH_SETTINGS_PAGES__
      },
      /** @returns {Record<string, boolean>} per-feature enable preferences. */
      readEnabledFeatures() {
        try {
          const raw = window.localStorage.getItem(FEATURE_PREFS_KEY)
          if (raw === null || raw === '') return {}
          const parsed = JSON.parse(raw)
          return parsed !== null && typeof parsed === 'object' ? parsed : {}
        } catch {
          return {}
        }
      },
      /**
       * Persist one feature toggle.
       * @param {string} id - feature id.
       * @param {boolean} enabled - new state.
       * @returns {Record<string, boolean>} the updated map.
       */
      writeEnabledFeature(id, enabled) {
        const next = { ...env.readEnabledFeatures() }
        next[id] = enabled !== false
        try {
          window.localStorage.setItem(FEATURE_PREFS_KEY, JSON.stringify(next))
        } catch {
          // Private browsing or a disposed page keeps the in-memory state only.
        }
        return next
      },
      /** @returns {string[]} feature ids in bundle order. */
      featureIds() {
        return FEATURE_IDS.slice()
      },
      /** Generate the browser-local preferences key, for diagnostics and checks. */
      preferencesKey: FEATURE_PREFS_KEY,
      /** Id of the settings shell feature. */
      settingsFeatureId: SETTINGS_FEATURE_ID,
    }

    /* ------------------------------------------------------------------ *
     * Feature health bookkeeping.
     *
     * Failures, dependency skips and quarantines are recorded here so the
     * settings shell can report them, and failures are persisted so the next
     * page load can warn about a feature that crashed in an earlier boot.
     * ------------------------------------------------------------------ */

    /** Browser-local failure records key. */
    const FEATURE_FAILURES_KEY = 'dsh.codexStyle.failures'
    /** Live state per feature id: { state, phase, message, at }. */
    const __DSH_STATUS__ = Object.create(null)
    /** @type {Set<Function>} status listeners owned by the settings shell. */
    const __DSH_STATUS_LISTENERS__ = new Set()

    /**
     * Bounded one-line message for an unknown thrown value.
     * @param {unknown} error - thrown value.
     * @returns {string} message.
     */
    function __dshMessageOf(error) {
      try {
        const text = error !== null && typeof error === 'object'
          ? String(error.message ?? error)
          : String(error)
        return text.slice(0, 400)
      } catch {
        return 'unknown error'
      }
    }

    /** Notify every registered status listener; a broken listener is ignored. */
    function __dshNotifyStatus() {
      for (const listener of [...__DSH_STATUS_LISTENERS__]) {
        try {
          listener()
        } catch {
          // A broken status surface never breaks a feature.
        }
      }
    }

    /** @returns {object} persisted failure map, best effort. */
    function __dshReadFailures() {
      try {
        const raw = window.localStorage.getItem(FEATURE_FAILURES_KEY)
        if (raw === null || raw === '') return {}
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : {}
      } catch {
        return {}
      }
    }

    /**
     * Persist a failure map, best effort.
     * @param {object} failures - map keyed by feature id.
     */
    function __dshWriteFailures(failures) {
      try {
        if (Object.keys(failures).length === 0) window.localStorage.removeItem(FEATURE_FAILURES_KEY)
        else window.localStorage.setItem(FEATURE_FAILURES_KEY, JSON.stringify(failures))
      } catch {
        // Private browsing keeps the in-memory records only.
      }
    }

    /** Persist the current live failure map, best effort. */
    function __dshPersistFailures() {
      const failures = {}
      for (const [id, status] of Object.entries(__DSH_STATUS__)) {
        if (status.state === 'failed' || status.state === 'quarantined') failures[id] = status
      }
      __dshWriteFailures(failures)
    }

    /**
     * Record one feature health transition.
     * @param {string} id - feature id.
     * @param {string} state - failed, quarantined, skipped or disabled.
     * @param {string} phase - failing phase.
     * @param {string} message - bounded message.
     */
    function __dshSetStatus(id, state, phase, message) {
      __DSH_STATUS__[id] = { state, phase, message, at: Date.now() }
      __dshPersistFailures()
      __dshNotifyStatus()
    }

    /**
     * Record a feature failure.
     * @param {string} id - feature id.
     * @param {string} phase - build, apply, effect, slot, label, inject, render or cleanup.
     * @param {string} message - bounded message.
     */
    env.recordFailure = (id, phase, message) => {
      const state = phase === 'render' || phase === 'dependency' ? 'quarantined' : 'failed'
      __dshSetStatus(id, state, phase, typeof message === 'string' ? message : __dshMessageOf(message))
    }

    /**
     * Record a feature quarantined after it started running.
     * @param {string} id - feature id.
     * @param {string} phase - render, effect, slot, label, inject or dependency.
     * @param {string} message - bounded message.
     */
    env.recordQuarantine = (id, phase, message) => {
      __dshSetStatus(id, 'quarantined', phase, typeof message === 'string' ? message : __dshMessageOf(message))
    }

    /**
     * Record a feature skipped because a declared dependency is unavailable.
     * @param {string} id - feature id.
     * @param {string} dependency - missing dependency id.
     */
    env.markSkipped = (id, dependency) => {
      __dshSetStatus(id, 'skipped', 'dependency', 'requires "' + dependency + '"')
    }

    /** @param {string} id - feature id. Clear a healthy feature's failure record. */
    env.clearFailure = (id) => {
      const hadLive = __DSH_STATUS__[id] !== undefined
      if (hadLive) delete __DSH_STATUS__[id]
      const failures = __dshReadFailures()
      if (failures[id] !== undefined) {
        delete failures[id]
        __dshWriteFailures(failures)
      }
      if (hadLive) __dshNotifyStatus()
    }

    /** @returns {object} live failure/skip/quarantine records keyed by feature id. */
    env.featureStatuses = () => ({ ...__DSH_STATUS__ })

    /** @returns {object} failure records persisted by an earlier boot. */
    env.persistedFailures = () => __dshReadFailures()

    /**
     * Subscribe to feature health changes (used by the settings shell).
     * @param {Function} listener - change listener.
     * @returns {Function} unsubscribe.
     */
    env.subscribeStatus = (listener) => {
      if (typeof listener !== 'function') return () => {}
      __DSH_STATUS_LISTENERS__.add(listener)
      return () => { __DSH_STATUS_LISTENERS__.delete(listener) }
    }

    /**
     * Quarantine a feature from a render boundary or the settings page.
     * @param {string} id - feature id.
     * @param {unknown} error - thrown value.
     * @param {string} phase - failing phase.
     */
    env.quarantineFeature = (id, error, phase) => {
      if (env.__runtime !== null) env.__runtime.quarantine(id, error, phase ?? 'render')
      else env.recordFailure(id, phase ?? 'render', __dshMessageOf(error))
    }

    /** @param {object} runtime - isolation runtime for this materialization. */
    env.attachRuntime = (runtime) => { env.__runtime = runtime }
    /** @type {object|null} isolation runtime, attached at materialization. */
    env.__runtime = null
`

/** Epilogue: build the selected features, expose the merged isolated module. */
const EPILOGUE = `
    /* ------------------------------------------------------------------ *
     * Materialization: build the selected features and hand them to the
     * isolation runtime (src/isolation.js), which owns apply, quarantine and
     * per-feature error boundaries.
     * ------------------------------------------------------------------ */

    const runtime = __dshCreateRuntime(require, env, __DSH_FEATURE_TABLE__)
    env.attachRuntime(runtime)
    runtime.buildAll()
    const modules = runtime.builtModules()

    /* ------------------------------------------------------------------ *
     * Merged client plugin: one module for the whole bundle.
     * ------------------------------------------------------------------ */

    return {
      /** Union of the built features' services; the shell never applies early. */
      inject: [...new Set(modules.flatMap((module) => module.inject ?? []))],
      /**
       * Apply every enabled feature on its own disposable scope. A feature that
       * throws is quarantined so the rest of the bundle keeps running.
       * @param {object} ctx - client root context.
       */
      apply(ctx) {
        runtime.applyAll(ctx)
      },
      /** Ids built in this materialization (a test filter narrows them). */
      __features: runtime.builtIds(),
      /** Settings pages registered by the built features, for the package checks. */
      __settingsPages: __DSH_SETTINGS_PAGES__,
      /** @returns {object} live failure/skip/quarantine records per feature. */
      __statuses: () => env.featureStatuses(),
      /** Whether apply/render isolation is active for this materialization. */
      __isolationEnabled: runtime.isolationEnabled,
      /** Per-feature test hooks when exactly one feature is built. */
      __test: modules.length === 1 ? modules[0].__test : undefined,
    }
  },
})
`

/** Read one source file and fail with a readable message when it is missing. */
function readSource(relative) {
  const path = join(ROOT, relative)
  try {
    return readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
  } catch (error) {
    throw new Error(`cannot read ${relative}: ${error.message}`)
  }
}

/** Render the generated client bundle. */
function renderClient() {
  const parts = []
  parts.push(`/**
 * dsh-codex-style — merged DSH web-client bundle.
 *
 * GENERATED by scripts/build-client.mjs from src/; do not edit by hand.
 * The bundle is self-contained: one module owns eleven merged features and the
 * Settings -> Codex Style section with one tab per feature.
 */

window.__ModuleLoader__.load({
  id: 'dsh-codex-style',
  factory(require) {
`)

  parts.push(PROLOGUE)

  for (const id of FEATURE_ORDER) {
    const source = readSource(`src/features/${id}.js`).trimEnd()
    if (!source.includes(`__DSH_FEATURE('${id}'`)) {
      throw new Error(`src/features/${id}.js does not register __DSH_FEATURE('${id}')`)
    }
    parts.push(`\n    /* ================================================================== *\n` +
      `     * Feature: ${id}\n` +
      `     * ================================================================== */\n\n`)
    parts.push(source + '\n')
  }

  const settings = readSource('src/settings.js').trimEnd()
  if (!settings.includes(`__DSH_FEATURE(SETTINGS_FEATURE_ID`)) {
    throw new Error('src/settings.js does not register the settings shell feature')
  }
  for (const id of FEATURE_ORDER) {
    if (!settings.includes(`'${id}'`)) {
      throw new Error(`src/settings.js has no metadata entry for ${id}`)
    }
  }
  parts.push('\n    /* ================================================================== *\n' +
    '     * Feature: settings shell (Settings -> Codex Style)\n' +
    '     * ================================================================== */\n\n')
  parts.push(settings.replace('__DSH_FEATURE(SETTINGS_FEATURE_ID', "__DSH_FEATURE('" + SETTINGS_FEATURE_ID + "'") + '\n')

  const isolation = readSource('src/isolation.js').trimEnd()
  if (!isolation.includes('function __dshCreateRuntime')) {
    throw new Error('src/isolation.js does not define __dshCreateRuntime')
  }
  parts.push('\n    /* ================================================================== *\n' +
    '     * Isolation runtime: per-feature interceptor, scopes and boundaries\n' +
    '     * ================================================================== */\n\n')
  parts.push(isolation + '\n')

  parts.push(EPILOGUE)
  return parts.join('')
}

/** Only run when invoked as a script; the checks import FEATURE_ORDER. */
const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (!invokedDirectly) {
  // Imported for FEATURE_ORDER only; nothing to generate.
} else {
const generated = renderClient()

if (process.argv.includes('--check')) {
  let current = ''
  try {
    current = readFileSync(CLIENT_PATH, 'utf8')
  } catch {
    console.error('client.js is missing; run: node scripts/build-client.mjs')
    process.exit(1)
  }
  if (current !== generated) {
    console.error('client.js is stale; run: node scripts/build-client.mjs')
    process.exit(1)
  }
  console.log('client.js is current')
} else {
  writeFileSync(CLIENT_PATH, generated, 'utf8')
  const kb = (Buffer.byteLength(generated) / 1024).toFixed(1)
  console.log(`wrote client.js (${kb} KB, ${FEATURE_ORDER.length} features)`)
}
}
