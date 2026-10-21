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
      state.groups[0].models[0].name = 'DeepSeek V4.1 Flash'
      state.current = { provider: 'fixture', model: 'reasoner' }
      review.modelState.set(state)
    })
    const native = page.locator('.wq12jW_triggerEffort')
    const expected = language === 'zh' ? ['默认', '最大', '低', '中', '高'] : ['Default', 'Max', 'Low', 'Medium', 'High']
    await page.waitForFunction((text) => document.querySelector('.wq12jW_triggerEffort')?.textContent === text, expected[0])
    await page.waitForFunction(() => document.querySelector('.dshe-model-label')?.textContent === 'V4.1 Flash')
    assert(await page.evaluate(() => getComputedStyle(document.querySelector('.wq12jW_triggerLabel')).display === 'none'), 'host model label must be hidden while enhanced')
    assert(await page.evaluate(() => { const label = document.querySelector('.dshe-model-label'); return label.scrollWidth <= label.clientWidth + 1 }), 'shortened model label must not be ellipsized')
    await page.locator('.wq12jW_trigger').click()
    const slider = page.getByRole('slider', { name: language === 'zh' ? '推理强度' : 'Reasoning effort', exact: true })
    await slider.waitFor()
    assert(await page.locator('.dshe-modelCaption span').textContent() === 'DeepSeek V4.1 Flash', 'effort panel must show the full model name')
    assert(await page.locator('.dshe-modelCaption span').evaluate((node) => node.scrollWidth <= node.clientWidth + 1), 'effort panel must not clip the model name')
    const bounds = await page.locator('.wq12jW_trigger').boundingBox()
    for (const [index, key] of ['Home', 'End', 'Home', 'ArrowRight', 'ArrowRight', 'ArrowRight'].entries()) {
      await slider.press(key)
      const label = expected[[0, 1, 0, 2, 3, 4][index]]
      await page.waitForFunction((label) => {
        const trigger = document.querySelector('.wq12jW_trigger')
        return document.querySelector('.dshe-panel')?.getAttribute('aria-busy') === 'false'
          && trigger?.querySelector('.wq12jW_triggerEffort')?.textContent === label
          && trigger.getAttribute('aria-label')?.endsWith(label)
      }, label)
      assert(await page.locator('.dshe-level').textContent() === label, 'heading and native label disagree')
      assert(await slider.getAttribute('aria-valuetext') === label, 'slider accessibility name is mixed')
      const next = await page.locator('.wq12jW_trigger').boundingBox()
      for (const coordinate of ['x', 'y', 'width', 'height'])
        assert(Math.abs(next[coordinate] - bounds[coordinate]) < .5, 'localized trigger shifted')
    }
    assert(await page.evaluate(() => review.modelState.getSnapshot().current.reasoningEffort) === 'high', 'localization changed selection ID')
    assert(await page.evaluate(() => review.modelState.getSnapshot().groups[0].models[0].reasoning.efforts.at(-1).name) === 'Max', 'provider catalog was mutated')
    await slider.press('Escape')
    await page.evaluate(() => {
      window.retainedEffortButton = document.querySelector('.wq12jW_trigger')
      review.dispose()
    })
    assert(await page.evaluate(() => retainedEffortButton.querySelector('.wq12jW_triggerEffort').textContent) === 'High', 'unload did not restore native label')
    assert(await page.evaluate(() => retainedEffortButton.querySelector('.dshe-model-label') === null), 'compact label must be removed on unload')
    assert(await page.evaluate(() => retainedEffortButton.querySelector('.wq12jW_triggerLabel').textContent === 'DeepSeek V4.1 Flash'), 'unload did not restore the full model label')
    assert(await page.evaluate(() => getComputedStyle(retainedEffortButton.querySelector('.wq12jW_triggerLabel')).display !== 'none'), 'unload did not restore the host model label')
    results.push({ language, labels: expected, triggerWidth: bounds.width, movement: 0 })
  }
  assert(errors.length === 0, errors.join('; '))
  return { results, errors }
}
