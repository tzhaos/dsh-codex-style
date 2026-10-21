/** Conversation content owns selection geometry; providers supply the actions. */
__DSH_FEATURE('dsh-selection-toolbar', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const { useEffect, useLayoutEffect, useRef, useState } = React
  const h = React.createElement
  const NS = 'selectionToolbar'
  const zh = { actions: '选中文字操作' }
  const en = { actions: 'Selection actions' }
  function ownerOf(node) {
    const element = node?.nodeType === 3 ? node.parentElement : node
    if (
      element?.closest?.(
        '[contenteditable]:not([contenteditable="false"]), textarea, input, [data-conversation-region="composer"], [data-composer-card], [data-queue-dock]',
      )
    )
      return null
    return element?.closest?.('[data-conversation-session]') ?? null
  }
  function Toolbar({ t }) {
    const [selection, setSelection] = useState(null)
    const [version, setVersion] = useState(0)
    const [position, setPosition] = useState(null)
    const ref = useRef(null)
    useEffect(() => env.selectionActions.subscribe(() => setVersion((value) => value + 1)), [])
    useEffect(() => {
      const clear = () => setSelection(null)
      const update = () => {
        const selected = window.getSelection()
        const owner = ownerOf(selected?.anchorNode)
        const text = selected?.toString().trim() ?? ''
        if (!owner || owner !== ownerOf(selected?.focusNode) || !text || !selected.rangeCount) {
          clear()
          return
        }
        const sessionId = owner.getAttribute('data-conversation-session')
        if (!sessionId || owner.closest('[hidden], [aria-hidden="true"]')) {
          clear()
          return
        }
        const rect = selected.getRangeAt(0).getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) {
          clear()
          return
        }
        setSelection({
          sessionId,
          text: text.slice(0, 20000),
          x: rect.left + rect.width / 2,
          y: rect.top,
          bottom: rect.bottom,
        })
      }
      document.addEventListener('selectionchange', update)
      document.addEventListener('mouseup', update)
      document.addEventListener('keyup', update)
      window.addEventListener('scroll', clear, true)
      window.addEventListener('resize', clear)
      return () => {
        document.removeEventListener('selectionchange', update)
        document.removeEventListener('mouseup', update)
        document.removeEventListener('keyup', update)
        window.removeEventListener('scroll', clear, true)
        window.removeEventListener('resize', clear)
      }
    }, [])
    useLayoutEffect(() => {
      if (!selection || !ref.current) {
        setPosition(null)
        return
      }
      const rect = ref.current.getBoundingClientRect()
      const viewport = window.visualViewport ?? { width: innerWidth, height: innerHeight }
      const left = (viewport.offsetLeft ?? 0) + 8
      const top = Math.max(viewport.offsetTop ?? 0,
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-chrome-top')) || 0) + 8
      const right = (viewport.offsetLeft ?? 0) + viewport.width - 8
      const bottom = (viewport.offsetTop ?? 0) + viewport.height - 8
      setPosition({
        left: Math.max(left, Math.min(selection.x - rect.width / 2, right - rect.width)),
        top: Math.max(top, Math.min(selection.y - rect.height - 8 >= top
          ? selection.y - rect.height - 8 : selection.bottom + 8, bottom - rect.height)),
      })
    }, [selection, version])
    if (!selection) return null
    const actions = env.selectionActions.available(selection)
    if (!actions.length) return null
    return createPortal(
      h(
        'div',
        {
          ref,
          className: 'dsh-selection-toolbar',
          role: 'toolbar',
          'aria-label': t('actions'),
          style: position ?? { left: -9999, top: -9999 },
          onMouseDown: (event) => event.preventDefault(),
        },
        actions.map((action) =>
          h(
            'button',
            {
              type: 'button',
              key: action.id,
              className: 'dsh-selection-action',
              'aria-label': action.ariaLabel?.() ?? action.label(),
              onClick: () => {
                void env.selectionActions.invoke(action.id, selection)
                setSelection(null)
              },
            },
            action.label(),
          ),
        ),
      ),
      document.body,
    )
  }
  const CSS = `
.dsh-selection-toolbar { position: fixed; z-index: 120; display: inline-flex; align-items: stretch; min-height: 30px; max-width: calc(100vw - 16px); border: 0; border-radius: 999px; corner-shape: round; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-soft); font-family: var(--dsw-font-family); overflow: hidden; }
.dsh-selection-action { appearance: none; min-width:0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; line-height: 18px; padding: 5px 12px; white-space: normal; overflow-wrap:anywhere; cursor: pointer; }
.dsh-selection-action + .dsh-selection-action { border-left: .5px solid var(--dsw-alias-border-l2); }
.dsh-selection-action:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsh-selection-action:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
`
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'selection-toolbar: locale')
    ctx.effect(() => {
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-selection-toolbar'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => style.remove()
    }, 'selection-toolbar: styles')
    ctx.effect(
      () =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            { name: 'shell.overlay', id: 'selection-toolbar', locale: NS },
            Toolbar,
          ),
        ),
      'selection-toolbar: overlay',
    )
  }
  return { inject: ['slots', 'locale'], apply, __test: { ownerOf } }
})
