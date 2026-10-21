/** Native management components with private in-memory records and inert mutations. */
export function createWorkbenchFixture({ React, modules, services, store, useStore, registrations, panel, mode, control, getStandard }) {
  const h = React.createElement
  const nativePlugins = modules['@deepseek-ai/dsh-client-ui-plugin-manager']
  const nativeTasks = modules['@deepseek-ai/dsh-client-ui-schedule']
  const translate = (module) => (key, params = {}) => (module.__reviewLocale[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? ''))
  const packages = [
    ['codex-workbench', 'Codex 工作台', '统一聊天与工作区的界面和交互'],
    ['file-tools', '文件工具', '查看文件、引用和工作区内容'],
    ['terminal', '终端', '在工作区中执行和查看命令'],
    ['browser-tools', '浏览器工具', '浏览网页与查看本地页面'],
    ['notes', '笔记', '整理工作中的想法与记录'],
    ['calendar', '日程', '安排工作与定时任务'],
  ].map(([name, title, description]) => ({ name, meta: { title, description },
    enabled: true, installed: true, official: false, optional: false, removable: true,
    availability: 'profile', rows: [], overrides: [], version: '1.0.0' }))
  const pluginState = store({ status: 'ready', refreshStatus: 'idle', packages, busy: [],
    highlight: null, notice: null, confirm: null, install: { ...nativePlugins.__review.IDLE_INSTALL } })
  const navigation = store({ tab: 'installed', view: { kind: 'list' } })
  const actions = {
    setTab: (tab) => navigation.set({ ...navigation.getSnapshot(), tab }),
    setView: (view) => navigation.set({ ...navigation.getSnapshot(), view }),
  }
  panel.subscribe(() => { if (panel.getSnapshot().activePanelId !== 'plugins') actions.setView({ kind: 'list' }) })
  const ledger = { items: [], rows: new Set(), bundles: new Set() }
  const writes = [], skillReads = [], inventoryReads = []
  registrations.push({ options: { name: 'sidebar.settings', children: { 'settings.launcher': {} } },
    store: { create: () => ({ actions: { open: () => { writes.push('open-settings') } } }) } })
  services.remote.$on = () => () => {}
  services.remote.pluginManager = { async listBundles() {
    inventoryReads.push(true)
    return { ok: true, value: pluginState.getSnapshot().packages }
  } }
  services.remote.skills = { async list(request, signal) {
    skillReads.push(request.sessionId)
    if (control.listSkills) return control.listSkills(request, signal)
    return { ok: true, value: { skills: Array.from({ length: 9 }, (_, index) => ({
      name: ['Agent Browser', 'C++ 开发规范', '性能分析', '界面设计', '文件整理', '项目审阅', '演示文稿', '数据分析', '技术写作'][index],
      description: ['浏览网页、检查表单与页面交互。', '编写清晰、可靠的现代 C++ 代码。', '分析瓶颈并优化运行效率。'][index % 3],
      path: 'C:/private-fixture/skills/' + index + '/SKILL.md', modelInvocable: true,
    })) } }
  } }
  services.pluginNavigation = { openBundle(name) {
    panel.set({ activePanelId: 'plugins' }); actions.setTab('installed'); actions.setView({ kind: 'package', name })
  } }
  const record = (id, title, status = 'active') => ({ id, title, status, sessionId: 's1', kind: 'at',
    createdAt: new Date(Date.now() - 10000).toISOString(),
    scheduledAt: new Date(Date.now() + 86400000).toISOString(), prompt: '整理并汇总项目进展。' })
  const tasks = store({ status: 'ready', records: [], deleting: [], readRequest: 1 })
  function Plugins() {
    return h(nativePlugins.__review.PluginManagerPage, {
      ...getStandard(), t: translate(nativePlugins), actions,
      useStore: (selector) => useStore(navigation, selector),
      usePluginManager: (selector) => useStore(pluginState, selector),
      useConfigLedger: (selector) => selector(ledger),
      useConfigurations: (selector) => selector({ view: { namespaces: [] } }),
      usePluginTabs: (selector) => selector(registrations.filter((entry) => entry.options.name === 'plugins.tab')
        .map((entry) => ({ id: entry.options.id, label: entry.options.label() }))),
      ensure: () => {}, resolveText: (value) => typeof value === 'string' ? value : value?.zh ?? value?.en,
      refresh: () => { writes.push('refresh') }, clearHighlight: () => {},
      configForm: () => undefined, dismissNotice: () => {},
      setEnabled: (name, enabled) => { writes.push({ name, enabled }) },
      uninstall: () => {}, update: () => {}, setRowEnabled: () => {},
      openInstall: () => { writes.push('open-install') }, installFrom: () => {},
      renderSlot: (name, owner, options) => {
        const entry = registrations.find((entry) => entry.options.name === name && entry.options.id === options?.only)
        if (!entry) return null
        const injected = entry.options.inject?.() ?? {}
        const hooks = Object.fromEntries(Object.entries(injected.hooks ?? {}).map(([name, source]) => [
          'use' + name[0].toUpperCase() + name.slice(1), (selector) => useStore(source, selector),
        ]))
        return h(entry.component, { ...getStandard(), ...injected, ...hooks, ...owner,
          t: (key) => control.pagesT(key) })
      },
    })
  }
  function Tasks() {
    return h(nativeTasks.__review.TaskManagerPage, { ...getStandard(), t: translate(nativeTasks),
      useCatalog: (selector) => useStore(tasks, selector),
      onNewTask: () => { writes.push('new-task'); panel.set({ activePanelId: null }); mode.set({ ...mode.getSnapshot(), screen: 'hero' }) },
      onRetry: () => { writes.push('retry-tasks') },
      onDelete: async () => ({ ok: true }), onUpdateTiming: async () => ({ ok: false }),
      onOpenSession: () => {}, loadHistory: async () => ({ ok: true, value: { entries: [], hasMore: false } }),
    })
  }
  return { Plugins, Tasks, packages, pluginState, tasks, navigation, record, writes, skillReads, inventoryReads }
}
