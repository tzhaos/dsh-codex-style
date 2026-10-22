async (page) => {
  const assert = (value, message) => { if (!value) throw new Error(message) }
  assert(new URL(page.url()).hostname === '127.0.0.1', 'private fixture required')
  page.setDefaultTimeout(5000)
  const errors = []; page.on('pageerror', (error) => errors.push(error.message))
  const results = []
  for (const language of ['zh', 'en']) {
    await page.goto(new URL('/?lang=' + language, page.url()).href)
    await page.waitForFunction(() => !!window.review)
    assert(await page.evaluate(() => window.__CODEX_WORKBENCH_UI_FIXTURE__ === true), 'owned fixture required')
    await page.evaluate(() => {
      review.mode.set({ ...review.mode.getSnapshot(), collapsed: true })
      const state = structuredClone(review.modelState.getSnapshot())
      state.groups[0].models[0].reasoning = { efforts: [
        { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' },
        { id: 'high', name: 'High' }, { id: 'max', name: 'Max' },
      ] }
      state.current = { provider: 'fixture', model: 'reasoner' }
      review.modelState.set(state)
    })
    // The provider catalog spells effort levels in English; the control shows
    // that spelling verbatim in every UI language and never translates it.
    const expected = ['High', 'Low', 'Max', 'Low', 'Medium', 'High', 'Max']
    await page.waitForFunction((text) => document.querySelector('.wq12jW_triggerEffort')?.textContent === text, expected[0])
    await page.locator('.wq12jW_trigger').click()
    const slider = page.getByRole('slider', { name: language === 'zh' ? '推理强度' : 'Reasoning effort', exact: true })
    await slider.waitFor()
    const bounds = await page.locator('.wq12jW_trigger').boundingBox()
    const presses = [
      ['Home', expected[1]],
      ['End', expected[2]],
      ['Home', expected[3]],
      ['ArrowRight', expected[4]],
      ['ArrowRight', expected[5]],
      ['ArrowRight', expected[6]],
    ]
    for (const [key, label] of presses) {
      await slider.press(key)
      await page.waitForFunction((expectedLabel) => {
        const trigger = document.querySelector('.wq12jW_trigger')
        return document.querySelector('.dshe-panel')?.getAttribute('aria-busy') === 'false'
          && trigger?.querySelector('.wq12jW_triggerEffort')?.textContent === expectedLabel
          && trigger.getAttribute('aria-label')?.endsWith(expectedLabel)
      }, label)
      assert(await page.locator('.dshe-level').textContent() === label, 'heading and native label disagree')
      assert(await slider.getAttribute('aria-valuetext') === label, 'slider accessibility name is mixed')
      const next = await page.locator('.wq12jW_trigger').boundingBox()
      for (const coordinate of ['x', 'y', 'width', 'height'])
        assert(Math.abs(next[coordinate] - bounds[coordinate]) < .5, 'localized trigger shifted')
    }
    assert(await page.evaluate(() => review.modelState.getSnapshot().current.reasoningEffort) === 'max', 'localization changed selection ID')
    assert(await page.evaluate(() => review.modelState.getSnapshot().groups[0].models[0].reasoning.efforts.at(-1).name) === 'Max', 'provider catalog was mutated')
    await slider.press('Escape')
    await page.evaluate(() => {
      window.retainedEffortButton = document.querySelector('.wq12jW_trigger')
      review.dispose()
    })
    assert(await page.evaluate(() => retainedEffortButton.querySelector('.wq12jW_triggerEffort').textContent) === 'Max', 'unload did not restore native label')
    results.push({ language, labels: expected, triggerWidth: bounds.width, movement: 0 })
  }
  assert(errors.length === 0, errors.join('; '))
  return { results, errors }
}
