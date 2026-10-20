#!/usr/bin/env node
/**
 * Run every package check under `checks/` without third-party dependencies.
 *
 * Each check file is a standalone Node script that loads the real shipped
 * `client.js` (or the host half) and prints one `ok <name>` line per check.
 * This runner only discovers them in deterministic order, streams their output
 * and aggregates failures and counts.
 *
 * Usage:
 *   node scripts/check.mjs
 *   node scripts/check.mjs --no-build-check   # skip the generated-bundle check
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const CHECKS_DIR = join(ROOT, 'checks')
const skipBuildCheck = process.argv.includes('--no-build-check')

if (!skipBuildCheck) {
  const build = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-client.mjs'), '--check'], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  if (build.status !== 0) {
    process.stdout.write(build.stdout ?? '')
    process.stderr.write(build.stderr ?? '')
    console.error('\nclient.js is not up to date; run: node scripts/build-client.mjs')
    process.exit(1)
  }
  console.log('ok generated client.js is current')
}

const files = readdirSync(CHECKS_DIR)
  .filter((name) => name.endsWith('.mjs'))
  .sort()

if (files.length === 0) {
  console.error('no checks found under checks/')
  process.exit(1)
}

let failed = 0
let totalChecks = 0
const started = Date.now()

for (const file of files) {
  const path = join(CHECKS_DIR, file)
  if (!existsSync(path)) continue
  console.log(`\n=== ${file.replace(/\.mjs$/, '')} ===`)
  const result = spawnSync(process.execPath, [path], { cwd: ROOT, encoding: 'utf8' })
  if (result.stdout !== '') process.stdout.write(result.stdout)
  if (result.stderr !== '') process.stderr.write(result.stderr)
  const passed = (result.stdout ?? '').match(/^ok /gm)
  if (passed !== null) totalChecks += passed.length
  if (result.status !== 0) {
    failed += 1
    console.error(`FAIL ${file}: exit ${String(result.status)}`)
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1)
if (failed > 0) {
  console.error(`\n${String(failed)} check file(s) failed; ${String(totalChecks)} checks passed; ${elapsed}s`)
  process.exit(1)
}
console.log(`\nall checks passed: ${String(files.length)} files, ${String(totalChecks)} checks, ${elapsed}s`)
