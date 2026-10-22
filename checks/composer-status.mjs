/** Inline composer status checks: icon-only fit planning, dock splitting and safe styling. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'

const source = fs.readFileSync(new URL('../src/composer/composer-status.js', import.meta.url), 'utf8')
let build
vm.runInNewContext(source, {
  __DSH_FEATURE: (_id, factory) => {
    build = factory
  },
  requestAnimationFrame: (callback) => callback(),
  cancelAnimationFrame: () => {},
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  MutationObserver: class {
    observe() {}
    disconnect() {}
  },
  document: { querySelectorAll: () => [], createElement: () => ({ dataset: {}, style: {} }) },
  window: { addEventListener() {}, removeEventListener() {} },
})
const { planStatusLayout, splitDock, centeredPanelLeft, keepPlacement, bindPerformanceUsage, VERTICAL_DEADBAND, PERFORMANCE_ATTR, GAP, RING_GAP } = build().__test

let checks = 0
const check = (name, run) => {
  run()
  checks++
  console.log('ok ' + name)
}

/** Composer geometry at a 1440px window; only the icon pair (24+4+24) is shown. */
function fixture(patch = {}) {
  return {
    root: { left: 0, right: 1440, top: 760, bottom: 900, width: 1440, height: 140 },
    row: { left: 100, right: 1340, top: 800, bottom: 836, width: 1240, height: 36 },
    tools: { left: 108, right: 250, top: 800, bottom: 828, width: 142, height: 28 },
    model: { left: 1050, right: 1180, top: 800, bottom: 828, width: 130, height: 28 },
    ringWidth: 20,
    pillsWidth: 52,
    ...patch,
  }
}

check('a wide composer keeps the icon pair and pins the ring before the model seat', () => {
  const plan = planStatusLayout(fixture())
  assert.equal(plan.pills, 'icon')
  assert.equal(plan.left, 100)
  assert.equal(plan.top, 40)
  assert.equal(plan.width, 1240)
  assert.equal(plan.height, 28)
  assert.equal(plan.ringRight, 1340 - (1050 - RING_GAP))
  assert.equal(plan.ringRight, 294)
})

check('the dock spans the row while the ring ends one gap before the model seat', () => {
  for (const modelLeft of [700, 900, 1050, 1200]) {
    const plan = planStatusLayout(fixture({ model: { ...fixture().model, left: modelLeft } }))
    const ringRightEdge = plan.width + plan.left - plan.ringRight
    assert.equal(ringRightEdge, modelLeft - RING_GAP, 'ring right edge tracks the model seat: ' + modelLeft)
  }
})

check('the icon pair is dropped when the left tools group leaves no room before the ring', () => {
  const hidden = planStatusLayout(fixture({ tools: { ...fixture().tools, right: 1000, width: 892 } }))
  assert.equal(hidden.pills, 'hidden')
  const kept = planStatusLayout(fixture({ tools: { ...fixture().tools, right: 900, width: 792 } }))
  assert.equal(kept.pills, 'icon')
})

check('the fit boundary uses the measured room, not a viewport guess', () => {
  // pillsRoom = model.left - RING_GAP - ringWidth - GAP - (tools.right + GAP)
  const modelLeft = 250 + GAP + 52 + GAP + RING_GAP + 20
  assert.equal(planStatusLayout(fixture({ model: { ...fixture().model, left: modelLeft } })).pills, 'icon')
  assert.equal(
    planStatusLayout(fixture({ model: { ...fixture().model, left: modelLeft - 1 } })).pills,
    'hidden',
  )
})

check('a wrapped control row hides the icons instead of floating them over another line', () => {
  const plan = planStatusLayout(fixture({ tools: { ...fixture().tools, top: 860, bottom: 888 } }))
  assert.equal(plan.pills, 'hidden')
  assert.equal(plan.top, 40, 'the ring still follows the model line')
})

