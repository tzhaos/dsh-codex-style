/** Image lightbox wheel-zoom math and attachment hover stroke checks. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

let build
vm.runInNewContext(fs.readFileSync(new URL('../src/conversation/image-zoom.js', import.meta.url), 'utf8'), {
  __DSH_FEATURE: (_id, factory) => { build = factory },
})
const { lightboxOf, planZoom, paint } = build(() => ({}), {}).__test
const source = fs.readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const queueSource = fs.readFileSync(new URL('../src/composer/queue.js', import.meta.url), 'utf8')

let checks = 0
async function check(name, run) {
  try {
    await run()
    checks += 1
    console.log('ok ' + name)
  } catch (error) {
    process.exitCode = 1
    console.error('FAIL ' + name + '\n' + error.stack)
  }
}

const near = (actual, expected, label) =>
  assert(Math.abs(actual - expected) < 1e-6, `${label}: ${String(actual)} != ${String(expected)}`)

await check('wheel zoom keeps the point under the cursor fixed', () => {
  const base = { left: 100, top: 50 }
  const point = { x: 260, y: 190 }
  const next = planZoom({ scale: 1, tx: 0, ty: 0 }, base, point, -480)
  assert(next.scale > 1)
  // The local image point under the cursor is (160, 140); its screen position
  // after the transform must stay at the cursor.
  const localX = (point.x - base.left) / 1
  const localY = (point.y - base.top) / 1
  near(base.left + next.tx + localX * next.scale, point.x, 'x anchor')
  near(base.top + next.ty + localY * next.scale, point.y, 'y anchor')
})

await check('zoom keeps the anchor when starting from an already panned state', () => {
  const state = { scale: 2, tx: -40, ty: 25 }
  const base = { left: 100, top: 60 }
  const point = { x: 300, y: 220 }
  const next = planZoom(state, base, point, -120)
  assert(next.scale > state.scale)
  const localX = (point.x - base.left - state.tx) / state.scale
  const localY = (point.y - base.top - state.ty) / state.scale
  near(base.left + next.tx + localX * next.scale, point.x, 'x anchor')
  near(base.top + next.ty + localY * next.scale, point.y, 'y anchor')
})

await check('scale clamps to 8x and returns to a clean fit size', () => {
  const max = planZoom({ scale: 1, tx: 0, ty: 0 }, { left: 0, top: 0 }, { x: 10, y: 10 }, -100000)
  assert.equal(max.scale, 8)
  const min = planZoom({ scale: 2.5, tx: -90, ty: 15 }, { left: 0, top: 0 }, { x: 10, y: 10 }, 100000)
  assert.deepEqual({ ...min }, { scale: 1, tx: 0, ty: 0 })
  const noop = planZoom({ scale: 1, tx: 0, ty: 0 }, { left: 0, top: 0 }, { x: 0, y: 0 }, 200000)
  assert.deepEqual({ ...noop }, { scale: 1, tx: 0, ty: 0 })
})

await check('only a dialog whose stage holds a direct image is a lightbox', () => {
  const image = { tag: 'img' }
  const stage = { querySelector: (selector) => (selector === ':scope > img' ? image : null) }
  const dialog = { firstElementChild: stage }
  const target = { closest: () => dialog }
  const parts = lightboxOf(target)
  assert(parts !== null)
  assert.equal(parts.image, image)
  assert.equal(lightboxOf({ closest: () => null }), null)
  assert.equal(lightboxOf(null), null)
  assert.equal(lightboxOf({}), null)
  assert.equal(lightboxOf({ closest: () => ({ firstElementChild: null }) }), null)
  assert.equal(lightboxOf({ closest: () => ({ firstElementChild: { querySelector: () => null } }) }), null)
})

await check('painting applies one local transform and clears it at fit size', () => {
  const removed = []
  const styled = { style: { removeProperty: (key) => removed.push(key) } }
  paint(styled, { scale: 2, tx: 30, ty: -10 })
  assert.equal(styled.style.transform, 'translate(30px, -10px) scale(2)')
  assert.equal(styled.style.transformOrigin, '0 0')
  assert.equal(styled.style.willChange, 'transform')
  assert.equal(styled.style.cursor, 'grab')
  paint(styled, { scale: 1, tx: 0, ty: 0 })
  assert.deepEqual(removed.sort(), ['cursor', 'transform', 'transform-origin', 'will-change'])
})

await check('wheel, drag, double-click reset and cleanup are wired on the document', () => {
  assert(source.includes("document.addEventListener('wheel'"))
  assert(source.includes('{ passive: false, capture: true }'))
  assert(source.includes("document.addEventListener('pointermove'"))
  assert(source.includes("document.addEventListener('dblclick'"))
  assert(source.includes('removeEventListener'))
  assert(source.includes('[role="dialog"][aria-modal="true"]'))
  assert(source.includes(':scope > img'))
})

await check('attachment hover swaps in one solid stroke instead of a lighter ring', () => {
  assert(queueSource.includes('border-color: var(--dsw-alias-state-business-primary)'))
  assert(queueSource.includes('box-shadow: 0 0 0 1px var(--dsw-alias-state-business-primary)'))
  assert(!queueSource.includes('box-shadow: 0 0 0 2px'))
  assert(!queueSource.includes('55%, transparent'))
})

await check('the bundled client ships the zoom layer after a rebuild', () => {
  assert(source.includes("__DSH_FEATURE('dsh-image-zoom'"))
  assert(source.includes('planZoom'))
})

console.log('\n' + checks + ' image zoom checks passed')
