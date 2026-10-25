/** Native task/plugin pages with shared navigation and a session-scoped skill catalog. */
__DSH_FEATURE('dsh-workbench-pages', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const { createSnapshotStore } = require('@deepseek-ai/dsh-client-store')
  const {
    Button, Menu, Tooltip, IconSearchOutlineRegular, IconRefreshOutlineRegular,
    IconSettingsOutlineRegular, IconClockOutlineRegular, IconPluginPinwheelOutlineRegular,
    IconSkillOutlineRegular, IconSlidersTwoOutlineRegular, IconCheckOutlineRegular,
    IconPlusOutlineRegular,
  } = require('@deepseek-ai/dsh-client-ui-primitives')
  const { useEffect, useLayoutEffect, useState } = React
  const h = React.createElement
  const NS = 'workbenchPages', SKILLS_TAB = 'codex-skills'
  const PROFILE_BUNDLES = new Set([
    '@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless',
    '@deepseek-ai/dsh-sdk-app', '@deepseek-ai/dsh-acp-app', '@deepseek-ai/dsh-sdk-minimal',
  ])
  const SIDEBAR = '[class$="_sidebarCol"]'
  const PLUGINS = '[data-plugin-panel]'
  const TASKS = '[data-testid="task-manager-page"]'
  const zh = {
    customize: '自定义', plugins: '插件', skills: '技能', installed: '已安装',
    search: '搜索', searchPlugins: '搜索插件', searchSkills: '搜索技能', searchInstalled: '搜索已安装的插件',
    refresh: '刷新', settings: '设置', emptyPlugins: '暂无已安装插件',
    inventoryFailed: '无法读取已安装插件', retry: '重试', more: '显示更多',
    noMatches: '没有匹配的结果', tasks: '定时任务', taskSearch: '搜索任务',
    taskPlaceholder: '搜索定时任务', noTasks: '暂无已安排的任务', noEndedTasks: '暂无已结束的任务',
    upcoming: '即将执行', filter: '筛选任务', arrange: '安排任务',
    taskIntro: '安排定时任务，处理重复工作。', newTask: '新建任务',
    skillsIntro: '当前聊天可用的专用技能', available: '可用技能',
    skillReady: '当前聊天可用', skillFailed: '暂时无法读取当前聊天的技能。',
    noSkills: '当前聊天没有可用技能', chooseSession: '先打开一个聊天，再查看它可用的技能。',
    backToChat: '返回聊天', loading: '正在读取…',
  }
  const en = {
    customize: 'Customize', plugins: 'Plugins', skills: 'Skills', installed: 'Installed',
    search: 'Search', searchPlugins: 'Search plugins', searchSkills: 'Search skills', searchInstalled: 'Search installed plugins',
    refresh: 'Refresh', settings: 'Settings', emptyPlugins: 'No installed plugins',
    inventoryFailed: 'Could not load installed plugins', retry: 'Retry', more: 'Show more',
    noMatches: 'No matching results', tasks: 'Scheduled tasks', taskSearch: 'Search tasks',
    taskPlaceholder: 'Search scheduled tasks', noTasks: 'No scheduled tasks yet', noEndedTasks: 'No ended tasks yet',
    upcoming: 'Upcoming', filter: 'Filter tasks', arrange: 'Schedule tasks',
    taskIntro: 'Schedule tasks to take care of recurring work.', newTask: 'New task',
    skillsIntro: 'Specialized skills available to the current chat', available: 'Available skills',
    skillReady: 'Available to this chat', skillFailed: 'Could not load this chat’s skills.',
    noSkills: 'No skills are available to this chat', chooseSession: 'Open a chat to see its available skills.',
    backToChat: 'Back to chat', loading: 'Loading…',
  }
  function useSource(source) {
    const [state, setState] = useState(source.getSnapshot)
    useEffect(() => {
      setState(source.getSnapshot())
      return source.subscribe(() => setState(source.getSnapshot()))
    }, [source])
    return state
  }
  function skillContext(list) {
    const id = list.ids.find((id) => (list.byId[id]?.retainedBy?.mainView ?? 0) > 0)
    const values = list.projectionsBySession?.[id]?.values
    return { id, key: JSON.stringify([id, values?.workingDirectory ?? list.byId[id]?.cwd, values?.agentPreset]) }
  }
  const filterSkills = (items, query) => {
    const q = query.trim().toLocaleLowerCase()
    return items.filter((item) => [item.name, item.description, item.whenToUse ?? '']
      .some((text) => text.toLocaleLowerCase().includes(q)))
  }
  const safeIcon = (value) => typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value)
  function Search({ label, value, onChange, inputRef }) {
    return h('label', { className: 'dshwp-search' },
      h(IconSearchOutlineRegular, { size: 16 }),
      h('input', { ref: inputRef, type: 'search', value, 'aria-label': label,
        placeholder: label, onChange: (event) => onChange(event.target.value) }))
  }
  function IconButton({ label, icon: Icon, onClick, disabled, pressed }) {
    return h(Tooltip, { label, side: 'bottom', portal: true },
      h('button', { type: 'button', className: 'dshwp-iconButton', 'aria-label': label,
        'aria-pressed': pressed, disabled, onClick }, h(Icon, { size: 16 })))
  }
  function SkillsPage({ useSessions, useHostGeneration, listSkills, backToChat, openSettings, t }) {
    const context = skillContext(useSessions((state) => state))
    const generation = useHostGeneration((state) => state)
    const [revision, setRevision] = useState(0), [query, setQuery] = useState('')
    const [limit, setLimit] = useState(6), [state, setState] = useState({ key: null, phase: 'idle', items: [] })
    const matching = state.key === context.key && state.generation === generation
    const loading = !!context.id && !!generation && (!matching || state.phase === 'loading')
    useEffect(() => {
      setQuery(''); setLimit(6)
    }, [context.key, generation])
    useEffect(() => {
      if (!context.id || !generation) return
      const controller = new AbortController()
      let alive = true
      setState({ key: context.key, generation, phase: 'loading', items: [] })
      const timer = setTimeout(() => {
        controller.abort()
        if (alive) setState({ key: context.key, generation, phase: 'error', items: [] })
      }, 15000)
      Promise.resolve().then(() => listSkills(context.id, controller.signal)).then((result) => {
        if (!alive || controller.signal.aborted) return
        const valid = result.ok && Array.isArray(result.value?.skills)
        const items = valid ? result.value.skills.filter((item) =>
          typeof item.name === 'string' && typeof item.description === 'string' &&
          (item.whenToUse === undefined || typeof item.whenToUse === 'string')) : []
        setState({ key: context.key, generation, phase: valid ? 'ready' : 'error', items })
      }, () => {
        if (alive && !controller.signal.aborted) setState({ key: context.key, generation, phase: 'error', items: [] })
      }).finally(() => clearTimeout(timer))
      return () => { alive = false; clearTimeout(timer); controller.abort() }
    }, [context.key, generation, revision, listSkills])
    const items = filterSkills(matching ? state.items : [], query)
    return h('section', { className: 'dshwp-skills', 'aria-label': t('skills') },
      h('header', { className: 'dshwp-pageHead' },
        h('div', null, h('h1', null, t('skills')), h('p', null, t('skillsIntro'))),
        h('div', { className: 'dshwp-toolbar' },
          h(Search, { label: t('searchSkills'), value: query, onChange: setQuery }),
          h(IconButton, { label: t('refresh'), icon: IconRefreshOutlineRegular,
            disabled: loading || !context.id || !generation, onClick: () => setRevision((n) => n + 1) }),
          openSettings ? h(IconButton, { label: t('settings'), icon: IconSettingsOutlineRegular, onClick: openSettings }) : null)),
      !context.id ? h('div', { className: 'dshwp-empty', role: 'status' },
        h('p', null, t('chooseSession')), h(Button, { onClick: backToChat }, t('backToChat')))
        : loading ? h('p', { className: 'dshwp-notice', role: 'status' }, t('loading'))
          : !generation || state.phase === 'error' ? h('div', { className: 'dshwp-empty', role: 'alert' },
            h('p', null, t('skillFailed')), h(Button, { disabled: !generation,
              onClick: () => setRevision((n) => n + 1) }, t('retry')))
            : h('section', { className: 'dshwp-skillSection' },
              h('h2', null, t('available')),
              items.length === 0 ? h('p', { className: 'dshwp-notice', role: 'status' }, t(query ? 'noMatches' : 'noSkills')) : null,
              h('div', { className: 'dshwp-skillGrid' }, items.slice(0, limit).map((item) =>
                h('article', { key: item.path ?? item.name, className: 'dshwp-skillCard' },
                  h('span', { className: 'dshwp-artwork', 'aria-hidden': true }, h(IconSkillOutlineRegular, { size: 22 })),
                  h('div', { className: 'dshwp-skillCopy' }, h('h3', null, item.name), h('p', null, item.description)),
                  h('span', { className: 'dshwp-available', role: 'img', 'aria-label': t('skillReady') },
                    h(IconCheckOutlineRegular, { size: 16 }))))),
              items.length > limit ? h('button', { type: 'button', className: 'dshwp-more',
                onClick: () => setLimit((n) => n + 24) }, t('more')) : null))
  }

  /** All DOM seams live here; native React keeps ownership of its nodes and actions. */
  function createPageBridge(panel, onChange, t) {
    const mounts = new Map(), root = document.documentElement
    let disposed = false, last = '', resizeTarget = null, snapshot, knownTabs = []
    const seat = (name, host) => {
      const previous = mounts.get(name)
      if (previous?.parentElement === host) return previous
      previous?.remove(); mounts.delete(name)
      if (!host) return null
      const mount = document.createElement('span')
      mount.className = 'dshwp-' + name
      mount.dataset.dshwpOwned = ''
      host.append(mount); mounts.set(name, mount)
      return mount
    }
    const geometry = () => {
      const sidebar = document.querySelector(SIDEBAR), rect = sidebar?.getBoundingClientRect()
      const visible = !!rect && rect.width > 1 && rect.height > 1
      if (rect) for (const key of ['left', 'top', 'width', 'height']) {
        const name = '--dshwp-sidebar-' + key, value = rect[key] + 'px'
        if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value)
      }
      root.dataset.dshwpSidebar = String(visible)
      if (sidebar !== resizeTarget) {
        if (resizeTarget) resize.unobserve(resizeTarget)
        resizeTarget = sidebar
        if (sidebar) resize.observe(sidebar)
      }
      return visible
    }
    const scan = () => {
      if (disposed) return
      const page = document.querySelector(panel === 'plugins' ? PLUGINS : TASKS)
      if (!page) {
        for (const name of ['panel', 'sidebar', 'skills']) root.removeAttribute('data-dshwp-' + name)
        for (const mount of mounts.values()) mount.remove()
        mounts.clear()
        if (snapshot) { snapshot = null; last = ''; onChange(null) }
        return
      }
      root.dataset.dshwpPanel = panel
      const sidebar = geometry()
      const liveTabs = panel === 'plugins' ? [...page.querySelectorAll('.fO69Vq_pageTabs [role="tab"]')]
        .map((button) => ({ id: button.id, button, label: button.textContent.trim(), selected: button.getAttribute('aria-selected') === 'true' })) : []
      if (liveTabs.length) knownTabs = liveTabs
      const tabs = knownTabs.length ? knownTabs : panel === 'plugins'
        ? [{ id: 'installed', label: t('plugins'), selected: true }, { id: SKILLS_TAB, label: t('skills'), selected: false }] : []
      const skills = tabs.some((tab) => tab.selected && tab.id.endsWith(SKILLS_TAB))
      root.dataset.dshwpSkills = String(skills)
      const filters = panel === 'schedules' ? [...page.querySelectorAll('.S0jZwq_filterTabs button')]
        .map((button) => ({ button, label: button.textContent.trim(), selected: button.getAttribute('aria-pressed') === 'true' })) : []
      const next = {
        page, sidebar: sidebar && panel === 'plugins' ? seat('sidebarMount', document.querySelector(SIDEBAR)) : null,
        search: panel === 'plugins' ? seat('searchMount', page.querySelector('.fO69Vq_toolbar')) : null,
        settings: panel === 'plugins' ? seat('settingsMount', page.querySelector('.fO69Vq_toolbar')) : null,
        taskHeader: panel === 'schedules' ? seat('taskHeaderMount', page.querySelector('.S0jZwq_pageHeading')) : null,
        taskFilter: panel === 'schedules' ? seat('taskFilterMount', page.querySelector('.S0jZwq_filters')) : null,
        taskLanding: panel === 'schedules' ? seat('taskLandingMount', page) : null,
        taskEmpty: panel === 'schedules' ? seat('taskEmptyMount', page.querySelector('.S0jZwq_list .S0jZwq_empty')) : null,
        searching: !!page.querySelector('.S0jZwq_searchField input')?.value.trim(),
        tabs, filters, skills, activePackage: page.querySelector('[data-plugin-detail]')?.getAttribute('data-plugin-detail'),
      }
      const key = JSON.stringify([sidebar, skills, next.activePackage, next.searching,
        tabs.map((tab) => [tab.id, tab.label, tab.selected]), filters.map((item) => [item.label, item.selected])])
      const changed = last !== key || !snapshot || ['page', 'sidebar', 'search', 'settings', 'taskHeader', 'taskFilter', 'taskLanding', 'taskEmpty']
        .some((name) => next[name] !== snapshot[name]) ||
        next.tabs.some((tab, i) => tab.button !== snapshot.tabs[i]?.button) ||
        next.filters.some((item, i) => item.button !== snapshot.filters[i]?.button)
      last = key; snapshot = next
      if (changed) onChange(next)
    }
    const resize = new ResizeObserver(scan)
    const observer = new MutationObserver((entries) => {
      if (entries.some((entry) => !entry.target.closest?.('[data-dshwp-owned]'))) scan()
    })
    observer.observe(document.body, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['aria-selected', 'aria-pressed', 'class'] })
    window.addEventListener('resize', scan)
    scan()
    return () => {
      disposed = true; observer.disconnect(); resize.disconnect()
      window.removeEventListener('resize', scan)
      for (const mount of mounts.values()) mount.remove()
      for (const name of ['panel', 'sidebar', 'skills']) root.removeAttribute('data-dshwp-' + name)
      for (const key of ['left', 'top', 'width', 'height']) root.style.removeProperty('--dshwp-sidebar-' + key)
    }
  }
  function activateTab(page, tab, after, attempt = 0) {
    if (!page.isConnected) return
    const button = [...page.querySelectorAll('.fO69Vq_pageTabs [role="tab"]')]
      .find((button) => button.id === tab.id || button.id.endsWith('-' + tab.id))
    if (button) {
      button.click()
      if (after) requestAnimationFrame(after)
      return
    }
    const back = page.querySelector('.fO69Vq_crumb,.fO69Vq_moreBack')
    if (back && attempt < 4) {
      back.click()
      requestAnimationFrame(() => activateTab(page, tab, after, attempt + 1))
    }
  }
  function Sidebar({ seats, inventory, openPackage, resolveText, t }) {
    const [limit, setLimit] = useState(40), [searchOpen, setSearchOpen] = useState(false), [query, setQuery] = useState('')
    const searchRef = React.useRef(null)
    const q = query.trim().toLocaleLowerCase()
    const items = inventory.items.filter((item) => [item.name, resolveText(item.meta?.title ?? item.name)]
      .some((text) => text.toLocaleLowerCase().includes(q)))
    const closeSearch = () => { setSearchOpen(false); setQuery('') }
    useLayoutEffect(() => { if (searchOpen) searchRef.current?.focus({ preventScroll: true }) }, [searchOpen])
    return h('div', { className: 'dshwp-sidebar', 'aria-label': t('customize') },
      h('header', { className: 'dshwp-sidebarHead' }, h('h2', null, t('customize')),
        h(IconButton, { label: t('search'), icon: IconSearchOutlineRegular, pressed: searchOpen,
          onClick: () => searchOpen ? closeSearch() : setSearchOpen(true) })),
      searchOpen ? h('div', { className: 'dshwp-sidebarSearch', onKeyDown: (event) => {
        if (event.key === 'Escape') { event.stopPropagation(); closeSearch() }
      } }, h(Search, { label: t('searchInstalled'), value: query, onChange: setQuery, inputRef: searchRef })) : null,
      h('nav', { className: 'dshwp-sidebarNav', 'aria-label': t('customize') },
        seats.tabs.length ? seats.tabs.map((tab, index) => h('button', { key: tab.id,
          type: 'button', 'aria-current': tab.selected && !seats.activePackage ? 'page' : undefined,
          onClick: () => activateTab(seats.page, tab) }, h(index === 0 ? IconPluginPinwheelOutlineRegular : IconSkillOutlineRegular, { size: 16 }),
          h('span', null, index === 0 ? t('plugins') : tab.label))) :
          h('button', { type: 'button', 'aria-current': 'page', onClick: () => {} },
            h(IconPluginPinwheelOutlineRegular, { size: 16 }), t('plugins'))),
      h('h3', null, t('installed')),
      inventory.phase === 'error' ? h('p', { className: 'dshwp-notice' }, t('inventoryFailed')) : null,
      inventory.phase === 'loading' && !inventory.items.length ? h('p', { className: 'dshwp-notice', role: 'status' }, t('loading')) : null,
      inventory.phase === 'ready' && !inventory.items.length ? h('p', { className: 'dshwp-notice' }, t('emptyPlugins')) : null,
      q && !items.length ? h('p', { className: 'dshwp-notice', role: 'status' }, t('noMatches')) : null,
      h('div', { className: 'dshwp-installed' }, items.slice(0, limit).map((item) =>
        h('button', { type: 'button', key: item.name,
          'aria-current': seats.activePackage === item.name ? 'page' : undefined,
          onClick: () => openPackage(item.name) },
          safeIcon(item.meta?.icon) ? h('img', { src: item.meta.icon, alt: '', width: 16, height: 16 }) :
            h(IconPluginPinwheelOutlineRegular, { size: 16 }),
          h('span', null, resolveText(item.meta?.title ?? item.name))))),
      items.length > limit ? h('button', { className: 'dshwp-more', type: 'button', onClick: () => setLimit((n) => n + 40) }, t('more')) : null)
  }
  function TaskHeader({ page, t }) {
    const [searchOpen, setSearchOpen] = useState(false)
    useLayoutEffect(() => {
      page.dataset.dshwpSearch = String(searchOpen)
      const input = page.querySelector('.S0jZwq_searchField input')
      const placeholder = input?.getAttribute('placeholder')
      input?.setAttribute('placeholder', t('taskPlaceholder'))
      if (searchOpen) input?.focus({ preventScroll: true })
      const escape = (event) => {
        if (event.key !== 'Escape') return
        event.preventDefault(); event.stopPropagation()
        page.querySelector('.S0jZwq_searchClear')?.click(); setSearchOpen(false)
      }
      input?.addEventListener('keydown', escape)
      return () => {
        page.removeAttribute('data-dshwp-search'); input?.removeEventListener('keydown', escape)
        if (input && placeholder !== null) input.setAttribute('placeholder', placeholder)
      }
    }, [page, searchOpen, t])
    return h(React.Fragment, null,
      h('div', { className: 'dshwp-sidebarHead' }, h('h2', null, t('tasks')),
        h(IconButton, { label: t('taskSearch'), icon: IconSearchOutlineRegular, pressed: searchOpen,
          onClick: () => {
            if (searchOpen) page.querySelector('.S0jZwq_searchClear')?.click()
            setSearchOpen((value) => !value)
          } })),
      h(Button, { variant: 'ghost', className: 'dshwp-newTask', icon: h(IconPlusOutlineRegular, { size: 16 }),
        onClick: () => page.querySelector('.S0jZwq_newButton')?.click() }, t('newTask')))
  }
  function TaskFilter({ seats, t }) {
    const [open, setOpen] = useState(false)
    return h('div', { className: 'dshwp-taskFilter' },
      h('span', null, seats.filters.find((item) => item.selected)?.label ?? t('upcoming')),
      h(Menu, { open, onClose: () => setOpen(false), portal: true, side: 'bottom', align: 'end', autoFocus: true,
        listClassName: 'dsh-motion-surface',
        selectedId: String(seats.filters.findIndex((item) => item.selected)),
        anchor: h('button', { type: 'button', className: 'dshwp-iconButton', 'aria-label': t('filter'),
          'aria-haspopup': 'menu', 'aria-expanded': open, onClick: () => setOpen((value) => !value) },
          h(IconSlidersTwoOutlineRegular, { size: 16 })),
        items: seats.filters.map((item, i) => ({ id: String(i), label: item.label })),
        onSelect: (id) => { seats.filters[Number(id)]?.button.click(); setOpen(false) } }))
  }
  function TaskLanding({ page, t }) {
    return h('div', { className: 'dshwp-taskLanding' },
      h(IconClockOutlineRegular, { size: 48 }), h('h1', null, t('arrange')),
      h('p', null, t('taskIntro')), h(Button, { variant: 'primary',
        onClick: () => page.querySelector('.S0jZwq_newButton')?.click() }, t('newTask')))
  }
  function Overlay({ usePanelInfo, inventory, openPackage, openSettings, resolveText, t }) {
    const panel = usePanelInfo((state) => state.activePanelId)
    const [seats, setSeats] = useState(null), [query, setQuery] = useState('')
    const packages = useSource(inventory)
    useLayoutEffect(() => {
      setSeats(null); setQuery('')
      if (panel !== 'plugins' && panel !== 'schedules') return
      return createPageBridge(panel, setSeats, t)
    }, [panel, t])
    useLayoutEffect(() => {
      if (!seats?.page || panel !== 'plugins') return
      const q = query.trim().toLocaleLowerCase()
      const apply = () => {
        for (const row of seats.page.querySelectorAll('[data-plugin-package],[data-plugin-item]')) {
          const hidden = !!q && !row.textContent.toLocaleLowerCase().includes(q)
          if (hidden) row.setAttribute('data-dshwp-filtered', '')
          else row.removeAttribute('data-dshwp-filtered')
        }
      }
      const observer = new MutationObserver(apply)
      observer.observe(seats.page, { childList: true, subtree: true, characterData: true })
      apply()
      return () => {
        observer.disconnect()
        for (const row of seats.page.querySelectorAll('[data-dshwp-filtered]')) row.removeAttribute('data-dshwp-filtered')
      }
    }, [seats?.page, panel, query])
    if (!seats) return null
    return h(React.Fragment, null,
      seats.sidebar ? createPortal(h(Sidebar, { seats, inventory: packages, openPackage, resolveText, t }), seats.sidebar) : null,
      seats.search ? createPortal(h(Search, { label: t('searchPlugins'), value: query, onChange: setQuery }), seats.search) : null,
      seats.settings && openSettings ? createPortal(h(IconButton, { label: t('settings'), icon: IconSettingsOutlineRegular, onClick: openSettings }), seats.settings) : null,
      seats.taskHeader ? createPortal(h(TaskHeader, { page: seats.page, t }), seats.taskHeader) : null,
      seats.taskFilter ? createPortal(h(TaskFilter, { seats, t }), seats.taskFilter) : null,
      seats.taskLanding ? createPortal(h(TaskLanding, { page: seats.page, t }), seats.taskLanding) : null,
      seats.taskEmpty ? createPortal(t(seats.searching ? 'noMatches' : seats.filters[2]?.selected ? 'noEndedTasks' : 'noTasks'), seats.taskEmpty) : null)
  }

  const CSS = `
    html[data-dshwp-panel] [class$="_sidebarCol"]{position:relative;}
    html[data-dshwp-panel] [class$="_sidebarCol"]>:not(.dshwp-sidebarMount){visibility:hidden;pointer-events:none;}
    html[data-dshwp-panel] .dshlr-settings-native{visibility:visible;pointer-events:auto;}
    .dshwp-sidebarMount{position:absolute;inset:0;display:block;overflow:hidden;}
    .dshwp-sidebar{box-sizing:border-box;display:flex;flex-direction:column;height:100%;padding:12px 10px 20px;overflow:auto;font-size:14px;}
    .dshwp-sidebarHead{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;}
    .dshwp-sidebarHead h2{margin:0 6px;font-size:18px;line-height:28px;font-weight:600;}
    .dshwp-iconButton{display:grid;place-items:center;flex:none;width:28px;height:28px;padding:0;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;}
    .dshwp-iconButton:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
    .dshwp-iconButton[aria-pressed=true]{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary);}
    .dshwp-iconButton:disabled{opacity:.45;cursor:default;}.dshwp-iconButton>svg{display:block;}
    .dshwp-sidebarNav{display:flex;flex-direction:column;gap:2px;margin-top:12px;}
    .dshwp-sidebarNav>button,.dshwp-installed>button{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-height:34px;width:100%;padding:6px 8px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer;}
    .dshwp-sidebarNav>button:hover,.dshwp-installed>button:hover,.dshwp-sidebar button[aria-current=page]{background:var(--dsw-alias-interactive-bg-hover);}
    .dshwp-sidebarNav svg,.dshwp-installed img,.dshwp-installed svg{flex:none;}.dshwp-installed img{object-fit:contain;}
    .dshwp-sidebarNav span,.dshwp-installed span{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;}
    .dshwp-sidebar>h3{margin:28px 8px 10px;font-size:13px;line-height:20px;font-weight:500;color:var(--dsw-alias-label-tertiary);}
    .dshwp-search{box-sizing:border-box;display:flex;align-items:center;gap:8px;min-width:0;width:250px;max-width:100%;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3);border-radius:999px;corner-shape:round;color:var(--dsw-alias-label-tertiary);}
    .dshwp-search>svg{flex:none;}.dshwp-search input{width:100%;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;outline:none;}.dshwp-search:focus-within{outline:2px solid var(--dsw-focus-ring-color);outline-offset:1px;}
    .dshwp-sidebarSearch{margin-top:12px;}.dshwp-sidebarSearch .dshwp-search{width:100%;height:40px;border:0;background:var(--dsw-alias-interactive-bg-hover);}.dshwp-sidebarSearch input{font-size:14px;line-height:20px;}
    .dshwp-searchMount,.dshwp-settingsMount{display:inline-flex;align-items:center;}.dshwp-searchMount{order:-1;}.dshwp-settingsMount{order:1;}
    html[data-dshwp-panel=plugins] [data-plugin-panel]{container-type:inline-size;container-name:dshwp;gap:26px;padding:0 clamp(24px,5vw,64px) 40px;}
    html[data-dshwp-panel=plugins] [data-plugin-panel]>*{max-width:960px;}
    html[data-dshwp-panel=plugins] .fO69Vq_pageHead{padding-top:32px;gap:20px;}
    html[data-dshwp-panel=plugins] .fO69Vq_pageTitle{font-size:24px;line-height:32px;font-weight:600;}
    html[data-dshwp-panel=plugins] .fO69Vq_pageIntro{margin-top:8px;font-size:14px;line-height:22px;}
    html[data-dshwp-panel=plugins] .fO69Vq_toolbar{gap:8px;align-items:center;max-width:100%;min-width:0;flex-wrap:wrap;}
    html[data-dshwp-panel=plugins] .fO69Vq_toolbar>.fO69Vq_addGroup,html[data-dshwp-panel=plugins] .fO69Vq_toolbar>.fO69Vq_addButton{order:2;}
    html[data-dshwp-panel=plugins] .fO69Vq_addButton{min-height:32px;border-radius:999px;corner-shape:round;}
    html[data-dshwp-panel=plugins] .fO69Vq_cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 32px;}
    html[data-dshwp-panel=plugins] .fO69Vq_card{margin:0;border-radius:12px;}
    html[data-dshwp-panel=plugins] .fO69Vq_cardHead{min-height:64px;gap:12px;padding:10px 8px;}
    html[data-dshwp-panel=plugins] .fO69Vq_cardIcon{width:36px;height:36px;border:0;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);}
    html[data-dshwp-panel=plugins] .fO69Vq_cardIcon img{width:32px;height:32px;object-fit:contain;}
    html[data-dshwp-panel=plugins] .fO69Vq_cardIcon svg{max-width:24px;max-height:24px;}
    html[data-dshwp-panel=plugins] .fO69Vq_installedPanel{gap:28px;}
    html[data-dshwp-sidebar=true] .fO69Vq_pageTabs{display:none;}
    html[data-dshwp-skills=true] .fO69Vq_pageHead{display:none;}
    [data-dshwp-filtered]{display:none!important;}
    .dshwp-skills{width:100%;}.dshwp-pageHead{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:20px;padding-top:32px;margin-bottom:28px;}
    .dshwp-pageHead h1{margin:0;font-size:24px;line-height:32px;font-weight:600;}.dshwp-pageHead p{margin:8px 0 0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-secondary);}
    .dshwp-toolbar{display:flex;align-items:center;gap:8px;max-width:100%;flex-wrap:wrap;}
    .dshwp-skillSection>h2{margin:0 0 16px;padding-bottom:12px;border-bottom:.5px solid var(--dsw-alias-border-l3);font-size:15px;line-height:24px;font-weight:500;}
    .dshwp-skillGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px 32px;}
    .dshwp-skillCard{display:flex;align-items:center;gap:12px;min-width:0;min-height:64px;padding:10px 8px;border-radius:12px;}
    .dshwp-artwork{display:grid;place-items:center;flex:none;width:36px;height:36px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary);}
    .dshwp-skillCopy{flex:1;min-width:0;}.dshwp-skillCopy h3{margin:0;font-size:14px;line-height:20px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
    .dshwp-skillCopy p{margin:4px 0 0;font-size:13px;line-height:18px;color:var(--dsw-alias-label-tertiary);display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:1;overflow:hidden;}
    .dshwp-available{display:flex;flex:none;color:var(--dsw-alias-label-tertiary);}
    .dshwp-more{align-self:flex-start;margin:14px 8px;padding:0;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:22px;cursor:pointer;}
    .dshwp-notice{margin:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);}.dshwp-empty{padding:32px 0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;}
    html[data-dshwp-panel=schedules][data-dshwp-sidebar=true] .S0jZwq_listPane{position:fixed;z-index:2;left:var(--dshwp-sidebar-left);top:var(--dshwp-sidebar-top);width:var(--dshwp-sidebar-width);height:var(--dshwp-sidebar-height);display:flex;overflow:hidden;border-radius:var(--dshlr-pane-radius) 0 0 var(--dshlr-pane-radius);}
    html[data-dshwp-panel=schedules][data-dshwp-sidebar=true] .S0jZwq_pageScroll{display:flex;flex-direction:column;overflow:hidden;scrollbar-gutter:auto;}
    html[data-dshwp-panel=schedules][data-dshwp-sidebar=true] .S0jZwq_pageContent{box-sizing:border-box;flex:1;width:100%;min-height:0;}
    html[data-dshwp-panel=schedules][data-dshwp-sidebar=true] .S0jZwq_list{flex:1;min-height:0;overflow:auto;}
    html[data-dshwp-panel=schedules] .S0jZwq_pageContent{display:flex;flex-direction:column;max-width:none;padding:12px 10px 20px;}
    html[data-dshwp-panel=schedules] .S0jZwq_pageHeading{display:contents;}
    html[data-dshwp-panel=schedules] .S0jZwq_pageHeading>h1{display:none;}
    .dshwp-taskHeaderMount{display:contents;}.dshwp-taskHeaderMount>.dshwp-sidebarHead{order:0;}
    html[data-dshwp-panel=schedules] .S0jZwq_creationActions{display:none;}
    .dshwp-newTask{order:2;width:100%;height:34px;margin-top:10px;margin-bottom:14px;justify-content:flex-start;padding:6px 8px;border:0;border-radius:9px;background:transparent;color:var(--dsw-alias-label-primary);box-shadow:none;font-size:14px;font-weight:400;}
    .dshwp-newTask:hover{background:var(--dsw-alias-interactive-bg-hover);}
    html[data-dshwp-panel=schedules] .S0jZwq_filters{display:block;order:3;margin-bottom:8px;}html[data-dshwp-panel=schedules] .S0jZwq_list{order:4;}
    html[data-dshwp-panel=schedules] .S0jZwq_filterTabs{display:none;}.dshwp-taskFilterMount{display:block;}
    .dshwp-taskFilter{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 4px 0 8px;font-size:13px;line-height:22px;color:var(--dsw-alias-label-tertiary);}
    html[data-dshwp-panel=schedules] .S0jZwq_searchField{display:none;order:1;margin:12px 0 0;padding:0;border:0;border-radius:999px;corner-shape:round;background:transparent;box-shadow:none;}
    html[data-dshwp-panel=schedules] [data-dshwp-search=true] .S0jZwq_searchField{display:flex;}
    html[data-dshwp-panel=schedules] .S0jZwq_searchField>:first-child{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;height:40px;padding:0 12px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-interactive-bg-hover);box-shadow:none;}
    html[data-dshwp-panel=schedules] .S0jZwq_searchField:has(.S0jZwq_searchClear)>:first-child{padding-right:36px;}
    html[data-dshwp-panel=schedules] .S0jZwq_searchField input{min-width:0;padding:0;outline:none;font-size:14px;line-height:20px;}
    html[data-dshwp-panel=schedules] .S0jZwq_empty{align-items:flex-start;text-align:left;padding:8px;font-size:13px;}
    html[data-dshwp-panel=schedules] .S0jZwq_emptyGlyph,html[data-dshwp-panel=schedules] .S0jZwq_emptyAction,html[data-dshwp-panel=schedules] .S0jZwq_list .S0jZwq_empty>h2{display:none;}
    html[data-dshwp-panel=schedules] .S0jZwq_row{gap:8px;padding:8px;border-radius:9px;}
    html[data-dshwp-panel=schedules] .S0jZwq_rowTitle{font-size:14px;line-height:20px;font-weight:400;}
    html[data-dshwp-panel=schedules] .S0jZwq_rowSummary{font-size:11px;line-height:16px;}
    html[data-dshwp-panel=schedules][data-dshwp-sidebar=true] [data-testid=task-manager-page]>.S0jZwq_detail{flex:1;border-left:0;}
    .dshwp-taskLandingMount{display:none;flex:1;min-width:0;}
    html[data-dshwp-panel=schedules][data-dshwp-sidebar=true] .dshwp-taskLandingMount{display:flex;}
    html[data-dshwp-panel=schedules] .S0jZwq_hasDetails>.dshwp-taskLandingMount{display:none;}
    .dshwp-taskLanding{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;width:100%;padding:24px;text-align:center;box-sizing:border-box;}
    .dshwp-taskLanding>svg{color:var(--dsw-alias-label-tertiary);margin-bottom:4px;}.dshwp-taskLanding h1{margin:0;font-size:20px;line-height:28px;font-weight:500;}
    .dshwp-taskLanding p{margin:0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary);}.dshwp-taskLanding button{margin-top:24px;min-height:34px;border-radius:999px;corner-shape:round;}
    .dshwp-sidebar button:focus-visible,.dshwp-iconButton:focus-visible,.dshwp-more:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:-2px;}
    @container dshwp (max-width:760px){html[data-dshwp-panel=plugins] .fO69Vq_cards,.dshwp-skillGrid{grid-template-columns:minmax(0,1fr);}html[data-dshwp-panel=plugins] .fO69Vq_toolbar{width:100%;}.dshwp-searchMount{flex:1 1 160px;min-width:0;}.dshwp-search{width:220px;}.dshwp-searchMount>.dshwp-search{width:100%;}}
  `
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workbench pages: locale')
    const t = ctx.locale.bind(NS)
    const inventory = createSnapshotStore({ phase: 'idle', items: [] })
    const layout = ctx.get('layout'), remote = ctx.get('remote')
    // DSH 0.2.1-rc.2 shares this exact settings-shell instance with its launcher.
    const settingsEntry = () => ctx.slots.entries('sidebar.settings').find((entry) =>
      entry.options.children?.['settings.launcher'] && typeof entry.store?.create === 'function')
    const openSettings = () => {
      const actions = settingsEntry()?.store.create()?.actions
      if (typeof actions?.open === 'function') actions.open()
    }
    const settingsAction = () => settingsEntry() ? openSettings : undefined
    let disposed = false, reading = false, again = false, lastPanel
    const loadInventory = async () => {
      if (disposed || layout.panelInfo.getSnapshot().activePanelId !== 'plugins') return
      if (reading) { again = true; return }
      reading = true
      inventory.set({ ...inventory.getSnapshot(), phase: 'loading' })
      try {
        const result = await remote.pluginManager.listBundles()
        if (!disposed) inventory.set(result.ok && Array.isArray(result.value)
          ? { phase: 'ready', items: result.value.filter((item) => item.installed && !PROFILE_BUNDLES.has(item.name)) }
          : { ...inventory.getSnapshot(), phase: 'error' })
      } catch {
        if (!disposed) inventory.set({ ...inventory.getSnapshot(), phase: 'error' })
      } finally {
        reading = false
        if (again) { again = false; void loadInventory() }
      }
    }
    ctx.effect(() => {
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-workbench-pages'; style.textContent = CSS
      document.head.append(style)
      const onPanel = () => {
        const panel = layout.panelInfo.getSnapshot().activePanelId
        if (panel !== lastPanel) { lastPanel = panel; void loadInventory() }
      }
      const offPanel = layout.panelInfo.subscribe(onPanel)
      const offChanged = remote.$on?.('plugin-manager/changed', () => { void loadInventory() })
      onPanel()
      return () => { disposed = true; offPanel(); offChanged?.(); style.remove() }
    }, 'workbench pages: presentation and inventory')
    ctx.slots.inject('plugins.tab', () => ctx.slots.register({
      name: 'plugins.tab', id: SKILLS_TAB, order: 20, label: () => t('skills'), locale: NS,
      inject: () => ({
        hooks: { hostGeneration: ctx.get('connection').generation },
        listSkills: (sessionId, signal) => remote.skills.list({ sessionId }, signal),
        backToChat: () => layout.selectPanel(null),
        openSettings: settingsAction(),
      }),
    }, SkillsPage))
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: 'workbench-pages', locale: NS,
      inject: () => ({ inventory, openSettings: settingsAction(), resolveText: (value) => ctx.locale.resolveText(value),
        openPackage: (name) => {
          const navigation = ctx.get('pluginNavigation')
          if (navigation) navigation.openBundle(name)
          else [...document.querySelectorAll('[data-plugin-package]')]
            .find((node) => node.getAttribute('data-plugin-package') === name)?.querySelector('.fO69Vq_cardOpen')?.click()
        } }),
    }, Overlay))
  }
  return { inject: ['slots', 'locale', 'layout', 'remote', 'connection'], requires: ['dsh-left-rail'],
    apply, __test: { skillContext, filterSkills, safeIcon } }
})