check('dock children split into stat pills and the dialog-ring surface', () => {
  const node = (kind) => ({
    stat: kind === 'stat',
    ring: kind === 'ring',
    hasAttribute(name) {
      return this.stat && name === 'data-composer-stat'
    },
    querySelector(selector) {
      return this.ring && selector.includes('svg circle') ? { tag: 'circle' } : null
    },
  })
  const activity = node('stat')
  const usage = node('stat')
  const meter = node('ring')
  const direct = { children: [activity, usage, meter], querySelectorAll: () => [activity, usage] }
  const directParts = splitDock(direct)
  assert.equal(directParts.pills.length, 2)
  assert.equal(directParts.pills[0], activity)
  assert.equal(directParts.pills[1], usage)
  assert.equal(directParts.ring, meter)
  // The host renders slot contributions inside a display:contents outlet; the
  // outlet itself is not a surface and its pill anchors are still found.
  const outlet = { style: { display: 'contents' }, children: [activity, usage] }
  const wrapped = { children: [outlet, meter], querySelectorAll: () => [activity, usage] }
  const wrappedParts = splitDock(wrapped)
  assert.equal(wrappedParts.children.length, 1)
  assert.equal(wrappedParts.children[0], meter)
  assert.equal(wrappedParts.pills.length, 2)
  assert.equal(wrappedParts.ring, meter)
  const fallback = node('plain')
  assert.equal(splitDock({ children: [activity, fallback], querySelectorAll: () => [activity] }).ring, fallback)
  assert.equal(splitDock({ children: [activity], querySelectorAll: () => [activity] }).ring, null)
})

