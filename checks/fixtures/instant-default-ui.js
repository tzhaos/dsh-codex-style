async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message) }
  assert(new URL(page.url()).hostname === '127.0.0.1', 'private fixture required')
  page.setDefaultTimeout(5000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.reload(); await page.waitForFunction(() => !!window.review)
  assert(await page.evaluate(() => window.__CODEX_WORKBENCH_UI_FIXTURE__ === true), 'owned fixture required')
  const measurements = []
  for (const explicit of [false, true]) for (const width of [1200, 390]) {
    await page.setViewportSize({ width, height: 700 })
    await page.evaluate((explicit) => {
      review.show('hero'); review.mode.set({ ...review.mode.getSnapshot(), collapsed: true })
      const state = structuredClone(review.modelState.getSnapshot()), model = state.groups[0].models[0]
      model.name = 'R'
      model.reasoning = { efforts: [
        ...(explicit ? [{ id: 'default', name: 'Default' }] : []),
        { id: 'low', name: 'Low' }, { id: 'high', name: 'High' }, { id: 'max', name: 'Max' },
      ] }
      state.current = { provider: 'fixture', model: 'reasoner', reasoningEffort: 'low' }
      review.modelState.set(state)
    }, explicit)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.locator('.wq12jW_trigger').click()
    const slider = page.getByRole('slider', { name: '推理强度' })
    await slider.waitFor()
    const rows = []
    for (const key of ['Home', 'ArrowRight', 'End', 'Home']) {
      await slider.press(key)
      await page.waitForFunction(() => document.querySelector('.dshe-panel').getAttribute('aria-busy') === 'false')
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      rows.push(await page.evaluate(() => {
        const measure = (selector) => {
          const node = document.querySelector(selector), r = node.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        }
        return { label: document.querySelector('.dshe-level').textContent,
          trigger: measure('.wq12jW_trigger'), heading: measure('.dshe-model'),
          effort: measure('.wq12jW_triggerEffort'), panel: measure('.dshe-panel'),
          animations: document.querySelector('.dshe-panel').getAnimations().length }
      }))
    }
    for (const row of rows) for (const part of ['trigger', 'heading', 'effort', 'panel']) {
      for (const coordinate of ['x', 'y', 'width', 'height'])
        assert(Math.abs(row[part][coordinate] - rows[0][part][coordinate]) < .5,
          'Default layout moved: ' + JSON.stringify({ explicit, width, part, coordinate, rows }))
      assert(row.animations === 0, 'effort popup is animated')
    }
    measurements.push({ explicit, viewport: width, labels: rows.map(row => row.label),
      triggerWidth: rows[0].trigger.width, headingWidth: rows[0].heading.width, movement: 0 })
    await slider.press('Escape')
    assert(await page.locator('.dshe-panel,[data-dsh-motion-ghost]').count() === 0, 'popup kept an exit surface')
  }
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.evaluate(() => review.mode.set({ ...review.mode.getSnapshot(), collapsed: false }))
  await page.getByRole('button', { name: '搜索聊天', exact: true }).click()
  const search = page.getByRole('dialog', { name: '搜索聊天', exact: true })
  await search.waitFor()
  assert(await search.evaluate(node => node.getAnimations().length + node.parentElement.getAnimations().length) === 0, 'modal opening is animated')
  await page.keyboard.press('Escape')
  assert(await page.locator('.dshst-searchModal,[data-dsh-motion-ghost]').count() === 0, 'modal kept an exit surface')
  await page.evaluate(() => review.inbox.set({ 'next-turn': [
    { id: 'hover-handle', source: { kind: 'user' }, content: [{ type: 'text', text: 'Queued test' }] },
  ], 'next-step': [] }))
  const handle = page.locator('[data-dshq-handle]').first()
  await handle.hover()
  const hover = await handle.evaluate(node => ({ background: getComputedStyle(node).backgroundColor,
    genericHover: node.hasAttribute('data-dshhp-hover'),
    icons: [...node.querySelectorAll('svg')].map(icon => getComputedStyle(icon).backgroundColor) }))
  assert(hover.background === 'rgba(0, 0, 0, 0)' && !hover.genericHover && hover.icons.every(color => color === 'rgba(0, 0, 0, 0)'), 'drag handle has a hover fill: ' + JSON.stringify(hover))
  await page.evaluate(() => review.dispose())
  assert(errors.length === 0, errors.join('; '))
  return { measurements, animations: 'none', exitCopies: 0, dragHandle: hover, errors }
}
