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

  /** Gap between the three status buttons in the control row. */
  const GAP = 4
  /** Gap between the context ring and the model seat. */
  const RING_GAP = 4
  /** Viewport margin kept by the centered detail panels. */
  const PANEL_MARGIN = 12

  const CSS = `
    [${ROOT_ATTR}]{position:relative;}
    [${DOCK_ATTR}]{position:absolute;box-sizing:border-box;left:var(--dshcs-left,0px);top:var(--dshcs-top,0px);width:var(--dshcs-width,0px);height:var(--dshcs-height,0px);max-width:none;margin:0;padding:0;justify-content:flex-end;align-items:center;gap:${GAP}px;pointer-events:none;z-index:2;display:flex;overflow:visible;}
    [${DOCK_ATTR}][${ACTIVITY_ATTR}]{display:none;}
    [${DOCK_ATTR}]*{box-sizing:border-box;}
    [${DOCK_ATTR}]>*{pointer-events:auto;flex:none;}
    [${DOCK_ATTR}] [data-composer-stat]{margin:0;flex:none;display:none;pointer-events:auto;}
    [${DOCK_ATTR}][${PILLS_ATTR}=hidden] [data-composer-stat]{display:none;}
    [${DOCK_ATTR}] [data-composer-stat] [class$="_pill"]{justify-content:center;gap:0;padding:2px 4px;border-radius:999px;corner-shape:round;}
    [${DOCK_ATTR}] [data-composer-stat] svg{width:16px;height:16px;}
    [${DOCK_ATTR}] [data-composer-stat] [class$="_label"]{display:none;}
    [${DOCK_ATTR}]>[${RING_ATTR}]{position:relative;flex:none;pointer-events:auto;margin-right:var(--dshcs-ring-right,0px);}
    [${DOCK_ATTR}]>[${RING_ATTR}] button{padding:2px;gap:0;border-radius:999px;corner-shape:round;}
    [${DOCK_ATTR}]>[${RING_ATTR}] button>span{display:none;}
    [${DOCK_ATTR}]>[${RING_ATTR}] button svg{width:16px;height:16px;}
    [data-dshcs-popup]{left:var(--dshcs-popup-left) !important;}
    .dshcs-menu{position:absolute;right:0;bottom:calc(100% + 8px);z-index:6;display:flex;flex-direction:column;gap:2px;min-width:220px;max-width:min(360px,80vw);padding:4px;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);}
    .dshcs-menuItem{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:pointer;}
    .dshcs-menuItem:hover,.dshcs-menuItem:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none;}
    .dshcs-menuIcon{display:inline-flex;flex:none;width:16px;height:16px;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);}
    .dshcs-menuIcon svg{width:16px;height:16px;}
    .dshcs-menuText{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  `

  /** @param {number} value - raw px. @returns {number} rounded px. */
  function px(value) {
    return Math.round(value * 100) / 100
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
   * Horizontal position that centers a panel over the composer card without
   * leaving the viewport. Pure so the package check can exercise the clamps.
   * @param {object} input - measurements.
   * @param {number} input.cardLeft - composer card left edge.
   * @param {number} input.cardWidth - composer card width.
   * @param {number} input.panelWidth - panel width.
   * @param {number} input.viewportWidth - document client width.
   * @returns {number} panel left in px.
   */
  function centeredPanelLeft({ cardLeft, cardWidth, panelWidth, viewportWidth }) {
    const max = Math.max(PANEL_MARGIN, viewportWidth - panelWidth - PANEL_MARGIN)
    const centered = cardLeft + cardWidth / 2 - panelWidth / 2
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
    for (const menu of Array.from(dock.querySelectorAll?.('.dshcs-menu') ?? [])) menu.remove?.()
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
     * Center one open panel over its composer card. The host anchors it to the
     * small icon button; centering it on the card keeps the reading position
     * stable across the three buttons.
     * @param {Element} panel - portaled dialog panel.
     */
    function centerPopup(panel) {
      const dock = popups.get(panel)
      if (dock === undefined) return
      if (!panel.isConnected || !dock.isConnected || dock.parentElement === null) {
        dropPopup(panel)
        return
      }
      const card = dock.parentElement.querySelector(':scope > ' + CARD_SELECTOR)
      if (card === null || panel.offsetWidth === 0) return
      const cardRect = card.getBoundingClientRect()
      const left = centeredPanelLeft({
        cardLeft: cardRect.left,
        cardWidth: cardRect.width,
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
     */
    function write(dock, state, name, value) {
      const text = value + 'px'
      if (state[name] === text) return
      dock.style.setProperty(name, text)
      state[name] = text
    }

    /**
     * Close one dock's first-level status menu.
     * @param {object} state - per-dock applied values.
     */
    function closeMenu(state) {
      if (state.menu === undefined || state.menu === null) return
      state.menu.remove?.()
      state.menu = null
      const button = state.ringButton
      if (button !== null && button !== undefined && button.isConnected !== false)
        button.setAttribute('aria-expanded', 'false')
    }

    /** Close every open first-level status menu. */
    function closeMenus() {
      for (const state of states.values()) closeMenu(state)
    }

    /** @param {Element|null|undefined} node - host node. @returns {string} visible text. */
    function domText(node) {
      return typeof node?.textContent === 'string' ? node.textContent.trim() : ''
    }

    /** @param {Element|null|undefined} node - host control. @returns {string} icon markup. */
    function iconHtml(node) {
      const svg = node?.querySelector?.('svg')
      return svg === null || svg === undefined ? '' : svg.outerHTML
    }

    /**
     * Build the first-level menu: one row per hidden stat pill plus the context
     * ring itself. Each row carries the host icon and its live info; selecting a
     * row opens that panel (second level) by relaying to the host control.
     * @param {Element} dock - dock row.
     * @param {object} state - per-dock applied values.
     * @param {Element|null} ring - ring container.
     * @param {Element[]} pills - hidden stat anchors.
     */
    function openMenu(dock, state, ring, pills) {
      closeMenus()
      if (ring === null) return
      const ringButton =
        ring.querySelector?.('button[aria-haspopup="dialog"]') ?? ring.querySelector?.('button')
      if (ringButton === null || ringButton === undefined) return
      const menu = document.createElement('div')
      menu.className = 'dshcs-menu'
      menu.setAttribute('role', 'menu')
      const entries = []
      for (const pill of pills) {
        const button = pill.querySelector?.('button') ?? null
        if (button === null) continue
        const label = pill.querySelector?.('[class$="_label"]')
        const info = domText(label) || domText(pill) || (button.getAttribute?.('aria-label') ?? '')
        entries.push({ icon: iconHtml(pill), info, button, ring: false })
      }
      entries.push({
        icon: iconHtml(ringButton),
        info: domText(ringButton) || ringButton.getAttribute?.('aria-label') || '',
        button: ringButton,
        ring: true,
      })
      for (const entry of entries) {
        const item = document.createElement('button')
        item.type = 'button'
        item.className = 'dshcs-menuItem'
        item.setAttribute('role', 'menuitem')
        item.innerHTML =
          '<span class="dshcs-menuIcon">' +
          entry.icon +
          '</span><span class="dshcs-menuText"></span>'
        const text = item.querySelector?.('.dshcs-menuText') ?? null
        if (text !== null) text.textContent = entry.info
        item.addEventListener('click', (event) => {
          event.preventDefault?.()
          event.stopPropagation?.()
          closeMenu(state)
          if (entry.ring === true) {
            // Let the host ring control own its own dialog this once.
            state.bypassRing = true
            entry.button.click?.()
            return
          }
          entry.button.click?.()
        })
        menu.append(item)
      }
      ring.append(menu)
      state.menu = menu
      state.ringButton = ringButton
      if (ringButton.getAttribute?.('aria-haspopup') !== 'menu')
        ringButton.setAttribute('aria-haspopup', 'menu')
      ringButton.setAttribute('aria-expanded', 'true')
    }

    /**
     * Bind the single context control to the first-level menu.
     * @param {Element} dock - dock row.
     * @param {object} state - per-dock applied values.
     * @param {Element|null} ring - ring container.
     * @param {Element[]} pills - hidden stat anchors.
     */
    function bindStatusMenu(dock, state, ring, pills) {
      if (ring === null) return
      const button =
        ring.querySelector?.('button[aria-haspopup="dialog"]') ?? ring.querySelector?.('button')
      if (button === null || button === undefined) return
      if (state.ringButton === button) {
        if (button.getAttribute?.('aria-haspopup') !== 'menu')
          button.setAttribute('aria-haspopup', 'menu')
        if (button.getAttribute?.('aria-expanded') === null)
          button.setAttribute('aria-expanded', 'false')
        return
      }
      if (state.ringButton !== undefined && state.ringButton !== null && state.ringClick !== undefined)
        state.ringButton.removeEventListener?.('click', state.ringClick, true)
      state.ringButton = button
      state.ringClick = (event) => {
        if (state.bypassRing === true) {
          state.bypassRing = false
          return
        }
        event.preventDefault?.()
        event.stopImmediatePropagation?.()
        event.stopPropagation?.()
        if (state.menu !== undefined && state.menu !== null) closeMenu(state)
        else openMenu(dock, state, ring, pills)
      }
      button.addEventListener('click', state.ringClick, true)
      button.setAttribute('aria-haspopup', 'menu')
      button.setAttribute('aria-expanded', 'false')
    }

    /**
     * Release one dock's menu, listener and markers.
     * @param {Element} dock - dock row.
     */
    function disposeDock(dock) {
      const state = states.get(dock)
      if (state === undefined) return
      closeMenu(state)
      if (state.ringButton !== undefined && state.ringButton !== null && state.ringClick !== undefined)
        state.ringButton.removeEventListener?.('click', state.ringClick, true)
      delete state.ringButton
      delete state.ringClick
    }

    /**
     * Apply the plan to one dock.
     * @param {Element} dock - dock row.
     * @returns {Element[]} nodes whose geometry governs the plan.
     */
    function syncDock(dock) {
      const parts = composerParts(dock)
      if (parts === null) {
        disposeDock(dock)
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
      bindStatusMenu(dock, state, ring, pills)
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
      write(dock, state, '--dshcs-top', plan.top)
      write(dock, state, '--dshcs-width', plan.width)
      write(dock, state, '--dshcs-height', plan.height)
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
          disposeDock(dock)
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

    /** Close the first-level menu once focus/pointer leaves the control. */
    const onMenuPointerDown = (event) => {
      const target = event.target
      for (const [dock, state] of states) {
        if (state.menu === undefined || state.menu === null) continue
        if (state.menu.contains?.(target) === true) continue
        if (state.ringButton?.contains?.(target) === true) continue
        closeMenu(state)
      }
    }
    const onMenuKeyDown = (event) => {
      if (event.key === 'Escape') closeMenus()
    }
    const onResize = () => {
      closeMenus()
      schedule()
    }
    const onScroll = () => {
      if (document.querySelector('.dshcs-menu') !== null) closeMenus()
      if (popups.size > 0) schedule()
    }
    mutations.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('pointerdown', onMenuPointerDown, true)
    document.addEventListener('keydown', onMenuKeyDown, true)
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
      closeMenus()
      document.removeEventListener('pointerdown', onMenuPointerDown, true)
      document.removeEventListener('keydown', onMenuKeyDown, true)
      window.removeEventListener('resize', onResize)
      window.visualViewport?.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', onScroll, true)
      for (const dock of Array.from(document.querySelectorAll(DOCK_SELECTOR))) clearDock(dock)
      for (const dock of states.keys()) disposeDock(dock)
      for (const [dock] of states) clearDock(dock)
      states.clear()
      observed.clear()
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
  }

  return {
    apply,
    __test: { planStatusLayout, centeredPanelLeft, splitDock, isPopupPanel, RING_GAP, GAP },
  }
})
