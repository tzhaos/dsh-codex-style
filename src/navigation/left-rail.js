/**
 * Codex navigation over DSH's layout service and UI primitives.
 * The selectors below are the only sidebar DOM compatibility seam (0.2.1-rc.2).
 * shell.overlay cannot render another owner's child slots, so the rail uses
 * exported glyphs and delegates settings to its native launcher.
 */
__DSH_FEATURE('dsh-left-rail', function (require, env) {
  const React = require('react')
  const { createPortal } = require('react-dom')
  const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
  const { Menu, Tooltip, IconChevronDownOutlineRegular } = primitives
  const { useEffect, useState } = React
  const h = React.createElement
  const NavigationIcon = env.createNavigationIcon(React, primitives)
  const NS = 'leftRail'
  const SIDEBAR = '.BynINW_sidebarCol'
  const BRAND = SIDEBAR + ' [class$="_logoRow"] button[class*="_brand"]'
  const PANELS = SIDEBAR + ' [class$="_panelList"] button[aria-label]'
  const SETTINGS = SIDEBAR + ' [class$="_settingsArea"] button[aria-haspopup]'
  const zh = {
    'rail.chat': '会话',
    'rail.automation': '自动化任务',
    'rail.plugins': '插件',
    'rail.settings': '设置',
    'rail.display': '工作模式',
    'display.work': 'Work',
    'display.code': 'Code',
    'display.workHint': '创建、学习和探索',
    'display.codeHint': '构建、调试和发布',
    'display.loading': '正在读取展示设置…',
    'display.unavailable': '展示设置暂不可用',
    'display.readonly': '当前展示设置只读',
    'display.failed': '保存失败，请重试',
    'display.saving': '正在保存…',
    'rail.unavailable': '{name}面板未安装',
  }
  const en = {
    'rail.chat': 'Conversations',
    'rail.automation': 'Automation',
    'rail.plugins': 'Plugins',
    'rail.settings': 'Settings',
    'rail.display': 'Work mode',
    'display.work': 'Work',
    'display.code': 'Code',
    'display.workHint': 'Create, learn and explore',
    'display.codeHint': 'Build, debug and ship',
    'display.loading': 'Loading display settings…',
    'display.unavailable': 'Display settings are unavailable',
    'display.readonly': 'Display settings are read-only',
    'display.failed': 'Could not save. Try again',
    'display.saving': 'Saving…',
    'rail.unavailable': '{name} panel is not installed',
  }

  const PROFILES = {
    work: { transcriptView: 'compact', collapseTiming: 'completion' },
    code: { transcriptView: 'detailed', collapseTiming: 'next-input' },
  }

  /** One shared native form, with atomic presets and accepted-value feedback. */
  function createDisplayPreferences(form, defaultMode) {
    const listeners = new Set()
    let saving = false,
      failed = false,
      target = null,
      disposed = false
    const read = () => {
      const snapshot = form?.getSnapshot()
      const value = snapshot?.value
      const saved = value?.transcriptView
      const mode = saved === 'normal' || saved === 'expanded' ? 'detailed' : (saved ?? defaultMode)
      return {
        mode,
        timing: value?.collapseTiming ?? 'completion',
        profile: mode === 'compact' || mode === 'standard' ? 'work' : 'code',
        status: snapshot?.status ?? 'unavailable',
        writable: snapshot?.status === 'ready' && snapshot.writable === true,
        saving,
        failed,
        target,
      }
    }
    const publish = () => {
      if (!disposed) for (const listener of [...listeners]) listener(read())
    }
    const unsubscribe = form?.subscribe(publish)
    return {
      getSnapshot: read,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      async select(id) {
        if (disposed || saving || !read().writable) return false
        if (!Object.hasOwn(PROFILES, id)) return false
        const changes = PROFILES[id]
        const current = read()
        if (
          Object.entries(changes).every(
            ([key, value]) => value === (key === 'transcriptView' ? current.mode : current.timing),
          )
        ) {
          failed = false
          target = null
          publish()
          return true
        }
        saving = true
        failed = false
        target = id
        publish()
        try {
          const accepted = await form.mutate(
            Object.entries(changes).map(([key, value]) => ({ op: 'set', path: [key], value })),
          )
          failed = accepted !== true
          return !failed
        } catch {
          failed = true
          return false
        } finally {
          saving = false
          publish()
        }
      },
      dispose() {
        disposed = true
        unsubscribe?.()
        listeners.clear()
      },
    }
  }

  function DisplayMenu({ brand, adapter, display, t }) {
    const [state, setState] = useState(display.getSnapshot)
    useEffect(() => {
      const off = display.subscribe(setState)
      setState(display.getSnapshot())
      return off
    }, [display])
    const disabled = !state.writable || state.saving
    const copy = (label, description, role) =>
      h(
        'span',
        { className: 'dshlr-menuCopy' },
        h('span', null, label),
        h(
          'span',
          { className: role === 'alert' ? 'dshlr-menuError' : 'dshlr-menuDescription', role },
          description,
        ),
      )
    const notice = state.failed
      ? 'failed'
      : state.status === 'loading'
        ? 'loading'
        : state.status !== 'ready'
          ? 'unavailable'
          : state.saving
            ? 'saving'
            : !state.writable
              ? 'readonly'
              : null
    const items = Object.keys(PROFILES).map((id) => {
      const showNotice =
        notice !== null && id === (state.failed || state.saving ? state.target : state.profile)
      return {
        id,
        label: copy(
          t('display.' + id),
          t('display.' + (showNotice ? notice : id + 'Hint')),
          showNotice ? (state.failed ? 'alert' : 'status') : undefined,
        ),
        disabled,
      }
    })
    const close = () => {
      adapter.close()
      brand.anchor?.focus({ preventScroll: true })
    }
    return h(Menu, {
      open: true,
      portal: true,
      autoFocus: true,
      side: 'bottom',
      align: 'start',
      listClassName: 'dshlr-displayMenu',
      anchor: h('span', { hidden: true }),
      getAnchorRect: () => brand.anchor.getBoundingClientRect(),
      selectedIds: state.status === 'ready' ? [state.profile] : [],
      items,
      onClose: close,
      onSelect: (id) => {
        void display.select(id).then((accepted) => {
          if (accepted) close()
        })
      },
    })
  }

  function createHostAdapter(t) {
    let state = { anchor: null, chevron: null, open: false, launcher: null, launcherIcon: null }
    const listeners = new Set()
    const hidden = new Set()
    let restoreBrand = () => {}
    let restoreLauncher = () => {}
    const publish = (next) => {
      state = next
      for (const listener of listeners) listener(state)
    }
    const close = () => {
      state.anchor?.setAttribute('aria-expanded', 'false')
      if (state.open) publish({ ...state, open: false })
    }
    const reconcile = () => {
      const anchor = document.querySelector(BRAND)
      if (anchor !== state.anchor) {
        restoreBrand()
        restoreBrand = () => {}
        let chevron = null
        if (anchor !== null) {
          const names = ['aria-label', 'aria-haspopup', 'aria-expanded']
          const previous = names.map((name) => anchor.getAttribute(name))
          anchor.setAttribute('aria-label', t('rail.display'))
          anchor.setAttribute('aria-haspopup', 'menu')
          anchor.setAttribute('aria-expanded', 'false')
          anchor.classList.add('dshlr-brand')
          const identity = anchor.querySelector('[class$="_brandIdentity"]') ?? anchor
          chevron = document.createElement('span')
          chevron.className = 'dshlr-brand-chevron'
          chevron.setAttribute('aria-hidden', 'true')
          identity.appendChild(chevron)
          const activate = (event) => {
            event.preventDefault()
            event.stopImmediatePropagation()
            const open = !state.open
            anchor.setAttribute('aria-expanded', String(open))
            publish({ ...state, open })
          }
          const onKey = (event) => {
            if (event.key === 'ArrowDown' && !state.open) activate(event)
          }
          const onPointerDown = (event) => event.stopPropagation()
          anchor.addEventListener('pointerdown', onPointerDown, true)
          anchor.addEventListener('click', activate, true)
          anchor.addEventListener('keydown', onKey, true)
          restoreBrand = () => {
            anchor.removeEventListener('click', activate, true)
            anchor.removeEventListener('keydown', onKey, true)
            anchor.removeEventListener('pointerdown', onPointerDown, true)
            anchor.classList.remove('dshlr-brand')
            chevron.remove()
            names.forEach((name, index) => {
              if (previous[index] === null) anchor.removeAttribute(name)
              else anchor.setAttribute(name, previous[index])
            })
          }
        }
        publish({ ...state, anchor, chevron, open: false })
      }
      for (const button of document.querySelectorAll(PANELS)) {
        if (
          !/^(插件|Plugins|自动化任务|自动化|Automation|Scheduled tasks)$/i.test(
            button.getAttribute('aria-label') ?? '',
          )
        )
          continue
        if (hidden.has(button)) continue
        hidden.add(button)
        button.setAttribute('data-dshlr-hidden', '')
      }
      const launcher = document.querySelector(SETTINGS)
      if (launcher !== state.launcher) {
        restoreLauncher()
        restoreLauncher = () => {}
        let launcherIcon = null
        if (launcher !== null) {
          launcher.classList.add('dshlr-settings-native')
          const launcherAnchor = launcher.parentElement
          launcherAnchor?.classList.add('dshlr-launcher-anchor')
          launcher.setAttribute('data-dshlr-button', 'settings')
          launcherIcon = document.createElement('span')
          launcherIcon.className = 'dshlr-settings-icon'
          launcherIcon.setAttribute('aria-hidden', 'true')
          launcher.appendChild(launcherIcon)
          restoreLauncher = () => {
            launcherIcon.remove()
            launcher.classList.remove('dshlr-settings-native')
            launcherAnchor?.classList.remove('dshlr-launcher-anchor')
            launcher.removeAttribute('data-dshlr-button')
          }
        }
        publish({ ...state, launcher, launcherIcon })
      } else if (launcher !== null && state.launcherIcon.parentElement !== launcher) {
        launcher.appendChild(state.launcherIcon)
      }
    }
    return {
      snapshot: () => state,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      close,
      openSettings: () => document.querySelector(SETTINGS)?.click(),
      install() {
        reconcile()
        const observer = new MutationObserver(reconcile)
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
          restoreBrand()
          restoreLauncher()
          for (const node of hidden) node.removeAttribute('data-dshlr-hidden')
          hidden.clear()
          listeners.clear()
        }
      },
    }
  }

  function RailButton({ name, label, active, disabled, onClick }) {
    return h(
      Tooltip,
      { label, side: 'right', align: 'center', delayMs: 500 },
      h(
        'button',
        {
          type: 'button',
          className: 'dshlr-button' + (active ? ' dshlr-active' : ''),
          'data-dshlr-button': name,
          'aria-label': label,
          'aria-current': active ? 'page' : undefined,
          disabled,
          onClick,
        },
        h(NavigationIcon, { name, active, size: 20 }),
      ),
    )
  }

  function LeftRail({ actions, adapter, display, t }) {
    const [active, setActive] = useState(actions.activePanel)
    const [brand, setBrand] = useState(adapter.snapshot)
    useEffect(() => actions.subscribe(setActive), [actions])
    useEffect(() => {
      setBrand(adapter.snapshot())
      return adapter.subscribe(setBrand)
    }, [adapter])
    return h(
      React.Fragment,
      null,
      h(
        'nav',
        { className: 'dshlr-rail', 'data-dshlr-rail': '', 'aria-label': t('rail.chat') },
        h(RailButton, {
          name: 'chat',
          label: t('rail.chat'),
          active: active === null,
          onClick: actions.openChat,
        }),
        ...[
          ['automation', 'schedules'],
          ['plugins', 'plugins'],
        ].map(([name, id]) =>
          h(RailButton, {
            key: id,
            name,
            active: active === id,
            disabled: !actions.hasPanel(id),
            label: actions.hasPanel(id)
              ? t('rail.' + name)
              : t('rail.unavailable', { name: t('rail.' + name) }),
            onClick: () => actions.openPanel(id),
          }),
        ),
        h('span', { className: 'dshlr-spacer' }),
      ),
      brand.chevron === null
        ? null
        : createPortal(h(IconChevronDownOutlineRegular, { size: 14 }), brand.chevron),
      brand.launcherIcon === null
        ? null
        : createPortal(
            h(
              React.Fragment,
              null,
              h(NavigationIcon, { name: 'settings', active: false }),
              h(NavigationIcon, { name: 'settings', active: true }),
            ),
            brand.launcherIcon,
          ),
      brand.open && brand.anchor !== null ? h(DisplayMenu, { brand, adapter, display, t }) : null,
    )
  }

  const CSS = `
html[data-dshlr-active] { --dsh-left-rail-width: 52px; }
html[data-dshlr-active] #root { margin-left: var(--dsh-left-rail-width); width: calc(100% - var(--dsh-left-rail-width)); }
[data-dshlr-hidden] { display: none !important; }
.dshlr-rail {
  position: fixed; inset: var(--dsh-frame-chrome-top, 0px) auto 0 0; z-index: 25;
  width: var(--dshlr-rail-span, var(--dsh-left-rail-width)); box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 8px 8px 12px; background: var(--dsw-specific-sidebar-fill);
  color: var(--dsw-alias-label-secondary); -webkit-app-region: no-drag;
}
.dshlr-button, .dshlr-settings-native {
  box-sizing: border-box; width: 36px; height: 36px; flex: none;
  display: grid; place-items: center; padding: 0; border: 0; border-radius: 10px;
  background: transparent; color: inherit; font: inherit; cursor: pointer;
}
.dshlr-button > svg { display: block; flex: none; }
.dshlr-button:hover:not(:disabled), .dshlr-button.dshlr-active { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshlr-button:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.dshlr-button:disabled { opacity: .35; cursor: default; }
.dshlr-settings-native {
  position: fixed; left: calc((var(--dshlr-rail-span, var(--dsh-left-rail-width)) - 36px) / 2); bottom: 12px; z-index: 26;
  width: 36px; height: 36px; min-height: 0; max-width: none; margin: 0;
  color: var(--dsw-alias-label-secondary); -webkit-app-region: no-drag;
}
.dshlr-launcher-anchor { position: fixed; left: calc((var(--dshlr-rail-span, var(--dsh-left-rail-width)) - 36px) / 2); bottom: 12px; width: 36px; height: 36px; z-index: 26; }
.dshlr-settings-native > :not(.dshlr-settings-icon) { display: none; }
.dshlr-settings-icon { display: flex; align-items: center; justify-content: center; pointer-events: none; }
.dshlr-settings-icon [data-active="true"] { display: none; }
.dshlr-settings-native[aria-expanded="true"] .dshlr-settings-icon [data-active="false"] { display: none; }
.dshlr-settings-native[aria-expanded="true"] .dshlr-settings-icon [data-active="true"] { display: block; }
.dshlr-settings-native[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshlr-settings-native:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshlr-settings-native:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.dshlr-spacer { flex: 1; min-height: 16px; }
html[data-dshlr-active] .BynINW_sidebarCol [class$="_logoRow"]:has(.dshlr-brand) {
  height: 52px; min-height: 52px; padding-block: 8px; align-items: center;
}
html[data-dshlr-active] .BynINW_sidebarCol [class$="_logoRow"] .dshlr-brand {
  box-sizing: border-box; height: 36px; min-height: 36px; padding: 6px 8px;
  align-items: center; justify-content: center; border-radius: 8px; font-family: inherit;
}
html[data-dshlr-active] .BynINW_sidebarCol .dshlr-brand [class$="_brandIdentity"] { transform: none; }
.dshlr-brand:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshlr-displayMenu { width: 280px; max-width: calc(100vw - 24px); }
.dshlr-menuCopy { display: flex; flex-direction: column; gap: 2px; min-width: 0; white-space: normal; }
.dshlr-menuDescription { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; white-space: normal; }
.dshlr-menuError { color: var(--dsw-alias-state-error-primary); white-space: normal; }
.dshlr-brand-chevron { display: inline-flex; align-items: center; justify-content: center; flex: none; margin-left: 6px; color: var(--dsw-alias-label-secondary); pointer-events: none; }
/* Keep the native new-chat row on the same text axis as project rows. */
html[data-dshlr-active] .BynINW_sidebarCol [class*="_root"]:not([class*="_collapsed"]) [class$="_newSession"] {
  justify-content: flex-start; border: 0; background: transparent; border-radius: 8px;
  margin: 4px 0 16px; padding: 6px 8px; height: 36px; font: inherit; font-size: 14px; font-weight: 400;
}
html[data-dshlr-active] .BynINW_sidebarCol [class$="_newSession"]:hover { background: var(--dsw-alias-interactive-bg-hover); }
html[data-dshlr-active] .BynINW_sidebarCol [class$="_newSessionContent"] { justify-content: flex-start; width: auto; gap: 8px; }
html[data-dshlr-active] .BynINW_sidebarCol [class$="_panelList"]:not(:has(button:not([data-dshlr-hidden]))) { display: none; }
html[data-dshlr-active] .BynINW_sidebarCol [class*="_collapsed"] [class$="_footArea"] { display: flex; }
html[data-dshlr-active] [data-sidebar-collapsed] .BynINW_sidebarCol [class$="_newSession"] { display: none; }
@media (max-height: 400px) { .dshlr-rail { gap: 4px; padding-bottom: 6px; } }
`

  function apply(ctx) {
    const layout = ctx.get('layout')
    if (layout?.panelInfo === undefined) return
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'left-rail: dictionaries')
    const adapter = createHostAdapter(ctx.locale.bind(NS))
    const display = createDisplayPreferences(
      ctx.get('configForms').get('ui-chat'),
      'dshDesktop' in globalThis ? 'standard' : 'detailed',
    )
    ctx.effect(() => () => display.dispose(), 'left-rail: display preferences')
    ctx.effect(() => {
      const root = document.documentElement
      const previous = root.getAttribute('data-dshlr-active')
      root.setAttribute('data-dshlr-active', '')
      const style = document.createElement('style')
      style.dataset.dshPlugin = 'dsh-left-rail'
      style.textContent = env.presentationCSS + env.navigationIconsCSS + CSS
      document.head.appendChild(style)
      const dispose = adapter.install()
      return () => {
        dispose()
        style.remove()
        if (previous === null) root.removeAttribute('data-dshlr-active')
        else root.setAttribute('data-dshlr-active', previous)
      }
    }, 'left-rail: host adapter')
    const actions = {
      activePanel: () => layout.panelInfo.getSnapshot().activePanelId ?? null,
      subscribe(listener) {
        return layout.panelInfo.subscribe(() => listener(actions.activePanel()))
      },
      hasPanel: (id) => layout.hasMainPanel(id),
      openChat: () => layout.selectPanel(null),
      openPanel: (id) => {
        if (layout.hasMainPanel(id)) layout.selectPanel(id)
      },
    }
    ctx.effect(
      () =>
        ctx.slots.inject('shell.overlay', () =>
          ctx.slots.register(
            {
              name: 'shell.overlay',
              id: 'left-rail.overlay',
              locale: NS,
              inject: () => ({ actions, adapter, display }),
            },
            LeftRail,
          ),
        ),
      'left-rail: overlay',
    )
  }
  return {
    inject: ['slots', 'locale', 'layout', 'configForms'],
    apply,
    __test: { createDisplayPreferences },
  }
})
