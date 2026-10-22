/**
 * Inline composer status.
 *
 * The host renders the context-occupancy ring and the session stat pills in a
 * dock row after the composer card (`[data-composer-dock]`). That row adds
 * vertical height, so the card sits above the window bottom instead of on it.
 *
 * This feature keeps the host widgets — including their tooltips, dialogs and
 * live values — and overlays them, icon-only, on the composer's own control
 * row: two stat icon buttons and the ring sit directly before the model seat,
 * and the dock no longer contributes layout height.
 *
 * It never moves React-owned nodes. Only own data attributes, CSS custom
 * properties and one stylesheet are written; all of it is restored on unload.
 */
__DSH_FEATURE('dsh-composer-status', function () {
  /** Dock row after the composer card. */
  const DOCK_SELECTOR = '[data-composer-dock]'
  /** Composer card that owns the control row. */
  const CARD_SELECTOR = '[data-composer-card]'

  /** Own marker attributes; host React never writes or removes them. */
  const ROOT_ATTR = 'data-dshcs-root'
  const DOCK_ATTR = 'data-dshcs-dock'
  const RING_ATTR = 'data-dshcs-ring'
  const PILLS_ATTR = 'data-dshcs-pills'
  const ACTIVITY_ATTR = 'data-dshcs-activity'
  const POPUP_ATTR = 'data-dshcs-popup'
  /**
   * Host "Performance & usage" preference (`ui-chat` setting). Compact renders
   * only plain-text speed/cache readings, so this feature's icon-only pills
   * would carry no information; the marker hides them instead.
   */
  const PERFORMANCE_ATTR = 'data-dshcs-performance'

  /** Host settings namespace that owns the performance-and-usage preference. */
  const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

  /** Gap between the three status buttons in the control row. */
  const GAP = 4
  /** Gap between the context ring and the model seat. */
  const RING_GAP = 4
  /** Viewport margin kept by the centered detail panels. */
  const PANEL_MARGIN = 12
  /**
   * Vertical placement deadband. Reaching the conversation tail settles the
   * sticky composer by about a pixel, and re-centering these icons for that
   * pixel reads as a shake; real row/card layout changes are far larger.
   */
  const VERTICAL_DEADBAND = 2

  const CSS = `
    [${ROOT_ATTR}]{position:relative;}
    [${DOCK_ATTR}]{position:absolute;box-sizing:border-box;left:var(--dshcs-left,0px);top:var(--dshcs-top,0px);width:var(--dshcs-width,0px);height:var(--dshcs-height,0px);max-width:none;margin:0;padding:0;justify-content:flex-end;align-items:center;gap:${GAP}px;pointer-events:none;z-index:2;display:flex;overflow:visible;}
    [${DOCK_ATTR}][${ACTIVITY_ATTR}]{display:none;}
    [${DOCK_ATTR}]*{box-sizing:border-box;}
    [${DOCK_ATTR}]>*{pointer-events:auto;flex:none;}
    [${DOCK_ATTR}] [data-composer-stat]{margin:0;flex:none;pointer-events:auto;}
    [${DOCK_ATTR}][${PILLS_ATTR}=hidden] [data-composer-stat]{display:none;}
    /* Compact mode only carries plain-text readings in the Host pills, which
       this icon-only row hides; drop the two stat buttons rather than leave
       two meaningless glyphs. Detailed mode keeps them. */
    html[${PERFORMANCE_ATTR}=compact] [${DOCK_ATTR}] [data-composer-stat]{display:none;}
    /* One 28px hover circle for every composer status icon: the Host ring and
       the two stat pills share the history trigger's surface size. */
    [${DOCK_ATTR}] [data-composer-stat] [class$="_pill"]{justify-content:center;gap:0;padding:6px;border-radius:999px;corner-shape:round;}
    [${DOCK_ATTR}] [data-composer-stat] svg{width:16px;height:16px;}
    [${DOCK_ATTR}] [data-composer-stat] [class$="_label"]{display:none;}
    [${DOCK_ATTR}]>[${RING_ATTR}]{position:relative;flex:none;pointer-events:auto;margin-right:var(--dshcs-ring-right,0px);}
    [${DOCK_ATTR}]>[${RING_ATTR}]>button{padding:6px;gap:0;border-radius:999px;corner-shape:round;}
    [${DOCK_ATTR}]>[${RING_ATTR}]>button>span{display:none;}
    [${DOCK_ATTR}]>[${RING_ATTR}]>button>svg{width:16px;height:16px;}
    [data-dshcs-popup]{left:var(--dshcs-popup-left) !important;}
  `

  /** @param {number} value - raw px. @returns {number} rounded px. */
  function px(value) {
    return Math.round(value * 100) / 100
  }

  /**
   * Keep the previous applied px value when the new measurement only moved by
   * less than the deadband. Sub-pixel/one-pixel seat settling would otherwise
   * visibly re-center the three icons on every tail transition.
   * @param {number|undefined} previous - last applied value.
   * @param {number} next - freshly measured value.
   * @param {number} deadband - ignore differences smaller than this.
   * @returns {number} value to apply.
   */
  function keepPlacement(previous, next, deadband) {
    if (previous === undefined || deadband <= 0) return next
    return Math.abs(previous - next) < deadband ? previous : next
  }

  /**
   * Read one element rect.
   * @param {Element|null} node - element to measure.
   * @returns {{left:number,right:number,top:number,bottom:number,width:number,height:number}|null} rect.
   */
  function rectOf(node) {
    if (node === null) return null
    const rect = node.getBoundingClientRect()
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    }
  }

  /**
   * Whether an element is a layout-neutral slot outlet (`display: contents`).
   * Its children are the real flex items of the surrounding container.
   * @param {Element} node - dock direct child.
   * @returns {boolean} true for layout-neutral wrappers.
   */
  function isSlotOutlet(node) {
    if (node.style !== undefined && node.style !== null && node.style.display === 'contents') return true
    if (typeof getComputedStyle !== 'function') return false
    return getComputedStyle(node).display === 'contents'
  }

  /**
   * Split the dock's children into the two host surfaces. Slot contributions are
   * wrapped in a `display: contents` outlet, so pills are looked up by their own
   * marker rather than by direct parenthood.
   * @param {Element} dock - composer dock row.
   * @returns {{children: Element[], pills: Element[], ring: Element|null}} parts.
   */
  function splitDock(dock) {
    const children = Array.from(dock.children).filter((child) => !isSlotOutlet(child))
    const pills = Array.from(dock.querySelectorAll('[data-composer-stat]'))
    const ring =
      children.find(
        (child) =>
          !child.hasAttribute('data-composer-stat') &&
          child.querySelector('button[aria-haspopup="dialog"] svg circle') !== null,
      ) ??
      children.find((child) => !child.hasAttribute('data-composer-stat')) ??
      null
    return { children, pills, ring }
  }

  /**
   * Plan the inline dock geometry. Pure so the package check can exercise every
   * fit branch without a browser.
   * @param {object} input - measured rects and widths.
   * @param {object} input.root - composer root rect.
   * @param {object} input.row - composer control row rect.
   * @param {object} input.tools - left tools group rect.
   * @param {object} input.model - model seat rect.
   * @param {number} input.ringWidth - rendered context-ring control width.
   * @param {number} input.pillsWidth - the two icon buttons.
   * @returns {{left:number,top:number,width:number,height:number,ringRight:number,pills:string}} dock plan.
   */
  function planStatusLayout({ root, row, tools, model, ringWidth, pillsWidth }) {
    const ringLeft = model.left - RING_GAP - ringWidth
    // The icon pair must stay between the left tools group and the ring.
    const pillsRoom = ringLeft - GAP - (tools.right + GAP)
    // A wrapped control row has no single line to align to; keep the ring but
    // never float stat buttons over the wrong line.
    const sameLine = tools.top < model.bottom - 1 && model.top < tools.bottom - 1
    return {
      left: px(row.left - root.left),
      top: px(model.top - root.top),
      width: px(row.width),
      height: px(model.height),
      ringRight: px(row.right - (model.left - RING_GAP)),
      pills: sameLine && pillsWidth <= pillsRoom ? 'icon' : 'hidden',
    }
  }

  /**
   * Whether one node is a popup panel opened from the composer status buttons.
   * Stat and context dialogs are portaled `role="dialog"` panels.
   * @param {Node} node - added body node.
   * @returns {boolean} true for a composer status popup.
   */
  function isPopupPanel(node) {
    if (node.nodeType !== Node.ELEMENT_NODE) return false
    if (!node.matches('[role="dialog"]')) return false
    return /(^|\s)[\w-]+_panel(\s|$)/.test(node.className)
  }

  /**
   * Horizontal position that centers a panel over the button that opened it,
   * clamped to the viewport. Pure so the package check can exercise the clamps.
   * @param {object} input - measurements.
   * @param {number} input.anchorLeft - left edge of the owning status button.
   * @param {number} input.anchorWidth - width of the owning status button.
   * @param {number} input.panelWidth - panel width.
   * @param {number} input.viewportWidth - document client width.
   * @returns {number} panel left in px.
   */
  function centeredPanelLeft({ anchorLeft, anchorWidth, panelWidth, viewportWidth }) {
    const max = Math.max(PANEL_MARGIN, viewportWidth - panelWidth - PANEL_MARGIN)
    const centered = anchorLeft + anchorWidth / 2 - panelWidth / 2
    return px(Math.max(PANEL_MARGIN, Math.min(centered, max)))
  }

  /**
   * Find the model seat behind the composer control row.
   * @param {Element} card - composer card.
   * @returns {Element|null} seat wrapper containing the native trigger.
   */
  function findModelSeat(card) {
    const trigger = Array.from(card.querySelectorAll('button[aria-haspopup]')).find(
      (node) => node.querySelector('[data-provider-id][data-model-id]') !== null,
    )
    if (trigger === undefined) return null
    return trigger.parentElement ?? trigger
  }

  /**
   * Resolve the composer parts around one dock.
   * @param {Element} dock - dock row.
   * @returns {object|null} measured parts, or null while the host is incomplete.
   */
  function composerParts(dock) {
    const root = dock.parentElement
    if (root === null) return null
    const card = root.querySelector(':scope > ' + CARD_SELECTOR)
    if (card === null) return null
    const model = findModelSeat(card)
    if (model === null) return null
    let row = model
    while (row.parentElement !== null && row.parentElement !== card) row = row.parentElement
    if (row.parentElement !== card) return null
    const tools = row.children[0] ?? null
    const trailing = row.children[1] ?? null
    if (tools === null || trailing === null) return null
    return { root, card, model, row, tools, trailing }
  }

  /**
   * Whether the host hides the control row in favor of the activity surface.
   * @param {object} parts - composer parts.
   * @returns {boolean} true while the activity surface replaces the row.
   */
  function inActivity(parts) {
    if (parts.tools.hidden === true) return true
    return parts.trailing.firstElementChild?.hidden === true
  }

  /**
   * Sum the horizontal footprint of a set of pill anchors.
   * @param {Element[]} pills - stat anchors.
   * @param {number} gap - flex gap.
   * @returns {number} width in px.
   */
  function pillsWidth(pills, gap) {
    if (pills.length === 0) return 0
    const widths = pills.map((pill) => pill.getBoundingClientRect().width)
    return widths.reduce((sum, width) => sum + width, 0) + Math.max(0, pills.length - 1) * gap
  }

  /**
   * Clear every marker this feature wrote to one dock's composer.
   * @param {Element} dock - dock row.
   */
  function clearDock(dock) {
    const root = dock.parentElement
    if (root !== null) root.removeAttribute(ROOT_ATTR)
    dock.removeAttribute(DOCK_ATTR)
    dock.removeAttribute(ACTIVITY_ATTR)
    dock.removeAttribute(PILLS_ATTR)
    for (const name of [
      '--dshcs-left',
      '--dshcs-top',
      '--dshcs-width',
      '--dshcs-height',
      '--dshcs-ring-right',
    ])
      dock.style.removeProperty(name)
    for (const ring of Array.from(dock.querySelectorAll('[' + RING_ATTR + ']')))
      ring.removeAttribute(RING_ATTR)
  }

  /**
   * Install the inline layout for every composer currently on screen.
   * @returns {Function} cleanup.
   */
  function install() {
    /** @type {Map<Element, object>} per-dock applied values. */
    const states = new Map()
    /** @type {Map<Element, object>} open detail panels keyed by their portaled node. */
    const popups = new Map()
    const observed = new Set()
    const resize = new ResizeObserver(() => schedule())
    let frame = null
    let disposed = false

    /** Throttle reconciliation to one animation frame. */
    function schedule() {
      if (disposed || frame !== null) return
      frame = requestAnimationFrame(() => {
        frame = null
        if (!disposed) reconcile()
      })
    }

    /**
     * Stop tracking one popup panel.
     * @param {Element} panel - portaled dialog panel.
     */
    function dropPopup(panel) {
      if (!popups.has(panel)) return
      popups.delete(panel)
      panel.removeAttribute(POPUP_ATTR)
      panel.style.removeProperty('--dshcs-popup-left')
    }

    /**
     * Center one open panel over the status button that opened it, clamped to
     * the viewport. The Host anchors it to the small icon button, so the panel
     * follows the clicked button instead of the whole composer card.
     * @param {Element} panel - portaled dialog panel.
     */
    function centerPopup(panel) {
      const dock = popups.get(panel)
      if (dock === undefined) return
      if (!panel.isConnected || !dock.isConnected || dock.parentElement === null) {
        dropPopup(panel)
        return
      }
      // The Host writes `aria-expanded="true"` on the control that owns the
      // open panel; both the stat pills and the ring use their own button.
      const anchor = dock.querySelector('button[aria-expanded="true"]')
      if (anchor === null || anchor === undefined || panel.offsetWidth === 0) return
      const anchorRect = anchor.getBoundingClientRect()
      if (anchorRect.width <= 0) return
      const left = centeredPanelLeft({
        anchorLeft: anchorRect.left,
        anchorWidth: anchorRect.width,
        panelWidth: panel.offsetWidth,
        viewportWidth: document.documentElement.clientWidth,
      })
      const current = parseFloat(panel.style.getPropertyValue('--dshcs-popup-left'))
      if (Math.abs(current - left) <= 0.5) return
      panel.style.setProperty('--dshcs-popup-left', left + 'px')
    }

    /** Center every open panel after a layout change. */
    function centerPopups() {
      for (const panel of Array.from(popups.keys())) centerPopup(panel)
    }

    /**
     * Track one popup opened from an expanded composer status button.
     * @param {Element} panel - portaled dialog panel.
     */
    function registerPopup(panel) {
      if (popups.has(panel)) return
      for (const dock of document.querySelectorAll(DOCK_SELECTOR)) {
        if (dock.querySelector('button[aria-expanded="true"]') === null) continue
        popups.set(panel, dock)
        panel.setAttribute(POPUP_ATTR, '')
        panel.style.setProperty('--dshcs-popup-left', '0px')
        schedule()
        return
      }
    }

    /** Release every panel this feature moved. */
    function releasePopups() {
      for (const panel of Array.from(popups.keys())) dropPopup(panel)
    }

    /**
     * Observed geometry for the next resize notifications.
     * @param {Element[]} nodes - composer nodes to watch.
     */
    function watch(nodes) {
      const next = new Set(nodes)
      for (const node of observed) {
        if (next.has(node)) continue
        resize.unobserve(node)
        observed.delete(node)
      }
      for (const node of next) {
        if (observed.has(node) || !node.isConnected) continue
        resize.observe(node)
        observed.add(node)
      }
    }

    /**
     * Write one CSS custom property only when it changed.
     * @param {Element} dock - dock row.
     * @param {object} state - per-dock applied values.
     * @param {string} name - property name.
     * @param {number} value - px value.
     * @param {number} [deadband] - keep the previous value for smaller moves.
     */
    function write(dock, state, name, value, deadband = 0) {
      const next = keepPlacement(state[name], value, deadband)
      if (state[name] === next) return
      dock.style.setProperty(name, next + 'px')
      state[name] = next
    }


    /**
     * Apply the plan to one dock.
     * @param {Element} dock - dock row.
     * @returns {Element[]} nodes whose geometry governs the plan.
     */
    function syncDock(dock) {
      const parts = composerParts(dock)
      if (parts === null) {
        clearDock(dock)
        states.delete(dock)
        return []
      }
      const state = states.get(dock) ?? {}
      states.set(dock, state)
      parts.root.setAttribute(ROOT_ATTR, '')
      dock.setAttribute(DOCK_ATTR, '')
      if (inActivity(parts)) {
        if (!dock.hasAttribute(ACTIVITY_ATTR)) dock.setAttribute(ACTIVITY_ATTR, '')
        return [parts.root, parts.card, parts.row, parts.model, parts.tools]
      }
      if (dock.hasAttribute(ACTIVITY_ATTR)) dock.removeAttribute(ACTIVITY_ATTR)

      const { pills, ring } = splitDock(dock)
      if (ring !== null && !ring.hasAttribute(RING_ATTR)) ring.setAttribute(RING_ATTR, '')
      const rootRect = rectOf(parts.root)
      const rowRect = rectOf(parts.row)
      const toolsRect = rectOf(parts.tools)
      const modelRect = rectOf(parts.model) ?? rectOf(parts.card)
      const ringRect = rectOf(ring)
      if (rootRect === null || rowRect === null || toolsRect === null || modelRect === null) {
        clearDock(dock)
        return []
      }
      const gap = parseFloat(getComputedStyle(dock).columnGap) || GAP
      const plan = planStatusLayout({
        root: rootRect,
        row: rowRect,
        tools: toolsRect,
        model: modelRect,
        ringWidth: ringRect?.width ?? 0,
        pillsWidth: pillsWidth(pills, gap),
      })
      if (plan.pills === 'hidden') {
        if (dock.getAttribute(PILLS_ATTR) !== 'hidden') dock.setAttribute(PILLS_ATTR, 'hidden')
      } else if (dock.hasAttribute(PILLS_ATTR)) {
        dock.removeAttribute(PILLS_ATTR)
      }
      write(dock, state, '--dshcs-left', plan.left)
      write(dock, state, '--dshcs-top', plan.top, VERTICAL_DEADBAND)
      write(dock, state, '--dshcs-width', plan.width)
      write(dock, state, '--dshcs-height', plan.height, VERTICAL_DEADBAND)
      write(dock, state, '--dshcs-ring-right', plan.ringRight)
      return [
        parts.root,
        parts.card,
        parts.row,
        parts.tools,
        parts.model,
        ...(ring === null ? [] : [ring]),
        ...pills,
      ]
    }

    /** Re-read every composer and refresh the observed geometry. */
    function reconcile() {
      const docks = Array.from(document.querySelectorAll(DOCK_SELECTOR))
      const live = new Set(docks)
      for (const [dock] of states) {
        if (!live.has(dock)) {
          clearDock(dock)
          states.delete(dock)
        }
      }
      const nodes = []
      for (const dock of docks) nodes.push(...syncDock(dock))
      centerPopups()
      for (const panel of popups.keys()) nodes.push(panel)
      watch(nodes)
    }

    /**
     * Whether one added or removed node carries a composer.
     * @param {Node} node - added or removed node.
     * @returns {boolean} true when it matches or contains a composer surface.
     */
    function touchesComposer(node) {
      if (node.nodeType !== Node.ELEMENT_NODE) return false
      if (node.matches(DOCK_SELECTOR) || node.matches(CARD_SELECTOR)) return true
      return node.querySelector(DOCK_SELECTOR) !== null || node.querySelector(CARD_SELECTOR) !== null
    }

    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type !== 'childList') continue
        for (const node of record.addedNodes) {
          if (isPopupPanel(node)) {
            registerPopup(node)
            continue
          }
          if (touchesComposer(node)) {
            schedule()
            return
          }
        }
        for (const node of record.removedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE && popups.has(node)) {
            dropPopup(node)
            continue
          }
          if (touchesComposer(node)) {
            schedule()
            return
          }
        }
        const target = record.target
        if (
          target instanceof Element &&
          (target.closest(CARD_SELECTOR) !== null || target.closest(DOCK_SELECTOR) !== null)
        ) {
          schedule()
          return
        }
      }
    })

    const onResize = () => {
      schedule()
    }
    const onScroll = () => {
      if (popups.size > 0) schedule()
    }
    mutations.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', onResize)
    window.visualViewport?.addEventListener('resize', onResize)
    window.addEventListener('scroll', onScroll, true)
    document.fonts?.ready.then(schedule).catch(() => {})
    reconcile()

    return () => {
      disposed = true
      if (frame !== null) cancelAnimationFrame(frame)
      mutations.disconnect()
      resize.disconnect()
      releasePopups()
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
      for (const dock of Array.from(document.querySelectorAll(DOCK_SELECTOR))) clearDock(dock)
      for (const [dock] of states) clearDock(dock)
      states.clear()
      observed.clear()
    }
  }

  /**
   * Bind the two stat buttons to the Host "Performance & usage" preference.
   * Compact mode renders only plain-text readings in the Host pills, which this
   * icon-only row hides, so the buttons are dropped instead of showing glyphs
   * without content. The Host settings form is optional: when it is missing the
   * pills keep their default (detailed) visibility.
   * @param {object|undefined} form - Host `ui-chat` config form.
   * @param {object} root - document element that carries the marker.
   * @returns {Function} cleanup that drops the marker.
   */
  function bindPerformanceUsage(form, root) {
    if (form?.subscribe === undefined) return () => {}
    const read = () => {
      const mode = form.getSnapshot?.()?.value?.performanceUsage
      if (mode === 'compact') root.setAttribute(PERFORMANCE_ATTR, 'compact')
      else root.removeAttribute(PERFORMANCE_ATTR)
    }
    read()
    const unsubscribe = form.subscribe(read)
    return () => {
      unsubscribe?.()
      root.removeAttribute(PERFORMANCE_ATTR)
    }
  }

  function apply(ctx) {
    ctx.effect(() => {
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-composer-status'
      style.textContent = CSS
      document.head.append(style)
      return () => style.remove()
    }, 'composer-status: styles')
    ctx.effect(() => install(), 'composer-status: inline dock')
    // Follow the Host preference that decides how much performance/usage detail
    // the composer carries; without the settings service the pills default to
    // detailed visibility.
    ctx.effect(() => {
      let form
      try {
        form =
          typeof ctx.get === 'function'
            ? ctx.get('configForms')?.get?.(CHAT_SETTINGS_NAMESPACE)
            : undefined
      } catch {
        form = undefined
      }
      return bindPerformanceUsage(form, document.documentElement)
    }, 'composer-status: performance usage')
  }

  return {
    apply,
    __test: {
      planStatusLayout,
      centeredPanelLeft,
      splitDock,
      isPopupPanel,
      keepPlacement,
      bindPerformanceUsage,
      VERTICAL_DEADBAND,
      PERFORMANCE_ATTR,
      RING_GAP,
      GAP,
    },
  }
})
