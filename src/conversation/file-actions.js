/**
 * dsh-file-link-actions 1.0.0 — merged feature of dsh-codex-style.
 *
 * Source: dsh-plugins/6cebd96 packages/dsh-file-link-actions/client.js.
 * The factory wrapper is provided by scripts/build-client.mjs; the body still
 * returns { inject, apply } and is only built when the feature is enabled.
 */
__DSH_FEATURE('dsh-file-link-actions', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  const {
    Menu,
    writeClipboard,
    IconLinkOutlineRegular,
    IconFolderOpenRegular,
    IconCopyOutlineRegular,
  } = primitives
  const { useEffect, useRef, useState } = React
  const h = React.createElement

  /** Locale namespace owned by this plugin. */
  const NS = 'fileLinkActions'

  const zh = {
    'menu.open': '用默认应用打开',
    'menu.reveal': '打开所在文件夹',
    'menu.copyPath': '复制文件路径',
    'toast.copied': '已复制文件路径',
    'toast.unresolved': '无法确定该文件所在的工作区，请尝试绝对路径',
    'toast.failed': '打开失败：{message}',
  }

  const en = {
    'menu.open': 'Open with default app',
    'menu.reveal': 'Open containing folder',
    'menu.copyPath': 'Copy file path',
    'toast.copied': 'File path copied',
    'toast.unresolved': 'Could not locate the owning workspace; try an absolute path',
    'toast.failed': 'Could not open: {message}',
  }

  /** @param {unknown} error - anything a Host call rejected with. */
  function messageOf(error) {
    if (error instanceof Error) return error.message
    if (typeof error === 'string') return error
    if (error !== null && typeof error === 'object' && typeof error.message === 'string')
      return error.message
    return 'unknown error'
  }

  /**
   * Join a file reference against its conversation workspace.
   * The Host path opener requires an absolute Host path; relative links are
   * what the agent usually writes, so the workspace directory is essential.
   * @param {string} raw - path as carried by the rendered file link.
   * @param {string|undefined} cwd - owning conversation workspace.
   * @returns {string|undefined} absolute path, or undefined when it cannot be resolved.
   */
  function resolvePath(raw, cwd) {
    const path = raw.trim()
    if (path === '') return undefined
    if (/^[a-zA-Z]:[\\/]/.test(path)) return path
    if (/^[\\/]{2}/.test(path)) return path
    if (path.startsWith('/')) return path
    if (cwd === undefined || cwd === '') return undefined
    const separator = cwd.includes('\\') ? '\\' : '/'
    return (
      cwd.replace(/[\\/]+$/, '') +
      separator +
      path.replace(/^[.][\\/]/, '').replace(/[\\/]/g, separator)
    )
  }

  /**
   * Locate the rendered local-file button behind a context-menu target.
   * The conversation markdown renderer gives these buttons a hashed
   * `fileLink` / `fileMention` class and stores the file path in `title`.
   * The classes only occur on conversation markdown file links, so they are
   * sufficient to identify the control without relying on a markdown wrapper
   * attribute (the normal body variant does not render one).
   * @param {EventTarget|null} target - context-menu target.
   * @returns {{button: Element, path: string}|undefined} file link, if any.
   */
  function findFileLink(target) {
    if (target === null || target === undefined || typeof target.closest !== 'function')
      return undefined
    const button = target.closest('button')
    if (button === null || button === undefined) return undefined
    const className = typeof button.className === 'string' ? button.className : ''
    if (!className.includes('fileLink') && !className.includes('fileMention')) return undefined
    const title = button.getAttribute?.('title')
    if (typeof title !== 'string' || title.trim() === '') return undefined
    return { button, path: title.trim() }
  }

  /**
   * @param {Element} button - rendered file-link button.
   * @returns {string|undefined} owning conversation id.
   */
  function sessionOf(button) {
    const occurrence = button.closest('[data-conversation-session]')
    if (occurrence === null || occurrence === undefined) return undefined
    const id = occurrence.getAttribute?.('data-conversation-session')
    return typeof id === 'string' && id !== '' ? id : undefined
  }

  /** @param {string} path - absolute path. */
  function basename(path) {
    const parts = path.split(/[\\/]/).filter((part) => part !== '')
    return parts.length === 0 ? path : parts[parts.length - 1]
  }

  /**
   * The menu itself. It listens to context-menu events at capture time so the
   * shipped text-selection menu never opens over a file link.
   * @param {object} props - injected actions and locale seat.
   * @returns {object|null} menu and transient notice.
   */
  function FileLinkOverlay({ actions, t }) {
    const [menu, setMenu] = useState(null)
    const [notice, setNotice] = useState(null)
    const noticeTimer = useRef(null)

    useEffect(
      () => () => {
        if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
      },
      [],
    )

    useEffect(() => {
      if (notice === null) return undefined
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
      noticeTimer.current = window.setTimeout(() => {
        noticeTimer.current = null
        setNotice(null)
      }, 4500)
      return () => {
        if (noticeTimer.current !== null) {
          window.clearTimeout(noticeTimer.current)
          noticeTimer.current = null
        }
      }
    }, [notice])

    useEffect(() => {
      if (typeof document === 'undefined' || typeof document.addEventListener !== 'function')
        return undefined
      const onContextMenu = (event) => {
        const hit = findFileLink(event.target)
        if (hit === undefined) return
        event.preventDefault()
        event.stopPropagation?.()
        event.stopImmediatePropagation?.()
        const sessionId = sessionOf(hit.button)
        const cwd = sessionId === undefined ? undefined : actions.sessionCwd(sessionId)
        const absolute = resolvePath(hit.path, cwd)
        let point = { x: event.clientX ?? 0, y: event.clientY ?? 0 }
        if (
          (point.x === 0 && point.y === 0) ||
          typeof point.x !== 'number' ||
          typeof point.y !== 'number'
        ) {
          const rect = hit.button.getBoundingClientRect?.()
          point = rect === undefined ? point : { x: rect.left, y: rect.bottom }
        }
        setNotice(null)
        setMenu({
          point,
          raw: hit.path,
          path: absolute,
          label: basename(hit.path),
        })
      }
      document.addEventListener('contextmenu', onContextMenu, true)
      return () => {
        document.removeEventListener('contextmenu', onContextMenu, true)
      }
    }, [actions])

    if (menu === null) {
      return notice === null
        ? null
        : createPortal(
            h('div', { className: 'dshfl-toast', role: 'status' }, notice),
            document.body,
          )
    }

    const rect = {
      left: menu.point.x,
      top: menu.point.y,
      right: menu.point.x,
      bottom: menu.point.y,
      width: 0,
      height: 0,
      x: menu.point.x,
      y: menu.point.y,
      toJSON() {
        return this
      },
    }
    const items = [
      { type: 'label', id: 'file', text: menu.label },
      { id: 'open', label: t('menu.open'), icon: h(IconLinkOutlineRegular, { size: 14 }) },
      { id: 'reveal', label: t('menu.reveal'), icon: h(IconFolderOpenRegular, { size: 14 }) },
      { type: 'separator', id: 'separator' },
      { id: 'copy', label: t('menu.copyPath'), icon: h(IconCopyOutlineRegular, { size: 14 }) },
    ]

    const report = (message) => {
      setNotice(message)
    }
    const openOrReveal = (path, reveal) => {
      const action = reveal ? actions.revealPath(path) : actions.openPath(path)
      Promise.resolve(action).catch((error) => {
        report(t('toast.failed', { message: messageOf(error) }))
      })
    }

    return h(
      React.Fragment,
      null,
      h(Menu, {
        listClassName: 'dsh-motion-surface',
        key: 'dshfl-menu',
        open: true,
        onClose: () => {
          setMenu(null)
        },
        portal: true,
        align: 'start',
        side: 'bottom',
        anchor: h('span', { className: 'dshfl-anchor' }),
        getAnchorRect: () => rect,
        items,
        onSelect: (id) => {
          const current = menu
          setMenu(null)
          if (id === 'copy') {
            Promise.resolve(actions.copyPath(current.path ?? current.raw)).then(
              () => {
                report(t('toast.copied'))
              },
              (error) => {
                report(t('toast.failed', { message: messageOf(error) }))
              },
            )
            return
          }
          if (current.path === undefined) {
            report(t('toast.unresolved'))
            return
          }
          if (id === 'open') openOrReveal(current.path, false)
          else if (id === 'reveal') openOrReveal(current.path, true)
        },
      }),
      notice === null
        ? null
        : createPortal(
            h('div', { className: 'dshfl-toast', role: 'status' }, notice),
            document.body,
          ),
    )
  }

  /** Styles are presentation only; every color comes from a theme token. */
  const CSS = `
.dshfl-anchor {
  display: none;
}
.dshfl-toast {
  position: fixed;
  left: 50%;
  bottom: 34px;
  z-index: 110;
  transform: translateX(-50%);
  max-width: min(560px, calc(100vw - 48px));
  box-sizing: border-box;
  padding: 10px 16px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 13px;
  line-height: 20px;
}
`

  /**
   * Register the overlay that owns the context-menu listener.
   * @param {object} ctx - Client root context.
   */
  function apply(ctx) {
    const remote = ctx.get('remote')
    const sessions = ctx.get('sessions')
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'file-link-actions: dictionaries')
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function')
        return () => {}
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-file-link-actions'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        style.remove?.()
      }
    }, 'file-link-actions: styles')

    const actions = {
      /**
       * Open a workspace path in its default application.
       * @param {string} path - absolute Host path.
       * @returns {Promise<void>} settles after the Host accepts the gesture.
       */
      openPath: async (path) => {
        const result = await remote.session.openWorkspacePath({ path })
        if (result !== null && typeof result === 'object' && result.ok === false) {
          throw new Error(result.error?.message ?? result.error?.code ?? 'open failed')
        }
      },
      /**
       * Reveal a workspace path in the OS file manager.
       * @param {string} path - absolute Host path.
       * @returns {Promise<void>} settles after the Host accepts the gesture.
       */
      revealPath: async (path) => {
        const result = await remote.session.openWorkspacePath({ path, action: 'reveal' })
        if (result !== null && typeof result === 'object' && result.ok === false) {
          throw new Error(result.error?.message ?? result.error?.code ?? 'reveal failed')
        }
      },
      /** @param {string} path - text to put on the clipboard. */
      copyPath: (path) => writeClipboard(path),
      /**
       * Read the owning conversation's workspace directory from the live session list.
       * @param {string} sessionId - conversation id from the DOM owner.
       * @returns {string|undefined} absolute workspace path.
       */
      sessionCwd: (sessionId) => {
        try {
          const snapshot = sessions?.list?.getSnapshot?.()
          const entry = snapshot?.byId?.[sessionId]
          return typeof entry?.cwd === 'string' && entry.cwd !== '' ? entry.cwd : undefined
        } catch {
          return undefined
        }
      },
    }

    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register(
        {
          name: 'shell.overlay',
          id: 'file-link-actions.menu',
          locale: NS,
          inject: () => ({ actions }),
        },
        FileLinkOverlay,
      ),
    )
  }

  return {
    /** Services this Client plugin waits for before applying. */
    inject: ['slots', 'locale', 'sessions', 'remote', 'remote.session'],
    apply,
  }
})
