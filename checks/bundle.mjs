/**
 * Static contract checks for the merged dsh-codex-style bundle.
 *
 * The other check files drive one merged feature each. This file guards the
 * bundle-level contract: manifest, patch, generated artifact freshness, feature
 * table, host half and the absence of stale standalone-package wiring.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { FEATURE_ORDER } from '../scripts/build-client.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const manifest = JSON.parse(read('package.json'))
const clientSource = read('client.js')
const settingsSource = read('src/settings.js')
const indexSource = read('index.js')
const patch = read('cordis.patch.yml')

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

// ---------------------------------------------------------------------------
// Manifest, patch and files
// ---------------------------------------------------------------------------

await check('manifest declares one DSH bundle and one web client half', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.version, '1.2.0')
  assert.equal(manifest.license, 'MIT')
  assert.equal(manifest.type, 'module')
  assert.equal(manifest.main, 'index.js')
  assert.equal(manifest.exports['./client'], './client.js')
  assert.equal(manifest.exports['./icon'], './icon.svg')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.scripts.check, 'node scripts/check.mjs')
  assert.equal(manifest.scripts.build, 'node scripts/build-client.mjs')
})

await check('manifest injects every client module a feature requires', () => {
  const inject = manifest.dsh.client.inject
  for (const name of [
    '@deepseek-ai/dsh-client-locale',
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-settings-general',
    '@deepseek-ai/dsh-client-ui-session',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-workspace',
    '@deepseek-ai/dsh-api-gateway',
    '@deepseek-ai/dsh-api-remotes',
    '@deepseek-ai/dsh-api-session-controller',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-sidebar-right',
  ]) assert(inject.includes(name), 'inject includes ' + name)
  assert(!inject.includes('@deepseek-ai/dsh-client-ui-settings-plugins'), 'no standalone settings tab dependency')
  assert.equal(manifest.dependencies, undefined, 'no runtime dependencies')
  assert.equal(manifest.packages, undefined, 'not a workspace root')
})

await check('every manifest file exists on disk', () => {
  for (const relative of [
    manifest.main,
    'client.js',
    manifest.dsh.bundle.patch,
    'src/settings.js',
    'scripts/build-client.mjs',
    'scripts/check.mjs',
    'locale/en.json',
    'locale/zh.json',
    'icon.svg',
    'README.md',
    'README.en.md',
    'CHANGELOG.md',
    'LICENSE',
  ]) assert(fs.existsSync(path.join(ROOT, relative)), relative + ' exists')
})

await check('bundle patch inserts exactly one codex-style row', () => {
  assert(patch.includes('- insert:'))
  assert(patch.includes('id: codex-style'))
  assert(patch.includes("name: 'dsh-codex-style'"))
  assert.equal((patch.match(/- insert:/g) ?? []).length, 1)
})

// ---------------------------------------------------------------------------
// Generated bundle
// ---------------------------------------------------------------------------

await check('shipped client.js is the current generated artifact', () => {
  const result = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'build-client.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  assert.equal(result.status, 0, (result.stdout ?? '') + (result.stderr ?? ''))
})

await check('client.js registers exactly one client module', () => {
  assert.equal((clientSource.match(/window\.__ModuleLoader__\.load\(/g) ?? []).length, 1)
  assert(clientSource.includes("id: 'dsh-codex-style'"))
  assert(clientSource.includes('factory(require)'))
})

await check('every merged feature registers exactly once in bundle order', () => {
  assert.equal(FEATURE_ORDER.length, 18)
  for (const id of FEATURE_ORDER) {
    const pattern = new RegExp("__DSH_FEATURE\\('" + id + "'", 'g')
    assert.equal((clientSource.match(pattern) ?? []).length, 1, id + ' registers once')
  }
  const order = FEATURE_ORDER.map((id) => clientSource.indexOf("__DSH_FEATURE('" + id + "'"))
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'features keep bundle order')
  assert(clientSource.includes("__DSH_FEATURE('dsh-codex-style.settings', function (require, env)"), 'settings shell registers once')
})

await check('settings shell covers every merged feature in both locales', () => {
  for (const id of FEATURE_ORDER) {
    for (const suffix of ['title', 'summary', 'note']) {
      assert.equal((settingsSource.match(new RegExp("'feature\\." + id + "\\." + suffix + "'", 'g')) ?? []).length, 2,
        id + ' ' + suffix + ' exists in zh and en')
    }
  }
  assert(settingsSource.includes("'settings.nav'"))
  assert(settingsSource.includes("'settings.restart'"))
})

await check('client only requires platform-seeded modules', () => {
  const requires = [...new Set([...clientSource.matchAll(/require\('([^']+)'\)/g)].map((match) => match[1]))].sort()
  assert.deepEqual(requires, [
    '@deepseek-ai/dsh-client-store',
    '@deepseek-ai/dsh-client-ui-primitives',
    'react',
    'react-dom',
  ])
})

await check('no standalone-package wiring is left in the bundle', () => {
  for (const id of FEATURE_ORDER) {
    assert(!clientSource.includes('id: \'' + id + '\',\n  factory'), 'no standalone module id ' + id)
  }
  assert(!clientSource.includes('settings.plugins.tab'), 'settings tabs are owned by the shell')
  assert(!clientSource.includes('__DSH_CODEX_STYLE_FEATURES__: ['), 'test filter stays out of the artifact')
  assert(clientSource.includes('dsh.codexStyle.features'))
})

// ---------------------------------------------------------------------------
// Host half
// ---------------------------------------------------------------------------

await check('host half exports its services and keeps the queue routes', () => {
  for (const dependency of ['webServer', 'agents', 'sessions', 'attachments', 'typert', 'fs', 'subprocess', 'sandbox', 'sandboxPolicy']) assert(indexSource.includes("'" + dependency + "'"), dependency)
  for (const route of [
    '/dsh-queue-withdraw/reorder',
    '/dsh-queue-withdraw/update',
    '/dsh-queue-withdraw/freeze',
    '/dsh-queue-withdraw/thaw',
    '/dsh-queue-withdraw/frozen',
  ]) assert(indexSource.includes(route), 'route ' + route)
  assert(indexSource.includes('installClaimPatch'))
  assert(indexSource.includes('frozenFile()'))
  assert(!indexSource.includes('dsh-composer-plus'), 'composer-plus is not merged yet')
})

// ---------------------------------------------------------------------------
// Feature isolation
// ---------------------------------------------------------------------------

await check('the bundle ships the per-feature isolation runtime', () => {
  for (const marker of [
    'function __dshCreateRuntime',
    'FeatureErrorBoundary',
    'getDerivedStateFromError',
    'function createScope',
    'function quarantine(',
    'env.markSkipped',
    'missingDependency',
    '__DSH_CODEX_STYLE_ISOLATION__',
    'dsh.codexStyle.failures',
  ]) assert(clientSource.includes(marker), 'isolation marker ' + marker)
  assert(clientSource.includes('__statuses: () => env.featureStatuses()'), 'statuses exposed to the checks')
  assert(clientSource.includes('__isolationEnabled: runtime.isolationEnabled'), 'isolation flag exposed')
})

await check('an isolated feature cannot take the bundle down at apply time', () => {
  assert(clientSource.includes("env.recordFailure(id, 'apply'"), 'apply failures recorded')
  assert(clientSource.includes('scope.dispose()'), 'failed scope disposed')
  assert(clientSource.includes('const scope = createScope(ctx, id)'), 'each feature applies on its own scope')
  assert(clientSource.includes('if (failed) {'), 'failed feature skipped after disposal')
  assert(clientSource.includes('setTimeout(() => quarantine(id, error, phase), 0)'), 'runtime quarantine is deferred')
})

await check('the settings shell reports failed, quarantined and skipped features', () => {
  for (const marker of [
    "'settings.state.failed'",
    "'settings.state.quarantined'",
    "'settings.state.skipped'",
    "'settings.failure.message'",
    "'group.navigation'",
    'dshcs-alert',
    'dshcs-tabBadge',
    'SettingsPageBoundary',
  ]) assert(settingsSource.includes(marker), 'settings health marker ' + marker)
  assert(settingsSource.includes('env.subscribeStatus'), 'settings shell follows live health changes')
})

// ---------------------------------------------------------------------------
// Locale and icon
// ---------------------------------------------------------------------------

await check('locale files carry the merged plugin title and description', () => {
  for (const locale of ['zh', 'en']) {
    const value = JSON.parse(read('locale/' + locale + '.json'))
    assert.equal(typeof value.meta.title, 'string')
    assert.equal(typeof value.meta.description, 'string')
    assert(value.meta.description.trim().length > 0)
    assert.equal(value.meta.title, locale === 'zh' ? 'Codex 工作台' : 'Codex Workbench')
  }
})

await check('icon is a valid accent SVG', () => {
  const icon = read('icon.svg')
  assert(icon.includes('<svg'))
  assert(icon.includes('#4D6BFE'))
  assert(icon.includes('aria-label'))
})

console.log('\n' + (process.exitCode === 1 ? 'some checks failed' : 'all checks passed (' + checks + ')'))
