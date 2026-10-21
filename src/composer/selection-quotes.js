/** Composer-owned selected passages and their draft/send lifecycle. */
__DSH_FEATURE('dsh-selection-quotes', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const { useEffect, useLayoutEffect, useRef, useState } = React
  const h = React.createElement
  const NS = 'selectionQuotes'
  const ANNOTATION_STORE_KEY = 'dsh.quickFork.annotations'
  const ANNOTATION_MAX_COUNT = 20
  const ANNOTATION_MAX_TEXT = 20000
  const ANNOTATION_EMPTY = Object.freeze([])
  const zh = {
    'bubble.addToChat': '加入消息',
    'bubble.addToChatAria': '把选中内容作为引用加入当前消息',
    'bubble.addFailed': '添加引用失败，请稍后重试',
    'annotation.label': '引用',
    'annotation.panelTitle': '引用内容',
    'annotation.remove': '移除引用',
  }
  const en = {
    'bubble.addToChat': 'Add quote',
    'bubble.addToChatAria': 'Add the selected text as context for the next message',
    'bubble.addFailed': 'Could not add the quote; try again',
    'annotation.label': 'quote',
    'annotation.panelTitle': 'Quoted text',
    'annotation.remove': 'Remove quote',
  }

  function randomId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      return crypto.randomUUID()
    return String(Date.now()) + '-' + Math.random().toString(36).slice(2)
  }

  function inputShellOf(ctx, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') return null
    try {
      const sessions = ctx.sessions
      if (sessions === null || sessions === undefined || typeof sessions.scope !== 'function')
        return null
      const scope = sessions.scope(sessionId)
      if (scope === null || scope === undefined || typeof scope.get !== 'function') return null
      const conversation = scope.get('conversation')
      const shell = conversation?.input?.for?.(scope)
      return shell !== null && shell !== undefined ? shell : null
    } catch {
      return null
    }
  }

  /** Annotation lists by Session id (browser-local draft context, persisted). */
  const annotationBySession = loadAnnotationStore()
  const annotationListeners = new Set()
  const wrappedPrompts = new WeakSet()
  const promptDisposers = new Set()

  /** @returns {Map<string, Array<{id:string,text:string}>>} persisted annotation lists. */
  function loadAnnotationStore() {
    const store = new Map()
    try {
      if (typeof localStorage === 'undefined') return store
      const raw = JSON.parse(localStorage.getItem(ANNOTATION_STORE_KEY) ?? 'null')
      if (raw === null || typeof raw !== 'object') return store
      for (const [sessionId, items] of Object.entries(raw)) {
        if (typeof sessionId !== 'string' || !Array.isArray(items)) continue
        const list = items
          .filter(
            (item) =>
              item !== null &&
              typeof item === 'object' &&
              typeof item.text === 'string' &&
              item.text.trim() !== '',
          )
          .map((item) => ({
            id: typeof item.id === 'string' && item.id !== '' ? item.id : randomId(),
            text: item.text.slice(0, ANNOTATION_MAX_TEXT),
          }))
        if (list.length > 0) store.set(sessionId, list)
      }
    } catch {
      return new Map()
    }
    return store
  }

  /** Persist the current annotation lists; storage failures keep the in-page copy. */
  function saveAnnotationStore() {
    try {
      if (typeof localStorage === 'undefined') return
      const raw = {}
      for (const [sessionId, items] of annotationBySession)
        if (items.length > 0) raw[sessionId] = items
      if (Object.keys(raw).length === 0) localStorage.removeItem(ANNOTATION_STORE_KEY)
      else localStorage.setItem(ANNOTATION_STORE_KEY, JSON.stringify(raw))
    } catch {
      // Storage unavailable: annotations still work for this page.
    }
  }

  /** Notify every mounted annotation layer. */
  function notifyAnnotations() {
    for (const listener of [...annotationListeners]) {
      try {
        listener()
      } catch {
        // One bad listener must not stop the rest.
      }
    }
  }

  /** @param {() => void} listener @returns {() => void} unsubscribe. */
  function subscribeAnnotations(listener) {
    annotationListeners.add(listener)
    return () => {
      annotationListeners.delete(listener)
    }
  }

  /** @param {string} sessionId @returns {Array<{id:string,text:string}>} current list. */
  function annotationItemsOf(sessionId) {
    return annotationBySession.get(sessionId) ?? ANNOTATION_EMPTY
  }

  /** @param {string} sessionId @param {string} text @returns {boolean} whether it was added. */
  function addAnnotation(sessionId, text) {
    if (typeof sessionId !== 'string' || sessionId === '' || typeof text !== 'string') return false
    const trimmed = text.trim()
    if (trimmed === '') return false
    const items = annotationItemsOf(sessionId)
    if (items.length >= ANNOTATION_MAX_COUNT) return false
    annotationBySession.set(sessionId, [
      ...items,
      { id: randomId(), text: trimmed.slice(0, ANNOTATION_MAX_TEXT) },
    ])
    saveAnnotationStore()
    notifyAnnotations()
    return true
  }

  /** @param {string} sessionId @param {string} id @returns {boolean} whether it was removed. */
  function removeAnnotation(sessionId, id) {
    const items = annotationItemsOf(sessionId)
    const next = items.filter((item) => item.id !== id)
    if (next.length === items.length) return false
    if (next.length === 0) annotationBySession.delete(sessionId)
    else annotationBySession.set(sessionId, next)
    saveAnnotationStore()
    notifyAnnotations()
    return true
  }

  /** @param {string} sessionId @param {Array<{id:string,text:string}>} items - annotations to drop. */
  function forgetAnnotations(sessionId, items) {
    if (items.length === 0) return
    const ids = new Set(items.map((item) => item.id))
    const next = annotationItemsOf(sessionId).filter((item) => !ids.has(item.id))
    if (next.length === 0) annotationBySession.delete(sessionId)
    else annotationBySession.set(sessionId, next)
    saveAnnotationStore()
    notifyAnnotations()
  }

  /** @param {string} sessionId @param {Array<{id:string,text:string}>} items - annotations to put back. */
  function restoreAnnotations(sessionId, items) {
    if (items.length === 0) return
    const current = annotationItemsOf(sessionId)
    const known = new Set(current.map((item) => item.id))
    const missing = items.filter((item) => !known.has(item.id))
    if (missing.length === 0) return
    // Rollback restores accepted user data. The count limit governs new
    // additions, never a failed send or a persisted restore.
    annotationBySession.set(sessionId, [...missing, ...current])
    saveAnnotationStore()
    notifyAnnotations()
  }

  /**
   * Model-facing context for one submission: numbered selected passages.
   * @param {Array<{text:string}>} items - annotations in display order.
   * @returns {string} context text, or '' when nothing can be sent.
   */
  function annotationContextOf(items) {
    if (!Array.isArray(items) || items.length === 0) return ''
    return items
      .filter(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          typeof item.text === 'string' &&
          item.text.trim() !== '',
      )
      .map((item, index) => 'Selected text ' + String(index + 1) + ':\n' + item.text.trim())
      .join('\n\n')
  }

  /**
   * Wrap one Session's prompt so pending annotations travel as a leading text
   * block. Annotations leave the draft when the send starts; a rejected prompt
   * puts the same annotations back in their original order.
   * @param {object} ctx - root client context.
   * @param {string} sessionId - owning Session id.
   */
  function ensureAnnotationPromptWrapper(ctx, sessionId) {
    try {
      const binding = ctx.sessions?.binding?.(sessionId)
      const session = binding?.session
      if (session === null || session === undefined || typeof session.prompt !== 'function') return
      if (wrappedPrompts.has(session)) return
      const original = session.prompt
      const patched = async function promptWithAnnotations(content, mode, signal, requestId) {
        const pending = annotationItemsOf(sessionId).slice()
        const context = pending.length === 0 ? '' : annotationContextOf(pending)
        if (context === '' || !Array.isArray(content))
          return original.call(this, content, mode, signal, requestId)
        forgetAnnotations(sessionId, pending)
        let result
        try {
          result = await original.call(
            this,
            [{ type: 'text', text: context }, ...content],
            mode,
            signal,
            requestId,
          )
        } catch (error) {
          restoreAnnotations(sessionId, pending)
          throw error
        }
        if (result === null || result === undefined || result.ok !== true)
          restoreAnnotations(sessionId, pending)
        return result
      }
      session.prompt = patched
      wrappedPrompts.add(session)
      promptDisposers.add(() => {
        if (session.prompt === patched) session.prompt = original
        wrappedPrompts.delete(session)
      })
    } catch {
      // Wrapping is best effort; annotations still show even without submission context.
    }
  }

  /**
   * Find or create the annotation row host directly above one composer editor.
   * @param {Element} card - `[data-composer-card]` element.
   * @returns {Element} the host element.
   */
  function ensureAnnotationHost(card) {
    let host = null
    for (const child of card.children) {
      if (child?.getAttribute?.('data-dsh-quick-fork-annotations') !== null) {
        host = child
        break
      }
    }
    if (host === null) {
      host = document.createElement('div')
      host.setAttribute('data-dsh-quick-fork-annotations', '')
      host.className = 'dshqf-annotations'
      host.style.display = 'none'
    }
    const editor = card.querySelector(':scope > [data-input-scroll]')
    if (editor !== null && editor.parentElement === card) {
      if (host.parentElement !== card || host.nextElementSibling !== editor)
        card.insertBefore(host, editor)
    } else if (host.parentElement !== card) {
      card.appendChild(host)
    }
    return host
  }

  /**
   * Build the composer annotation layer: numbered chips inside the composer
   * card, each with a hover panel that shows the full selected passage.
   * @param {object} ctx - root client context.
   * @returns {Function} React component registered into the composer overlay.
   */
  function createAnnotationChips(ctx) {
    return function AnnotationChipLayer({ sessionId, t }) {
      const [marker, setMarker] = useState(null)
      const [host, setHost] = useState(null)
      const [items, setItems] = useState(() => annotationItemsOf(sessionId))
      const [hover, setHover] = useState(null)
      const [panelPosition, setPanelPosition] = useState(null)
      const hoverTimerRef = useRef(null)
      const panelRef = useRef(null)

      useEffect(() => {
        setItems(annotationItemsOf(sessionId))
        return subscribeAnnotations(() => setItems(annotationItemsOf(sessionId)))
      }, [sessionId])

      useEffect(() => {
        ensureAnnotationPromptWrapper(ctx, sessionId)
      }, [sessionId])

      useEffect(() => {
        if (marker === null) {
          setHost(null)
          return undefined
        }
        const card =
          typeof marker.closest === 'function' ? marker.closest('[data-composer-card]') : null
        if (card === null) {
          setHost(null)
          return undefined
        }
        const target = ensureAnnotationHost(card)
        setHost(target)
        let observer
        if (typeof MutationObserver === 'function') {
          observer = new MutationObserver(() => {
            if (card.contains(target) && target.parentElement === card) return
            setHost(ensureAnnotationHost(card))
          })
          observer.observe(card, { childList: true })
        }
        return () => {
          observer?.disconnect?.()
          target.remove?.()
        }
      }, [marker, sessionId])

      useEffect(() => {
        if (host === null) return
        host.style.display = items.length === 0 ? 'none' : 'flex'
      }, [host, items.length])

      useEffect(
        () => () => {
          if (hoverTimerRef.current !== null) clearTimeout(hoverTimerRef.current)
        },
        [],
      )

      // Measure the hover panel before painting so it never flashes at a stale spot.
      useLayoutEffect(() => {
        if (hover === null || panelRef.current === null) {
          setPanelPosition(null)
          return
        }
        const update = () => {
          if (!hover.anchor?.isConnected) { setHover(null); return }
          const panel = panelRef.current
          if (!panel) return
          const viewport = window.visualViewport ?? { width: window.innerWidth, height: window.innerHeight }
          const x = (viewport.offsetLeft ?? 0) + 8
          const y = Math.max(viewport.offsetTop ?? 0,
            parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-chrome-top')) || 0) + 8
          const right = (viewport.offsetLeft ?? 0) + viewport.width - 8
          const bottom = (viewport.offsetTop ?? 0) + viewport.height - 8
          panel.style.maxWidth = Math.max(1, right - x) + 'px'
          panel.style.maxHeight = Math.max(1, bottom - y) + 'px'
          const anchor = hover.anchor.getBoundingClientRect()
          const aboveRoom = Math.max(0, anchor.top - y - 8)
          const belowRoom = Math.max(0, bottom - anchor.bottom - 8)
          const above = panel.offsetHeight <= aboveRoom || aboveRoom >= belowRoom
          panel.style.maxHeight = Math.max(1, above ? aboveRoom : belowRoom) + 'px'
          const rect = panel.getBoundingClientRect()
          const left = Math.max(x, Math.min(anchor.left + anchor.width / 2 - rect.width / 2, right - rect.width))
          const top = Math.max(y, Math.min(above ? anchor.top - rect.height - 8 : anchor.bottom + 8, bottom - rect.height))
          setPanelPosition((current) => current?.left === left && current?.top === top ? current : { left, top })
        }
        update()
        const resize = new ResizeObserver(update)
        resize.observe(panelRef.current)
        resize.observe(hover.anchor)
        window.addEventListener('resize', update)
        window.addEventListener('scroll', update, true)
        window.visualViewport?.addEventListener('resize', update)
        window.visualViewport?.addEventListener('scroll', update)
        return () => {
          resize.disconnect()
          window.removeEventListener('resize', update)
          window.removeEventListener('scroll', update, true)
          window.visualViewport?.removeEventListener('resize', update)
          window.visualViewport?.removeEventListener('scroll', update)
        }
      }, [hover, items])

      const cancelHide = () => {
        if (hoverTimerRef.current === null) return
        clearTimeout(hoverTimerRef.current)
        hoverTimerRef.current = null
      }
      const scheduleHide = () => {
        cancelHide()
        hoverTimerRef.current = setTimeout(() => {
          hoverTimerRef.current = null
          setHover(null)
        }, 180)
      }
      const showHover = (item, element) => {
        if (typeof element?.getBoundingClientRect !== 'function') return
        cancelHide()
        setHover({ id: item.id, anchor: element })
      }

      const hoveredIndex = hover === null ? -1 : items.findIndex((item) => item.id === hover.id)
      const hoveredItem = hoveredIndex >= 0 ? items[hoveredIndex] : null
      const hoverPanel =
        hoveredItem === null
          ? null
          : createPortal(
              h(
                'div',
                {
                  ref: panelRef,
                  className: 'dshqf-annotationPanel',
                  role: 'tooltip',
                  style:
                    panelPosition === null
                      ? { left: '-9999px', top: '-9999px' }
                      : { left: panelPosition.left + 'px', top: panelPosition.top + 'px' },
                  onMouseEnter: cancelHide,
                  onMouseLeave: scheduleHide,
                },
                h(
                  'div',
                  { className: 'dshqf-annotationPanelTitle' },
                  String(hoveredIndex + 1) + '. ' + t('annotation.panelTitle'),
                ),
                h('div', { className: 'dshqf-annotationPanelText' }, hoveredItem.text),
              ),
              document.body,
            )
      const row = h(
        'div',
        { className: 'dshqf-annotationRow', role: 'list' },
        items.map((item, index) =>
          h(
            'span',
            {
              key: item.id,
              className:
                'dshqf-annotation' +
                (hover !== null && hover.id === item.id ? ' dshqf-annotationActive' : ''),
              role: 'listitem',
              tabIndex: 0,
              onMouseEnter: (event) => showHover(item, event.currentTarget),
              onMouseLeave: scheduleHide,
              onFocus: (event) => showHover(item, event.currentTarget),
              onBlur: scheduleHide,
            },
            h(
              'span',
              { className: 'dshqf-annotationNum', 'aria-hidden': true },
              String(index + 1) + '.',
            ),
            h('span', { className: 'dshqf-annotationLabel' }, t('annotation.label')),
            h(
              'button',
              {
                type: 'button',
                className: 'dshqf-annotationRemove',
                'aria-label': t('annotation.remove'),
                onMouseDown: (event) => {
                  event.stopPropagation?.()
                },
                onClick: (event) => {
                  event.stopPropagation?.()
                  if (hover !== null && hover.id === item.id) setHover(null)
                  removeAnnotation(sessionId, item.id)
                },
              },
              '×',
            ),
          ),
        ),
      )
      const markerEl = h('span', { key: 'annotation-marker', ref: setMarker, hidden: true })
      if (host === null) return markerEl
      return h(React.Fragment, null, markerEl, createPortal(row, host), hoverPanel)
    }
  }

  const CSS = `.dshqf-annotations{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.dshqf-annotationRow{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.dshqf-annotation{display:inline-flex;align-items:center;gap:6px;max-width:260px;height:24px;padding:0 4px 0 8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;outline:none}
.dshqf-annotation:hover,.dshqf-annotationActive{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshqf-annotation:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dshqf-annotationNum{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dshqf-annotationLabel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshqf-annotationRemove{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary);font:inherit;font-size:13px;line-height:1;cursor:pointer}
.dshqf-annotationRemove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshqf-annotationPanel{position:fixed;z-index:130;box-sizing:border-box;width:max-content;min-width:min(200px,calc(100vw - 16px));max-width:min(420px,calc(100vw - 16px));overflow:auto;overscroll-behavior:contain;border:0;border-radius:10px;background:var(--dsw-alias-bg-base);box-shadow:var(--dsw-elevation-soft);padding:10px 12px;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5}
.dshqf-annotationPanelTitle{font-weight:600;margin-bottom:6px}
.dshqf-annotationPanelText{white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;color:var(--dsw-alias-label-secondary)}`
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'selection-quotes: locale')
    ctx.effect(() => {
      const state = {
        has: (sessionId) => annotationItemsOf(sessionId).length > 0,
        subscribe: subscribeAnnotations,
      }
      env.selectionQuoteState = state
      return () => {
        if (env.selectionQuoteState === state) delete env.selectionQuoteState
        notifyAnnotations()
      }
    }, 'selection-quotes: composer readiness')
    const t = ctx.locale.bind(NS)
    ctx.effect(() => {
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-selection-quotes'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }, 'selection-quotes: styles')
    ctx.effect(
      () => () => {
        for (const dispose of promptDisposers) dispose()
        promptDisposers.clear()
      },
      'selection-quotes: prompt ownership',
    )
    ctx.effect(
      () =>
        env.selectionActions.register({
          id: 'composer.quote-selection',
          order: 10,
          label: () => t('bubble.addToChat'),
          ariaLabel: () => t('bubble.addToChatAria'),
          supports: ({ sessionId }) => {
            const shell = inputShellOf(ctx, sessionId)
            return shell !== null && !['adjudicating', 'submitting'].includes(shell.snapshot?.phase)
          },
          run({ sessionId, text }) {
            const shell = inputShellOf(ctx, sessionId)
            ensureAnnotationPromptWrapper(ctx, sessionId)
            if (!addAnnotation(sessionId, text)) {
              shell?.notify?.('error', t('bubble.addFailed'))
              return false
            }
            shell?.focus?.()
            return true
          },
        }),
      'selection-quotes: action provider',
    )
    const Chips = createAnnotationChips(ctx)
    ctx.effect(
      () =>
        ctx.slots.inject('conversation.input.overlay', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.overlay',
              id: 'selection-quotes.chips',
              order: 40,
              locale: NS,
              inject: (sessionId) => ({ sessionId }),
            },
            Chips,
          ),
        ),
      'selection-quotes: composer overlay',
    )
  }
  return {
    inject: ['sessions', 'slots', 'locale'],
    apply,
    __test: {
      annotationContextOf,
      addAnnotation,
      annotationItemsOf,
      removeAnnotation,
      forgetAnnotations,
      restoreAnnotations,
      ensureAnnotationPromptWrapper,
    },
  }
})