check('the stat buttons follow the Host performance-and-usage preference', () => {
  const attributes = new Map()
  const root = {
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  }
  const listeners = new Set()
  let value = { performanceUsage: 'compact' }
  const form = {
    getSnapshot: () => ({ value }),
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  const dispose = bindPerformanceUsage(form, root)
  assert.equal(attributes.get(PERFORMANCE_ATTR), 'compact', 'compact hides the stat buttons')
  value = { performanceUsage: 'detailed' }
  for (const listener of listeners) listener()
  assert.equal(attributes.has(PERFORMANCE_ATTR), false, 'detailed restores the stat buttons')
  value = { performanceUsage: 'compact' }
  for (const listener of listeners) listener()
  assert.equal(attributes.get(PERFORMANCE_ATTR), 'compact', 'the marker follows live changes')
  dispose()
  assert.equal(attributes.has(PERFORMANCE_ATTR), false, 'the marker is removed on unload')
  assert.equal(listeners.size, 0, 'the settings subscription is released')
  assert.equal(typeof bindPerformanceUsage(undefined, root), 'function', 'a missing Host form degrades to no-op')
  assert.equal(attributes.has(PERFORMANCE_ATTR), false, 'no preference means the default detailed visibility')
})

check('the feature never re-parents host nodes and restores everything it writes', () => {
  assert(!source.includes('insertBefore('), 'host nodes are never moved')
  assert(!source.includes('appendChild('), 'host nodes are never moved')
  assert(!source.includes('replaceWith('), 'host nodes are never replaced')
  const textWrites = source.match(/[A-Za-z_$][\w$]*\.textContent\s*=/g) ?? []
  assert.deepEqual(textWrites, ['style.textContent ='], 'host text stays host-owned')
  for (const marker of ['data-dshcs-root', 'data-dshcs-dock', 'data-dshcs-ring', 'data-dshcs-pills', 'data-dshcs-performance'])
    assert(source.includes(marker), 'marker is written: ' + marker)
  assert(source.includes('removeAttribute(DOCK_ATTR)'), 'dock markers are removed on unload')
  assert(source.includes('style.removeProperty'), 'CSS custom properties are removed on unload')
  assert(source.includes('mutations.disconnect()'), 'mutation observer is disconnected')
  assert(source.includes('resize.disconnect()'), 'resize observer is disconnected')
})

check('the stylesheet floats the dock on the card row and keeps only icons', () => {
  assert(source.includes('position:absolute'), 'dock leaves the layout flow')
  assert(source.includes('pointer-events:none'), 'the overlay never blocks the row')
  assert(source.includes('justify-content:flex-end'), 'the status buttons hug the model seat')
  assert(source.includes('button>span{display:none'), 'only the ring survives in the context trigger')
  assert(source.includes('[class$="_label"]{display:none'), 'stat pills keep only their icon')
  assert(source.includes('margin-right:var(--dshcs-ring-right'), 'ring offset is driven by measurement')
})

check('the detail panel centers on the clicked status button, clamped to the viewport', () => {
  assert.equal(
    centeredPanelLeft({ anchorLeft: 1000, anchorWidth: 24, panelWidth: 300, viewportWidth: 1440 }),
    862,
    'button center and panel center coincide',
  )
  assert.equal(
    centeredPanelLeft({ anchorLeft: 1400, anchorWidth: 20, panelWidth: 300, viewportWidth: 1440 }),
    1128,
    'right clamp',
  )
  assert.equal(
    centeredPanelLeft({ anchorLeft: 0, anchorWidth: 20, panelWidth: 300, viewportWidth: 1440 }),
    12,
    'left clamp',
  )
})

check('the three status controls stay separate icon buttons in the composer row', () => {
  assert(source.includes('[${DOCK_ATTR}] [data-composer-stat]{margin:0;flex:none;pointer-events:auto;}'), 'stat pills keep their row slot')
  assert(source.includes('[${DOCK_ATTR}][${PILLS_ATTR}=hidden] [data-composer-stat]{display:none;}'), 'pills only hide when the fit plan drops them')
  assert(source.includes('html[${PERFORMANCE_ATTR}=compact] [${DOCK_ATTR}] [data-composer-stat]{display:none;}'), 'compact mode drops the stat buttons')
  assert(source.includes('[${DOCK_ATTR}]>[${RING_ATTR}]>button>span{display:none;}'), 'the ring keeps only its icon')
  assert(source.includes('[${DOCK_ATTR}] [data-composer-stat] [class$="_label"]{display:none;'), 'stat pills keep only their icon')
  assert(source.includes('[class$="_pill"]{justify-content:center;gap:0;padding:6px;border-radius:999px'), 'stat pills share the 28px hover circle')
  assert(source.includes('>button{padding:6px;gap:0;border-radius:999px'), 'the ring shares the same 28px hover circle')
  assert(!source.includes('dshcs-menu'), 'no merged menu surface')
  assert(!source.includes('require('), 'no extra framework dependency')
})

check('one-pixel seat settling never re-centers the icon row', () => {
  // Reaching the tail settles the sticky composer by about a pixel; keeping the
  // previous vertical placement avoids the shake, while real layout moves pass.
  assert.equal(keepPlacement(undefined, 40, VERTICAL_DEADBAND), 40, 'first placement applies')
  assert.equal(keepPlacement(40, 40.4, VERTICAL_DEADBAND), 40, 'sub-pixel settling is ignored')
  assert.equal(keepPlacement(40, 39, VERTICAL_DEADBAND), 40, 'one-pixel settling is ignored')
  assert.equal(keepPlacement(40, 41.9, VERTICAL_DEADBAND), 40, 'below the deadband is ignored')
  assert.equal(keepPlacement(40, 42, VERTICAL_DEADBAND), 42, 'a real layout move applies')
  assert.equal(keepPlacement(40, 20, VERTICAL_DEADBAND), 20, 'large moves apply')
  assert.equal(keepPlacement(40, 39, 0), 39, 'no deadband keeps exact placement')
  assert.equal(VERTICAL_DEADBAND, 2)
})

check('the feature is one lazy capability whose Host preference stays optional', () => {
  assert(source.includes("__DSH_FEATURE('dsh-composer-status'"), 'feature id is stable')
  assert(source.includes('function apply(ctx)'), 'applies through the client context')
  assert(source.includes("'composer-status: styles'") && source.includes("'composer-status: inline dock'"))
  assert(source.includes("ctx.get('configForms')?.get?.(CHAT_SETTINGS_NAMESPACE)"), 'performance preference comes from the Host chat settings')
  assert(source.includes("CHAT_SETTINGS_NAMESPACE = 'ui-chat'"), 'the Host settings namespace is explicit')
  assert(!source.includes('ctx.inject('), 'no host service is required by inject')
})

console.log(checks + ' composer status checks passed')
