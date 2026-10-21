;async (page) => {
  const results = []
  const errors = []
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  assert(new URL(page.url()).hostname === '127.0.0.1', 'verification requires the private loopback fixture')
  assert(await page.evaluate(() => window.__CODEX_WORKBENCH_UI_FIXTURE__ === true), 'verification requires the owned UI fixture')
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear() })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  const check = async (name, run) => {
    await run()
    results.push(name)
  }
  await page.reload()
  await page.locator('[data-composer-card]').waitFor()
  await check('caption controls follow back, forward, sidebar and menu on one axis', async () => {
    const positions = await page.evaluate(() => {
      const nodes = [
        ...document.querySelectorAll('.dshnb-nav button'),
        document.querySelector('aside button[class*="_toggle"]'),
        document.querySelector('.fixture-caption'),
      ]
      return nodes.map((node) => {
        const box = node.getBoundingClientRect()
        return { x: box.x, center: box.y + box.height / 2, width: box.width, height: box.height }
      })
    })
    assert(positions.map((box) => box.x).join(',') === '12,46,80,116', 'caption order or spacing')
    assert(
      positions.every((box) => box.center === 20),
      'caption vertical alignment',
    )
    assert(
      positions.slice(0, 3).every((box) => box.width === 28 && box.height === 28),
      'caption control size',
    )
  })
  await check('hero geometry and shared control metrics', async () => {
    const metrics = await page.evaluate(() => {
      const rect = (selector) => {
        const box = document.querySelector(selector).getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height }
      }
      return {
        main: rect('main'),
        card: rect('[data-composer-card]'),
        rail: rect('.dshlr-rail'),
        buttons: [...document.querySelectorAll('[data-dshlr-button]')].map((node) => ({
          width: node.offsetWidth,
          height: node.offsetHeight,
        })),
        height: innerHeight,
      }
    })
    assert(
      Math.abs(metrics.main.x + metrics.main.width / 2 - metrics.card.x - metrics.card.width / 2) <=
        1,
      'composer is off center',
    )
    assert(metrics.height - metrics.card.y - metrics.card.height === 16, 'composer bottom spacing')
    assert(metrics.rail.width === 52 && metrics.rail.y === 40, 'rail overlaps window chrome')
    assert(
      metrics.buttons.length === 4 &&
        metrics.buttons.every((box) => box.width === 36 && box.height === 36),
      'rail buttons have unequal sizes',
    )
    await page.screenshot({ path: 'output/playwright/ui-hero-light.png' })
  })
  await check('navigation glyphs retain their geometry while the active paint changes', async () => {
    for (const [name, file] of [
      ['chat', 'conversation'],
      ['automation', 'automation'],
      ['plugins', 'plugins'],
    ]) {
      const button = page.locator('[data-dshlr-button="' + name + '"]')
      const before = await button
        .locator('svg')
        .evaluate((node) =>
          [...node.querySelectorAll('path')].map((path) => path.getAttribute('d')),
        )
      await button.click()
      assert((await button.locator('[data-active="true"]').count()) === 1, 'active glyph state')
      const after = await button
        .locator('svg')
        .evaluate((node) =>
          [...node.querySelectorAll('path')].map((path) => path.getAttribute('d')),
        )
      assert(
        JSON.stringify(before) === JSON.stringify(after),
        'activation replaced navigation SVG geometry',
      )
      await page.screenshot({ path: 'output/playwright/ui-icons-' + file + '.png', clip: { x: 0, y: 40, width: 52, height: 152 } })
    }
    await page.locator('[data-dshlr-button="chat"]').click()
  })
  await check('native image deletion releases the draft resource', async () => {
    await page.evaluate(() => review.image())
    await page.getByRole('button', { name: 'image.remove', exact: true }).click()
    const state = await page.evaluate(() => ({
      ids: review.shell.snapshot.attachmentIds.length,
      files: review.drafts.size,
      released: review.released.length,
    }))
    assert(
      state.ids === 0 && state.files === 0 && state.released === 1,
      'image removal left a draft or preview URL behind',
    )
  })
  await check('native settings opens once at its actual rail anchor', async () => {
    await page.locator('[data-dshlr-button="settings"]').click()
    await page.getByRole('menuitem', { name: '设置', exact: true }).waitFor()
    const rect = await page.getByRole('menu').boundingBox()
    assert(rect.x >= 8 && rect.x < 60 && rect.y < 850, 'settings menu lost its rail anchor')
    await page.keyboard.press('Escape')
    assert((await page.getByRole('menu').count()) === 0, 'settings menu did not close')
  })
  await check('display preferences support keyboard opening and dismissal', async () => {
    const brand = page.locator('aside').getByRole('button', { name: '工作模式', exact: true })
    await brand.focus()
    await page.keyboard.press('ArrowDown')
    await page.getByRole('menuitem', { name: /^Work/ }).waitFor()
    assert((await brand.getAttribute('aria-expanded')) === 'true', 'display preferences ARIA state')
    await page.keyboard.press('Escape')
    assert((await brand.getAttribute('aria-expanded')) === 'false', 'display menu did not close')
  })
  await check('dark theme and narrow viewport remain inside the content column', async () => {
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    await page.screenshot({ path: 'output/playwright/ui-hero-dark.png' })
    await page.evaluate(() => {
      document.body.removeAttribute('data-ds-dark-theme')
      review.mode.set({ screen: 'hero', collapsed: true })
    })
    await page.setViewportSize({ width: 720, height: 640 })
    const fits = await page.evaluate(() => {
      const card = document.querySelector('[data-composer-card]').getBoundingClientRect()
      return (
        card.left >= 52 &&
        card.right <= innerWidth &&
        document.documentElement.scrollWidth <= innerWidth
      )
    })
    assert(fits, 'composer overflows a narrow window')
    await page.screenshot({ path: 'output/playwright/ui-narrow.png' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => review.mode.set({ screen: 'hero', collapsed: false }))
  })
  await check(
    'settings uses the native switch and preserves accessible tab navigation',
    async () => {
      await page.locator('[data-dshlr-button="settings"]').click()
      await page.getByRole('menuitem', { name: '设置', exact: true }).click()
      const tabs = page.getByRole('tab')
      assert((await tabs.count()) === 5, 'missing task-group tabs')
      await tabs.first().focus()
      await page.keyboard.press('ArrowRight')
      assert(
        (await tabs.nth(1).getAttribute('aria-selected')) === 'true',
        'tab keyboard navigation',
      )
      const toggle = page.getByRole('switch').first()
      await toggle.click()
      assert(
        (await toggle.getAttribute('aria-checked')) === 'false',
        'native switch did not persist disabled preference',
      )
      await toggle.click()
      await page.screenshot({ path: 'output/playwright/ui-settings.png' })
    },
  )
  await check('attachment-only queue editor uses the host modal and Escape', async () => {
    await page.evaluate(() => {
      review.show('active')
      review.inbox.set({
        'next-turn': [
          {
            id: 'queued-image',
            source: { kind: 'user' },
            content: [
              {
                type: 'image',
                attachment: {
                  attachmentId: 'image-one',
                  mediaType: 'image/png',
                  name: 'fixture.png',
                },
              },
            ],
          },
        ],
        'next-step': [],
      })
    })
    await page.getByRole('button', { name: '编辑排队消息', exact: true }).click()
    await page.getByRole('dialog').waitFor()
    assert((await page.locator('.dshqw-editorText').count()) === 1, 'dialog text field')
    await page.screenshot({ path: 'output/playwright/ui-queue-editor.png' })
    await page.keyboard.press('Escape')
    assert((await page.getByRole('dialog').count()) === 0, 'queue modal did not close')
  })
  await check('holding an attachment row converges without a mutation-observer loop', async () => {
    await page.locator('[data-dshq-freeze]').click()
    await page.locator('.dshqw-locked-row').waitFor()
    const unchanged = await page.evaluate(async () => {
      let count = 0
      const observer = new MutationObserver((events) => {
        count += events.length
      })
      observer.observe(document.querySelector('[data-queue-dock]'), {
        attributes: true,
        subtree: true,
        attributeFilter: ['disabled'],
      })
      const frame = () =>
        new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      await frame()
      const initial = count
      await frame()
      observer.disconnect()
      return count === initial
    })
    assert(unchanged, 'held attachment row kept mutating disabled state')
    await page.locator('[data-dshq-freeze]').click()
  })
  await check(
    'selection actions connect independent composer and side-panel providers',
    async () => {
      const selectPassage = () =>
        page.locator('.fixture-transcript').evaluate((node) => {
          const range = document.createRange()
          range.selectNodeContents(node)
          const selection = window.getSelection()
          selection.removeAllRanges()
          selection.addRange(range)
          document.dispatchEvent(new Event('selectionchange'))
        })
      await selectPassage()
      const toolbar = page.getByRole('toolbar', { name: '选中文字操作' })
      await toolbar.waitFor()
      assert(
        (await toolbar.getByRole('button').count()) === 2,
        'missing independently registered selection action',
      )
      await toolbar.getByRole('button', { name: '把选中内容作为引用加入当前消息' }).click()
      await page.locator('.dshqf-annotation').waitFor()
      await selectPassage()
      await toolbar.getByRole('button', { name: '用选中内容打开临时侧聊' }).click()
      const input = page.locator('.dshqf-input')
      await input.waitFor()
      await input.fill('解释这段内容')
      await page.locator('.dshqf-send').click()
      await page.waitForFunction(() => document.querySelector('.dshqf-input').value === '')
      const parentQuotes = await page.evaluate(
        () => JSON.parse(localStorage.getItem('dsh.quickFork.annotations')).s1,
      )
      assert(parentQuotes.length === 1, 'side chat consumed the parent composer quotes')
      await page.evaluate(() => review.closeFork())
    },
  )
  await check('IME Enter does not submit, and a late reply preserves the next draft', async () => {
    await page.evaluate(() => {
      review.fork('send-race')
      window.reviewSent = 0
      review.control.prompt = () => {
        window.reviewSent++
        return new Promise((resolve) => {
          window.reviewCompletePrompt = resolve
        })
      }
    })
    const input = page.locator('.dshqf-input')
    await input.waitFor()
    await input.fill('第一条')
    await input.dispatchEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      isComposing: true,
      keyCode: 229,
    })
    assert((await page.evaluate(() => window.reviewSent)) === 0, 'IME Enter sent a prompt')
    await page.locator('.dshqf-send').click()
    await input.fill('下一条草稿')
    await page.evaluate(() => window.reviewCompletePrompt({ ok: true }))
    await page.waitForFunction(() => !document.querySelector('.dshqf-send').disabled)
    assert(
      (await input.inputValue()) === '下一条草稿',
      'late send acknowledgement erased the next draft',
    )
  })
  await check('a child created after its panel closes is archived', async () => {
    await page.evaluate(() => {
      review.show('hero')
      review.control.create = () =>
        new Promise((resolve) => {
          window.reviewCompleteChild = resolve
        })
    })
    await page.evaluate(() => review.fork('cancel-create'))
    await page.waitForFunction(() => typeof window.reviewCompleteChild === 'function')
    await page.evaluate(() => {
      review.show('hero')
    })
    await page.locator('.dshqf-panel').waitFor({ state: 'detached' })
    await page.evaluate(() => window.reviewCompleteChild('late-child'))
    await page.waitForFunction(() => review.archived.includes('late-child'))
  })
  await check('closing a retained session during opening never unarchives it again', async () => {
    await page.evaluate(() => {
      review.control.create = async () => 'retained-child'
      review.control.binding = () => undefined
      review.control.retain = () => {
        let reject
        let released = false
        const ready = new Promise((_resolve, fail) => {
          reject = fail
        })
        window.reviewRetainStarted = true
        return {
          ready,
          release() {
            if (!released) {
              released = true
              reject(new Error('released'))
            }
          },
        }
      }
      review.fork('retained-opening')
    })
    await page.waitForFunction(() => window.reviewRetainStarted === true)
    await page.evaluate(() => review.closeFork())
    await page.locator('.dshqf-panel').waitFor({ state: 'detached' })
    assert(
      (await page.evaluate(() => review.unarchived.length)) === 0,
      'disposed opening unarchived the closed child',
    )
  })
  await check('reload does not expire subsequently created side chats', async () => {
    await page.evaluate(() => sessionStorage.setItem('dsh.quickFork.pageRun', 'legacy-page'))
    await page.reload()
    await page.locator('[data-composer-card]').waitFor()
    await page.evaluate(() => review.fork('after-reload'))
    await page.locator('.dshqf-empty').waitFor()
    assert(
      (await page.locator('.dshqf-errorText').count()) === 0,
      'new side chat was treated as expired',
    )
  })
  await check('unmount restores native host state and removes feature styles', async () => {
    await page.evaluate(() => review.dispose())
    const remaining = await page.evaluate(() => ({
      styles: document.querySelectorAll('style[data-dsh-plugin]').length,
      active: document.documentElement.hasAttribute('data-dshlr-active'),
    }))
    assert(
      remaining.styles === 0 && !remaining.active,
      'plugin cleanup left global presentation behind',
    )
  })
  assert(errors.length === 0, 'browser errors: ' + errors.join('; '))
  return { passed: results.length, checks: results, pageErrors: errors }
}
