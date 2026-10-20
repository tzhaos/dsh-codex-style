/**
 * Settings shell — Settings → Codex Style, one tab per merged feature.
 *
 * The section owns the tab row and the shared enable switch; every feature tab
 * either renders the page that feature registered through
 * `env.registerSettingsPage(...)` (sidebar sections, prompt history) or a
 * generated page that explains the feature, shows its enable switch and lists
 * the data/limitation note. Enable preferences are browser-local and take
 * effect on the next full DSH restart, because features install their client
 * patches once at boot.
 */

__DSH_FEATURE(SETTINGS_FEATURE_ID, function (require, env) {
  const React = require('react')
  const { useId, useRef, useState } = React
  const h = React.createElement

  /** Locale namespace owned by the merged plugin shell. */
  const NS = 'codexStyle'

  /** Feature ids in bundle order; mirrors scripts/build-client.mjs. */
  const FEATURES = [
    'dsh-sidebar-sections',
    'dsh-left-rail',
    'dsh-nav-back-forward',
    'dsh-hover-polish',
    'dsh-tab-middle-click',
    'dsh-long-paste',
    'dsh-sidebar-file-drop',
    'dsh-file-link-actions',
    'dsh-composer-history',
    'dsh-queue-withdraw',
    'dsh-quick-fork',
  ]

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
    'settings.nav': 'Codex 风格',
    'settings.title': 'Codex 风格插件',
    'settings.intro': '11 个子插件合并成一个 bundle，每个子插件占一个 tab：可以单独启用/禁用，并在各自的页面里管理它自己的设置。禁用和设置在完全退出并重新启动 DSH 后生效。',
    'settings.tabs': '子插件设置页',
    'settings.restart': '启用或禁用后需要完全退出并重新启动 DSH 才会生效。',
    'settings.enabled': '已启用',
    'settings.disabled': '已停用',
    'settings.noOptions': '这个子插件没有额外可配置项，使用上方开关控制它是否加载。',
    'settings.disabledHint': '该子插件当前已停用；重新启用并重启 DSH 后生效。',
    'settings.dataHint': '数据与限制',
    'feature.dsh-sidebar-sections.title': '侧边栏分区',
    'feature.dsh-sidebar-sections.summary': '把侧边栏分成置顶 / 项目 / 最近 / 归档四个分区，支持拖拽排序、行菜单与安全删除。',
    'feature.dsh-sidebar-sections.note': '排序、折叠与安全删除记录保存在浏览器 localStorage；已删除会话的恢复在下方设置里。',
    'feature.dsh-left-rail.title': '左侧图标栏',
    'feature.dsh-left-rail.summary': '最左侧 Codex 风格 46px 图标栏：会话、插件、自动化任务、设置与品牌菜单。',
    'feature.dsh-left-rail.note': '自动化任务图标依赖宿主注册 schedules 主面板；设置按钮依赖宿主按钮的 aria-label 文案。',
    'feature.dsh-nav-back-forward.title': '会话前进 / 后退',
    'feature.dsh-nav-back-forward.summary': '在 Windows 标题栏、侧边栏开关右侧提供会话前进/后退按钮，并支持 Alt+← / Alt+→。',
    'feature.dsh-nav-back-forward.note': '只记录主视图的 Session 切换，不含右侧标签页与滚动位置；刷新后从当前会话重新开始。',
    'feature.dsh-hover-polish.title': 'Hover 与 Tooltip',
    'feature.dsh-hover-polish.summary': '统一按钮 / 标签的 hover 反馈，并给图标按钮加 Codex 风格 Tooltip。',
    'feature.dsh-hover-polish.note': '只处理带 title / aria-label 的按钮；菜单项、下拉选项与 data-dshhp-skip 控件跳过；自定义气泡延迟 650ms。',
    'feature.dsh-tab-middle-click.title': '标签中键关闭',
    'feature.dsh-tab-middle-click.summary': '在侧边栏或停靠标签上按鼠标中键，复用标签自带的关闭控件关闭。',
    'feature.dsh-tab-middle-click.note': '依赖 DockKit 标签 DOM 契约；没有关闭控件的标签不处理，也不新增快捷键。',
    'feature.dsh-long-paste.title': '长文本粘贴',
    'feature.dsh-long-paste.summary': '超长纯文本粘贴时自动变成 .txt 附件，并可从附件卡片展开回输入框。',
    'feature.dsh-long-paste.note': '阈值固定 2000 字符；模型收到的是文件附件而不是内联文本。',
    'feature.dsh-sidebar-file-drop.title': '侧栏文件拖入',
    'feature.dsh-sidebar-file-drop.summary': '从侧边栏文件列表把文件拖进输入框，生成文件引用 chip；Desktop 上桥接宿主文件路径。',
    'feature.dsh-sidebar-file-drop.note': '文件行需要提供绝对路径（title / aria-label / data-path）；生成的是引用，不是上传副本。',
    'feature.dsh-file-link-actions.title': '文件链接右键',
    'feature.dsh-file-link-actions.summary': '对话里的本地文件链接右键可默认应用打开、在文件管理器中定位、复制绝对路径。',
    'feature.dsh-file-link-actions.note': '只处理本地文件链接；没有可用工作区路径时无法定位；左键预览与宿主数据不变。',
    'feature.dsh-composer-history.title': '输入历史',
    'feature.dsh-composer-history.summary': '给输入框补上可搜索的历史输入面板：↑ 取回上一条，Ctrl/Cmd+↑ 打开搜索面板。',
    'feature.dsh-composer-history.note': '只记录文本，不含附件；记录保存在浏览器 localStorage，上限 500 条，清空或删除只影响本地记录。',
    'feature.dsh-queue-withdraw.title': '排队消息',
    'feature.dsh-queue-withdraw.summary': '排队消息可撤回输入栏、原生行内编辑、整行拖动排序，也可以锁定不发。',
    'feature.dsh-queue-withdraw.note': '锁定依赖宿主侧 inbox.claim 补丁；只覆盖插件加载后选择的文件缓存；切换会话会恢复草稿附件。',
    'feature.dsh-quick-fork.title': '划选复创',
    'feature.dsh-quick-fork.summary': '划选对话文字后点「复创」，在右侧栏开一个临时侧边对话。',
    'feature.dsh-quick-fork.note': '侧聊是空白子会话的精简面板，不是主对话的完整复刻；关闭标签后从视图消失。',
  }

  const en = {
    'settings.nav': 'Codex Style',
    'settings.title': 'Codex Style plugin',
    'settings.intro': 'Eleven plugins ship as one bundle. Each sub-plugin has its own tab: enable or disable it and manage its settings there. Toggles and settings take effect after a full DSH restart.',
    'settings.tabs': 'Sub-plugin settings pages',
    'settings.restart': 'Enable or disable takes effect after fully quitting and restarting DSH.',
    'settings.enabled': 'Enabled',
    'settings.disabled': 'Disabled',
    'settings.noOptions': 'This sub-plugin has no extra options; use the switch above to control whether it loads.',
    'settings.disabledHint': 'This sub-plugin is disabled; re-enable it and restart DSH to apply.',
    'settings.dataHint': 'Data and limitations',
    'feature.dsh-sidebar-sections.title': 'Sidebar sections',
    'feature.dsh-sidebar-sections.summary': 'Pinned / Projects / Recent / Archived sidebar sections with drag ordering, row menus and safe delete.',
    'feature.dsh-sidebar-sections.note': 'Ordering, collapse and safe-delete records live in browser localStorage; restoring removed conversations is in the settings below.',
    'feature.dsh-left-rail.title': 'Left icon rail',
    'feature.dsh-left-rail.summary': 'A 46px Codex-style icon rail: conversations, plugins, automation, settings and the brand menu.',
    'feature.dsh-left-rail.note': 'The automation icon depends on the host registering a schedules panel; the settings button depends on the host aria-label text.',
    'feature.dsh-nav-back-forward.title': 'Session back / forward',
    'feature.dsh-nav-back-forward.summary': 'Back/forward controls in the Windows caption row next to the sidebar toggle, plus Alt+Left / Alt+Right.',
    'feature.dsh-nav-back-forward.note': 'Tracks main-view Session switches only; right-sidebar tabs and scroll positions are not included, and history restarts after a refresh.',
    'feature.dsh-hover-polish.title': 'Hover and tooltips',
    'feature.dsh-hover-polish.summary': 'One hover surface for buttons and tabs, and Codex-style tooltips for icon buttons.',
    'feature.dsh-hover-polish.note': 'Only buttons with title / aria-label; menu items, dropdown options and data-dshhp-skip controls are skipped; custom bubbles wait 650ms.',
    'feature.dsh-tab-middle-click.title': 'Tab middle-click',
    'feature.dsh-tab-middle-click.summary': 'Middle-click a sidebar or dock tab to close it through the tab\'s own close control.',
    'feature.dsh-tab-middle-click.note': 'Depends on the DockKit tab DOM contract; tabs without a close control are left alone and no shortcut is added.',
    'feature.dsh-long-paste.title': 'Long paste',
    'feature.dsh-long-paste.summary': 'Very long plain-text pastes become a .txt attachment that can be expanded back into the composer.',
    'feature.dsh-long-paste.note': 'The threshold is fixed at 2000 characters; the model receives a file attachment rather than inline text.',
    'feature.dsh-sidebar-file-drop.title': 'Sidebar file drop',
    'feature.dsh-sidebar-file-drop.summary': 'Drag a sidebar file into the composer as a file-reference chip; on Desktop the host file-path bridge is used.',
    'feature.dsh-sidebar-file-drop.note': 'The row must expose an absolute path (title / aria-label / data-path); the result is a reference, not an uploaded copy.',
    'feature.dsh-file-link-actions.title': 'File-link actions',
    'feature.dsh-file-link-actions.summary': 'Right-click a local file link to open it, reveal it in the file manager, or copy its absolute path.',
    'feature.dsh-file-link-actions.note': 'Local file links only; no workspace path means no reveal; left-click preview and host data stay unchanged.',
    'feature.dsh-composer-history.title': 'Prompt history',
    'feature.dsh-composer-history.summary': 'Searchable prompt-history panel plus arrow-up recall for the composer.',
    'feature.dsh-composer-history.note': 'Text only, no attachments; records stay in browser localStorage capped at 500; clearing or deleting only touches local records.',
    'feature.dsh-queue-withdraw.title': 'Queued messages',
    'feature.dsh-queue-withdraw.summary': 'Withdraw queued messages back to the composer, edit in place, drag reorder, or lock a message so it is not sent.',
    'feature.dsh-queue-withdraw.note': 'Locking relies on a host-side inbox.claim patch; only files selected after the plugin loaded are cached; switching conversations restores draft attachments.',
    'feature.dsh-quick-fork.title': 'Selection fork',
    'feature.dsh-quick-fork.summary': 'Select text in a conversation, click Fork, and open a temporary side conversation in the right sidebar.',
    'feature.dsh-quick-fork.note': 'The side chat is a compact panel over a blank child session, not a full replica of the main conversation; closing the tab removes it from view.',
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
    '.dshcs-switchTrack{display:inline-flex;align-items:center;width:36px;height:20px;border-radius:10px;padding:2px;background:var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));transition:background .15s ease;}',
    '.dshcs-switchOn .dshcs-switchTrack{background:var(--dsw-alias-state-business-primary);}',
    '.dshcs-switchKnob{width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease;}',
    '.dshcs-switchOn .dshcs-switchKnob{transform:translateX(16px);}',
    '.dshcs-switchLabel{font-size:12px;line-height:18px;white-space:nowrap;}',
    '.dshcs-page{min-width:0;}',
    '.dshcs-generic{margin:0;}',
    '.dshcs-genericText{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);}',
    '.dshcs-notes{border-style:dashed;}',
    '.dshcs-notesTitle{margin:0;font-size:12px;font-weight:600;line-height:18px;color:var(--dsw-alias-label-tertiary);text-transform:uppercase;letter-spacing:.04em;}',
    '.dshcs-note{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary);}',
  ].join('')

  /**
   * One feature switch.
   * @param {{ t: Function, checked: boolean, onChange: Function }} props - switch props.
   * @returns {object} rendered switch.
   */
  function FeatureSwitch(props) {
    const t = props.t
    const checked = props.checked
    return h('button', {
      type: 'button',
      role: 'switch',
      'aria-checked': checked ? 'true' : 'false',
      className: 'dshcs-switch' + (checked ? ' dshcs-switchOn' : ''),
      onClick: () => props.onChange(!checked),
    },
    h('span', { className: 'dshcs-switchTrack' }, h('span', { className: 'dshcs-switchKnob' })),
    h('span', { className: 'dshcs-switchLabel' }, checked ? t('settings.enabled') : t('settings.disabled')))
  }

  /**
   * Settings → Codex Style: one tab per merged feature.
   * @param {{ t: Function }} props - slot-provided locale binding.
   * @returns {object} rendered section.
   */
  function CodexStyleSettings(props) {
    const t = props.t
    const tabsId = useId()
    const tabRefs = useRef([])
    const [activeId, setActiveId] = useState(() => FEATURES[0])
    const [enabledMap, setEnabledMap] = useState(() => env.readEnabledFeatures())

    const rows = FEATURES.map((id) => ({
      id,
      label: t(titleKey(id)),
    }))
    const active = rows.find((row) => row.id === activeId)?.id ?? rows[0]?.id
    const enabled = enabledMap[active] !== false
    const page = env.settingsPages().find((entry) => entry.id === active)

    /** @param {number} index - tab index to move to. */
    function focusTab(index) {
      const row = rows[(index + rows.length) % rows.length]
      setActiveId(row.id)
      tabRefs.current[(index + rows.length) % rows.length]?.focus?.()
    }

    const tabList = h('div', {
      className: 'dshcs-tabs',
      role: 'tablist',
      'aria-label': t('settings.tabs'),
    }, rows.map((row, index) => {
      const selected = row.id === active
      return h('button', {
        key: row.id,
        ref: (element) => { tabRefs.current[index] = element },
        id: tabsId + '-tab-' + row.id,
        type: 'button',
        role: 'tab',
        className: 'dshcs-tab',
        'aria-selected': selected ? 'true' : 'false',
        'aria-controls': tabsId + '-panel-' + row.id,
        'data-active': selected ? 'true' : 'false',
        tabIndex: selected ? 0 : -1,
        onClick: () => setActiveId(row.id),
        onKeyDown: (event) => {
          switch (event.key) {
            case 'ArrowRight': focusTab(index + 1); break
            case 'ArrowLeft': focusTab(index - 1); break
            case 'Home': focusTab(0); break
            case 'End': focusTab(rows.length - 1); break
            default: return
          }
          event.preventDefault?.()
        },
      }, row.label)
    }))

    const pageBody = page !== undefined && typeof page.render === 'function'
      ? h('div', { className: 'dshcs-page' }, page.render())
      : h('section', { className: 'dshcs-card dshcs-generic' },
        h('p', { className: 'dshcs-genericText' }, enabled ? t('settings.noOptions') : t('settings.disabledHint')))

    return h('div', { className: 'dshcs-section' },
      h('h2', { className: 'dshcs-heading' }, t('settings.title')),
      h('p', { className: 'dshcs-intro' }, t('settings.intro')),
      tabList,
      h('div', {
        className: 'dshcs-panel',
        role: 'tabpanel',
        id: tabsId + '-panel-' + active,
        'aria-labelledby': tabsId + '-tab-' + active,
      },
      h('section', { className: 'dshcs-card', 'data-enabled': enabled ? 'true' : 'false' },
        h('div', { className: 'dshcs-cardHead' },
          h('div', { className: 'dshcs-cardText' },
            h('h3', { className: 'dshcs-cardTitle' }, t(titleKey(active))),
            h('p', { className: 'dshcs-cardSummary' }, t(summaryKey(active))),
          ),
          h(FeatureSwitch, {
            t,
            checked: enabled,
            onChange: (next) => setEnabledMap(env.writeEnabledFeature(active, next)),
          }),
        ),
        h('p', { className: 'dshcs-restart' }, t('settings.restart')),
      ),
      pageBody,
      h('section', { className: 'dshcs-card dshcs-notes' },
        h('h4', { className: 'dshcs-notesTitle' }, t('settings.dataHint')),
        h('p', { className: 'dshcs-note' }, t(noteKey(active))),
      )))
  }

  /** Register dictionaries, styles and the settings section. */
  function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'codex-style: dictionaries')
    const t = ctx.locale.bind(NS)
    ctx.effect(() => {
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return () => {}
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-codex-style'
      style.textContent = CSS
      document.head.appendChild(style)
      return () => { style.remove?.() }
    }, 'codex-style: styles')
    ctx.effect(() => ctx.slots.inject('settings.section', () => {
      const dispose = ctx.slots.register({
        name: 'settings.section',
        id: 'codex-style',
        order: 70,
        label: () => t('settings.nav'),
        locale: NS,
      }, CodexStyleSettings)
      return () => dispose?.()
    }), 'codex-style: settings section')
  }

  return {
    inject: ['slots', 'locale'],
    apply,
  }
})
