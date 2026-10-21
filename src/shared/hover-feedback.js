/**
 * dsh-hover-polish 1.0.11 — merged feature of dsh-codex-style.
 *
 * Source: dsh-plugins/6cebd96 packages/dsh-hover-polish/client.js.
 * The factory wrapper is provided by scripts/build-client.mjs; the body still
 * returns { inject, apply } and is only built when the feature is enabled.
 */
__DSH_FEATURE('dsh-hover-polish', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const { useEffect, useLayoutEffect, useRef, useState } = React
  const h = React.createElement
  const NS = 'hoverPolish'
  const zh = {
    'explain.model': '选择模型与推理强度',
    'explain.permission': '选择工具权限级别',
    'explain.add': '添加文件或调用指令',
    'explain.history': '查看输入历史',
    'explain.search': '搜索会话和工作区',
    'explain.settings': '打开设置',
    'explain.menu': '打开选项菜单',
  }
  const en = {
    'explain.model': 'Choose model and reasoning effort',
    'explain.permission': 'Choose the tool permission level',
    'explain.add': 'Add files or invoke a command',
    'explain.history': 'View prompt history',
    'explain.search': 'Search conversations and workspaces',
    'explain.settings': 'Open settings',
    'explain.menu': 'Open the options menu',
  }

  /** Tooltip reveal delay; longer than common Host tooltip delays so a Host
   * bubble can win without rendering a duplicate. */
  const TOOLTIP_DELAY_MS = 650
  /** Selectors whose controls already own a hover/selection surface. */
  const SKIP_INSIDE = '[role="menu"], [role="menubar"], [role="listbox"], [data-dshhp-skip]'
  /** Interactive elements that can own a tooltip; tabs are not always <button>. */
  const CONTROL_SELECTOR = 'button, [role="button"], [role="tab"]'

  /** @param {unknown} value - candidate. @returns {string} trimmed text. */
  function textOf(value) {
    return typeof value === 'string' ? value.trim() : ''
  }

  /**
   * Whether a button is icon-only: visible text would make a tooltip
   * redundant, while an SVG has no text content.
   * @param {Element} button - candidate button.
   * @returns {boolean} true when the control has no visible text.
   */
  function isIconOnly(button) {
    const text = typeof button.innerText === 'string' ? button.innerText : button.textContent
    return textOf(text) === ''
  }

  /**
   * The composer send control is a filled primary action; hover copy there is
   * redundant and its own hover treatment is enough.
   * @param {Element} control - candidate control.
   * @returns {boolean} true for send/queue-send controls.
   */
  function isSendButton(control) {
    if (control.getAttribute?.('type') === 'submit') return true
    const label = textOf(control.getAttribute?.('aria-label')).toLowerCase()
    return /^(发送|排队发送|发送消息|send|queue send|send message|submit)/.test(label)
  }

  /**
   * Return a short explanation for a labeled control, not its visible text.
   * The bubble should describe the action; repeating the button label is
   * redundant. Only controls with a known description get one.
   * @param {Element} control - candidate control.
   * @param {Function} t - locale translator.
   * @returns {string} explanation, or an empty string.
   */
  function explanationFor(control, t) {
    if (typeof t !== 'function') return ''
    const aria = textOf(control.getAttribute?.('aria-label'))
    const visible = textOf(control.textContent)
    const label = aria !== '' ? aria : visible
    if (label === '') return ''
    if (/选择模型|模型.*推理|推理.*模型|select model|select effort|reasoning effort/i.test(label))
      return t('explain.model')
    if (/访问模式|权限模式|permission|access mode/i.test(label)) return t('explain.permission')
    if (/添加文件|调用指令|add files|invoke a command|command menu/i.test(label))
      return t('explain.add')
    if (/输入历史|prompt history/i.test(label)) return t('explain.history')
    if (/搜索会话|搜索工作区|search conversations|search workspaces/i.test(label))
      return t('explain.search')
    if (/打开设置|open settings/i.test(label)) return t('explain.settings')
    if (
      control.getAttribute?.('aria-haspopup') !== null &&
      control.getAttribute?.('aria-haspopup') !== undefined
    )
      return t('explain.menu')
    return ''
  }

  /**
   * Whether a control is a tab. Tabs have truncated visible labels, so a
   * tab-specific bubble is useful even when the control is not icon-only.
   * @param {Element} control - candidate control.
   * @returns {boolean} true for role=tab / dockkit tab controls.
   */
  function isTabControl(control) {
    return (
      control.getAttribute?.('role') === 'tab' ||
      control.hasAttribute?.('data-dockkit-tab') === true
    )
  }

  /**
   * Resolve the full tab label/path, preferring the title attribute.
   * @param {Element} control - tab control.
   * @returns {string} full tooltip label.
   */
  function tabLabelOf(control) {
    const title = textOf(control.getAttribute?.('title'))
    if (title !== '') return title
    const aria = textOf(control.getAttribute?.('aria-label'))
    if (aria !== '') return aria
    return textOf(control.textContent)
  }

  /**
   * Resolve a tooltip label without changing the element.
   * @param {Element} button - candidate button.
   * @returns {{label: string, nativeTitle: boolean}} label and whether it came from `title`.
   */
  function labelOf(button) {
    const title = textOf(button.getAttribute?.('title'))
    if (title !== '') return { label: title, nativeTitle: true }
    const aria = textOf(button.getAttribute?.('aria-label'))
    if (aria !== '') return { label: aria, nativeTitle: false }
    const labelledBy = textOf(button.getAttribute?.('aria-labelledby'))
    if (labelledBy !== '') {
      const id = labelledBy.split(/\s+/)[0]
      const owner = id === '' ? null : button.ownerDocument?.getElementById?.(id)
      const label = textOf(owner?.textContent)
      if (label !== '') return { label, nativeTitle: false }
    }
    return { label: '', nativeTitle: false }
  }

  /**
   * Read a shortcut from the ARIA contract used by Host controls.
   * @param {Element} button - candidate button.
   * @returns {string[]} display-ready key tokens.
   */
  function shortcutOf(button) {
    const raw =
      textOf(button.getAttribute?.('aria-keyshortcuts')) ||
      textOf(button.getAttribute?.('data-shortcut'))
    if (raw === '') return []
    const seen = new Set()
    return raw
      .split(/\s+/)
      .map((token) =>
        token
          .split('+')
          .map((part) => {
            if (part === 'Control') return 'Ctrl'
            if (part === 'Meta') return 'Cmd'
            return part
          })
          .join('+'),
      )
      .filter((token) => token !== '')
      .filter((token) => {
        if (seen.has(token)) return false
        seen.add(token)
        return true
      })
  }

  /**
   * Hide repeated adjacent keycap labels in a Host tooltip. The shipped
   * stop tooltip can carry the same key twice, which reads as a duplicate
   * shortcut rather than a useful chord.
   * @param {Element} tip - Host tooltip bubble.
   */
  function dedupeShortcutKeycaps(tip) {
    if (tip === null || tip === undefined || typeof tip.querySelectorAll !== 'function') return
    let previous = null
    for (const key of tip.querySelectorAll('kbd')) {
      const text =
        typeof key.textContent === 'string' ? key.textContent.replace(/\s+/g, ' ').trim() : ''
      if (text === '') continue
      if (text === previous) {
        key.style.display = 'none'
        key.setAttribute?.('data-dshhp-duplicate', '')
        continue
      }
      previous = text
      if (key.hasAttribute?.('data-dshhp-duplicate') === true) {
        key.style.display = ''
        key.removeAttribute?.('data-dshhp-duplicate')
      }
    }
  }

  /**
   * Whether a node is a real Host Tooltip bubble rather than another plugin's
   * hover card that also uses `role="tooltip"`. Host bubbles carry a
   * `data-side` attribute; our own portal carries `data-dshhp-tooltip`.
   * @param {unknown} node - candidate node.
   * @returns {boolean} true for a Host Tooltip bubble.
   */
  function isHostTooltipNode(node) {
    if (node === null || node === undefined || typeof node !== 'object') return false
    const own = node.getAttribute?.('data-dshhp-tooltip')
    if (own !== null && own !== undefined) return false
    const side = node.getAttribute?.('data-side')
    if (side === null || side === undefined || side === '') return false
    // Host bubbles use a CSS-module bubble class, but production hashes may
    // not retain that word. `data-side` plus the foreign-card exclusions is
    // the stable contract; requiring the class name silently disabled
    // centering for every Host tooltip when the hash was opaque.
    const className = typeof node.className === 'string' ? node.className : ''
    if (/hoverCard|hover-card|dshss/i.test(className)) return false
    if (
      typeof node.classList?.contains === 'function' &&
      node.classList.contains('dshss-hoverCard')
    )
      return false
    return true
  }

  /** Remove centering attributes from non-Host tooltips left by older versions. */
  function cleanForeignTooltip(node) {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (isHostTooltipNode(node)) return
    const own = node.getAttribute?.('data-dshhp-tooltip')
    if (own !== null && own !== undefined) return
    node.removeAttribute?.('data-side')
    node.removeAttribute?.('data-align')
  }

  /**
   * Whether any other tooltip-like surface is visible, including another
   * plugin's hover card. Used only for duplicate suppression; centering uses
   * the narrower {@link isHostTooltipNode}. Our own portal carries
   * `data-dshhp-tooltip` and is excluded.
   * @returns {boolean} true when another tooltip is on screen.
   */
  function otherTooltipVisible() {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function')
      return false
    for (const node of document.querySelectorAll('[role="tooltip"]')) {
      if (node === null || node === undefined || typeof node !== 'object') continue
      const own = node.getAttribute?.('data-dshhp-tooltip')
      if (own !== null && own !== undefined) continue
      if (typeof node.getClientRects === 'function' && node.getClientRects().length === 0) continue
      return true
    }
    return false
  }

  /** Position the measured bubble, including visual-viewport edge insets. */
  function tooltipPosition(rect, box) {
    const viewport = window.visualViewport
    const x = viewport?.offsetLeft ?? 0
    const y = viewport?.offsetTop ?? 0
    const width = viewport?.width ?? window.innerWidth ?? 1200
    const height = viewport?.height ?? window.innerHeight ?? 800
    const margin = 8
    let safeTop = y + margin
    const root = document.documentElement
    if (
      root?.hasAttribute?.('data-windows-titlebar') &&
      !root.hasAttribute('data-fullscreen')
    ) {
      const styles = window.getComputedStyle(root)
      const caption = Number.parseFloat(
        styles.getPropertyValue('--dsh-frame-chrome-top') ||
          styles.getPropertyValue('--dsh-windows-titlebar-height') ||
          '40',
      )
      if (Number.isFinite(caption)) safeTop = Math.max(safeTop, caption + margin)
    }
    const aboveSpace = rect.top - safeTop - margin
    const belowSpace = y + height - rect.bottom - margin * 2
    const above = box.height <= aboveSpace || aboveSpace > belowSpace
    const left = Math.max(
      x + margin,
      Math.min(rect.left + rect.width / 2 - box.width / 2, x + width - margin - box.width),
    )
    const top = Math.max(
      safeTop,
      Math.min(
        above ? rect.top - margin - box.height : rect.bottom + margin,
        y + height - margin - box.height,
      ),
    )
    return { left, top, side: above ? 'top' : 'bottom' }
  }

  /**
   * One global hover layer. It owns all timers/listeners and one portal
   * tooltip; it never mounts a second application.
   * @returns {object|null} the tooltip portal, or null.
   */
  function HoverLayer({ t }) {
    const [tooltip, setTooltip] = useState(null)
    const tooltipRef = useRef(null)
    const timerRef = useRef(null)
    const activeRef = useRef(null)
    const titleBackupRef = useRef(new Map())
    const hostAnchorRef = useRef(null)
    const hostCenterTimerRef = useRef(null)
    const rootHideTimerRef = useRef(null)

    /**
     * Center a Host tooltip over its control, keeping it inside the viewport.
     * @returns {boolean} true once a visible Host bubble was positioned.
     */
    const centerHostTooltip = (control) => {
      if (control === null || control === undefined) return false
      if (typeof window === 'undefined' || typeof document === 'undefined') return false
      if (typeof document.querySelectorAll !== 'function') return false
      const rect = control.getBoundingClientRect?.()
      if (rect === undefined || rect === null) return false
      let moved = false
      for (const tip of document.querySelectorAll('[role="tooltip"]')) {
        cleanForeignTooltip(tip)
        if (!isHostTooltipNode(tip)) continue
        if (tip.hasAttribute?.('data-pinned') === true) continue
        if (typeof tip.getClientRects === 'function' && tip.getClientRects().length === 0) continue
        if (tip.style)
          tip.style.maxWidth =
            Math.max(1, (window.visualViewport?.width ?? window.innerWidth) - 16) + 'px'
        const box =
          typeof tip.getBoundingClientRect === 'function' ? tip.getBoundingClientRect() : null
        if (box === null || box === undefined || !(box.width > 0)) continue
        if (tip.dataset === undefined || tip.style === undefined) continue
        const position = tooltipPosition(rect, box)
        tip.dataset.side = position.side
        tip.dataset.align = 'center'
        tip.style.left = position.left + 'px'
        tip.style.top = position.top + 'px'
        // Native ResizeObserver writes its own inline coordinates later.
        // Keep the measured top-left authoritative for this managed bubble.
        tip.style.setProperty?.('--dshhp-left', position.left + 'px')
        tip.style.setProperty?.('--dshhp-top', position.top + 'px')
        dedupeShortcutKeycaps(tip)
        // The root attribute hides Host bubbles for the brief insertion
        // window; mark this one ready only after it already has the final
        // position, so it is never painted at the lower-left default.
        tip.dataset.dshhpReady = ''
        moved = true
      }
      return moved
    }

    const stopHostCentering = () => {
      if (hostCenterTimerRef.current !== null) {
        window.clearTimeout(hostCenterTimerRef.current)
        hostCenterTimerRef.current = null
      }
      hostAnchorRef.current = null
      // Keep Host bubbles hidden for one short grace period. The Host removes
      // its bubble on pointerleave asynchronously; removing the root marker in
      // the same tick exposes that bubble at its default lower-left position
      // for a frame.
      if (rootHideTimerRef.current !== null) window.clearTimeout(rootHideTimerRef.current)
      rootHideTimerRef.current = window.setTimeout(() => {
        rootHideTimerRef.current = null
        try {
          document.documentElement?.removeAttribute?.('data-dshhp-hover')
        } catch {
          // A detached document has no Host tooltip to reveal.
        }
      }, 200)
    }

    const startHostCentering = (control) => {
      if (rootHideTimerRef.current !== null) {
        window.clearTimeout(rootHideTimerRef.current)
        rootHideTimerRef.current = null
      }
      hostAnchorRef.current = control
      try {
        document.documentElement?.setAttribute?.('data-dshhp-hover', '')
      } catch {
        // Positioning still works when the root attribute is unavailable.
      }
      if (centerHostTooltip(control)) return
      if (hostCenterTimerRef.current !== null) return
      // Wait for the Host's delayed bubble, position it once, then stop: a
      // continuous loop fights the Host's own layout and can flicker.
      let attempts = 0
      const tick = () => {
        hostCenterTimerRef.current = null
        const anchor = hostAnchorRef.current
        if (anchor === null || anchor === undefined) return
        if (centerHostTooltip(anchor)) return
        attempts += 1
        if (attempts >= 16) return
        hostCenterTimerRef.current = window.setTimeout(tick, 80)
      }
      hostCenterTimerRef.current = window.setTimeout(tick, 80)
    }

    const restoreTitle = (button) => {
      if (button === null || button === undefined) return
      const previous = titleBackupRef.current.get(button)
      if (previous === undefined) return
      button.setAttribute?.('title', previous)
      titleBackupRef.current.delete(button)
    }

    const hide = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const active = activeRef.current
      activeRef.current = null
      restoreTitle(active)
      setTooltip(null)
    }

    const show = (button, label, keys) => {
      const rect = button.getBoundingClientRect?.()
      if (rect === undefined || rect === null) return
      setTooltip({
        label,
        keys,
        rect,
      })
    }

    useLayoutEffect(() => {
      const tip = tooltipRef.current
      if (tooltip === null || tip === null) return
      tip.style.maxWidth =
        Math.max(1, Math.min(460, (window.visualViewport?.width ?? window.innerWidth) - 16)) + 'px'
      const position = tooltipPosition(tooltip.rect, tip.getBoundingClientRect())
      tip.style.left = position.left + 'px'
      tip.style.top = position.top + 'px'
    }, [tooltip])

    const markHoverSurface = (button) => {
      if (!isIconOnly(button)) return
      const style =
        typeof window.getComputedStyle === 'function' ? window.getComputedStyle(button) : null
      const background = style?.backgroundColor ?? ''
      const transparent =
        background === '' || background === 'transparent' || background.endsWith(', 0)')
      if (transparent) button.setAttribute?.('data-dshhp-hover', 'icon')
    }

    const schedule = (button, label, keys) => {
      if (label === '') return
      activeRef.current = button
      const nativeTitle = textOf(button.getAttribute?.('title'))
      if (nativeTitle !== '') {
        // Suppress the browser's title bubble while our styled bubble owns
        // the hover. The original attribute is restored on leave/unmount.
        titleBackupRef.current.set(button, nativeTitle)
        button.removeAttribute?.('title')
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        if (activeRef.current !== button) return
        if (otherTooltipVisible()) return
        show(button, label, keys)
      }, TOOLTIP_DELAY_MS)
    }

    useEffect(() => {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function')
        return undefined
      const onPointerOver = (event) => {
        const target = event.target
        if (target === null || target === undefined || typeof target.closest !== 'function') return
        const button = target.closest(CONTROL_SELECTOR)
        if (
          button === null ||
          button === undefined ||
          button.disabled === true ||
          button.getAttribute?.('aria-disabled') === 'true'
        )
          return
        if (isSendButton(button)) return
        if (button.closest(SKIP_INSIDE) !== null) return
        startHostCentering(button)
        if (button === activeRef.current) return
        hide()
        markHoverSurface(button)
        if (isTabControl(button)) {
          const label = tabLabelOf(button)
          if (label === '') return
          activeRef.current = button
          schedule(button, label, shortcutOf(button))
          return
        }
        if (isIconOnly(button)) {
          const label = labelOf(button)
          if (label.label === '') return
          activeRef.current = button
          schedule(button, label.label, shortcutOf(button))
          return
        }
        // A visible text label is already the affordance, so only a known,
        // genuinely explanatory description earns a bubble here.
        const explanation = explanationFor(button, t)
        if (explanation === '') return
        activeRef.current = button
        schedule(button, explanation, shortcutOf(button))
      }
      const onPointerOut = (event) => {
        const target = event.target
        if (target === null || target === undefined || typeof target.closest !== 'function') return
        const button = target.closest(CONTROL_SELECTOR)
        if (button === null || button === undefined) return
        if (
          event.relatedTarget !== null &&
          event.relatedTarget !== undefined &&
          button.contains?.(event.relatedTarget)
        )
          return
        if (button === hostAnchorRef.current) stopHostCentering()
        if (button !== activeRef.current) return
        hide()
      }
      const onFocusIn = (event) => {
        const target = event.target
        if (target === null || target === undefined || typeof target.closest !== 'function') return
        const button = target.closest(CONTROL_SELECTOR)
        if (
          button === null ||
          button === undefined ||
          button.disabled === true ||
          button.getAttribute?.('aria-disabled') === 'true'
        )
          return
        if (isSendButton(button)) return
        if (button.closest(SKIP_INSIDE) !== null) return
        startHostCentering(button)
        if (button === activeRef.current) return
        hide()
        markHoverSurface(button)
        if (isTabControl(button)) {
          const label = tabLabelOf(button)
          if (label === '') return
          activeRef.current = button
          if (timerRef.current !== null) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            if (activeRef.current !== button || otherTooltipVisible()) return
            show(button, label, shortcutOf(button))
          }, TOOLTIP_DELAY_MS)
          return
        }
        if (isIconOnly(button)) {
          const label = labelOf(button)
          if (label.label === '') return
          activeRef.current = button
          if (timerRef.current !== null) window.clearTimeout(timerRef.current)
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            if (activeRef.current !== button || otherTooltipVisible()) return
            show(button, label.label, shortcutOf(button))
          }, TOOLTIP_DELAY_MS)
          return
        }
        const explanation = explanationFor(button, t)
        if (explanation === '') return
        activeRef.current = button
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null
          if (activeRef.current !== button || otherTooltipVisible()) return
          show(button, explanation, shortcutOf(button))
        }, TOOLTIP_DELAY_MS)
      }
      const onFocusOut = (event) => {
        if (event.target === hostAnchorRef.current) stopHostCentering()
        if (event.target !== activeRef.current) return
        hide()
      }
      const onScroll = () => {
        stopHostCentering()
        hide()
      }
      const onPointerDown = () => {
        stopHostCentering()
        hide()
      }
      const onClick = () => {
        stopHostCentering()
        hide()
      }
      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          stopHostCentering()
          hide()
        }
      }
      document.addEventListener('pointerover', onPointerOver, true)
      document.addEventListener('pointerout', onPointerOut, true)
      document.addEventListener('focusin', onFocusIn, true)
      document.addEventListener('focusout', onFocusOut, true)
      document.addEventListener('pointerdown', onPointerDown, true)
      document.addEventListener('click', onClick, true)
      document.addEventListener('scroll', onScroll, true)
      document.addEventListener('keydown', onKeyDown, true)
      window.addEventListener?.('resize', onScroll)
      window.visualViewport?.addEventListener('resize', onScroll)
      window.visualViewport?.addEventListener('scroll', onScroll)
      return () => {
        document.removeEventListener('pointerover', onPointerOver, true)
        document.removeEventListener('pointerout', onPointerOut, true)
        document.removeEventListener('focusin', onFocusIn, true)
        document.removeEventListener('focusout', onFocusOut, true)
        document.removeEventListener('pointerdown', onPointerDown, true)
        document.removeEventListener('click', onClick, true)
        document.removeEventListener('scroll', onScroll, true)
        document.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener?.('resize', onScroll)
        window.visualViewport?.removeEventListener('resize', onScroll)
        window.visualViewport?.removeEventListener('scroll', onScroll)
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        if (hostCenterTimerRef.current !== null) window.clearTimeout(hostCenterTimerRef.current)
        if (rootHideTimerRef.current !== null) window.clearTimeout(rootHideTimerRef.current)
        for (const button of titleBackupRef.current.keys()) restoreTitle(button)
      }
    }, [])

    useEffect(
      () => () => {
        if (timerRef.current !== null) window.clearTimeout(timerRef.current)
        if (hostCenterTimerRef.current !== null) window.clearTimeout(hostCenterTimerRef.current)
        if (rootHideTimerRef.current !== null) window.clearTimeout(rootHideTimerRef.current)
        for (const button of titleBackupRef.current.keys()) restoreTitle(button)
      },
      [],
    )

    if (tooltip === null) return null
    return createPortal(
      h(
        'span',
        {
          className: 'dshhp-tooltip',
          ref: tooltipRef,
          role: 'tooltip',
          'data-dshhp-tooltip': '',
          style: { left: tooltip.rect.left + 'px', top: tooltip.rect.bottom + 8 + 'px' },
        },
        h('span', { className: 'dshhp-label' }, tooltip.label),
        tooltip.keys.length === 0
          ? null
          : h(
              'span',
              { className: 'dshhp-keys' },
              tooltip.keys.map((key, index) =>
                h('kbd', { key: index, className: 'dshhp-key' }, key),
              ),
            ),
      ),
      document.body,
    )
  }

  /** Presentation only; colors and elevation come from the Host theme. */
  const CSS = `
.dshhp-tooltip {
  position: fixed;
  z-index: 1200;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  width: max-content;
  max-width: min(460px, calc(100vw - 16px));
  box-sizing: border-box;
  padding: 4px 8px;
  border-radius: 8px;
  background: var(--dsw-alias-tooltip-bg);
  color: var(--dsw-static-neutral-bluish-00);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
  font-family: inherit;
  pointer-events: none;
  overflow-wrap: anywhere;
  animation: dshhp-in 140ms ease-out;
}
.dshhp-label {
  min-width: 0;
}
.dshhp-keys {
  display: inline-flex;
  flex-wrap: wrap;
  max-width: 100%;
  flex: none;
  align-items: center;
  gap: 3px;
}
.dshhp-key {
  box-sizing: border-box;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border: 0;
  border-radius: 5px;
  background: var(--dsw-alias-tooltip-key-bg);
  color: inherit;
  font: inherit;
  font-size: 11px;
  line-height: 18px;
  text-align: center;
  white-space: nowrap;
}
@keyframes dshhp-in {
  from { opacity: 0; }
}
[data-dshhp-hover="icon"]:not(:disabled) {
  transition: background-color 120ms ease, color 120ms ease, transform 120ms ease;
}
[data-dshhp-hover="icon"]:not(:disabled):hover {
  background-color: var(--dsw-alias-interactive-bg-hover);
}
[data-dshhp-hover="icon"]:not(:disabled):active {
  transform: scale(.97);
}
/* Align the shipped bubble with the same compact Codex-like surfaces. */
[role="tooltip"]:not([data-dshhp-tooltip]) {
  padding: 4px 8px;
  border-radius: 8px;
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px;
  font-weight: 500;
  line-height: 18px;
}
[role="tooltip"][data-side]:not([data-dshhp-tooltip]) {
  box-sizing: border-box;
  max-width: calc(100vw - 16px);
  overflow-wrap: anywhere;
}
/* Right-sidebar document tabs: the shipped hover is too quiet and its type is
   a size/weight below the Codex-like target. Keep the Host geometry, give the
   pill a clear hover surface and one type scale. */
[data-dockkit-tab] {
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
}
[role="tab"] {
  transition: background-color 120ms ease, color 120ms ease, box-shadow 120ms ease, outline-color 120ms ease;
}
[role="tab"]:not([aria-selected="true"]):not([aria-disabled="true"]):not([data-dockkit-tab-quiet]):hover {
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-interactive-bg-hover);
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
  outline: 1px solid var(--dsw-alias-border-l3);
  outline-offset: -1px;
}
/* The selected tab owns the active fill, so hover feedback must not replace it. */
[role="tab"][aria-selected="true"]:hover {
  box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l2);
  outline: 1px solid var(--dsw-alias-border-l3);
  outline-offset: -1px;
}
/* Host Tooltips are inserted at their default side/alignment and only then
   receive our centered position. Keep them hidden for that insertion window
   so the first paint is already at the final top-center location. */
html[data-dshhp-hover] [role="tooltip"][data-side]:not([data-dshhp-ready]) {
  visibility: hidden !important;
}
html[data-dshhp-hover] [role="tooltip"][data-side][data-dshhp-ready]:not([data-dshhp-tooltip]):not([data-pinned]) {
  visibility: visible !important;
  left: var(--dshhp-left) !important;
  top: var(--dshhp-top) !important;
  transform: none !important;
}
[role="tooltip"] [data-dshhp-duplicate] {
  display: none !important;
}
@media (prefers-reduced-motion: reduce) {
  .dshhp-tooltip { animation: none; }
  [data-dshhp-hover="icon"]:not(:disabled) { transition: none; }
  [data-dshhp-hover="icon"]:not(:disabled):active { transform: none; }
}
`

  /**
   * Register the global hover layer.
   * @param {object} ctx - Client root context.
   */
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'hover-polish: dictionaries')
    const t = ctx.locale.bind(NS)
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function')
        return () => {}
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-hover-polish'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        style.remove?.()
      }
    }, 'hover-polish: styles')

    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'hover-polish.tooltip',
          locale: NS,
          inject: () => ({ t }),
        },
        HoverLayer,
      ),
    )
  }

  return {
    /** Services this Client plugin waits for before applying. */
    inject: ['slots', 'locale'],
    apply,
  }
})
