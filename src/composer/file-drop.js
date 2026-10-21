/**
 * dsh-sidebar-file-drop 1.1.1 — merged feature of dsh-codex-style.
 *
 * Source: dsh-plugins/6cebd96 packages/dsh-sidebar-file-drop/client.js.
 * The factory wrapper is provided by scripts/build-client.mjs; the body still
 * returns { inject, apply } and is only built when the feature is enabled.
 */
__DSH_FEATURE('dsh-sidebar-file-drop', function (require, env) {
  const React = require('react')
  const { useEffect } = React

  const NS = 'sidebarFileDrop'

  const zh = {
    'toast.failed': '无法把文件加入输入框',
    'toast.noPath': '没有找到该文件的完整路径',
  }

  const en = {
    'toast.failed': 'Could not add the file to the composer',
    'toast.noPath': 'Could not resolve the full path of this file',
  }

  /** A Windows drive path or a POSIX absolute path inside surrounding text. */
  const PATH_PATTERN = /(?:^|[\s(])([A-Za-z]:[\\/][^"'\r\n<>|?*]+|\/[^"'\r\n]+)/u

  /**
   * Extract the first absolute path from a title/label/value string.
   * @param {string} value - candidate attribute.
   * @returns {string|null} trimmed path.
   */
  function pathIn(value) {
    if (typeof value !== 'string' || value.trim() === '') return null
    const raw = value.trim()
    if (/^file:/i.test(raw)) {
      try {
        const url = new URL(raw)
        const path = decodeURIComponent(url.pathname)
        if (url.hostname !== '' && url.hostname !== 'localhost')
          return '\\\\' + url.hostname + path.replace(/\//g, '\\')
        return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
      } catch {
        return null
      }
    }
    if (/^[A-Za-z]:[\\/]/.test(raw) || raw.startsWith('\\\\') || raw.startsWith('/')) return raw
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(raw)) return null
    const match = PATH_PATTERN.exec(raw)
    if (match === null) return null
    return match[1].trim()
  }

  /**
   * Find a path from a row's data attributes or accessible title.
   * @param {unknown} target - event target.
   * @returns {string|null} path.
   */
  function pathOf(target) {
    if (target === null || target === undefined || typeof target !== 'object') return null
    let node = target
    for (let depth = 0; depth < 5 && node !== null && node !== undefined; depth += 1) {
      for (const attr of [
        'data-path',
        'data-file-path',
        'data-workspace-path',
        'title',
        'aria-label',
      ]) {
        const value = node.getAttribute?.(attr)
        const path = pathIn(value)
        if (path !== null) return path
      }
      node = node.parentElement ?? null
    }
    return null
  }

  /** @param {Element} element @returns {boolean} whether it is in a sidebar. */
  function inSidebar(element) {
    return (
      element?.closest?.(
        '[data-sidebar-right-session], aside, [data-sidebar], [class*="sidebar" i]',
      ) !== null &&
      element?.closest?.(
        '[data-sidebar-right-session], aside, [data-sidebar], [class*="sidebar" i]',
      ) !== undefined
    )
  }

  /** @param {DataTransfer} transfer @returns {string|null} dropped path. */
  function droppedPath(transfer) {
    if (transfer === null || transfer === undefined) return null
    if ((transfer.files?.length ?? 0) > 0) return null
    for (const type of ['application/x-dsh-sidebar-path', 'text/uri-list', 'text/plain']) {
      const value = typeof transfer.getData === 'function' ? transfer.getData(type) : ''
      const candidate =
        type === 'text/uri-list'
          ? value.split(/\r?\n/).find((line) => line !== '' && !line.startsWith('#'))
          : value
      const path = pathIn(candidate)
      if (path !== null) return path
    }
    return null
  }

  /** @param {string} path @param {string|undefined} cwd @returns {string} relative or absolute path. */
  function relativeTo(path, cwd) {
    if (typeof cwd !== 'string' || cwd === '') return path
    const normalizedCwd = cwd.replace(/[\\/]+$/, '')
    const windows = /^[A-Za-z]:[\\/]|^\\\\/.test(path)
    const candidate = windows ? path.replace(/\\/g, '/').toLowerCase() : path
    const base = windows ? normalizedCwd.replace(/\\/g, '/').toLowerCase() : normalizedCwd
    if (candidate.startsWith(base + '/')) {
      return path.slice(normalizedCwd.length + 1)
    }
    return path
  }

  /**
   * DSH Desktop exposes `__DSH_DESKTOP_FILE_PATH__.getPathForFile` from the
   * Electron preload, but the composer reads `__DSH_HOST_PATHS__.pathFor`.
   * Wire the two names when the shell provides the former and no other plugin
   * already claimed the latter. This makes the Host's own `addFiles` branch
   * produce @path references for non-image files instead of uploads.
   * @returns {boolean} whether this plugin installed the bridge.
   */
  function installDesktopPathBridge() {
    try {
      const desktop = globalThis.__DSH_DESKTOP_FILE_PATH__
      if (desktop === null || desktop === undefined || typeof desktop.getPathForFile !== 'function')
        return false
      if (globalThis.__DSH_HOST_PATHS__ !== null && globalThis.__DSH_HOST_PATHS__ !== undefined)
        return false
      const previous = Object.getOwnPropertyDescriptor(globalThis, '__DSH_HOST_PATHS__')
      const bridge = {
        pathFor: (file) => {
          try {
            return desktop.getPathForFile(file) ?? ''
          } catch {
            return ''
          }
        },
      }
      globalThis.__DSH_HOST_PATHS__ = bridge
      return () => {
        if (globalThis.__DSH_HOST_PATHS__ !== bridge) return
        if (previous) Object.defineProperty(globalThis, '__DSH_HOST_PATHS__', previous)
        else delete globalThis.__DSH_HOST_PATHS__
      }
    } catch {
      return false
    }
  }

  /** @param {string} path @returns {string} path inside a reference mention. */
  function mentionOf(path) {
    return /\s/u.test(path) ? '@"' + path + '"' : '@' + path
  }

  /** @param {string} path @returns {string} final path segment. */
  function labelOf(path) {
    const trimmed = path.replace(/[\\/]+$/, '')
    const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
    return trimmed.slice(index + 1) || trimmed
  }

  /**
   * Invisible per-session layer: decorates sidebar rows, accepts drops.
   * @param {object} props - session id, injected actions and translator.
   * @returns {null} no React output.
   */
  function SidebarFileDropLayer({ sessionId, actions, t }) {
    useEffect(() => {
      const touched = new Map()
      const onMouseDown = (event) => {
        const element = event.target
        if (!inSidebar(element)) return
        const path = pathOf(element)
        if (path === null) return
        const row =
          element.closest?.('[data-file-path], [data-path], [title], [aria-label]') ?? element
        if (row.draggable !== true) {
          touched.set(row, { attribute: row.getAttribute?.('draggable'), property: row.draggable })
          row.draggable = true
        }
      }
      const onDragStart = (event) => {
        if (!inSidebar(event.target)) return
        const path = pathOf(event.target)
        if (path === null) return
        event.dataTransfer?.setData?.('application/x-dsh-sidebar-path', path)
        event.dataTransfer?.setData?.('text/plain', path)
        const uri = path.replace(/\\/g, '/')
        event.dataTransfer?.setData?.(
          'text/uri-list',
          encodeURI(
            uri.startsWith('//')
              ? 'file:' + uri
              : 'file://' + (uri.startsWith('/') ? '' : '/') + uri,
          )
            .replace(/#/g, '%23')
            .replace(/\?/g, '%3F'),
        )
        if (event.dataTransfer !== null && event.dataTransfer !== undefined)
          event.dataTransfer.effectAllowed = 'copy'
      }
      const composerOwner = (target) => {
        const card = target?.closest?.('[data-composer-card]')
        if (card === null || card === undefined) return null
        return card.closest?.('[data-conversation-session]') ?? null
      }
      const onDragOver = (event) => {
        if (composerOwner(event.target)?.getAttribute?.('data-conversation-session') !== sessionId)
          return
        if (droppedPath(event.dataTransfer) === null) return
        event.preventDefault?.()
        if (event.dataTransfer !== null && event.dataTransfer !== undefined)
          event.dataTransfer.dropEffect = 'copy'
      }
      const onDrop = (event) => {
        const target = event.target
        if (composerOwner(target)?.getAttribute?.('data-conversation-session') !== sessionId) return
        const path = droppedPath(event.dataTransfer)
        if (path === null) return
        event.preventDefault?.()
        event.stopPropagation?.()
        void actions.addPath(path, t('toast.failed'), t('toast.noPath'))
      }
      document.addEventListener('mousedown', onMouseDown, true)
      document.addEventListener('dragstart', onDragStart, true)
      document.addEventListener('dragover', onDragOver, true)
      document.addEventListener('drop', onDrop, true)
      return () => {
        document.removeEventListener('mousedown', onMouseDown, true)
        document.removeEventListener('dragstart', onDragStart, true)
        document.removeEventListener('dragover', onDragOver, true)
        document.removeEventListener('drop', onDrop, true)
        for (const [row, previous] of touched) {
          if (row.draggable !== true) continue
          if (previous.attribute == null) row.removeAttribute?.('draggable')
          else row.setAttribute?.('draggable', previous.attribute)
          row.draggable = previous.property
        }
      }
    }, [sessionId, actions, t])
    return null
  }

  function apply(ctx) {
    ctx.effect(() => {
      const restore = installDesktopPathBridge()
      return typeof restore === 'function' ? restore : () => {}
    }, 'sidebar-file-drop: desktop path bridge')
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sidebar-file-drop: dictionaries')
    ctx.effect(() =>
      ctx.slots.inject('conversation.input.right', () =>
        ctx.slots.register(
          {
            name: 'conversation.input.right',
            id: 'sidebar-file-drop.layer',
            locale: NS,
            inject: (sessionId) => {
              let conversation
              let shell
              let cwd
              try {
                const scope = ctx.sessions.scope(sessionId)
                conversation = scope?.get('conversation')
                shell = conversation?.input?.for?.(scope)
                cwd = ctx.sessions.list.getSnapshot()?.byId?.[sessionId]?.cwd
              } catch {
                conversation = undefined
                shell = undefined
              }
              const notify = (text) => {
                try {
                  shell?.notify?.('error', text)
                } catch {
                  // A disposed scope loses the non-critical notice.
                }
              }
              return {
                sessionId,
                actions: {
                  /**
                   * Insert a sidebar path as a file-reference chip.
                   * @param {string} rawPath - absolute dropped path.
                   * @param {string} failed - localized failure text.
                   * @param {string} noPath - localized missing-path text.
                   * @returns {Promise<boolean>} whether the reference was inserted.
                   */
                  addPath: async (rawPath, failed, noPath) => {
                    const path = pathIn(rawPath)
                    if (path === null) {
                      notify(noPath)
                      return false
                    }
                    if (typeof shell?.addFiles !== 'function') {
                      notify(failed)
                      return false
                    }
                    const relative = relativeTo(path, cwd)
                    const mention = mentionOf(relative)
                    const reference = {
                      source: 'reference',
                      ref: mention,
                      label: labelOf(path),
                      appearance: 'file',
                      clipboardText: mention,
                    }
                    try {
                      if (shell.addFiles([reference], []) !== true) {
                        notify(failed)
                        return false
                      }
                      return true
                    } catch {
                      notify(failed)
                      return false
                    }
                  },
                },
              }
            },
          },
          SidebarFileDropLayer,
        ),
      ),
    )
  }

  return {
    inject: ['slots', 'locale', 'sessions'],
    apply,
  }
})
