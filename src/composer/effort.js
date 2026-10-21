/** Capability-driven effort slider over DSH's retained model directory. */
__DSH_FEATURE('dsh-effort-slider', function (require) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const {
    MenuSurface,
    IconRefreshOutlineRegular,
    IconChevronRightOutlineRegular,
  } = require('@deepseek-ai/dsh-client-ui-primitives')
  const { useId, useLayoutEffect, useRef, useState, useSyncExternalStore } = React
  const h = React.createElement
  const NS = 'effortSlider'
  const zh = {
    label: '推理强度',
    default: '默认',
    reset: '恢复默认强度',
    model: '选择模型',
    failed: '强度设置失败，请重试。',
    unknown: '切换结果尚未确认，当前显示已同步的强度。请检查连接后重试。',
    unsupported: '当前强度已不可用，请恢复默认或切换模型。',
    loading: '正在更新…',
  }
  const en = {
    label: 'Reasoning effort',
    default: 'Default',
    reset: 'Reset reasoning effort',
    model: 'Choose model',
    failed: 'Could not change reasoning effort. Try again.',
    unknown: 'The selection is unconfirmed. Showing the synchronized effort. Check the connection before retrying.',
    unsupported: 'This effort is no longer available. Reset it or choose a model.',
    loading: 'Updating…',
  }

  function describe(state, defaultLabel) {
    const current = state.current
    const model = state.groups
      .find((group) => group.id === current?.provider)
      ?.models.find((item) => item.id === current?.model)
    const reasoning = model?.reasoning
    const levels = !reasoning
      ? []
      : [
          ...(reasoning.defaultEffort === undefined ? [{ id: undefined, name: defaultLabel }] : []),
          ...reasoning.efforts,
        ]
    const effective = current?.reasoningEffort ?? reasoning?.defaultEffort
    return {
      model,
      levels,
      effective,
      index: levels.findIndex((level) => level.id === effective),
      isDefault: effective === reasoning?.defaultEffort,
      // A draft belongs to one exact model, capability list and accepted value.
      key: JSON.stringify([current, reasoning]),
      // Like the native picker, a background catalog refresh can use retained choices.
      busy: state.pending != null || state.status === 'selecting' || (state.status === 'loading' && !model),
    }
  }

  function selectionFor(state, key, index, reset) {
    const view = describe(state, '')
    if (view.key !== key || view.busy || !view.levels.length || !state.current) return null
    const choice = view.levels[index]
    if (reset ? view.isDefault : !choice || choice.id === view.effective) return null
    return {
      provider: state.current.provider,
      model: state.current.model,
      ...(!reset && choice.id !== undefined ? { reasoningEffort: choice.id } : {}),
    }
  }

  const sameSelection = (left, right) =>
    !!left &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.reasoningEffort === right.reasoningEffort

  /** A durable selection frame can arrive before the RPC acknowledgement. */
  function selectAndConfirm(directory, selection, options = {}) {
    const { signal, schedule = setTimeout, unschedule = clearTimeout } = options
    if (signal?.aborted) return Promise.resolve({ ok: false, cancelled: true })
    return new Promise((resolve) => {
      let settled = false,
        queued = false,
        timer,
        nativeGeneration,
        unsubscribe = () => {}
      const finish = (result) => {
        if (settled) return
        settled = true
        unsubscribe()
        unschedule(timer)
        signal?.removeEventListener('abort', abort)
        // Native select() can throw after applying the setting but before
        // clearing pending. Invalidate only our response and re-read its projection.
        if (
          directory.generation === nativeGeneration &&
          sameSelection(directory.store.getSnapshot().pending, selection)
        ) {
          try {
            directory.resetConnected?.()
          } catch {
            result = { ok: false, unknown: true }
          }
        }
        resolve(result)
      }
      const confirm = () => {
        if (settled) return
        const state = directory.store.getSnapshot()
        if (
          state.current?.provider !== selection.provider ||
          state.current?.model !== selection.model
        )
          return
        const view = describe(state, '')
        if (
          view.effective ===
          (selection.reasoningEffort ?? view.model?.reasoning?.defaultEffort)
        ) {
          finish({ ok: true })
        }
      }
      const abort = () => finish({ ok: false, cancelled: true })
      unsubscribe = directory.store.subscribe(() => {
        if (queued || settled) return
        queued = true
        queueMicrotask(() => {
          queued = false
          confirm()
        })
      })
      signal?.addEventListener('abort', abort, { once: true })
      timer = schedule(() => {
        confirm()
        finish({ ok: false, unknown: true })
      }, 15000)
      try {
        const response = directory.select(selection)
        nativeGeneration = directory.generation
        Promise.resolve(response).then(
          (result) => {
            confirm()
            finish(result?.ok ? result : { ok: false })
          },
          () => {
            confirm()
            finish({ ok: false, unknown: true })
          },
        )
      } catch {
        nativeGeneration = directory.generation
        confirm()
        finish({ ok: false, unknown: true })
      }
    })
  }

  function place(rect, width, height, viewport) {
    const margin = 12
    const left = viewport.offsetLeft ?? 0
    const top = viewport.offsetTop ?? 0
    const clamp = (value, start, end) => Math.max(start, Math.min(value, Math.max(start, end)))
    const above = rect.top - 8 - height
    const below = rect.bottom + 8
    return {
      left: clamp(
        (rect.left + rect.right - width) / 2,
        left + margin,
        left + viewport.width - width - margin,
      ),
      top: clamp(
        above >= top + margin || below + height > top + viewport.height - margin ? above : below,
        top + margin,
        top + viewport.height - height - margin,
      ),
      maxWidth: Math.max(0, viewport.width - margin * 2),
      maxHeight: Math.max(0, viewport.height - margin * 2),
    }
  }

  /** Bounded DOM bridge: keep native search, grouping and model selection intact. */
  function openModelMenu(button) {
    let timer
    const stop = () => {
      observer.disconnect()
      clearTimeout(timer)
    }
    const drill = () => {
      if (!button.isConnected) return stop()
      const menu = document.getElementById(button.getAttribute('aria-controls'))
      if (!menu) return
      const current = menu.querySelector('[data-provider-id][data-model-id]')
      const cell = current?.closest('button[role="menuitem"]')
      stop()
      // If the host changed its DOM contract, leave its root menu usable.
      cell?.click()
    }
    const observer = new MutationObserver(drill)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-controls'],
    })
    timer = setTimeout(stop, 750)
    button.click()
    drill()
    return stop
  }

  function EffortSlider({ sessionId, directory, connected, t }) {
    const anchor = useRef(null),
      panel = useRef(null),
      range = useRef(null)
    const draft = useRef(null),
      pointer = useRef(null),
      flight = useRef(null)
    const bridge = useRef(() => {}),
      bypass = useRef(false)
    const focused = useRef(false)
    const live = useRef(false)
    const [button, setButton] = useState(null)
    const [open, setOpen] = useState(false)
    const [preview, setPreview] = useState(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState(null)
    const [position, setPosition] = useState(null)
    const id = useId()
    const state = useSyncExternalStore(directory.store.subscribe, directory.store.getSnapshot)
    const generation = useSyncExternalStore(connected.subscribe, connected.getSnapshot)
    const view = describe(state, t('default'))
    const latest = useRef(null)
    latest.current = { view, open, generation, directory }
    const ready = () =>
      !!button?.isConnected &&
      !button.disabled &&
      !button.closest('[inert]') &&
      connected.getSnapshot() !== undefined
    const cancel = () => {
      draft.current = null
      pointer.current = null
      setPreview(null)
    }
    const close = (restore = false) => {
      cancel()
      setOpen(false)
      if (restore) button?.focus({ preventScroll: true })
    }
    useLayoutEffect(() => {
      live.current = true
      return () => {
        live.current = false
        flight.current?.controller.abort()
        bridge.current()
      }
    }, [directory])
    useLayoutEffect(() => {
      const card = anchor.current?.closest('[data-composer-card]')
      if (!card) return
      let target = null
      const intercept = (event) => {
        const value = latest.current
        if (
          bypass.current ||
          !value.view.levels.length ||
          !value.generation ||
          target.disabled ||
          target.closest('[inert]')
        )
          return
        if (event.type === 'keydown' && !['ArrowDown', 'ArrowUp'].includes(event.key)) return
        // An already-open native menu retains its own toggle and keyboard behavior.
        if (!value.open && target.getAttribute('aria-expanded') === 'true') return
        event.preventDefault()
        event.stopImmediatePropagation()
        setOpen(!value.open)
        setError(null)
        // The retained directory is already loaded and refreshes itself on host events.
        // Opening an effort control must not wait for another catalog read.
      }
      const update = () => {
        const next =
          [...card.querySelectorAll('button[aria-haspopup]')].find((node) =>
            node.querySelector('[data-provider-id][data-model-id]'),
          ) ?? null
        if (next === target) return
        target?.removeEventListener('click', intercept)
        target?.removeEventListener('keydown', intercept)
        target = next
        target?.addEventListener('click', intercept)
        target?.addEventListener('keydown', intercept)
        setButton(target)
        setOpen(false)
      }
      const observer = new MutationObserver(update)
      observer.observe(card, { childList: true, subtree: true })
      update()
      return () => {
        observer.disconnect()
        target?.removeEventListener('click', intercept)
        target?.removeEventListener('keydown', intercept)
      }
    }, [directory, sessionId, t])
    useLayoutEffect(() => {
      if (!button || !view.model) return
      const effort = button.querySelector('.wq12jW_triggerEffort')
      if (!effort) return
      const context = document.createElement('canvas').getContext('2d')
      if (!context) return
      let alive = true
      const measure = () => {
        if (!alive || !button.isConnected) return
        const textStyle = getComputedStyle(effort), style = getComputedStyle(button)
        context.font = textStyle.font
        const spacing = parseFloat(textStyle.letterSpacing) || 0
        const labels = [...view.levels.map((level) => level.name), effort.textContent]
        const widthOf = (text) => context.measureText(text ?? '').width + Math.max(0, (text?.length ?? 0) - 1) * spacing
        const effortWidth = Math.max(...labels.map(widthOf))
        const children = [...button.children].filter((child) => getComputedStyle(child).display !== 'none')
        const width = children.reduce((total, child) => total + (child === effort
          ? effortWidth : child.matches('.wq12jW_triggerLabel') ? child.scrollWidth
            : Math.max(16, child.getBoundingClientRect().width)), 0)
          + Math.max(0, children.length - 1) * (parseFloat(style.columnGap) || 0)
          + (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0)
        // Reserve the widest advertised level; the host's responsive max-width still applies.
        button.style.setProperty('--dshe-trigger-width', Math.ceil(width) + 'px')
        button.dataset.dsheTrigger = ''
      }
      measure()
      document.fonts?.ready.then(measure)
      return () => {
        alive = false
        button.removeAttribute('data-dshe-trigger')
        button.style.removeProperty('--dshe-trigger-width')
      }
    }, [button, view.model, view.effective])
    useLayoutEffect(() => {
      if (!button) return
      let menu = null, frame = null
      const restore = () => {
        if (!menu) return
        resize.unobserve(menu)
        menu.removeAttribute('data-dshe-native-model')
        menu.style.removeProperty('--dshe-native-model-left')
        menu = null
      }
      const update = () => {
        frame = null
        const next = document.getElementById(button.getAttribute('aria-controls'))
        if (!next?.matches('.wq12jW_menu')) { restore(); return }
        if (next !== menu) { restore(); menu = next; resize.observe(menu) }
        const viewport = window.visualViewport ?? { width: window.innerWidth, height: window.innerHeight }
        const position = place(button.getBoundingClientRect(), menu.offsetWidth, menu.offsetHeight, viewport)
        menu.style.setProperty('--dshe-native-model-left', position.left + 'px')
        menu.dataset.dsheNativeModel = ''
      }
      const schedule = () => { if (frame === null) frame = requestAnimationFrame(update) }
      const resize = new ResizeObserver(schedule)
      resize.observe(button)
      const observer = new MutationObserver(schedule)
      observer.observe(button, { attributes: true, attributeFilter: ['aria-controls', 'aria-expanded'] })
      observer.observe(document.body, { childList: true, subtree: true })
      window.addEventListener('resize', schedule)
      window.addEventListener('scroll', schedule, true)
      window.visualViewport?.addEventListener('resize', schedule)
      window.visualViewport?.addEventListener('scroll', schedule)
      update()
      return () => {
        observer.disconnect(); resize.disconnect()
        if (frame !== null) cancelAnimationFrame(frame)
        restore()
        window.removeEventListener('resize', schedule)
        window.removeEventListener('scroll', schedule, true)
        window.visualViewport?.removeEventListener('resize', schedule)
        window.visualViewport?.removeEventListener('scroll', schedule)
      }
    }, [button])
    useLayoutEffect(() => {
      cancel()
      setError(null)
      if (flight.current && flight.current.generation !== generation) {
        flight.current.controller.abort()
        flight.current = null
        setPending(false)
      }
      if (!view.levels.length || generation === undefined) setOpen(false)
    }, [view.key, generation])
    useLayoutEffect(() => {
      if (!open || !button) return
      const previous = ['aria-expanded', 'aria-haspopup', 'aria-controls'].map((name) => [
        name,
        button.getAttribute(name),
      ])
      button.setAttribute('aria-expanded', 'true')
      button.setAttribute('aria-haspopup', 'dialog')
      button.setAttribute('aria-controls', id)
      const outside = (event) => {
        if (!panel.current?.contains(event.target) && !button.contains(event.target)) close()
      }
      document.addEventListener('pointerdown', outside, true)
      document.addEventListener('focusin', outside)
      return () => {
        document.removeEventListener('pointerdown', outside, true)
        document.removeEventListener('focusin', outside)
        for (const [name, value] of previous) {
          if (value === null) button.removeAttribute(name)
          else button.setAttribute(name, value)
        }
      }
    }, [open, button, id])
    useLayoutEffect(() => {
      if (!open || !button || !panel.current) {
        setPosition(null)
        return
      }
      const update = () => {
        if (button.disabled || button.closest('[inert]') || !button.isConnected) return close()
        const viewport = window.visualViewport ?? {
          width: window.innerWidth,
          height: window.innerHeight,
        }
        setPosition(
          place(
            button.getBoundingClientRect(),
            panel.current.offsetWidth,
            panel.current.offsetHeight,
            viewport,
          ),
        )
      }
      const observer = new ResizeObserver(update)
      observer.observe(panel.current)
      observer.observe(button)
      const attributes = new MutationObserver(update)
      attributes.observe(button, { attributes: true, attributeFilter: ['disabled'] })
      window.addEventListener('resize', update)
      window.addEventListener('scroll', update, true)
      window.visualViewport?.addEventListener('resize', update)
      window.visualViewport?.addEventListener('scroll', update)
      update()
      return () => {
        observer.disconnect()
        attributes.disconnect()
        window.removeEventListener('resize', update)
        window.removeEventListener('scroll', update, true)
        window.visualViewport?.removeEventListener('resize', update)
        window.visualViewport?.removeEventListener('scroll', update)
      }
    }, [open, button])
    useLayoutEffect(() => {
      if (!open) {
        focused.current = false
        return
      }
      if (
        position !== null &&
        !view.busy &&
        !pending &&
        (!focused.current || document.activeElement === panel.current)
      ) {
        ;(range.current?.disabled ? panel.current : range.current)?.focus({ preventScroll: true })
        focused.current = true
      }
    }, [open, position !== null, view.busy, pending])

    const commit = async (value, reset = false) => {
      if (flight.current) return
      draft.current = null
      pointer.current = null
      if (!value || !ready()) return cancel()
      const selection = selectionFor(directory.store.getSnapshot(), value.key, value.index, reset)
      if (!selection) return cancel()
      // Keep the user's target visible until it is confirmed or explicitly rolled back.
      setPreview({ key: view.key, index: reset
        ? view.levels.findIndex((level) => level.id === view.model.reasoning.defaultEffort)
        : value.index })
      const operation = {
        controller: new AbortController(),
        generation: connected.getSnapshot(),
        model: selection.model,
        provider: selection.provider,
      }
      flight.current = operation
      setPending(true)
      setError(null)
      const current = () => {
        const selected = directory.store.getSnapshot().current
        return (
          live.current &&
          latest.current.directory === directory &&
          connected.getSnapshot() === operation.generation &&
          selected?.provider === operation.provider &&
          selected?.model === operation.model
        )
      }
      try {
        const result = await selectAndConfirm(directory, selection, {
          signal: operation.controller.signal,
        })
        if (current() && !result.ok && !result.cancelled)
          setError(t(result.unknown ? 'unknown' : 'failed'))
      } catch {
        if (current()) setError(t('unknown'))
      } finally {
        if (flight.current === operation) {
          flight.current = null
          if (live.current) { setPending(false); setPreview(null) }
        }
      }
    }
    const change = (event) => {
      const value = {
        key: draft.current?.key ?? view.key,
        index: Number(event.currentTarget.value),
      }
      if (value.key !== latest.current.view.key) return cancel()
      draft.current = value
      setPreview(value)
    }
    const displayed = preview?.key === view.key ? preview.index : view.index
    const disabled = pending || view.busy || !ready()
    const level = view.levels[displayed]
    const fraction =
      view.levels.length === 1 ? 0.5 : Math.max(0, displayed) / (view.levels.length - 1)
    return h(
      React.Fragment,
      null,
      h('span', { ref: anchor, 'data-dshe-anchor': sessionId }),
      !open || !view.levels.length
        ? null
        : createPortal(
            h(
              MenuSurface,
              {
                ref: panel,
                id,
                className: 'dshe-panel',
                role: 'dialog',
                tabIndex: -1,
                'aria-label': t('label'),
                'aria-busy': pending || view.busy,
                style: position ?? { visibility: 'hidden' },
                onKeyDown: (event) => {
                  event.stopPropagation()
                  if (event.key === 'Escape') {
                    event.preventDefault()
                    close(true)
                  }
                },
              },
              h(
                'div',
                { className: 'dshe-heading' },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshe-model',
                    'aria-label': t('model'),
                    title: view.model?.name,
                    disabled: pending || view.busy,
                    onClick: () => {
                      cancel()
                      setOpen(false)
                      // Unmount our dialog/ARIA override before opening the native menu.
                      queueMicrotask(() => {
                        if (!button?.isConnected || button.disabled || !live.current) return
                        bypass.current = true
                        try {
                          bridge.current()
                          bridge.current = openModelMenu(button)
                        } finally {
                          bypass.current = false
                        }
                      })
                    },
                  },
                  h('span', { className: 'dshe-level', 'aria-live': 'polite' },
                    level?.name ?? view.effective ?? t('default')),
                  h('span', { className: 'dshe-modelCaption' },
                    h('span', null, view.model?.name),
                    h(IconChevronRightOutlineRegular, { size: 12 })),
                ),
              ),
              h(
                'button',
                {
                  type: 'button',
                  className: 'dshe-reset',
                  title: t('reset'),
                  'aria-label': t('reset'),
                  disabled: disabled || view.isDefault,
                  onClick: () => void commit({ key: view.key, index: view.index }, true),
                },
                h(IconRefreshOutlineRegular, { size: 18 }),
              ),
              h(
                'div',
                {
                  className: 'dshe-track',
                  'data-single': view.levels.length === 1 ? '' : undefined,
                  'data-unknown': view.index < 0 ? '' : undefined,
                  'data-disabled':
                    disabled || view.levels.length < 2 || view.index < 0 ? '' : undefined,
                  style: {
                    '--dshe-position': `calc(12px + (100% - 24px) * ${fraction})`,
                    '--dshe-fill': fraction === 0 ? '0px' : fraction === 1 ? '100%' : 'var(--dshe-position)',
                  },
                },
                h(
                  'div',
                  { className: 'dshe-dots', 'aria-hidden': true },
                  view.levels.map((item, index) =>
                    h('span', {
                      key: item.id ?? 'provider-default',
                      'data-filled': index <= displayed ? '' : undefined,
                    }),
                  ),
                ),
                h('input', {
                  ref: range,
                  type: 'range',
                  min: 0,
                  max: Math.max(0, view.levels.length - 1),
                  step: 1,
                  value: Math.max(0, displayed),
                  disabled: disabled || view.levels.length < 2 || view.index < 0,
                  'aria-label': t('label'),
                  'aria-valuetext': level?.name ?? view.effective,
                  'aria-describedby': error || view.index < 0 ? id + '-status' : undefined,
                  onChange: change,
                  onPointerDown: (event) => {
                    if (event.button !== 0) return
                    draft.current = { key: view.key, index: displayed }
                    pointer.current = event.pointerId
                    event.currentTarget.setPointerCapture(event.pointerId)
                  },
                  onPointerUp: (event) => {
                    if (pointer.current !== event.pointerId) return
                    const value = draft.current
                    pointer.current = null
                    void commit(value)
                  },
                  onPointerCancel: cancel,
                  onLostPointerCapture: () => {
                    if (pointer.current !== null) cancel()
                  },
                  onKeyUp: (event) => {
                    if (
                      [
                        'ArrowLeft',
                        'ArrowRight',
                        'ArrowUp',
                        'ArrowDown',
                        'Home',
                        'End',
                        'PageUp',
                        'PageDown',
                      ].includes(event.key)
                    )
                      void commit(draft.current)
                  },
                  onBlur: () => {
                    if (pointer.current === null) void commit(draft.current)
                  },
                }),
                h('span', { className: 'dshe-thumb', 'aria-hidden': true }),
              ),
              h(
                'span',
                { className: 'dshe-announcement', role: 'status' },
                pending || view.busy ? t('loading') : '',
              ),
              error || view.index < 0
                ? h(
                    'div',
                    { className: 'dshe-status', id: id + '-status', role: 'status' },
                    error ?? t('unsupported'),
                  )
                : null,
            ),
            document.body,
          ),
    )
  }

  const CSS = `
    .wq12jW_trigger[data-dshe-trigger]{box-sizing:border-box;width:var(--dshe-trigger-width);}
    .wq12jW_trigger[data-dshe-trigger]>:last-child{flex:none;width:16px;height:16px;}
    .wq12jW_menu[data-dshe-native-model]{left:var(--dshe-native-model-left)!important;}
    .dshe-panel{position:fixed;z-index:1000;box-sizing:border-box;display:block;width:260px;min-width:0;padding:12px;border:1px solid var(--dsw-alias-border-l2);border-radius:16px;box-shadow:var(--dsw-shadow-lv2);overflow:auto;overscroll-behavior:contain;color:var(--dsw-alias-label-primary);}
    .dshe-heading{display:flex;justify-content:center;min-width:0;padding:0 24px;text-align:center;}
    .dshe-level{font-size:15px;line-height:20px;font-weight:600;color:var(--dsw-alias-state-business-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .dshe-model{display:flex;flex-direction:column;align-items:center;justify-content:center;max-width:100%;min-width:0;margin:-4px 0;padding:4px 8px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:18px;cursor:pointer;}
    .dshe-modelCaption{display:flex;align-items:center;justify-content:center;gap:2px;max-width:100%;}.dshe-model span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.dshe-model svg{flex:none;}.dshe-model:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
    .dshe-reset{position:absolute;right:6px;top:6px;display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;}.dshe-reset:hover{background:var(--dsw-alias-interactive-bg-hover);}
    .dshe-panel button:disabled{opacity:.45;cursor:default;}.dshe-panel button:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px;}
    .dshe-track{position:relative;height:24px;margin-top:12px;border-radius:12px;corner-shape:round;background:linear-gradient(to right,var(--dsw-alias-state-business-primary) 0 var(--dshe-fill),var(--dsw-alias-interactive-bg-hover-solid) var(--dshe-fill) 100%);}
    .dshe-dots{position:absolute;inset:0 12px;display:flex;align-items:center;justify-content:space-between;pointer-events:none;}.dshe-dots span{width:4px;height:4px;flex:none;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-tertiary);opacity:.45;}.dshe-dots span[data-filled]{background:var(--dsw-static-neutral-00);}
    .dshe-thumb{position:absolute;top:0;left:var(--dshe-position);transform:translateX(-50%);box-sizing:border-box;width:24px;height:24px;border-radius:50%;corner-shape:round;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-static-neutral-00);box-shadow:var(--dsw-shadow-lv1);pointer-events:none;}
    .dshe-track input{display:block;position:relative;width:100%;height:24px;margin:0;padding:0;border:0;border-radius:12px;corner-shape:round;appearance:none;-webkit-appearance:none;background:transparent;cursor:pointer;touch-action:none;direction:ltr;}
    .dshe-track input::-webkit-slider-runnable-track{height:24px;border-radius:12px;corner-shape:round;background:transparent;}.dshe-track input::-moz-range-track{height:24px;border-radius:12px;corner-shape:round;background:transparent;}
    .dshe-track input::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;box-sizing:border-box;width:24px;height:24px;border-radius:50%;corner-shape:round;border:0;background:transparent;box-shadow:none;}.dshe-track input::-moz-range-thumb{box-sizing:border-box;width:24px;height:24px;border-radius:50%;corner-shape:round;border:0;background:transparent;box-shadow:none;}
    .dshe-track input:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:4px;}.dshe-track[data-disabled]{opacity:.5;}.dshe-track input:disabled{cursor:default;}.dshe-dots span:only-child{margin:auto;}
    .dshe-track[data-single] input{width:24px;margin-inline:auto;}.dshe-track[data-unknown]{background:var(--dsw-alias-interactive-bg-hover-solid);}.dshe-track[data-unknown] :is(input,.dshe-thumb){opacity:0;}
    .dshe-announcement{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;}
    .dshe-status{margin-top:10px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;overflow-wrap:anywhere;}
  `
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'effort: locale')
    ctx.effect(() => {
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-effort-slider'
      style.textContent = CSS
      document.head.append(style)
      return () => style.remove()
    }, 'effort: styles')
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.input.overlay', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'effort-slider',
              locale: NS,
              order: 65,
              inject(sessionId) {
                return {
                  sessionId,
                  directory: ctx.modelDirectories.directoryFor(sessionId),
                  connected: ctx.connection.generation,
                }
              },
            },
            EffortSlider,
          ),
        ),
      'effort: slider',
    )
  }
  return {
    inject: ['slots', 'locale', 'modelDirectories', 'connection'],
    apply,
    __test: { describe, selectionFor, selectAndConfirm, place },
  }
})
