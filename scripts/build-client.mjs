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
 * `__DSH_CODEX_STYLE_FEATURES__` test filter), so a broken feature cannot stop
 * the rest of the bundle from booting.
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
`

/** Epilogue: build the enabled features, expose the merged module. */
const EPILOGUE = `
    /* ------------------------------------------------------------------ *
     * Materialization: build the features selected for this page.
     * ------------------------------------------------------------------ */

    /** Test filter used by the package checks; absent in the shipped page. */
    const filter = typeof __DSH_CODEX_STYLE_FEATURES__ !== 'undefined'
      && Array.isArray(__DSH_CODEX_STYLE_FEATURES__)
      ? __DSH_CODEX_STYLE_FEATURES__
      : null

    /** Built features: id plus the module the standalone package used to export. */
    const modules = []
    for (const feature of __DSH_FEATURE_TABLE__) {
      if (filter !== null && !filter.includes(feature.id)) continue
      try {
        const built = feature.build(require, env)
        modules.push({
          id: feature.id,
          inject: Array.isArray(built.inject) ? built.inject : [],
          apply: typeof built.apply === 'function' ? built.apply : () => {},
          ...built.__test !== undefined ? { __test: built.__test } : {},
        })
      } catch (error) {
        console.error('[dsh-codex-style] feature "' + feature.id + '" failed to build:', error)
      }
    }

    /* ------------------------------------------------------------------ *
     * Merged client plugin: one module for the whole bundle.
     * ------------------------------------------------------------------ */

    return {
      /** Union of the built features' services; the shell never applies early. */
      inject: [...new Set(modules.flatMap((module) => module.inject))],
      /**
       * Apply every enabled feature on the shared client context. A feature
       * that throws is reported and skipped so the rest of the bundle survives.
       * @param {object} ctx - client root context.
       */
      apply(ctx) {
        const enabled = env.readEnabledFeatures()
        for (const module of modules) {
          if (module.id !== SETTINGS_FEATURE_ID && enabled[module.id] === false) continue
          try {
            module.apply(ctx)
          } catch (error) {
            console.error('[dsh-codex-style] feature "' + module.id + '" failed to apply:', error)
          }
        }
      },
      /** Ids built in this materialization (a test filter narrows them). */
      __features: modules.map((module) => module.id),
      /** Settings pages registered by the built features, for the package checks. */
      __settingsPages: __DSH_SETTINGS_PAGES__,
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
