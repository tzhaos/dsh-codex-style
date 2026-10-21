/** Shared sidebar controls, activity projection and native search dialog. */
env.createSidebarTools = function (React, primitives, createPortal) {
  const {
    Modal,
    StateDot,
    Tooltip,
    IconSearchOutlineRegular,
    IconFolderCloseRegular,
    IconFolderOpenRegular,
  } = primitives
  const { useEffect, useLayoutEffect, useMemo, useRef, useState, useId } = React
  const h = React.createElement
  const SIDEBAR = '.BynINW_sidebarCol'
  const PREVIEW = 'codexActivityPreview'
  const messages = {
    zh: {
      'tools.activity': '活动视图',
      'tools.projects': '返回项目视图',
      'tools.search': '搜索聊天',
      'tools.chats': '聊天',
      'tools.quick': '快捷操作',
      'tools.folder': '打开文件夹',
      'tools.files': '浏览文件',
      'tools.empty': '没有匹配的聊天',
      'tools.loading': '正在搜索…',
      'tools.failed': '搜索失败，请重试。',
      'tools.openFailed': '操作失败，请重试。',
      'tools.more': '还有更多匹配，请缩小搜索范围。',
      'tools.priority': '优先级',
      'tools.today': '今天',
      'tools.yesterday': '昨天',
      'tools.earlier': '更早',
      'tools.activityEmpty': '暂无聊天活动',
      'tools.moreActivity': '显示更多',
    },
    en: {
      'tools.activity': 'Activity view',
      'tools.projects': 'Back to projects',
      'tools.search': 'Search chats',
      'tools.chats': 'Chats',
      'tools.quick': 'Quick actions',
      'tools.folder': 'Open folder',
      'tools.files': 'Browse files',
      'tools.empty': 'No matching chats',
      'tools.loading': 'Searching…',
      'tools.failed': 'Search failed. Try again.',
      'tools.openFailed': 'Could not complete the action. Try again.',
      'tools.more': 'More matches are available. Refine your search.',
      'tools.priority': 'Priority',
      'tools.today': 'Today',
      'tools.yesterday': 'Yesterday',
      'tools.earlier': 'Earlier',
      'tools.activityEmpty': 'No chat activity yet',
      'tools.moreActivity': 'Show more',
    },
  }
  function createControls(createStore) {
    const store = createStore({ view: 'projects', searchOpen: false })
    let origin = null,
      quickHandler = null
    const update = (patch) => {
      const state = store.getSnapshot()
      if (Object.keys(patch).some((key) => state[key] !== patch[key]))
        store.set({ ...state, ...patch })
    }
    return {
      store,
      toggleActivity() {
        update({ view: store.getSnapshot().view === 'activity' ? 'projects' : 'activity' })
      },
      openSearch(element) {
        if (store.getSnapshot().searchOpen) return
        origin = element ?? document.activeElement
        update({ searchOpen: true })
      },
      closeSearch(restore = true) {
        update({ searchOpen: false })
        if (restore)
          queueMicrotask(() => {
            if (origin?.isConnected) origin.focus({ preventScroll: true })
          })
      },
      toggleSearch() {
        if (store.getSnapshot().searchOpen) this.closeSearch()
        else this.openSearch()
      },
      origin: () => origin,
      installQuickHandler(handler) {
        quickHandler = handler
        return () => {
          if (quickHandler === handler) quickHandler = null
        }
      },
      invokeQuick(command) {
        return store.getSnapshot().searchOpen && quickHandler?.(command)
      },
    }
  }
  function useSource(source, fallback) {
    const [value, setValue] = useState(() => source?.getSnapshot?.() ?? fallback)
    useEffect(() => {
      setValue(source?.getSnapshot?.() ?? fallback)
      return source?.subscribe?.(() => setValue(source.getSnapshot()))
    }, [source])
    return value
  }
  function previewOf(summary, projection) {
    const values = projection?.values
    const source = values && Object.hasOwn(values, PREVIEW) ? values : summary?.projectionValues
    if (!source || !Object.hasOwn(source, PREVIEW)) return { known: false, text: '' }
    const value = source[PREVIEW]
    if (value === null) return { known: true, text: '' }
    const valid =
      value &&
      ['user', 'assistant'].includes(value.role) &&
      typeof value.text === 'string' &&
      value.text.length <= 480 &&
      Number.isSafeInteger(value.seq) &&
      value.seq >= 0 &&
      Number.isFinite(value.time)
    return { known: true, text: valid ? value.text : '' }
  }
  function activityGroups(nodes, now, t, locale = 'zh-CN') {
    const rank = (node) =>
      node.status.state === 'warning'
        ? 4
        : node.status.state === 'ongoing'
          ? 3
          : node.status.state === 'done'
            ? 2
            : node.pinned
              ? 1
              : 0
    const rows = nodes.filter((node) => !node.blank && !node.archived)
    const priority = rows
      .filter((node) => rank(node) > 0)
      .sort((a, b) => rank(b) - rank(a) || b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    const groups = priority.length
      ? [{ key: 'priority', label: t('tools.priority'), nodes: priority }]
      : []
    const byDay = new Map(),
      current = new Date(now)
    const day = (date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    for (const node of rows
      .filter((entry) => rank(entry) === 0)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))) {
      const date = new Date(node.updatedAt),
        valid = Number.isFinite(date.getTime())
      const age = valid ? Math.floor((day(current) - day(date)) / 86400000) : Infinity
      const key = valid ? String(day(date)) : 'earlier'
      if (!byDay.has(key))
        byDay.set(key, {
          key,
          nodes: [],
          label:
            age <= 0
              ? t('tools.today')
              : age === 1
                ? t('tools.yesterday')
                : age < 7
                  ? new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date)
                  : valid
                    ? new Intl.DateTimeFormat(locale, {
                        month: 'short',
                        day: 'numeric',
                        ...(date.getFullYear() !== current.getFullYear()
                          ? { year: 'numeric' }
                          : {}),
                      }).format(date)
                    : t('tools.earlier'),
        })
      byDay.get(key).nodes.push(node)
    }
    return [...groups, ...byDay.values()]
  }
  function mergeSearch(nodes, query, content, limit) {
    const q = query.trim().toLocaleLowerCase()
    const eligible = nodes.filter((node) => !node.blank && !node.archived)
    const byId = new Map(eligible.map((node) => [node.id, node]))
    const matches = new Map((content?.items ?? []).map((item) => [item.sessionId, item.snippet]))
    const local =
      q === ''
        ? eligible
        : eligible.filter((node) =>
            [node.title, node.projectLabel].some((value) => value.toLocaleLowerCase().includes(q)),
          )
    local.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
    const ordered = new Map(local.map((node) => [node.id, node]))
    if (q)
      for (const item of content?.items ?? [])
        if (!ordered.has(item.sessionId) && byId.has(item.sessionId))
          ordered.set(item.sessionId, byId.get(item.sessionId))
    return {
      items: [...ordered.values()]
        .slice(0, limit)
        .map((node) => ({ ...node, snippet: q ? matches.get(node.id) : undefined })),
      hasMore: !!content?.hasMore || ordered.size > limit,
    }
  }
  function shortcutEntry(catalog, config, id) {
    if (config?.status === 'loading') return undefined
    return catalog?.find(
      (row) => row.id === id && row.binding && row.issue === null && row.conflicts.length === 0,
    )
  }
  function matchesBinding(binding, input) {
    if (!binding || input.repeat) return false
    const codes = [input.code, input.secondCode].filter(Boolean).sort()
    const expected = [binding.code, binding.secondCode].filter(Boolean).sort()
    if (codes.length !== expected.length || codes.some((code, index) => code !== expected[index]))
      return false
    return ['control', 'alt', 'shift', 'meta'].every(
      (key) => !!input[key] === binding.modifiers.includes(key),
    )
  }
  function Bell() {
    return h(
      'svg',
      {
        width: 16,
        height: 16,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', {
        d: 'M6.4 13a1.7 1.7 0 0 0 3.2 0M4.3 6.3a3.7 3.7 0 0 1 7.4 0v2.3l1.1 2.1a.7.7 0 0 1-.6 1H3.8a.7.7 0 0 1-.6-1l1.1-2.1Z',
      }),
    )
  }
  function NewChatIcon({ size = 16 }) {
    return h(
      'svg',
      {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.1,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      },
      h('path', {
        d: 'M6.5 2.5H4.75A2.25 2.25 0 0 0 2.5 4.75v6.5a2.25 2.25 0 0 0 2.25 2.25h6.5a2.25 2.25 0 0 0 2.25-2.25V9.5',
      }),
      h('path', { d: 'm7.2 8.8.5-2.2 4.2-4.2a1.2 1.2 0 0 1 1.7 1.7L9.4 8.3Z' }),
    )
  }
  /** The native logo row has no actions slot; keep this versioned DOM seam small. */
  function useHeaderSeats(t) {
    const [seats, setSeats] = useState({ header: null, icon: null })
    useLayoutEffect(() => {
      let mounted = null,
        newChat = null
      const restoreHeader = () => {
        mounted?.mount.remove()
        mounted = null
      }
      const restoreNew = () => {
        if (!newChat) return
        newChat.mount.remove()
        newChat.icon?.removeAttribute('data-dshst-native-icon')
        if (newChat.label?.textContent === newChat.ownedText)
          newChat.label.textContent = newChat.text
        if (newChat.button.getAttribute('aria-label') === newChat.ownedText) {
          if (newChat.aria === null) newChat.button.removeAttribute('aria-label')
          else newChat.button.setAttribute('aria-label', newChat.aria)
        }
        newChat = null
      }
      const sync = () => {
        const row = document.querySelector(SIDEBAR + ' [class$="_logoRow"]')
        if (mounted?.row !== row) {
          restoreHeader()
          if (row) {
            const mount = document.createElement('span')
            mount.className = 'dshst-headerMount'
            row.append(mount)
            mounted = { row, mount }
          }
        }
        const button = document.querySelector(SIDEBAR + ' button[class$="_newSession"]')
        if (
          newChat?.button !== button ||
          (newChat && (!newChat.mount.isConnected || (newChat.icon && !newChat.icon.isConnected)))
        ) {
          restoreNew()
          if (button) {
            const label = button.querySelector(
                '[class*="_newSessionLabel"]:not([class*="_newSessionLabelMask"])',
              ),
              icon = button.querySelector('svg')
            const mount = document.createElement('span')
            mount.className = 'dshst-newIcon'
            mount.setAttribute('aria-hidden', 'true')
            ;(icon?.parentElement ?? button).insertBefore(mount, icon ?? button.firstChild)
            icon?.setAttribute('data-dshst-native-icon', '')
            newChat = {
              button,
              label,
              icon,
              mount,
              text: label?.textContent,
              aria: button.getAttribute('aria-label'),
            }
          }
        }
        if (newChat) {
          if (newChat.label && newChat.label.textContent !== t('newSession')) {
            if (newChat.label.textContent !== newChat.ownedText)
              newChat.text = newChat.label.textContent
            newChat.label.textContent = t('newSession')
          }
          if (newChat.button.getAttribute('aria-label') !== t('newSession')) {
            if (newChat.button.getAttribute('aria-label') !== newChat.ownedText)
              newChat.aria = newChat.button.getAttribute('aria-label')
            newChat.button.setAttribute('aria-label', t('newSession'))
          }
          newChat.ownedText = t('newSession')
        }
        const next = { header: mounted?.mount ?? null, icon: newChat?.mount ?? null }
        setSeats((previous) =>
          previous.header === next.header && previous.icon === next.icon ? previous : next,
        )
      }
      const observer = new MutationObserver((entries) => {
        if (
          entries.some(
            (entry) =>
              entry.target.closest?.(SIDEBAR) ||
              [...entry.addedNodes, ...entry.removedNodes].some(
                (node) => node.matches?.(SIDEBAR) || node.querySelector?.(SIDEBAR),
              ),
          )
        )
          sync()
      })
      observer.observe(document.body, { childList: true, subtree: true })
      sync()
      return () => {
        observer.disconnect()
        restoreHeader()
        restoreNew()
      }
    }, [t])
    return seats
  }
  function ActivityView({ nodes, renderRow, now, t, refreshPreview }) {
    const root = useRef(null),
      [limit, setLimit] = useState(80)
    const locale =
      typeof document === 'undefined' ? 'zh-CN' : document.documentElement.lang || 'zh-CN'
    const groups = activityGroups(nodes, now, t, locale)
    const visible = groups.flatMap((group) => group.nodes).slice(0, limit)
    const ids = new Set(visible.map((node) => node.id))
    useEffect(() => {
      if (!root.current || !refreshPreview || typeof IntersectionObserver === 'undefined') return
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            if (entry.isIntersecting) refreshPreview(entry.target.dataset.session)
        },
        { root: root.current.closest('.dshss-scroll') },
      )
      for (const row of root.current.querySelectorAll('[data-session]')) observer.observe(row)
      return () => observer.disconnect()
    }, [nodes, limit, refreshPreview])
    return h(
      'div',
      { ref: root, className: 'dshst-activity', role: 'tree', 'aria-label': t('tools.activity') },
      groups.length === 0
        ? h('div', { className: 'dshss-emptyHint' }, t('tools.activityEmpty'))
        : null,
      groups.map((group) => {
        const rows = group.nodes.filter((node) => ids.has(node.id))
        return rows.length
          ? h(
              'section',
              { key: group.key, className: 'dshst-activityGroup' },
              h('h2', null, group.label),
              rows.map((node) =>
                renderRow(node, {
                  className: 'dshst-activityRow',
                  children: h(
                    'span',
                    { className: 'dshst-activityCopy' },
                    h('span', { className: 'dshst-activityTitle' }, h('span', null, node.title)),
                    node.preview ? h('span', { className: 'dshst-preview' }, node.preview) : null,
                    h(
                      'span',
                      { className: 'dshst-workspace' },
                      h(IconFolderCloseRegular, { size: 12 }),
                      node.projectLabel,
                    ),
                  ),
                }),
              ),
            )
          : null
      }),
      groups.reduce((total, group) => total + group.nodes.length, 0) > limit
        ? h(
            'button',
            {
              type: 'button',
              className: 'dshss-emptyAction',
              onClick: () => setLimit((value) => value + 80),
            },
            t('tools.moreActivity'),
          )
        : null,
    )
  }
  function SearchPanel({ control, nodes, search, limit, actions, catalog, config, t }) {
    const input = useRef(null),
      alive = useRef(true),
      queryVersion = useRef(null)
    const [query, setQuery] = useState(''),
      [composing, setComposing] = useState(false)
    const [remote, setRemote] = useState(null),
      [highlight, setHighlight] = useState(0)
    const [busy, setBusy] = useState(false),
      [error, setError] = useState('')
    const id = useId(),
      trimmed = query.trim()
    const result = mergeSearch(
      nodes,
      trimmed,
      remote?.query === trimmed ? remote.value : null,
      trimmed ? limit : 9,
    )
    const shortcuts = (command) => shortcutEntry(catalog, config, command)?.keys.join(' ') ?? ''
    const allQuick = [
      {
        id: 'new',
        label: t('newSession'),
        command: 'session.new',
        icon: NewChatIcon,
        run: actions.newChat,
      },
      {
        id: 'folder',
        label: t('tools.folder'),
        command: 'workspace.add',
        icon: IconFolderOpenRegular,
        run: actions.addWorkspace,
      },
      ...(actions.openFiles
        ? [
            {
              id: 'files',
              label: t('tools.files'),
              command: 'workspace.files',
              icon: IconSearchOutlineRegular,
              run: () => actions.openFiles(control.origin()),
            },
          ]
        : []),
    ]
    const quick = allQuick.filter(
      (entry) => !trimmed || entry.label.toLocaleLowerCase().includes(trimmed.toLocaleLowerCase()),
    )
    const entries = [
      ...result.items.map((node) => ({
        id: node.id,
        node,
        run: () => actions.openSession(node.id),
      })),
      ...quick,
    ]
    const active = Math.max(0, Math.min(highlight, entries.length - 1))
    useLayoutEffect(() => {
      alive.current = true
      input.current?.focus({ preventScroll: true })
      return () => {
        alive.current = false
      }
    }, [])
    useEffect(() => {
      if (!trimmed || composing) return
      const controller = new AbortController(),
        operation = {}
      queryVersion.current = operation
      const timer = setTimeout(async () => {
        try {
          const response = await search(trimmed, controller.signal)
          if (!alive.current || controller.signal.aborted || queryVersion.current !== operation)
            return
          setRemote({
            query: trimmed,
            value: response.ok ? response.value : { items: [], hasMore: false },
            failed: !response.ok,
          })
        } catch {
          if (alive.current && !controller.signal.aborted && queryVersion.current === operation)
            setRemote({ query: trimmed, value: { items: [], hasMore: false }, failed: true })
        }
      }, 180)
      return () => {
        clearTimeout(timer)
        controller.abort()
        queryVersion.current = null
      }
    }, [trimmed, composing, search])
    useEffect(() => {
      document.getElementById(id + '-option-' + active)?.scrollIntoView({ block: 'nearest' })
    }, [active, id])
    const selecting = useRef(false),
      quickRef = useRef(null)
    const runEntry = async (entry) => {
      if (selecting.current || !entry) return
      selecting.current = true
      setBusy(true)
      setError('')
      try {
        const accepted = await entry.run()
        if (alive.current && accepted !== false) control.closeSearch(false)
        else if (alive.current) setError(t('tools.openFailed'))
      } catch {
        if (alive.current) setError(t('tools.openFailed'))
      } finally {
        selecting.current = false
        if (alive.current) setBusy(false)
      }
    }
    const choose = (index) => runEntry(entries[index])
    quickRef.current = (command) => {
      const entry = allQuick.find((item) => item.command === command)
      if (!entry) return false
      void runEntry(entry)
      return true
    }
    useEffect(() => control.installQuickHandler((command) => quickRef.current(command)), [control])
    const row = (entry, index) =>
      h(
        'button',
        {
          key: entry.id,
          type: 'button',
          role: 'option',
          tabIndex: -1,
          id: id + '-option-' + index,
          className: 'dshst-searchRow',
          disabled: busy,
          'aria-selected': index === active,
          'data-session': entry.node?.id,
          onMouseMove: () => {
            if (index !== active) setHighlight(index)
          },
          onMouseDown: (event) => event.preventDefault(),
          onClick: () => void choose(index),
        },
        entry.node
          ? h(
              'span',
              { className: 'dshst-resultState' },
              entry.node.status.state !== 'idle'
                ? h(StateDot, { state: entry.node.status.state, title: entry.node.status.label })
                : null,
            )
          : h(entry.icon, { size: 16 }),
        h(
          'span',
          { className: 'dshst-searchCopy' },
          h('span', { className: 'dshst-searchTitle' }, entry.node?.title ?? entry.label),
          entry.node?.snippet
            ? h('span', { className: 'dshst-searchSnippet' }, entry.node.snippet)
            : null,
        ),
        entry.node
          ? h('span', { className: 'dshst-searchWorkspace' }, entry.node.projectLabel)
          : null,
        entry.node && index < 9
          ? h('kbd', null, 'Alt+' + (index + 1))
          : !entry.node && shortcuts(entry.command)
            ? h('kbd', null, shortcuts(entry.command))
            : null,
      )
    return h(
      Modal,
      {
        open: true,
        title: t('tools.search'),
        closeLabel: t('dialog.close'),
        headless: true,
        backdropBlur: false,
        className: 'dshst-searchModal',
        shortcutModal: 'codex-chat-search',
        onClose: () => control.closeSearch(),
        onKeyDownCapture: (event) => {
          if (
            event.nativeEvent?.isComposing ||
            event.isComposing ||
            composing ||
            event.keyCode === 229
          ) {
            if (event.key === 'Escape' || event.key === 'Enter') event.stopPropagation()
            return
          }
          if (event.altKey && !event.ctrlKey && !event.metaKey && /^[1-9]$/.test(event.key)) {
            const index = Number(event.key) - 1
            if (result.items[index]) {
              event.preventDefault()
              event.stopPropagation()
              void choose(index)
            }
          }
        },
      },
      h('input', {
        ref: input,
        type: 'text',
        className: 'dshst-searchInput',
        placeholder: t('tools.search'),
        value: query,
        maxLength: 500,
        spellCheck: false,
        role: 'combobox',
        'aria-label': t('tools.search'),
        'aria-autocomplete': 'list',
        'aria-expanded': true,
        'aria-controls': id + '-results',
        'aria-activedescendant': entries.length ? id + '-option-' + active : undefined,
        onCompositionStart: () => setComposing(true),
        onCompositionEnd: () => setComposing(false),
        onChange: (event) => {
          setQuery(event.target.value.replace(/\0/g, ''))
          setHighlight(0)
          setError('')
        },
        onKeyDown: (event) => {
          if (event.nativeEvent?.isComposing || composing || event.keyCode === 229) return
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            if (entries.length)
              setHighlight(
                (active + (event.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length,
              )
          } else if (event.key === 'Enter') {
            event.preventDefault()
            void choose(active)
          }
        },
      }),
      h(
        'div',
        {
          className: 'dshst-searchResults',
          role: 'listbox',
          id: id + '-results',
          'aria-label': t('tools.search'),
          'aria-busy': busy,
        },
        result.items.length
          ? h(
              'div',
              { role: 'group', 'aria-label': t('tools.chats') },
              h('div', { className: 'dshst-groupLabel' }, t('tools.chats')),
              result.items.map((node, index) => row(entries[index], index)),
            )
          : null,
        !result.items.length && trimmed
          ? h(
              'div',
              { className: 'dshst-searchStatus', role: 'status' },
              remote?.query !== trimmed || composing ? t('tools.loading') : t('tools.empty'),
            )
          : null,
        quick.length
          ? h(
              'div',
              { role: 'group', 'aria-label': t('tools.quick') },
              h('div', { className: 'dshst-groupLabel' }, t('tools.quick')),
              quick.map((entry, index) => row(entry, result.items.length + index)),
            )
          : null,
      ),
      error || (remote?.query === trimmed && remote.failed)
        ? h('div', { className: 'dshst-searchStatus', role: 'alert' }, error || t('tools.failed'))
        : null,
      trimmed && result.hasMore
        ? h('div', { className: 'dshst-searchStatus' }, t('tools.more'))
        : null,
    )
  }
  const EMPTY_LIST = { phase: 'loading', ids: [], byId: {}, projectionsBySession: {} }
  const EMPTY_WORKSPACES = {
    phase: 'loading',
    items: [],
    archivedSessionIds: [],
    pinnedSessionIds: [],
  }
  const EMPTY_STATUS = new Map(),
    EMPTY_CATALOG = []
  function Overlay({
    control,
    stores,
    settings,
    deriveNodes,
    actions,
    search,
    limit,
    shortcuts,
    t,
  }) {
    const state = useSource(control.store),
      list = useSource(stores.list, EMPTY_LIST)
    const workspaces = useSource(stores.workspaces, EMPTY_WORKSPACES),
      statuses = useSource(stores.statuses, EMPTY_STATUS)
    const managed = useSource(settings),
      catalog = useSource(shortcuts?.catalog, EMPTY_CATALOG),
      config = useSource(shortcuts?.config, null)
    const seats = useHeaderSeats(t)
    const nodes = useMemo(
      () => deriveNodes(list, workspaces, statuses, managed),
      [deriveNodes, list, workspaces, statuses, managed],
    )
    useEffect(() => {
      const entry = (id) =>
        shortcutEntry(shortcuts?.catalog.getSnapshot(), shortcuts?.config.getSnapshot(), id)
      const allowed = () => {
        let target = document.activeElement
        while (target?.shadowRoot?.activeElement) target = target.shadowRoot.activeElement
        if (!nativePrimary && target?.closest('.xterm')) return false
        const modal =
          target?.closest('[aria-modal="true"]') ?? document.querySelector('[aria-modal="true"]')
        return !modal || modal.classList.contains('dshst-searchModal')
      }
      const route = (id) => {
        if (!allowed()) return false
        if (id === 'session.search') {
          control.toggleSearch()
          return true
        }
        return !!control.invokeQuick(id)
      }
      const commands = () =>
        control.store.getSnapshot().searchOpen
          ? ['session.search', 'session.new', 'workspace.add', 'workspace.files']
          : ['session.search']
      const native = globalThis.dshDesktop?.keyboard
      const platform = document.documentElement.dataset.platform
      const nativePrimary =
        !!native?.subscribe &&
        (platform === 'win32' ||
          platform === 'darwin' ||
          document.documentElement.hasAttribute('data-windows-titlebar'))
      const off = native?.subscribe?.((input) => {
        if (input.revision !== shortcuts?.config.getSnapshot()?.revision || input.repeat) return
        if (input.kind === 'menu') {
          if (input.commandId === 'session.search' && allowed()) control.openSearch()
          else if (commands().includes(input.commandId)) route(input.commandId)
          return
        }
        if (!nativePrimary && input.kind === 'keyboard') return
        const id = commands().find((id) => matchesBinding(entry(id)?.binding, input))
        if (id) route(id)
      })
      const held = new Set()
      const keydown = (event) => {
        if (
          nativePrimary ||
          event.defaultPrevented ||
          event.isComposing ||
          event.repeat ||
          event.key === 'Dead' ||
          event.getModifierState?.('AltGraph')
        )
          return
        held.add(event.code)
        const input = {
          code: event.code,
          control: event.ctrlKey,
          alt: event.altKey,
          shift: event.shiftKey,
          meta: event.metaKey,
        }
        const id = commands().find((id) => {
          const binding = entry(id)?.binding
          return matchesBinding(binding, {
            ...input,
            secondCode: binding?.secondCode
              ? [...held].find(
                  (code) =>
                    code !== event.code && [binding.code, binding.secondCode].includes(code),
                )
              : undefined,
          })
        })
        if (id && route(id)) event.preventDefault()
        else if (
          allowed() &&
          commands().some((id) => {
            const binding = entry(id)?.binding
            return (
              binding?.secondCode &&
              [binding.code, binding.secondCode].includes(event.code) &&
              ['control', 'alt', 'shift', 'meta'].every(
                (key) => !!input[key] === binding.modifiers.includes(key),
              )
            )
          })
        )
          event.preventDefault()
      }
      const keyup = (event) => held.delete(event.code)
      const blur = () => held.clear()
      document.addEventListener('keydown', keydown)
      document.addEventListener('keyup', keyup)
      window.addEventListener('blur', blur)
      return () => {
        off?.()
        document.removeEventListener('keydown', keydown)
        document.removeEventListener('keyup', keyup)
        window.removeEventListener('blur', blur)
      }
    }, [control, shortcuts])
    return h(
      React.Fragment,
      null,
      h('style', null, CSS),
      seats.header
        ? createPortal(
            h(
              'span',
              { className: 'dshst-headerActions' },
              h(
                Tooltip,
                {
                  label: t(state.view === 'activity' ? 'tools.projects' : 'tools.activity'),
                  side: 'bottom',
                  portal: true,
                },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshst-headerButton',
                    'aria-label': t('tools.activity'),
                    'aria-pressed': state.view === 'activity',
                    onClick: () => control.toggleActivity(),
                  },
                  h(Bell),
                ),
              ),
              h(
                Tooltip,
                { label: t('tools.search'), side: 'bottom', portal: true },
                h(
                  'button',
                  {
                    type: 'button',
                    className: 'dshst-headerButton',
                    'aria-label': t('tools.search'),
                    'aria-haspopup': 'dialog',
                    'aria-expanded': state.searchOpen,
                    onClick: (event) => control.openSearch(event.currentTarget),
                  },
                  h(IconSearchOutlineRegular, { size: 16 }),
                ),
              ),
            ),
            seats.header,
          )
        : null,
      seats.icon ? createPortal(h(NewChatIcon, { size: 16 }), seats.icon) : null,
      state.searchOpen
        ? h(SearchPanel, { control, nodes, search, limit, actions, catalog, config, t })
        : null,
    )
  }
  const CSS = `
    .dshst-headerMount,.dshst-headerActions{display:inline-flex;align-items:center;flex:none;gap:4px;}.dshst-headerButton{display:grid;place-items:center;box-sizing:border-box;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}.dshst-headerButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}.dshst-headerButton[aria-pressed=true]{color:var(--dsw-alias-state-business-primary);background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);}.dshst-headerButton:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:-2px;}
    .dshst-newIcon{display:inline-flex;align-items:center;justify-content:center;flex:none;width:16px;height:16px;}[data-dshst-native-icon]{display:none!important;}.dshst-headerMount button>svg,.dshst-newIcon>svg{display:block;flex:none;}
    .dshst-activityGroup+section{margin-top:20px;}.dshst-activityGroup>h2{margin:8px 4px 6px;font-size:13px;line-height:24px;font-weight:500;color:var(--dsw-alias-label-tertiary);}.dshss-row.dshst-activityRow{position:relative;box-sizing:border-box;align-items:flex-start;height:auto;min-height:54px;padding:7px 8px;gap:4px;}.dshst-activityRow .dshss-slot{order:2;margin-top:0;}.dshst-activityRow>.dshss-time,.dshst-activityRow>.dshss-pinMark{display:none;}.dshst-activityRow .dshss-rowActions{position:absolute;right:4px;top:3px;}.dshst-activityRow .dshss-rowActions>:not(:first-child){display:none;}.dshst-activityRow:is(:hover,:focus-within) .dshss-slot{visibility:hidden;}.dshst-activityCopy{padding-right:8px;display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;}.dshst-activityTitle{min-width:0;display:flex;align-items:center;font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary);}.dshst-activityTitle>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.dshst-preview{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere;}.dshst-workspace{display:flex;align-items:center;gap:4px;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);}.dshst-workspace>svg{flex:none;}
    .dshst-searchModal{box-sizing:border-box;width:640px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 64px);display:flex;flex-direction:column;gap:0;overflow:hidden;padding:8px;border-radius:20px;font-family:var(--dsw-font-family);}.dshst-searchInput{box-sizing:border-box;flex:none;width:100%;height:44px;padding:8px;border:0;background:transparent;outline:none;font:inherit;font-size:14px;color:var(--dsw-alias-label-primary);}.dshst-searchInput::placeholder{color:var(--dsw-alias-label-tertiary);}.dshst-searchResults{overflow-y:auto;min-height:0;overscroll-behavior:contain;}.dshst-groupLabel{padding:5px 8px;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:20px;}.dshst-searchRow{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;min-height:36px;padding:6px 8px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;text-align:left;cursor:pointer;}.dshst-searchRow[aria-selected=true]{background:var(--dsw-alias-interactive-bg-hover);}.dshst-searchRow>svg{flex:none;color:var(--dsw-alias-label-secondary);}.dshst-resultState{flex:none;display:grid;place-items:center;width:16px;}.dshst-searchCopy{display:flex;flex-direction:column;min-width:0;flex:1;}.dshst-searchTitle{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:24px;}.dshst-searchSnippet{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}.dshst-searchWorkspace{max-width:28%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:var(--dsw-alias-label-tertiary);}.dshst-searchRow kbd{flex:none;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 6px;border-radius:999px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;line-height:18px;}.dshst-searchStatus{padding:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);}.dshst-searchStatus[role=alert]{color:var(--dsw-alias-state-error-primary);}
    @media(max-height:480px){.dshst-searchModal{max-height:calc(100dvh - 24px);}}@media(max-width:480px){.dshst-searchWorkspace{display:none;}}
  `
  return {
    messages,
    NewChatIcon,
    createControls,
    Overlay,
    ActivityView,
    previewOf,
    activityGroups,
    mergeSearch,
    matchesBinding,
    shortcutEntry,
  }
}
