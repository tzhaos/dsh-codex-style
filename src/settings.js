/**
 * Codex Workbench settings: task groups over independently isolated capabilities.
 * Capability IDs and preference keys are stable across the source reorganization.
 * Each custom settings page remains inside its own feature boundary.
 */

__DSH_FEATURE(SETTINGS_FEATURE_ID, function (require, env) {
  const React = require('react')
  const { Switch } = require('@deepseek-ai/dsh-client-ui-primitives')
  const { useEffect, useId, useRef, useState } = React
  const h = React.createElement

  /**
   * Error boundary for a feature-owned settings page. A page that crashes
   * renders nothing and quarantines only its own feature.
   */
  class SettingsPageBoundary extends React.Component {
    constructor(props) {
      super(props)
      this.state = { failed: false }
    }

    /** @returns {{ failed: boolean }} suppress the crashed page. */
    static getDerivedStateFromError() {
      return { failed: true }
    }

    /**
     * Quarantine the page's own feature, not the settings shell.
     * @param {unknown} error - thrown value.
     */
    componentDidCatch(error) {
      env.quarantineFeature(this.props.featureId, error, 'render')
    }

    /** @returns {object|null} page until the first error. */
    render() {
      return this.state.failed ? null : this.props.children
    }
  }

  /** Locale namespace owned by the merged plugin shell. */
  const NS = 'codexStyle'

  /** Task groups from the shared build catalog. */
  const GROUPS = env.featureGroups()

  /** @param {string} id - feature id. @returns {string} title dictionary key. */
  function titleKey(id) {
    return 'feature.' + id + '.title'
  }

  /** @param {string} id - feature id. @returns {string} summary dictionary key. */
  function summaryKey(id) {
    return 'feature.' + id + '.summary'
  }

  /** @param {string} id - feature id. @returns {string} note dictionary key. */
  function noteKey(id) {
    return 'feature.' + id + '.note'
  }

  const zh = {
    'group.navigation': '会话与导航',
    'group.composer': '消息输入',
    'group.content': '内容操作',
    'group.panels': '侧边面板',
    'group.interaction': '通用交互',
    'feature.dsh-selection-quotes.title': '选区引用',
    'feature.dsh-selection-quotes.summary': '将选中文字作为引用加入当前消息。',
    'feature.dsh-selection-quotes.note': '引用保存在浏览器；发送成功后移除，失败后恢复。',
    'feature.dsh-continue.title': '继续对话',
    'feature.dsh-effort-slider.title': '推理强度滑条',
    'feature.dsh-effort-slider.summary': '滑动选择当前模型支持的推理强度。',
    'feature.dsh-effort-slider.note': '松开后生效；可恢复默认强度，并保留原生模型菜单。',
    'feature.dsh-continue.summary': '输入为空时，用继续按钮接着处理当前对话。',
    'feature.dsh-continue.note': '仅在已有对话且未运行时显示；发送结果不明时等待确认。',
    'feature.dsh-selection-toolbar.title': '选区工具栏',
    'feature.dsh-selection-toolbar.summary': '选中文字后显示当前可用的操作。',
    'feature.dsh-selection-toolbar.note': '仅显示已启用功能的操作入口。',

    'settings.nav': 'Codex 工作台',
    'settings.title': 'Codex 工作台',
    'settings.intro': '设置界面与交互功能。',
    'settings.tabs': '功能设置',
    'settings.restart': '启用或禁用后需要完全退出并重新启动 DSH 才会生效。',
    'settings.enabled': '已启用',
    'settings.disabled': '已停用',
    'settings.state.failed': '启动失败',
    'settings.state.quarantined': '已隔离',
    'settings.state.skipped': '已跳过',
    'settings.failure.message': '原因：{message}',
    'feature.dsh-sidebar-sections.title': '会话列表',
    'feature.dsh-sidebar-sections.summary': '按置顶、项目、最近和归档整理会话。',
    'feature.dsh-sidebar-sections.note': '排序、折叠和移除记录保存在此浏览器。',
    'feature.dsh-left-rail.title': '左侧导航栏',
    'feature.dsh-left-rail.summary': '切换会话、自动化任务、插件及 Work、Code 模式。',
    'feature.dsh-left-rail.note': '侧栏收起后，导航入口仍然可用。',
    'feature.dsh-workbench-pages.title': '管理页面',
    'feature.dsh-workbench-pages.summary': '统一任务、插件和技能的导航与列表布局。',
    'feature.dsh-workbench-pages.note': '技能目录跟随当前聊天；任务与插件保留原生操作。',
    'feature.dsh-nav-back-forward.title': '会话前进与后退',
    'feature.dsh-nav-back-forward.summary': '在本次打开过的会话之间前进和后退。',
    'feature.dsh-nav-back-forward.note': '快捷键：Alt+← / Alt+→。刷新后重新记录。',
    'feature.dsh-git-switch.title': 'Git 分支切换',
    'feature.dsh-git-switch.summary': '查看和搜索当前工作区的本地分支。',
    'feature.dsh-git-switch.note': '切换前检查未提交改动、工作树占用和执行中的会话。',
    'feature.dsh-hover-polish.title': '悬停提示',
    'feature.dsh-instant-ui.title': '即时交互',
    'feature.dsh-instant-ui.summary': '菜单、弹窗和提示即时开合。',
    'feature.dsh-instant-ui.note': '保留键盘焦点提示。',
    'feature.dsh-hover-polish.summary': '统一图标按钮和标签的悬停反馈。',
    'feature.dsh-hover-polish.note': '跟随当前主题和系统的减少动态效果设置。',
    'feature.dsh-tab-middle-click.title': '中键关闭标签',
    'feature.dsh-tab-middle-click.summary': '用鼠标中键关闭面板标签。',
    'feature.dsh-tab-middle-click.note': '仅作用于带关闭按钮的标签。',
    'feature.dsh-long-paste.title': '长文本粘贴',
    'feature.dsh-long-paste.summary': '长文本粘贴自动转为附件，可展开回输入框。',
    'feature.dsh-long-paste.note': '达到 2,000 个字符的粘贴会转为文本附件。',
    'feature.dsh-sidebar-file-drop.title': '拖入文件引用',
    'feature.dsh-sidebar-file-drop.summary': '把文件从文件列表拖入输入框，插入文件引用。',
    'feature.dsh-sidebar-file-drop.note': '文件列表需要提供完整路径。',
    'feature.dsh-file-link-actions.title': '文件操作菜单',
    'feature.dsh-file-link-actions.summary': '右键打开文件、定位文件夹或复制完整路径。',
    'feature.dsh-file-link-actions.note': '打开操作在运行 DSH 的设备上执行。',
    'feature.dsh-composer-history.title': '输入历史',
    'feature.dsh-composer-history.summary': '搜索历史输入，或用 ↑ 取回上一条。',
    'feature.dsh-composer-history.note': '历史保存在此浏览器，最多 500 条，仅包含文本。',
    'feature.dsh-queue-withdraw.title': '排队消息',
    'feature.dsh-queue-withdraw.summary': '撤回、编辑、排序和锁定排队消息。',
    'feature.dsh-queue-withdraw.note': '锁定状态在重启后保留。文件撤回需要此浏览器的附件缓存。',
    'feature.dsh-quick-fork.title': '临时侧聊',
    'feature.dsh-quick-fork.summary': '在侧边面板独立追问选中内容。',
    'feature.dsh-quick-fork.note': '关闭标签时停止并归档临时会话，保留历史消息。',
  }

  const en = {
    'group.navigation': 'Sessions and navigation',
    'group.composer': 'Composer',
    'group.content': 'Content actions',
    'group.panels': 'Side panels',
    'group.interaction': 'Interaction',
    'feature.dsh-selection-quotes.title': 'Selection quotes',
    'feature.dsh-selection-quotes.summary': 'Add selected text as context for the next message.',
    'feature.dsh-selection-quotes.note':
      'Quotes remain in this browser until a successful send; failed sends restore them.',
    'feature.dsh-continue.title': 'Continue conversation',
    'feature.dsh-effort-slider.title': 'Reasoning effort slider',
    'feature.dsh-effort-slider.summary': 'Slide through the current model’s supported reasoning levels.',
    'feature.dsh-effort-slider.note': 'Applies on release, with reset and the native model menu.',
    'feature.dsh-continue.summary': 'Continue the current conversation when the composer is empty.',
    'feature.dsh-continue.note':
      'Shown for idle existing conversations; uncertain sends await confirmation.',
    'feature.dsh-selection-toolbar.title': 'Selection toolbar',
    'feature.dsh-selection-toolbar.summary':
      'Show available actions when conversation text is selected.',
    'feature.dsh-selection-toolbar.note': 'Only actions from enabled capabilities are shown.',

    'settings.nav': 'Codex Workbench',
    'settings.title': 'Codex Workbench',
    'settings.intro': 'Configure the workspace and conversation tools.',
    'settings.tabs': 'Capability settings',
    'settings.restart': 'Enable or disable takes effect after fully quitting and restarting DSH.',
    'settings.enabled': 'Enabled',
    'settings.disabled': 'Disabled',
    'settings.state.failed': 'Failed to start',
    'settings.state.quarantined': 'Quarantined',
    'settings.state.skipped': 'Skipped',
    'settings.failure.message': 'Reason: {message}',
    'feature.dsh-sidebar-sections.title': 'Session list',
    'feature.dsh-sidebar-sections.summary':
      'Organize sessions into pinned, projects, recent and archived sections.',
    'feature.dsh-sidebar-sections.note':
      'Ordering, collapse state and removed-session records stay in this browser.',
    'feature.dsh-left-rail.title': 'Navigation rail',
    'feature.dsh-left-rail.summary':
      'Switch between conversations, automation, plugins and Work or Code mode.',
    'feature.dsh-left-rail.note':
      'Navigation stays available while the session sidebar is collapsed.',
    'feature.dsh-workbench-pages.title': 'Management pages',
    'feature.dsh-workbench-pages.summary': 'Align task, plugin and skill navigation and lists.',
    'feature.dsh-workbench-pages.note': 'Skills follow the current chat. Task and plugin actions stay native.',
    'feature.dsh-nav-back-forward.title': 'Session navigation',
    'feature.dsh-nav-back-forward.summary':
      'Go back and forward through sessions opened in this page.',
    'feature.dsh-nav-back-forward.note':
      'Shortcuts: Alt+Left / Alt+Right. Reloading resets this history.',
    'feature.dsh-git-switch.title': 'Git branches',
    'feature.dsh-git-switch.summary': 'Browse and search local branches in the current workspace.',
    'feature.dsh-git-switch.note':
      'Checks uncommitted changes, worktree occupancy and active sessions before switching.',
    'feature.dsh-hover-polish.title': 'Hover feedback',
    'feature.dsh-instant-ui.title': 'Immediate interactions',
    'feature.dsh-instant-ui.summary': 'Open and close menus, dialogs and hints instantly.',
    'feature.dsh-instant-ui.note': 'Keyboard focus indicators stay visible.',
    'feature.dsh-hover-polish.summary': 'Use consistent hover feedback for icon buttons and tabs.',
    'feature.dsh-hover-polish.note': 'Follows the active theme and reduced-motion preference.',
    'feature.dsh-tab-middle-click.title': 'Middle-click close',
    'feature.dsh-tab-middle-click.summary': 'Close a panel tab with the middle mouse button.',
    'feature.dsh-tab-middle-click.note': 'Only tabs with an existing close control can be closed.',
    'feature.dsh-long-paste.title': 'Long paste',
    'feature.dsh-long-paste.summary':
      'Keep long pasted text as an attachment and expand it into the editor.',
    'feature.dsh-long-paste.note':
      'Plain-text pastes of 2,000 characters or more become text files.',
    'feature.dsh-sidebar-file-drop.title': 'File references',
    'feature.dsh-sidebar-file-drop.summary':
      'Drag a file from the file list into the composer as a reference.',
    'feature.dsh-sidebar-file-drop.note': 'The file list must provide the complete path.',
    'feature.dsh-file-link-actions.title': 'File actions',
    'feature.dsh-file-link-actions.summary':
      'Open, reveal or copy the full path of a file from its context menu.',
    'feature.dsh-file-link-actions.note': 'Open and reveal run on the device hosting DSH.',
    'feature.dsh-composer-history.title': 'Prompt history',
    'feature.dsh-composer-history.summary':
      'Search earlier prompts or recall the previous one with ArrowUp.',
    'feature.dsh-composer-history.note': 'This browser stores up to 500 text-only records.',
    'feature.dsh-queue-withdraw.title': 'Queued messages',
    'feature.dsh-queue-withdraw.summary': 'Withdraw, edit, reorder and hold queued messages.',
    'feature.dsh-queue-withdraw.note':
      'Holds survive a restart. File withdrawal requires this browser to retain the attachment cache.',
    'feature.dsh-quick-fork.title': 'Side chat',
    'feature.dsh-quick-fork.summary': 'Ask about selected content in a separate side conversation.',
    'feature.dsh-quick-fork.note':
      'Closing a tab stops and archives its temporary session while retaining messages.',
  }

  const CSS = [
    '.dshcs-section{display:flex;flex-direction:column;gap:12px;max-width:760px;color:var(--dsw-alias-label-primary);}',
    '.dshcs-heading{margin:0;font-size:18px;font-weight:600;line-height:26px;}',
    '.dshcs-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);}',
    '.dshcs-tabs{display:flex;align-items:flex-end;gap:20px;margin-top:2px;border-bottom:.5px solid var(--dsw-alias-border-l2);overflow-x:auto;}',
    '.dshcs-tab{position:relative;border:0;background:none;padding:7px 1px 9px;font:inherit;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary);cursor:pointer;white-space:nowrap;}',
    '.dshcs-tab:hover,.dshcs-tab[data-active="true"]{color:var(--dsw-alias-label-primary);}',
    '.dshcs-tab[data-active="true"]:after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary);}',
    '.dshcs-tab:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:2px;color:var(--dsw-alias-label-primary);}',
    '.dshcs-panel{display:flex;flex-direction:column;gap:12px;min-width:0;padding-top:2px;}',
    '.dshcs-card{display:flex;flex-direction:column;gap:8px;border:.5px solid var(--dsw-alias-border-l2);border-radius:10px;padding:14px 16px;}',
    '.dshcs-cardHead{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;}',
    '.dshcs-cardText{display:flex;flex-direction:column;gap:4px;min-width:0;}',
    '.dshcs-cardTitle{margin:0;font-size:15px;font-weight:600;line-height:22px;}',
    '.dshcs-cardSummary{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);}',
    '.dshcs-restart{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary);}',
    '.dshcs-switch{display:inline-flex;align-items:center;gap:8px;border:0;background:none;padding:2px;font:inherit;cursor:pointer;color:var(--dsw-alias-label-secondary);flex:none;}',
    '.dshcs-switchLabel{font-size:12px;line-height:18px;white-space:nowrap;}',
    '.dshcs-page{min-width:0;}',
    '.dshcs-note{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);}',
    '.dshcs-tabBadge{display:inline-block;margin-left:5px;padding:0 4px;border-radius:6px;font-size:10px;line-height:15px;font-weight:700;color:var(--dsw-alias-bg-base);background:var(--dsw-alias-state-error-primary);vertical-align:1px;}',
    '.dshcs-alert{display:flex;flex-direction:column;gap:4px;margin-top:4px;padding:10px 12px;border-radius:8px;border:.5px solid var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 8%,transparent);}',
    '.dshcs-alertTitle{font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary);}',
    '.dshcs-alertText{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere;}',
    '.dshcs-alert[data-state="skipped"]{border-color:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));background:transparent;}',
    '.dshcs-alert[data-state="skipped"] .dshcs-alertTitle{color:var(--dsw-alias-label-secondary);}',
  ].join('')

  /**
   * One feature switch.
   * @param {{ t: Function, checked: boolean, onChange: Function }} props - switch props.
   * @returns {object} rendered switch.
   */
  function FeatureSwitch(props) {
    const t = props.t
    const checked = props.checked
    return h(
      'span',
      { className: 'dshcs-switch' },
      h(Switch, {
        checked,
        label: checked ? t('settings.enabled') : t('settings.disabled'),
        onChange: props.onChange,
      }),
      h(
        'span',
        { className: 'dshcs-switchLabel' },
        checked ? t('settings.enabled') : t('settings.disabled'),
      ),
    )
  }

  /**
   * Settings → Codex Style: one tab per merged feature.
   * @param {{ t: Function }} props - slot-provided locale binding.
   * @returns {object} rendered section.
   */
  function CodexStyleSettings({ t }) {
    const tabsId = useId()
    const tabRefs = useRef([])
    const [activeId, setActiveId] = useState(() => GROUPS[0].id)
    const [enabledMap, setEnabledMap] = useState(() => env.readEnabledFeatures())
    const [statuses, setStatuses] = useState(() => env.featureStatuses())
    useEffect(() => env.subscribeStatus(() => setStatuses(env.featureStatuses())), [])
    const persisted = env.persistedFailures()
    const active = GROUPS.find((group) => group.id === activeId) ?? GROUPS[0]
    const focusTab = (index) => {
      const position = (index + GROUPS.length) % GROUPS.length
      setActiveId(GROUPS[position].id)
      tabRefs.current[position]?.focus?.()
    }
    return h(
      'div',
      { className: 'dshcs-section' },
      h('h2', { className: 'dshcs-heading' }, t('settings.title')),
      h('p', { className: 'dshcs-intro' }, t('settings.intro')),
      h(
        'div',
        { className: 'dshcs-tabs', role: 'tablist', 'aria-label': t('settings.tabs') },
        GROUPS.map((group, index) => {
          const selected = group.id === active.id
          const problem = group.features.some(({ id }) => statuses[id] ?? persisted[id])
          return h(
            'button',
            {
              key: group.id,
              ref: (node) => {
                tabRefs.current[index] = node
              },
              type: 'button',
              role: 'tab',
              id: tabsId + '-tab-' + group.id,
              className: 'dshcs-tab',
              'data-active': String(selected),
              'aria-selected': String(selected),
              'aria-controls': tabsId + '-panel-' + group.id,
              tabIndex: selected ? 0 : -1,
              onClick: () => setActiveId(group.id),
              onKeyDown: (event) => {
                if (event.key === 'ArrowRight') focusTab(index + 1)
                else if (event.key === 'ArrowLeft') focusTab(index - 1)
                else if (event.key === 'Home') focusTab(0)
                else if (event.key === 'End') focusTab(GROUPS.length - 1)
                else return
                event.preventDefault?.()
              },
            },
            t('group.' + group.id),
            problem
              ? h(
                  'span',
                  {
                    className: 'dshcs-tabBadge',
                    role: 'status',
                    'aria-label': t('settings.state.failed'),
                  },
                  '!',
                )
              : null,
          )
        }),
      ),
      h('p', { className: 'dshcs-restart' }, t('settings.restart')),
      h(
        'div',
        {
          className: 'dshcs-panel',
          role: 'tabpanel',
          id: tabsId + '-panel-' + active.id,
          'aria-labelledby': tabsId + '-tab-' + active.id,
        },
        active.features.map(({ id }) => {
          const enabled = enabledMap[id] !== false
          const health = statuses[id] ?? persisted[id]
          const page = env.settingsPages().find((entry) => entry.id === id)
          return h(
            'section',
            {
              key: id,
              className: 'dshcs-card',
              'data-feature': id,
              'data-enabled': String(enabled),
            },
            h(
              'div',
              { className: 'dshcs-cardHead' },
              h(
                'div',
                { className: 'dshcs-cardText' },
                h('h3', { className: 'dshcs-cardTitle' }, t(titleKey(id))),
                h('p', { className: 'dshcs-cardSummary' }, t(summaryKey(id))),
              ),
              h(FeatureSwitch, {
                t,
                checked: enabled,
                onChange: (next) => setEnabledMap(env.writeEnabledFeature(id, next)),
              }),
            ),
            health === undefined
              ? null
              : h(
                  'div',
                  { className: 'dshcs-alert', 'data-state': health.state, role: 'status' },
                  h(
                    'strong',
                    { className: 'dshcs-alertTitle' },
                    t(
                      'settings.state.' +
                        (health.state === 'skipped'
                          ? 'skipped'
                          : health.state === 'quarantined'
                            ? 'quarantined'
                            : 'failed'),
                    ),
                  ),
                  h(
                    'p',
                    { className: 'dshcs-alertText' },
                    t('settings.failure.message', { message: health.message ?? '' }),
                  ),
                ),
            enabled && page?.render
              ? h(
                  SettingsPageBoundary,
                  { featureId: id },
                  h('div', { className: 'dshcs-page' }, page.render()),
                )
              : null,
            h('p', { className: 'dshcs-note' }, t(noteKey(id))),
          )
        }),
      ),
    )
  }

  /** Register dictionaries, styles and the settings section. */
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'codex-style: dictionaries')
    const t = ctx.locale.bind(NS)
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function')
        return () => {}
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-codex-style'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => {
        style.remove?.()
      }
    }, 'codex-style: styles')
    ctx.effect(
      () =>
        ctx.slots.inject('settings.section', () => {
          const dispose = ctx.slots.register(
            {
              name: 'settings.section',
              id: 'codex-style',
              order: 70,
              label: () => t('settings.nav'),
              locale: NS,
            },
            CodexStyleSettings,
          )
          return () => dispose?.()
        }),
      'codex-style: settings section',
    )
  }

  return {
    inject: ['slots', 'locale'],
    apply,
  }
})
