/* Isolated synthetic data; components, editor, primitives and styles are DSH's. */
const modules = globalThis.__reviewModules
const definitions = new Map()
window.__ModuleLoader__ = { load: ({ id, factory }) => definitions.set(id, factory) }
for (const name of ['layout', 'sidebar', 'conversation', 'attachment', 'model-selection', 'permission-presets', 'schedule', 'plugin-manager']) {
  await import('./' + name + '.js')
  const id = '@deepseek-ai/dsh-client-ui-' + name
  modules[id] = definitions.get(id)((specifier) => {
    if (!(specifier in modules)) throw new Error('Unseeded host dependency: ' + specifier)
    return modules[specifier]
  })
}
const React = modules.react
const { createRoot } = modules['react-dom/client']
const p = modules['@deepseek-ai/dsh-client-ui-primitives']
const { createSnapshotStore } = modules['@deepseek-ai/dsh-client-store']
const host = modules['@deepseek-ai/dsh-client-ui-conversation'].__review
const Sidebar = modules['@deepseek-ai/dsh-client-ui-sidebar'].__review.SidebarRoot
const Attachments = modules['@deepseek-ai/dsh-client-ui-attachment'].__review.ComposerAttachments
const h = React.createElement
const store = (value) => createSnapshotStore(value)
const useStore = (source, selector = (value) => value) =>
  selector(React.useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot))
const now = Date.now()
const sessionList = store({
  phase: 'ready',
  ids: ['s1', 's2', 's3'],
  byId: {
    s1: {
      id: 's1',
      title: '新会话',
      cwd: 'C:/project',
      blank: true,
      retainedBy: { mainView: 1 },
      updatedAt: now,
    },
    s2: { id: 's2', title: '检查附件和输入框布局', cwd: 'C:/project', updatedAt: now - 3600000 },
    s3: { id: 's3', title: '整理插件设置', cwd: 'C:/demo', updatedAt: now - 7200000 },
  },
})
const workspaces = store({
  phase: 'ready',
  items: [
    { workspaceId: 'w1', title: 'dsh-codex-style', path: 'C:/project', sessionIds: ['s1', 's2'] },
    { workspaceId: 'w2', title: 'demo', path: 'C:/demo', sessionIds: ['s3'] },
  ],
  pinnedSessionIds: [],
  archivedSessionIds: [],
})
const statuses = store(new Map())
const panel = store({ activePanelId: null })
const sessionState = store({
  openState: 'open',
  blank: true,
  awaitingFirstTurn: false,
  subagent: null,
  running: false,
  removed: false,
  promptError: null,
  pendingSubmissions: [],
})
const inbox = store({ 'next-turn': [], 'next-step': [] })
const sessionEvents = store({ entries: [] })
const generation = store({ id: 'fixture-generation', host: 'fixture-host' })
const composerBlock = store(undefined)
const emptyUploads = store({})
const emptySource = store(undefined)
const query = new URLSearchParams(location.search)
const statusMode = query.get('status') === '1'
const statusScreen = query.get('screen')
const initialScreen =
  statusScreen === 'hero' || statusScreen === 'active' ? statusScreen : statusMode ? 'active' : 'hero'
const language = query.get('lang') === 'en' ? 'en' : 'zh'
/** Composer status projections; opt-in through `?status=1` so other checks keep the empty dock. */
const statusProjections = statusMode
  ? {
      contextPressure: store({ pressureTokens: 48000, projectedTokens: 61200, contextWindow: 128000 }),
      contextBreakdown: store({ systemTokens: 5200, toolsTokens: 8100, messageTokens: 47800 }),
      tokenUsage: store({ uncachedInputTokens: 21000, cacheReadTokens: 46000, cacheWriteTokens: 0, outputTokens: 7800 }),
      sessionStats: store({ turns: 1, steps: 2, llmMs: 5100, toolMs: 1200, ttftMs: 600, ttftSteps: 2, decodeMs: 2000, decodeTokens: 496 }),
    }
  : null
// StatsPills.module.css from the 0.2.1-rc.2 ui-chat host package, copied
// verbatim so the mock anchors paint exactly like the native stat pills.
const statPillsCss =
  '.iq1doa_anchor{min-width:0;font-size:calc(var(--dsh-content-font-size-secondary,13px) - 1px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));display:inline-flex}.iq1doa_pill{box-sizing:border-box;border-radius:var(--dsw-radius-sm);max-width:100%;color:var(--dsw-alias-label-tertiary);font:inherit;font-variant-numeric:tabular-nums;line-height:inherit;white-space:nowrap;background:0 0;border:none;align-items:center;gap:6px;padding:1px 8px;display:inline-flex}.iq1doa_pill svg{flex:none;width:14px;height:14px}button.iq1doa_pill{cursor:pointer}button.iq1doa_pill:hover,button.iq1doa_pill[aria-expanded=true]{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.iq1doa_label{text-overflow:ellipsis;min-width:0;overflow:hidden}.iq1doa_sep{color:var(--dsw-alias-separator-primary);margin:0 6px}'
if (statusMode) {
  const style = document.createElement('style')
  style.dataset.fixture = 'composer-status-stat-pills'
  style.textContent = statPillsCss
  document.head.append(style)
}
/** Host-equivalent labels for the two mock stat pills. */
const statLabels =
  language === 'en'
    ? { activity: '1 turns 2 steps · 248 tok/s', usage: '30.9K tok · Cache hit 50%' }
    : { activity: '1 轮 2 步 · 248 tok/s', usage: '30.9K tok · 缓存命中 50%' }
const mode = store({ screen: initialScreen, collapsed: false })
const shell = new host.SessionInputShell({ inbox, defaultSink: async () => ({ kind: 'success' }) })
const drafts = new Map()
const released = []
const control = { prompt: async () => ({ ok: true }), create: async () => 'child-1' }
const openedChats = [], startedChats = [], chatSearches = [], previewReads = [], fileTabs = []
const shortcutConfig = store({ status: 'ready', revision: 1 })
const shortcutCatalog = store([
  ['session.search', 'KeyK', 'K'], ['session.new', 'KeyN', 'N'],
  ['workspace.add', 'KeyO', 'O'], ['workspace.files', 'KeyP', 'P'],
].map(([id, code, key]) => ({ id, binding: { code, modifiers: ['control'] }, modified: false,
  issue: null, conflicts: [], label: id, aliases: [], keys: ['Ctrl+' + key] })))
const keyboardListeners = new Set()
if (new URLSearchParams(location.search).get('surface') !== 'web')
  window.dshDesktop = { protocolVersion: 1, keyboard: { subscribe(listener) { keyboardListeners.add(listener); return () => keyboardListeners.delete(listener) } } }
const emitKeyboard = (input) => { for (const listener of [...keyboardListeners]) listener({ revision: shortcutConfig.getSnapshot().revision, ...input }) }
const modelState = store({
  current: { provider: 'fixture', model: 'reasoner', reasoningEffort: 'medium' },
  groups: [{ id: 'fixture', name: '测试模型', models: [
    { id: 'reasoner', name: 'Reasoner', reasoning: { defaultEffort: 'medium', efforts: [
      { id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' },
      { id: 'high', name: 'High' }, { id: 'max', name: 'Extra high' },
    ] } },
    { id: 'plain', name: 'Chat' },
  ] }],
  retainedEffort: undefined, failures: [], status: 'ready', pending: null, error: null,
})
const modelWrites = []
const permissionCatalog = store({ value: { options: [
  { value: 'read-only', name: '只读', description: '只读模式' },
  { value: 'workspace-write', name: '工作区', description: '工作区权限' },
  { value: 'danger-full-access', name: '完全权限', description: '完全权限' },
] } })
const permissionSelection = store({ currentValue: 'danger-full-access' })
const modelDirectory = {
  store: modelState,
  generation: 0,
  load: async () => modelState.getSnapshot(),
  select: async (selection) => {
    const generation = ++modelDirectory.generation
    modelWrites.push(selection)
    modelState.set({ ...modelState.getSnapshot(), status: 'selecting', pending: selection, error: null })
    const result = await (control.selectModel?.(selection) ?? Promise.resolve({ ok: true }))
    if (generation !== modelDirectory.generation) return result
    modelState.set({ ...modelState.getSnapshot(), status: result.ok ? 'ready' : 'error', pending: null,
      ...(result.ok ? { current: selection } : { error: 'fixture selection failed' }) })
    return result
  },
  resetConnected() {
    this.generation++
    modelState.set({ ...modelState.getSnapshot(), status: 'ready', pending: null, error: null })
  },
}
const gitState = store({ branch: 'main', head: 'b'.repeat(40), token: 'a'.repeat(64), dirty: false, writable: true, filtersDisabled: false,
  branches: [{ name: 'main', inUse: false }, { name: 'feature/ui', inUse: false }, { name: 'occupied', inUse: true }] })
const gitWrites = [], gitMounts = []
const displayForm = store({ status: 'ready', writable: true, revision: 0, value: { transcriptView: 'standard', collapseTiming: 'completion', performanceUsage: 'compact', linkOpening: 'sidebar' } })
const displayWrites = []
displayForm.mutate = async (patch) => {
  displayWrites.push(patch)
  if (control.displayMutation) return control.displayMutation(patch)
  const state = displayForm.getSnapshot()
  const value = { ...state.value }
  for (const operation of patch) value[operation.path[0]] = operation.value
  displayForm.set({ ...state, value, revision: state.revision + 1 })
  return true
}
const archived = []
const unarchived = []
const queueWrites = []
const session = {
  projections: { faceOf: (name) => name === 'inbox' ? inbox : emptySource },
  getSnapshot: sessionState.getSnapshot,
  subscribe: sessionState.subscribe,
  prompt: (...args) => control.prompt(...args),
  async updateQueue(id, action) {
    if (this !== session) throw new Error('fixture Session receiver was lost')
    queueWrites.push({ id, action })
    const result = await (control.updateQueue?.(id, action) ?? Promise.resolve({ ok: true, value: { accepted: true } }))
    if (result?.ok === true && result.value?.accepted === true) {
      const state = inbox.getSnapshot()
      inbox.set({ ...state, ...Object.fromEntries(['next-turn', 'next-step'].map((target) => [target,
        state[target].flatMap((item) => item.id !== id ? [item] : action.kind === 'edit' ? [{ ...item, content: action.content }] : []),
      ])) })
    }
    return result
  },
}
const conversation = {
  blocks: { storeFor: () => composerBlock },
  input: { for: () => shell },
  async updateQueue(id, action) {
    if (control.queueScopeFailure) throw new Error('conversation.updateQueue requires a session scope')
    const result = await session.updateQueue(id, action)
    if (!result.ok) throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
  },
  resolveDraftAttachments: (ids) => ids.map((id) => drafts.get(id)).filter(Boolean),
  fileUploads: emptyUploads,
  createDrafts(sessionId, files) {
    return files.map((file) => {
      const draft = {
        id: crypto.randomUUID(),
        file,
        kind: file.type.startsWith('image/') ? 'image' : 'file',
        previewUrl: URL.createObjectURL(file),
      }
      drafts.set(draft.id, draft)
      return draft
    })
  },
  releaseDraftAttachment(id) {
    const draft = drafts.get(id)
    if (draft) URL.revokeObjectURL(draft.previewUrl)
    drafts.delete(id)
    released.push(id)
  },
}
const scope = { get: (name) => (name === 'conversation' ? conversation : undefined) }
const sessionBindings = new Map()
const bindingFor = (id) => {
  if (control.binding) return control.binding(id)
  if (!sessionBindings.has(id))
    sessionBindings.set(id, {
      session: id === 's1' ? session : { ...session, prompt: (...args) => control.prompt(...args) },
      conversation: store({ nodes: [] }),
      eventSource: sessionEvents,
    })
  return sessionBindings.get(id)
}
const closeHandlers = new Map()
const dictionaries = new Map()
dictionaries.set('model', modules['@deepseek-ai/dsh-client-ui-model-selection'][language === 'en' ? '__reviewEnglishLocale' : '__reviewLocale'])
const tFor =
  (namespace) =>
  (key, params = {}) =>
    (dictionaries.get(namespace)?.[key] ?? key).replace(/\{(\w+)\}/g, (_, name) =>
      String(params[name] ?? ''),
    )
const registrations = []
const disposers = []
const services = {
  shortcuts: { config: shortcutConfig, catalog: shortcutCatalog },
  modelDirectories: { directoryFor: () => modelDirectory },
  configForms: { get: (id) => { if (id !== 'ui-chat') throw new Error('Fixture exposes only ui-chat preferences'); return displayForm } },
  layout: {
    panelInfo: panel,
    hasMainPanel: (id) => ['plugins', 'schedules'].includes(id),
    selectPanel: (id) => panel.set({ activePanelId: id }),
  },
  uiSession: { current: { value: 's1', subscribe: () => () => {} }, sessionStatus: statuses },
  connection: { generation },
  uiWorkspace: {
    workspaces: { list: workspaces },
    sessions: { list: sessionList },
    openSession: async (id) => {
      openedChats.push(id)
      if (control.openSession) return control.openSession(id)
      services.uiSession.current.value = id
      const state = sessionList.getSnapshot()
      sessionList.set({ ...state, byId: Object.fromEntries(Object.entries(state.byId).map(([key, value]) => [key, { ...value, retainedBy: { mainView: key === id ? 1 : 0 } }])) })
      const next = new Map(statuses.getSnapshot())
      if (next.has(id)) next.set(id, { ...next.get(id), completionUnread: false })
      statuses.set(next)
    },
    startSession: async (workspaceId) => { startedChats.push(workspaceId); if (control.startSession) return control.startSession(workspaceId) },
    pickDirectory: async () => control.pickDirectory?.() ?? null,
    openWorkspace: async () => {},
  },
  workspaces: {
    create: async ({ path }) => ({ workspaceId: 'fixture-added', path }),
    archiveSession: async (id) => {
      if (control.archiveSession) await control.archiveSession(id)
      archived.push(id)
    },
    unarchiveSession: async (id) => {
      unarchived.push(id)
    },
  },
  sessions: {
    list: sessionList,
    scope: () => scope,
    binding: bindingFor,
    retain: (...args) => control.retain?.(...args),
    create: (...args) => control.create(...args),
    searchResultLimit: 20,
    search: async (query, signal) => {
      chatSearches.push(query)
      return control.search ? control.search(query, signal) : { ok: true, value: { items: [], hasMore: false } }
    },
    refreshProjections: async (id) => {
      previewReads.push(id)
      if (control.refreshProjections) return control.refreshProjections(id)
      const state = sessionList.getSnapshot()
      const value = control.previews?.[id] ?? null
      sessionList.set({ ...state, projectionsBySession: { ...state.projectionsBySession, [id]: { state: 'ready', values: { codexActivityPreview: value } } } })
    },
  },
  remote: {
    async $mount(contribution) { gitMounts.push(contribution.package) },
    codexGit: {
      async list(sessionId, signal) { return control.gitList ? control.gitList(sessionId, signal) : { ok: true, value: { ok: true, repository: gitState.getSnapshot() } } },
      async switch(sessionId, branch, expectedHead) {
        gitWrites.push({ sessionId, branch, expectedHead })
        if (control.gitSwitch) return control.gitSwitch(sessionId, branch, expectedHead)
        const current = gitState.getSnapshot()
        if (current.token !== expectedHead) return { ok: true, value: { ok: false, reason: 'stale' } }
        gitState.set({ ...current, branch, token: 'c'.repeat(64) })
        return { ok: true, value: { ok: true, repository: gitState.getSnapshot() } }
      },
    },
  },
  sidebarRightTabs: { register: () => () => {} },
  sidebarRight: {
    commandTarget: () => ({ sessionId: services.uiSession.current.value }),
    openTabFromTarget: async (kind, target) => { fileTabs.push({ kind, target }); return true },
    registerCloseHandler: (kind, handler) => {
      closeHandlers.set(kind, handler)
      return () => closeHandlers.delete(kind)
    },
    openTab: (_kind, options) => {
      sideTab = { ...sideTab, id: crypto.randomUUID(), navigation: { params: options.params } }
      mode.set({ ...mode.getSnapshot(), screen: 'fork' })
    },
  },
}
const ctx = {
  get: (name) => services[name],
  ...services,
  effect(fn) {
    const off = fn()
    if (typeof off === 'function') disposers.push(off)
    return () => {
      if (typeof off === 'function') off()
    }
  },
  inject(_deps, fn) {
    if (_deps.every((name) => services[name])) fn(ctx)
    return () => {}
  },
  locale: {
    bind: tFor,
    resolveText: (value) => typeof value === 'string' ? value : value?.zh ?? value?.en ?? '',
    register(namespace, dict) {
      dictionaries.set(namespace, dict[language] ?? dict.zh)
      return () => dictionaries.delete(namespace)
    },
  },
  slots: {
    entries: (name) => registrations.filter((entry) => entry.options.name === name),
    inject(_name, fn) {
      return fn()
    },
    register(options, component) {
      const record = { options, component }
      registrations.push(record)
      return () => {
        const index = registrations.indexOf(record)
        if (index >= 0) registrations.splice(index, 1)
      }
    },
  },
}
window.__DSH_CODEX_STYLE_FEATURES__ = [
  'dsh-sidebar-sections',
  'dsh-left-rail',
  'dsh-workbench-pages',
  'dsh-git-switch',
  'dsh-hover-polish',
  'dsh-instant-ui',
  'dsh-nav-back-forward',
  'dsh-long-paste',
  'dsh-composer-history',
  'dsh-queue-withdraw',
  'dsh-selection-quotes',
  'dsh-continue',
  'dsh-effort-slider',
  'dsh-selection-toolbar',
  'dsh-attachment-actions',
  'dsh-quick-fork',
  'dsh-codex-style.settings',
  ...(statusMode ? ['dsh-composer-status'] : []),
]
window.__DSH_CODEX_STYLE_ISOLATION__ = true
globalThis.__DSH_CODEX_STYLE_FEATURES__ = window.__DSH_CODEX_STYLE_FEATURES__
// Only the fixture's own queue is mutable. No requests reach a DSH gateway.
const nativeFetch = window.fetch
const frozen = new Set()
const requests = []
window.fetch = (url, init) => {
  if (typeof url !== 'string' || !url.startsWith('/dsh-queue-withdraw/'))
    return nativeFetch(url, init)
  const body = JSON.parse(init.body)
  requests.push({ url, body })
  if (url.endsWith('/freeze')) frozen.add(body.itemId)
  else if (url.endsWith('/thaw')) frozen.delete(body.itemId)
  else if (url.endsWith('/reorder')) {
    const rows = inbox.getSnapshot()['next-turn']
    inbox.set({
      ...inbox.getSnapshot(),
      'next-turn': body.order.map((id) => rows.find((row) => row.id === id)),
    })
  }
  return Promise.resolve(
    new Response(JSON.stringify({ ok: true, ids: [...frozen] }), {
      headers: { 'content-type': 'application/json' },
    }),
  )
}
await import('./client.js')
const plugin = definitions.get('dsh-codex-style')((id) => modules[id])
plugin.apply(ctx)
const injected = new WeakMap()
const standard = {
  sessionId: 's1',
  useSessions: (selector) => useStore(sessionList, selector),
  useWorkspaces: (selector) => useStore(workspaces, selector),
  useSessionStatus: (selector) => useStore(statuses, selector),
  usePanelInfo: (selector) => useStore(panel, selector),
  useSession: (selector) => useStore(sessionState, selector),
  useInput: (selector) => useStore(shell.state, selector),
  useProjection: (name, selector = (value) => value) => {
    if (name === 'inbox') return useStore(inbox, selector)
    if (statusMode && Object.hasOwn(statusProjections, name)) return useStore(statusProjections[name], selector)
    return selector(undefined)
  },
}
const { createWorkbenchFixture } = await import('./workbench-fixture.js')
const workbench = createWorkbenchFixture({ React, modules, services, store, useStore, registrations,
  panel, mode, control, getStandard: () => standard })
control.pagesT = tFor('workbenchPages')
function Entry({ entry, owner = {} }) {
  if (!injected.has(entry)) injected.set(entry, entry.options.inject?.('s1') ?? {})
  const props = injected.get(entry)
  const hooks = Object.fromEntries(
    Object.entries(props.hooks ?? {}).map(([name, source]) => [
      'use' + name[0].toUpperCase() + name.slice(1),
      (selector) => useStore(source, selector),
    ]),
  )
  return h(entry.component, {
    ...standard,
    ...props,
    ...hooks,
    ...owner,
    t: tFor(entry.options.locale),
    renderSlot,
  })
}
function registered(name, owner = {}) {
  return registrations
    .filter((entry) => entry.options.name === name)
    .map((entry, index) => h(Entry, { key: entry.options.id ?? index, entry, owner }))
}
const conversationT = (key, params = {}) =>
  (modules['@deepseek-ai/dsh-client-ui-conversation'].__reviewLocale[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, name) => String(params[name] ?? ''),
  )
function addFiles(files) {
  const ids = conversation.createDrafts('s1', files).map((item) => item.id)
  if (!shell.addAttachments(ids)) ids.forEach(conversation.releaseDraftAttachment)
  return null
}
function NativeLauncher() {
  const [open, setOpen] = React.useState(false)
  return h(p.Menu, {
    open,
    portal: true,
    side: 'top',
    autoFocus: true,
    anchor: h(
      'button',
      {
        type: 'button',
        'aria-label': '账号菜单',
        'aria-haspopup': 'menu',
        'aria-expanded': String(open),
        onClick: () => setOpen(!open),
      },
      h('span', null, '本地账号'),
    ),
    items: [{ id: 'settings', label: '设置' }],
    onClose: () => setOpen(false),
    onSelect: () => {
      setOpen(false)
      mode.set({ ...mode.getSnapshot(), screen: 'settings' })
    },
  })
}
// Mock of the host ui-chat stat pill (DialogPill shape) rendered inside the native dock.
function ComposerStatPill({ stat, label, icon: Icon }) {
  return h(
    'span',
    { className: 'iq1doa_anchor', 'data-composer-stat': stat },
    h(
      'button',
      {
        type: 'button',
        className: 'iq1doa_pill',
        'aria-haspopup': 'dialog',
        'aria-expanded': false,
        'aria-label': label,
      },
      h(Icon, {}),
      h('span', { className: 'iq1doa_label' }, label),
    ),
  )
}
function renderSlot(name, owner = {}, options = {}) {
  if (name === 'conversation.composer.dock') {
    const mocks = statusMode
      ? [
          h(ComposerStatPill, {
            key: 'activity',
            stat: 'activity',
            label: statLabels.activity,
            icon: p.IconGaugeOutlineRegular,
          }),
          h(ComposerStatPill, {
            key: 'usage',
            stat: 'usage',
            label: statLabels.usage,
            icon: p.IconDatabaseOutlineRegular,
          }),
        ]
      : []
    const entries = registered(name, owner)
    return mocks.length > 0 || entries.length > 0
      ? h(React.Fragment, null, mocks, entries)
      : (options.fallback ?? null)
  }
  if (name === 'conversation.input.permission') return h(
    modules['@deepseek-ai/dsh-client-ui-permission-presets'].__review.PermissionSelect,
    { ...owner, locked: false,
      usePermissionCatalog: (selector) => useStore(permissionCatalog, selector),
      useProjection: () => useStore(permissionSelection),
      select: async (currentValue) => { permissionSelection.set({ currentValue }) },
      t: (key, params = {}) => (modules['@deepseek-ai/dsh-client-ui-permission-presets'].__reviewLocale[key] ?? key)
        .replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? '')) },
  )
  if (name === 'conversation.input.model') return h(
    modules['@deepseek-ai/dsh-client-ui-model-selection'].__review.ModelSelect,
    { ...owner, available: true, directory: modelState,
      load: modelDirectory.load, select: modelDirectory.select, renderSlot,
      t: tFor('model') },
  )
  if (name === 'sidebar.settings') return h(NativeLauncher)
  if (name === 'sidebar.brand.name') return 'DeepSeek'
  if (name === 'conversation.session')
    return mode.getSnapshot().screen === 'hero'
      ? null
      : h('div', { className: 'fixture-transcript' }, '检查附件删除、排队编辑与输入历史。')
  if (name === 'conversation.composer.bar') return h(NativeInput, owner)
  if (name === 'conversation.input.attachments')
    return h(Attachments, {
      ...owner,
      t: (key) => modules['@deepseek-ai/dsh-client-ui-attachment'].__reviewLocale[key] ?? key,
    })
  if (name === 'conversation.input.dock')
    return h(
      React.Fragment,
      null,
      h(host.QueueDock, {
        ...standard,
        t: conversationT,
        updateQueue: (id, action) => conversation.updateQueue(id, action),
        notify: (level, text) => shell.notify(level, text),
        loadImage: async () =>
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        renderFactorySlot: (name, owner) => name === 'conversation.user.text' ? owner.text : null,
      }),
      registered(name, owner),
    )
  return registered(name, owner).length ? registered(name, owner) : (options.fallback ?? null)
}
function NativeInput(props) {
  return h(host.InputBar, {
    ...standard,
    ...props,
    keyboard: shell,
    inputActions: shell.actions,
    addFiles,
    removeAttachment(id) {
      if (shell.removeAttachment(id)) conversation.releaseDraftAttachment(id)
    },
    resolveDraftAttachments: (ids) => ids.map((id) => drafts.get(id)).filter(Boolean),
    retryFileUpload() {},
    useBusyEnter: (selector) => selector('queue'),
    useFileUploads: (selector) => useStore(emptyUploads, selector),
    useNotices: (selector) => useStore(shell.notices, selector),
    useLexicon: (selector) => useStore(emptySource, selector),
    useMenuLauncher: (selector) => selector(undefined),
    useStopShortcut: (selector) => selector([]),
    t: conversationT,
    renderSlot,
  })
}
const root = createRoot(document.getElementById('root'))
const FixtureViews = () => renderSlot('conversation.session')
function closeFork() {
  closeHandlers.get('quick-fork')?.('s1', sideTab)
  mode.set({ ...mode.getSnapshot(), screen: 'hero' })
}
let sideTab = {
  id: 'fixture-fork',
  navigation: { params: { parentSessionId: 's1', quote: '' } },
  actions: { close: closeFork },
}
const useTabInfo = () => ({ tab: sideTab })
function App() {
  const state = useStore(mode)
  const activePanel = useStore(panel).activePanelId
  return h(
    'div',
    {
      className: 'BynINW_frame',
      'data-sidebar-collapsed': state.collapsed || undefined,
      'data-rightbar-collapsed': true,
      style: {
        gridTemplateColumns: (state.collapsed ? '0' : '280px') + ' minmax(0,1fr) 0',
        '--dsh-windows-sidebar-width': (state.collapsed ? 0 : 280) + 'px',
      },
    },
    h('div', { className: 'fixture-caption' }, h('span', null, '应用'), h('span', null, '编辑')),
    h(
      'aside',
      { className: 'BynINW_sidebarCol' },
      h(Sidebar, {
        collapsed: state.collapsed,
        width: 280,
        startSession: () => mode.set({ ...state, screen: 'hero' }),
        toggleSidebar: () => mode.set({ ...state, collapsed: !state.collapsed }),
        usePanels: (selector) => selector([]),
        useShortcuts: (selector) => selector([]),
        usePanelInfo: standard.usePanelInfo,
        t: (key) => modules['@deepseek-ai/dsh-client-ui-sidebar'].__reviewLocale[key] ?? key,
        renderSlot,
      }),
    ),
    h(
      'main',
      { className: 'BynINW_centerCol' },
      activePanel === 'plugins' ? h(workbench.Plugins)
        : activePanel === 'schedules' ? h(workbench.Tasks)
        : state.screen === 'settings'
        ? h('div', { className: 'fixture-settings' }, registered('settings.section'))
        : state.screen === 'fork'
          ? registered('sidebar.right.pane.tab', { useTabInfo })
          : h(
              'div',
              {
                className: 'Dc7zOa_root',
                'data-phase': state.screen === 'hero' ? 'hero' : 'active',
              },
              h(host.ConversationContent, {
                ...standard,
                phase: state.screen === 'hero' ? 'hero' : 'active',
                hero: state.screen === 'hero',
                useComposerBlock: (selector) => useStore(composerBlock, selector),
                useFactorySlot: (name, fallback) => (name === 'views' ? FixtureViews : fallback),
                renderSlot,
                renderSlotChain: (_name, _owner, options) => options.fallback,
                selectWorkspace: async () => {},
                t: conversationT,
              }),
            ),
    ),
    h('div', { className: 'BynINW_overlayLayer' }, registered('shell.overlay')),
  )
}
root.render(h(App))
window.__CODEX_WORKBENCH_UI_FIXTURE__ = true
window.review = {
  session,
  bindingFor,
  permissionCatalog, permissionSelection,
  workbench, panel,
  workspaceState: workspaces,
  shortcutConfig, shortcutCatalog, emitKeyboard, keyboardListeners,
  openedChats, startedChats, chatSearches, previewReads, fileTabs,
  queueWrites,
  modelState, modelWrites, modelDirectory,
  gitState,
  gitWrites,
  gitMounts,
  sessionList,
  displayForm,
  displayWrites,
  shell,
  sessionState,
  sessionEvents,
  generation,
  composerBlock,
  statusMode,
  statusProjections,
  statuses,
  drafts,
  released,
  plugin,
  registrations,
  conversation,
  mode,
  inbox,
  control,
  archived,
  unarchived,
  requests,
  closeFork,
  fork: (id) => {
    sideTab = { ...sideTab, id }
    mode.set({ ...mode.getSnapshot(), screen: 'fork' })
  },
  show: (screen) => mode.set({ ...mode.getSnapshot(), screen }),
  image: () =>
    addFiles([
      new File(
        [
          Uint8Array.from(
            atob(
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
            ),
            (c) => c.charCodeAt(0),
          ),
        ],
        'fixture.png',
        { type: 'image/png' },
      ),
    ]),
  dispose: () => {
    root.unmount()
    for (const off of disposers.reverse()) off()
    for (const id of drafts.keys()) conversation.releaseDraftAttachment(id)
  },
}
