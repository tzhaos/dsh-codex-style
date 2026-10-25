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
  const { Menu, Tooltip, Modal, Button, IconChevronDownOutlineRegular } = primitives
  const { useEffect, useState } = React
  const h = React.createElement
  const NavigationIcon = env.createNavigationIcon(React, primitives)
  const NS = 'leftRail'
  const SIDEBAR = '[class$="_sidebarCol"]'
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
    'account.menu': '账号菜单',
    'account.signedIn': '已登录 DeepSeek',
    'account.loading': '正在加载账号…',
    'account.balance': '充值余额',
    'account.bonus': '赠送余额',
    'account.viewUsage': '查询用量',
    'account.help': '帮助',
    'account.contact': '意见反馈',
    'account.signOut': '退出登录',
    'account.signOutTitle': '退出登录',
    'account.signOutConfirm': '退出登录后，此账号将停止在本机使用。确定退出？',
    'account.signOutRunning': '当前仍有使用此账号运行的任务。退出登录会中断这些任务，是否继续？',
    'account.signOutUnknown': '暂时无法确认任务状态。退出登录可能会中断使用此账号的任务，是否继续？',
    'account.cancel': '取消',
    'account.confirm': '退出登录',
    'account.settingsShortcut': 'Ctrl+,',
    'update.available': '发现新版本 {version}，点击下载并安装',
    'update.downloading': '正在下载更新 {percent}%…',
    'update.ready': '新版本 {version} 已就绪，点击安装并重启',
    'update.installing': '正在准备安装更新…',
    'update.failed': '更新出现错误，点击重试',
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
    'account.menu': 'Account menu',
    'account.signedIn': 'Signed in to DeepSeek',
    'account.loading': 'Loading account…',
    'account.balance': 'Topped-up balance',
    'account.bonus': 'Bonus balance',
    'account.viewUsage': 'View usage',
    'account.help': 'Help',
    'account.contact': 'Send feedback',
    'account.signOut': 'Sign out',
    'account.signOutTitle': 'Sign out',
    'account.signOutConfirm': 'Signing out stops this account from working on this machine. Sign out anyway?',
    'account.signOutRunning': 'Tasks using this account are still running. Signing out stops them. Continue?',
    'account.signOutUnknown': 'Task status is unavailable. Signing out may stop tasks that use this account. Continue?',
    'account.cancel': 'Cancel',
    'account.confirm': 'Sign out',
    'account.settingsShortcut': 'Ctrl+,',
    'update.available': 'Version {version} available — click to download and install',
    'update.downloading': 'Downloading update {percent}%…',
    'update.ready': 'Version {version} is ready — click to install and restart',
    'update.installing': 'Preparing to install the update…',
    'update.failed': 'The update failed — click to retry',
  }

  const PROFILES = {
    work: { transcriptView: 'compact', collapseTiming: 'completion' },
    code: { transcriptView: 'detailed', collapseTiming: 'next-input' },
  }

  /** Platform wallet text with the same rounding the account settings page uses. */
  function formatWallet(amount, currency) {
    const symbol = currency === 'USD' ? '$' : '¥'
    const value = Number.parseFloat(String(amount ?? ''))
    if (!Number.isFinite(value)) return symbol + String(amount ?? '0')
    const addCommas = (text) => {
      const [integer, fraction] = text.split('.')
      return Number(integer).toLocaleString('en-US') + (fraction === undefined ? '' : '.' + fraction)
    }
    const rounded = (magnitude) => addCommas((Math.floor(magnitude * 100 + 1e-9) / 100).toFixed(2))
    if (value === 0) return symbol + '0.00'
    if (value < 0) return '-' + symbol + (Math.abs(value) < 0.01 ? '0.01' : rounded(Math.abs(value)))
    if (value < 0.01) return '<' + symbol + '0.01'
    return symbol + rounded(value)
  }

  /** Join every non-empty wallet into one compact balance line. */
  function walletSummary(wallets) {
    if (!Array.isArray(wallets)) return ''
    return wallets
      .filter((wallet) => wallet !== null && typeof wallet === 'object' && typeof wallet.balance === 'string')
      .map((wallet) => formatWallet(wallet.balance, wallet.currency))
      .join(' · ')
  }

  /** Two-character avatar fallback drawn from the profile name. */
  function accountInitials(name) {
    const words = String(name ?? '').trim().split(/[\s._-]+/).filter(Boolean)
    if (words.length === 0) return 'DS'
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
    return (words[0][0] + words[1][0]).toUpperCase()
  }

  /** Map the Desktop update presentation onto the rail install button. */
  function updateView(snapshot, t) {
    const phase = snapshot?.phase
    if (phase === 'available') {
      return { visible: true, kind: 'download', label: t('update.available', { version: snapshot.version ?? '' }) }
    }
    if (phase === 'downloading' || phase === 'verifying') {
      return { visible: true, kind: 'progress', label: t('update.downloading', { percent: snapshot.percent ?? 0 }) }
    }
    if (phase === 'ready') {
      return { visible: true, kind: 'install', label: t('update.ready', { version: snapshot.version ?? '' }) }
    }
    if (phase === 'installing') return { visible: true, kind: 'installing', label: t('update.installing') }
    if (phase === 'error') return { visible: true, kind: 'error', label: t('update.failed') }
    return { visible: false }
  }

  /** Read the active browser identity the account Remote methods carry. */
  function accountClientMeta(ctx) {
    const version = globalThis.__DSH_BOOT__?.release?.version
    return {
      version: typeof version === 'string' && version !== '' ? version : '0.2.1-rc.2',
      locale: ctx.locale.getSnapshot().active,
      timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
    }
  }

  /**
   * DeepSeek account state, profile and wallet balance for the rail menu.
   * Failures stay local: signed-out and unavailable states simply keep the
   * native settings launcher.
   */
  function createAccountController(ctx) {
    const listeners = new Set()
    let snapshot = { phase: 'loading', signedIn: false, profile: null, balance: null, links: null }
    let disposed = false
    const publish = (patch) => {
      if (disposed) return
      snapshot = { ...snapshot, ...patch }
      for (const listener of [...listeners]) listener(snapshot)
    }
    const remoteAccount = () => {
      try {
        return ctx.remote?.account
      } catch {
        return undefined
      }
    }
    const refresh = async () => {
      const api = remoteAccount()
      if (api === undefined) {
        publish({ phase: 'unavailable', signedIn: false })
        return snapshot
      }
      try {
        const state = await api.getState()
        if (state?.ok !== true) throw new Error('account state unavailable')
        const signedIn = state.value?.status === 'credential-stored'
        publish({ phase: signedIn ? 'ready' : 'signed-out', signedIn, links: state.value?.links ?? null })
        if (!signedIn) {
          publish({ profile: null, balance: null })
          return snapshot
        }
        const client = accountClientMeta(ctx)
        const [profile, balance] = await Promise.allSettled([api.getProfile(client), api.getBalance(client)])
        publish({
          profile:
            profile.status === 'fulfilled' && profile.value?.ok === true && profile.value.value?.status === 'ready'
              ? profile.value.value.value
              : null,
          balance:
            balance.status === 'fulfilled' && balance.value?.ok === true && balance.value.value?.status === 'ready'
              ? balance.value.value
              : null,
        })
      } catch {
        publish({ phase: 'unavailable', signedIn: false })
      }
      return snapshot
    }
    const hasRunningTasks = async () => {
      const api = remoteAccount()
      if (api === undefined) return 'unknown'
      try {
        const result = await api.hasRunningAccountTasks()
        if (result?.ok === true) return result.value === true
      } catch {
        /* the confirmation can still warn conservatively */
      }
      return 'unknown'
    }
    const signOut = async () => {
      const api = remoteAccount()
      if (api === undefined) throw new Error('account unavailable')
      const result = await api.signOut(accountClientMeta(ctx))
      if (result?.ok !== true) throw new Error('sign out failed')
      publish({ phase: 'signed-out', signedIn: false, profile: null, balance: null })
    }
    const refreshSoon = () => {
      void refresh()
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') refreshSoon()
    }
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      refresh,
      hasRunningTasks,
      signOut,
      start() {
        refreshSoon()
        globalThis.addEventListener?.('focus', refreshSoon)
        document.addEventListener('visibilitychange', onVisibility)
        return () => {
          globalThis.removeEventListener?.('focus', refreshSoon)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      },
      dispose() {
        disposed = true
        listeners.clear()
      },
    }
  }

  /** Desktop updater state for the rail install button. */
  function createUpdateController() {
    const api = globalThis.dshDesktop?.updates
    if (api === undefined || api === null) return null
    const listeners = new Set()
    let snapshot = { phase: 'idle' }
    let disposeSubscription = null
    const publish = (next) => {
      if (next === null || typeof next !== 'object') return
      snapshot = { ...snapshot, ...next }
      for (const listener of [...listeners]) listener(snapshot)
    }
    return {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      start() {
        void api.status?.().then(publish, () => {})
        try {
          disposeSubscription = api.subscribe?.(publish) ?? null
        } catch {
          disposeSubscription = null
        }
      },
      dispose() {
        listeners.clear()
        try {
          disposeSubscription?.()
        } catch {
          /* already closed */
        }
        disposeSubscription = null
      },
      open() {
        try {
          void api.open?.()
        } catch {
          /* the native updater owns failure reporting */
        }
      },
    }
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
      /**
       * Open DSH settings even when the native launcher is the account menu.
       * The launcher click opens that menu; its first item is Settings. The
       * temporary busy attribute keeps the intermediate menu out of sight.
       */
      openSettings: () => {
        const launcher = document.querySelector(SETTINGS)
        if (launcher === null) return
        const body = document.body
        const finish = () => body.removeAttribute('data-dshlr-menu-busy')
        body.setAttribute('data-dshlr-menu-busy', '')
        launcher.click()
        const frame = globalThis.requestAnimationFrame ?? ((callback) => callback())
        frame(() => {
          const menu = document.querySelector('[role="menu"]')
          const item = menu === null ? null : menu.querySelector('[role="menuitem"]')
          item?.click?.()
          if (typeof globalThis.setTimeout === 'function') globalThis.setTimeout(finish, 50)
          else finish()
        })
      },
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

  /** @param {Element} row @returns {boolean} whether this native panel row is current. */
  function rowIsActive(row) {
    return [...(row.classList ?? [])].some((name) => name.endsWith('_panelActive'))
      || row.getAttribute?.('aria-current') === 'page'
  }

  /**
   * Read native sidebar panel rows. Known panels keep the layout-driven rail
   * buttons; any new panel row becomes an extra rail button and is hidden from
   * the sidebar. The `更多` marketplace anchor stays native.
   * @returns {{known: object, extras: object[]}} cloned icons and extra rows.
   */
  function useNativeNavRows() {
    const [state, setState] = useState({ known: {}, extras: [] })
    useEffect(() => {
      if (typeof document === 'undefined') return undefined
      let disposed = false
      const scan = () => {
        if (disposed || typeof document.querySelectorAll !== 'function') return
        const known = {}
        const extras = []
        for (const row of document.querySelectorAll(PANELS)) {
          const label = row.getAttribute?.('aria-label') ?? ''
          if (label === '') continue
          if (/^(更多|More)$/i.test(label)) continue
          const markup = row.querySelector?.('svg')?.outerHTML ?? ''
          if (/^(插件|Plugins|自动化任务|自动化|Automation|Scheduled tasks)$/i.test(label)) {
            known[label] = markup
            continue
          }
          if (row.hasAttribute?.('data-dshlr-hidden') !== true) row.setAttribute?.('data-dshlr-hidden', '')
          extras.push({ row, label, markup })
        }
        setState((current) => {
          if (current.extras.length === extras.length
            && current.extras.every((entry, index) => entry.row === extras[index].row
              && entry.label === extras[index].label
              && entry.markup === extras[index].markup)
            && Object.keys(current.known).length === Object.keys(known).length
            && Object.keys(known).every((key) => current.known[key] === known[key])) return current
          return { known, extras }
        })
      }
      scan()
      const observer = typeof MutationObserver === 'function' ? new MutationObserver(scan) : null
      observer?.observe?.(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] })
      const timer = typeof setInterval === 'function' ? setInterval(scan, 1000) : null
      return () => {
        disposed = true
        observer?.disconnect?.()
        if (timer !== null) clearInterval(timer)
      }
    }, [])
    return state
  }

  /** One rail button for a newly discovered native panel row. */
  function NativePanelButton({ row, label, markup }) {
    const [active, setActive] = useState(rowIsActive(row))
    useEffect(() => {
      const update = () => setActive(rowIsActive(row))
      update()
      const observer = typeof MutationObserver === 'function'
        ? new MutationObserver(update)
        : null
      observer?.observe?.(row, { attributes: true, attributeFilter: ['class', 'aria-current'] })
      return () => observer?.disconnect?.()
    }, [row])
    return h(RailButton, {
      name: 'panel',
      label,
      active,
      iconMarkup: markup,
      onClick: () => row.click?.(),
    })
  }

  function RailButton({ name, label, active, disabled, onClick, iconMarkup }) {
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
        iconMarkup !== undefined && iconMarkup !== ''
          ? h('span', {
              className: 'dshlr-glyph',
              'aria-hidden': 'true',
              dangerouslySetInnerHTML: { __html: iconMarkup },
            })
          : h(NavigationIcon, { name, active, size: 20 }),
      ),
    )
  }

  /** Inline 16-unit glyphs; the rail draws its own stroke so no icon module is needed. */
  function RailGlyph({ kind }) {
    const svg = (children, strokeWidth = 1) =>
      h(
        'svg',
        {
          width: 16,
          height: 16,
          viewBox: '0 0 16 16',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          strokeWidth,
        },
        children,
      )
    if (kind === 'settings') {
      return svg([
        h('path', {
          key: 'a',
          d: 'M8 9.75012C8.9665 9.75012 9.75 8.96662 9.75 8.00012C9.75 7.03362 8.9665 6.25012 8 6.25012C7.0335 6.25012 6.25 7.03362 6.25 8.00012C6.25 8.96662 7.0335 9.75012 8 9.75012Z',
          stroke: 'currentColor',
        }),
        h('path', {
          key: 'b',
          d: 'M13.0107 7.79377C12.9505 7.89401 12.9205 7.94413 12.9205 7.99951C12.9205 8.0549 12.9505 8.10502 13.0106 8.20528L13.9849 9.83006C14.045 9.93029 14.0751 9.9804 14.0751 10.0358C14.0751 10.0911 14.045 10.1413 13.9849 10.2415L13.0037 11.8777C12.9468 11.9726 12.9184 12.0201 12.8725 12.0461C12.8267 12.072 12.7713 12.072 12.6607 12.072H10.6704C10.5598 12.072 10.5045 12.072 10.4586 12.098C10.4128 12.1239 10.3843 12.1714 10.3274 12.2662L9.33825 13.9142C9.28133 14.009 9.25287 14.0564 9.20703 14.0823C9.16118 14.1083 9.10588 14.1083 8.99529 14.1083H7.00486C6.89426 14.1083 6.83896 14.1083 6.79312 14.0823C6.74727 14.0564 6.71881 14.009 6.6619 13.9142L5.67273 12.2662C5.61581 12.1714 5.58735 12.1239 5.54151 12.098C5.49566 12.072 5.44036 12.072 5.32977 12.072H3.33945C3.2288 12.072 3.17347 12.072 3.12761 12.0461C3.08176 12.0201 3.0533 11.9726 2.9964 11.8777L2.0152 10.2415C1.9551 10.1413 1.92505 10.0913 1.92505 10.0358C1.92505 9.9804 1.9551 9.93029 2.0152 9.83006L2.98951 8.20528C3.04963 8.10502 3.07969 8.0549 3.07969 7.99951C3.07968 7.94413 3.04961 7.89401 2.98946 7.79377L2.01529 6.17011C1.95514 6.06987 1.92507 6.01975 1.92507 5.96437C1.92506 5.90899 1.95512 5.85886 2.01524 5.7586L2.9964 4.1224C3.0533 4.0275 3.08176 3.98005 3.12761 3.95408C3.17347 3.92811 3.2288 3.92811 3.33945 3.92811H5.32977C5.44036 3.92811 5.49566 3.92811 5.54151 3.90216C5.58735 3.87621 5.61581 3.82879 5.67273 3.73397L6.6619 2.08599C6.71881 1.99116 6.74727 1.94375 6.79312 1.9178C6.83896 1.89185 6.89426 1.89185 7.00486 1.89185H8.99529C9.10588 1.89185 9.16118 1.89185 9.20703 1.9178C9.25287 1.94375 9.28133 1.99116 9.33825 2.08599L10.3274 3.73397C10.3843 3.82879 10.4128 3.87621 10.4586 3.90216C10.5045 3.92811 10.5598 3.92811 10.6704 3.92811H12.6607C12.7713 3.92811 12.8267 3.92811 12.8725 3.95408C12.9184 3.98005 12.9468 4.0275 13.0037 4.1224L13.9849 5.7586C14.045 5.85886 14.0751 5.90899 14.0751 5.96437C14.0751 6.01975 14.045 6.06987 13.9849 6.17011L13.0107 7.79377Z',
          stroke: 'currentColor',
        }),
      ])
    }
    if (kind === 'usage') {
      return svg([
        h('path', { key: 'a', d: 'M2.5 12.5V9.5', stroke: 'currentColor' }),
        h('path', { key: 'b', d: 'M6.5 12.5V6.5', stroke: 'currentColor' }),
        h('path', { key: 'c', d: 'M10.5 12.5V4.5', stroke: 'currentColor' }),
        h('path', { key: 'd', d: 'M13.5 12.5V2.5', stroke: 'currentColor' }),
      ])
    }
    if (kind === 'bonus') {
      return svg([
        h('path', { key: 'a', d: 'M2.5 5.5H13.5V8H2.5Z', stroke: 'currentColor' }),
        h('path', { key: 'b', d: 'M3.5 8V13.5H12.5V8', stroke: 'currentColor' }),
        h('path', { key: 'c', d: 'M8 5.5V13.5', stroke: 'currentColor' }),
        h('path', { key: 'd', d: 'M8 5.5C8 5.5 9.5 2.5 11 2.5C12 2.5 12.5 3.5 12 4.5C11.5 5.5 9 5.5 8 5.5Z', stroke: 'currentColor' }),
        h('path', { key: 'e', d: 'M8 5.5C8 5.5 6.5 2.5 5 2.5C4 2.5 3.5 3.5 4 4.5C4.5 5.5 7 5.5 8 5.5Z', stroke: 'currentColor' }),
      ])
    }
    if (kind === 'help') {
      return svg([
        h('path', {
          key: 'a',
          d: 'M4.74024 9.11029L1.82882 7.79865C1.75022 7.76323 1.75026 7.65161 1.82889 7.61626L12.9665 2.60943C13.0354 2.57846 13.1125 2.63213 13.1073 2.70749L12.3914 13.1388C12.3864 13.2117 12.3073 13.2548 12.2433 13.2194L6.12677 9.83657',
          stroke: 'currentColor',
        }),
        h('path', {
          key: 'b',
          d: 'M8.44336 11.0825L6.2832 13.2843C6.22048 13.3482 6.11182 13.3038 6.11182 13.2143V9.86772C6.11182 9.84165 6.122 9.8166 6.1402 9.79793L12.972 2.78748',
          stroke: 'currentColor',
        }),
      ])
    }
    if (kind === 'signout') {
      return svg([
        h('path', { key: 'a', d: 'M9.5 2.5H12.5C13.0523 2.5 13.5 2.94772 13.5 3.5V12.5C13.5 13.0523 13.0523 13.5 12.5 13.5H9.5', stroke: 'currentColor' }),
        h('path', { key: 'b', d: 'M2.5 8H9.5', stroke: 'currentColor' }),
        h('path', { key: 'c', d: 'M6.75 5.25L9.5 8L6.75 10.75', stroke: 'currentColor' }),
      ])
    }
    if (kind === 'user') {
      return svg(
        [
          h('path', { key: 'a', d: 'M8 8.25C9.51878 8.25 10.75 7.01878 10.75 5.5C10.75 3.98122 9.51878 2.75 8 2.75C6.48122 2.75 5.25 3.98122 5.25 5.5C5.25 7.01878 6.48122 8.25 8 8.25Z', stroke: 'currentColor' }),
          h('path', { key: 'b', d: 'M2.5 14.5C2.5 11.5 5.25 10.25 8 10.25C10.75 10.25 13.5 11.5 13.5 14.5', stroke: 'currentColor' }),
        ],
        1.3,
      )
    }
    if (kind === 'warning') {
      return svg([
        h('path', { key: 'a', d: 'M8 5.25V9', stroke: 'currentColor' }),
        h('path', { key: 'b', d: 'M8 11.25V11.5', stroke: 'currentColor' }),
        h('path', { key: 'c', d: 'M8 2.25L14 13.25H2L8 2.25Z', stroke: 'currentColor' }),
      ])
    }
    return svg([
      h('path', { key: 'a', d: 'M8 2.5V9.25', stroke: 'currentColor' }),
      h('path', { key: 'b', d: 'M4.75 6.25L8 9.5L11.25 6.25', stroke: 'currentColor' }),
      h('path', { key: 'c', d: 'M2.5 11.25V12.5C2.5 13.0523 2.94772 13.5 3.5 13.5H12.5C13.0523 13.5 13.5 13.0523 13.5 12.5V11.25', stroke: 'currentColor' }),
    ])
  }

  /** Profile picture with an initials fallback, mirroring the account settings avatar. */
  function AccountAvatar({ avatarUrl, name, initials }) {
    return h(
      'span',
      { className: 'dshlr-accountAvatar', 'aria-hidden': 'true' },
      typeof avatarUrl === 'string' && avatarUrl !== ''
        ? h('img', {
            className: 'dshlr-accountImage',
            src: avatarUrl,
            alt: '',
            referrerPolicy: 'no-referrer',
          })
        : h('span', { className: 'dshlr-accountInitials' }, initials),
    )
  }

  /** Codex-style account launcher: avatar trigger plus a native DSH account menu. */
  function AccountLauncher({ account, adapter, t }) {
    const [snapshot, setSnapshot] = useState(account.getSnapshot)
    const [open, setOpen] = useState(false)
    const [confirm, setConfirm] = useState(null)
    const [busy, setBusy] = useState(false)
    const [failed, setFailed] = useState(false)
    useEffect(() => {
      setSnapshot(account.getSnapshot())
      return account.subscribe(setSnapshot)
    }, [account])
    if (snapshot.signedIn !== true) return null
    const profile = snapshot.profile
    const name = typeof profile?.name === 'string' && profile.name !== '' ? profile.name : t('account.signedIn')
    const contact = typeof profile?.contact === 'string' ? profile.contact : ''
    const avatarUrl = typeof profile?.avatarUrl === 'string' ? profile.avatarUrl : ''
    const balance = walletSummary(snapshot.balance?.value)
    const bonus = walletSummary(
      Array.isArray(snapshot.balance?.bonusWallets)
        ? snapshot.balance.bonusWallets.filter((wallet) => Number.parseFloat(wallet?.balance ?? '0') !== 0)
        : [],
    )
    const usageUrl = snapshot.links?.usageUrl ?? ''
    const contactUrl = globalThis.__DSH_CONTACT_CONFIG__?.contactFormUrl ?? ''
    const openExternal = (url) => {
      if (typeof url !== 'string' || url === '') return
      try {
        globalThis.open?.(url, '_blank', 'noopener,noreferrer')
      } catch {
        /* the native shell owns external navigation failures */
      }
    }
    const run = (task) => {
      setBusy(true)
      setFailed(false)
      Promise.resolve()
        .then(task)
        .catch(() => setFailed(true))
        .finally(() => setBusy(false))
    }
    const desktop = globalThis.dshDesktop !== undefined
    const valueRow = (label, value) =>
      h(
        'span',
        { className: 'dshlr-accountValueRow' },
        h('span', { className: 'dshlr-accountValueLabel' }, label),
        h('span', { className: 'dshlr-accountValue' }, value),
      )
    const items = [
      { type: 'label', id: 'account-identity', text: contact === '' ? name : name + ' · ' + contact },
      balance === ''
        ? null
        : {
            id: 'usage',
            label: valueRow(t('account.balance'), balance),
            icon: h(RailGlyph, { kind: 'usage' }),
            disabled: usageUrl === '',
          },
      bonus === ''
        ? null
        : {
            id: 'bonus',
            label: valueRow(t('account.bonus'), bonus),
            icon: h(RailGlyph, { kind: 'bonus' }),
            disabled: true,
          },
      { type: 'separator', id: 'account-sep-actions' },
      {
        id: 'settings',
        label: t('rail.settings'),
        icon: h(RailGlyph, { kind: 'settings' }),
        shortcut: { keys: desktop ? ['Ctrl', '+', ','] : ['Ctrl', '+', 'Alt', '+', ','], aria: desktop ? 'Control+,' : 'Control+Alt+,' },
      },
      { id: 'contact', label: t('account.help'), icon: h(RailGlyph, { kind: 'help' }) },
      { type: 'separator', id: 'account-sep-signout' },
      { id: 'signout', label: t('account.signOut'), icon: h(RailGlyph, { kind: 'signout' }), disabled: busy },
    ].filter(Boolean)
    const signOutMessage =
      confirm === null
        ? ''
        : confirm.running === true
          ? t('account.signOutRunning')
          : confirm.running === 'unknown'
            ? t('account.signOutUnknown')
            : t('account.signOutConfirm')
    return h(
      React.Fragment,
      null,
      h(
        Tooltip,
        { label: t('account.menu'), side: 'right', align: 'center', delayMs: 500 },
        h(
          'button',
          {
            type: 'button',
            className: 'dshlr-accountTrigger',
            'data-dshlr-button': 'account',
            'aria-label': t('account.menu'),
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            onClick: () => {
              setOpen(!open)
              setFailed(false)
              if (!open) void account.refresh()
            },
          },
          h(AccountAvatar, { avatarUrl, name, initials: accountInitials(profile?.name) }),
        ),
      ),
      open
        ? h(Menu, {
            open: true,
            side: 'top',
            align: 'start',
            portal: true,
            autoFocus: true,
            listClassName: 'dshlr-accountMenuNative',
            anchor: h('span', { hidden: true }),
            getAnchorRect: () => document.querySelector('.dshlr-accountTrigger')?.getBoundingClientRect(),
            items,
            onClose: () => setOpen(false),
            onSelect: (id) => {
              if (id === 'usage') {
                setOpen(false)
                openExternal(usageUrl)
              } else if (id === 'settings') {
                setOpen(false)
                adapter.openSettings()
              } else if (id === 'contact') {
                setOpen(false)
                openExternal(contactUrl)
              } else if (id === 'signout') {
                setOpen(false)
                run(async () => {
                  setConfirm({ running: await account.hasRunningTasks() })
                })
              }
            },
          })
        : null,
      confirm === null
        ? null
        : h(
            Modal,
            { open: true, headless: true, title: t('account.signOutTitle'), onClose: () => setConfirm(null) },
            h(
              'div',
              { className: 'dshlr-accountConfirm' },
              h('h2', { className: 'dshlr-accountConfirmTitle' }, t('account.signOutTitle')),
              h('p', { className: 'dshlr-accountConfirmText' }, signOutMessage),
              failed ? h('p', { className: 'dshlr-accountError', role: 'alert' }, t('update.failed')) : null,
              h(
                'div',
                { className: 'dshlr-accountConfirmActions' },
                h(Button, { variant: 'outline', disabled: busy, onClick: () => setConfirm(null) }, t('account.cancel')),
                h(
                  Button,
                  {
                    variant: 'primary',
                    disabled: busy,
                    onClick: () =>
                      run(async () => {
                        await account.signOut()
                        setConfirm(null)
                      }),
                  },
                  t('account.confirm'),
                ),
              ),
            ),
          ),
    )
  }

  /** Blue install circle above the avatar, following the Desktop updater state. */
  function UpdateButton({ updates, t }) {
    const [snapshot, setSnapshot] = useState(updates === null ? { phase: 'idle' } : updates.getSnapshot)
    useEffect(() => {
      if (updates === null) return undefined
      setSnapshot(updates.getSnapshot())
      return updates.subscribe(setSnapshot)
    }, [updates])
    if (updates === null) return null
    const view = updateView(snapshot, t)
    if (view.visible !== true) return null
    return h(
      Tooltip,
      { label: view.label, side: 'right', align: 'center', delayMs: 300 },
      h(
        'button',
        {
          type: 'button',
          className: 'dshlr-updateButton',
          'data-dshlr-button': 'update',
          'data-kind': view.kind,
          'aria-label': view.label,
          onClick: () => updates.open(),
        },
        view.kind === 'progress'
          ? h('span', { className: 'dshlr-updatePercent' }, (snapshot.percent ?? 0) + '%')
          : h(RailGlyph, { kind: view.kind === 'error' ? 'warning' : 'download' }),
      ),
    )
  }

  function LeftRail({ actions, adapter, display, account, updates, t }) {
    const [active, setActive] = useState(actions.activePanel)
    const navRows = useNativeNavRows()
    const [brand, setBrand] = useState(adapter.snapshot)
    const [accountState, setAccountState] = useState(
      account === null || account === undefined ? { signedIn: false } : account.getSnapshot,
    )
    useEffect(() => actions.subscribe(setActive), [actions])
    useEffect(() => {
      setBrand(adapter.snapshot())
      return adapter.subscribe(setBrand)
    }, [adapter])
    useEffect(() => {
      if (account === null || account === undefined) return undefined
      setAccountState(account.getSnapshot())
      return account.subscribe(setAccountState)
    }, [account])
    useEffect(() => {
      const root = document.documentElement
      if (accountState.signedIn === true) root.setAttribute('data-dshlr-account', 'signed-in')
      else root.removeAttribute('data-dshlr-account')
      return () => root.removeAttribute('data-dshlr-account')
    }, [accountState.signedIn])
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
            iconMarkup: name === 'plugins'
              ? (navRows.known['插件'] ?? navRows.known.Plugins ?? '')
              : (navRows.known['自动化任务'] ?? navRows.known.Automation ?? navRows.known['自动化'] ?? ''),
          }),
        ),
        ...navRows.extras.map((entry) => h(NativePanelButton, { key: entry.label, ...entry })),
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
      h(UpdateButton, { updates, t }),
      h(AccountLauncher, { account, adapter, t }),
      brand.open && brand.anchor !== null ? h(DisplayMenu, { brand, adapter, display, t }) : null,
    )
  }

  const CSS = `
html[data-dshlr-active] { --dsh-left-rail-width: 52px; }
html[data-dshlr-active][data-windows-titlebar] { --dsh-left-rail-width: 44px; }
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
.dshlr-glyph { display: inline-flex; align-items: center; justify-content: center; }
  .dshlr-glyph svg { width: 18px; height: 18px; display: block; }
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
html[data-dshlr-active] [class$="_sidebarCol"] [class$="_logoRow"]:has(.dshlr-brand) {
  height: 52px; min-height: 52px; padding-block: 8px; align-items: center;
}
html[data-dshlr-active] [class$="_sidebarCol"] [class$="_logoRow"] .dshlr-brand {
  box-sizing: border-box; height: 36px; min-height: 36px; padding: 6px 8px;
  align-items: center; justify-content: center; border-radius: 8px; font-family: inherit;
}
html[data-dshlr-active] [class$="_sidebarCol"] .dshlr-brand [class$="_brandIdentity"] { transform: none; }
.dshlr-brand:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshlr-displayMenu { width: 280px; max-width: calc(100vw - 24px); }
.dshlr-menuCopy { display: flex; flex-direction: column; gap: 2px; min-width: 0; white-space: normal; }
.dshlr-menuDescription { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; white-space: normal; }
.dshlr-menuError { color: var(--dsw-alias-state-error-primary); white-space: normal; }
.dshlr-brand-chevron { display: inline-flex; align-items: center; justify-content: center; flex: none; margin-left: 6px; color: var(--dsw-alias-label-secondary); pointer-events: none; }
/* Keep the native new-chat row on the same text axis as project rows. */
html[data-dshlr-active] [class$="_sidebarCol"] [class$="_newSession"] {
  justify-content: flex-start; border: 0; background: transparent; border-radius: 8px;
  margin: 4px 0 16px; padding: 6px 8px; height: 36px; font: inherit; font-size: 14px; font-weight: 400;
}
html[data-dshlr-active] [class$="_sidebarCol"] [class$="_newSession"]:hover { background: var(--dsw-alias-interactive-bg-hover); }
html[data-dshlr-active] [class$="_sidebarCol"] [class$="_newSessionContent"] { justify-content: flex-start; width: auto; gap: 8px; }
html[data-dshlr-active] [class$="_sidebarCol"] [class$="_panelList"]:not(:has(button:not([data-dshlr-hidden]))) { display: none; }
html[data-dshlr-active] [class$="_sidebarCol"] [class*="_collapsed"] [class$="_footArea"] { display: flex; }
html[data-dshlr-active] [data-sidebar-collapsed] [class$="_sidebarCol"] [class$="_newSession"] { display: none; }
/* Codex-style account launcher. While DeepSeek is signed in the rail paints its
   own avatar trigger and a native DSH Menu (the same primitive as every other
   shell menu), and hides the native settings launcher. */
html[data-dshlr-account="signed-in"] .dshlr-launcher-anchor { display: none !important; }
body[data-dshlr-menu-busy] [role="menu"] { visibility: hidden !important; }
.dshlr-accountTrigger {
  position: fixed; left: calc((var(--dshlr-rail-span, var(--dsh-left-rail-width)) - 36px) / 2); bottom: 12px; z-index: 27;
  box-sizing: border-box; width: 36px; height: 36px; display: grid; place-items: center; padding: 0;
  border: 0; border-radius: 50%; background: transparent; color: var(--dsw-alias-label-secondary);
  font: inherit; cursor: pointer; -webkit-app-region: no-drag;
}
.dshlr-accountTrigger:hover, .dshlr-accountTrigger[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshlr-accountTrigger:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: -2px; }
.dshlr-accountAvatar {
  box-sizing: border-box; width: 26px; height: 26px; flex: none; display: grid; place-items: center;
  overflow: hidden; border-radius: 50%; background: var(--dsw-alias-state-business-primary); color: #fff;
}
.dshlr-accountImage { width: 100%; height: 100%; object-fit: cover; display: block; }
.dshlr-accountInitials { font-size: 10px; font-weight: 600; line-height: 1; letter-spacing: .02em; }
.dshlr-accountMenuNative { width: 264px; max-width: calc(100vw - 16px); }
.dshlr-accountValueRow { display: flex; align-items: center; justify-content: space-between; gap: 24px; width: 100%; min-width: 190px; }
.dshlr-accountValueLabel { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.dshlr-accountValue { color: var(--dsw-alias-label-secondary); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.dshlr-accountConfirm { box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; padding: 20px 24px 16px; min-width: 320px; max-width: 420px; }
.dshlr-accountConfirmTitle { margin: 0; font-size: 16px; font-weight: 600; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dshlr-accountConfirmText { margin: 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-secondary); white-space: normal; }
.dshlr-accountError { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary); white-space: normal; }
.dshlr-accountConfirmActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
.dshlr-updateButton {
  position: fixed; left: calc((var(--dshlr-rail-span, var(--dsh-left-rail-width)) - 28px) / 2); bottom: 56px; z-index: 27;
  box-sizing: border-box; width: 28px; height: 28px; display: grid; place-items: center; padding: 0;
  border: 0; border-radius: 50%; background: var(--dsw-alias-state-business-primary); color: #fff;
  cursor: pointer; -webkit-app-region: no-drag;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--dsw-alias-state-business-primary) 32%, transparent);
}
.dshlr-updateButton:hover { filter: brightness(1.08); }
.dshlr-updateButton:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }
.dshlr-updateButton[data-kind="progress"], .dshlr-updateButton[data-kind="installing"] { cursor: default; }
.dshlr-updatePercent { font-size: 9px; font-weight: 600; line-height: 1; letter-spacing: -.02em; }
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
    const account = createAccountController(ctx)
    const updates = createUpdateController()
    ctx.effect(() => {
      const stop = account.start()
      return () => {
        stop()
        account.dispose()
      }
    }, 'left-rail: account identity')
    ctx.effect(() => {
      updates?.start()
      return () => updates?.dispose()
    }, 'left-rail: desktop updates')
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
    // The window material tints with the Windows accent palette published by
    // the Host half. The Host watches the shell's registry keys natively and
    // pushes each change over this event stream, so switching an accent color
    // repaints the material without waiting for a poll; a slow GET poll stays
    // behind a closed stream only as the fallback. A missing shell or route
    // keeps the neutral theme surface.
    ctx.effect(() => {
      const request = globalThis.fetch
      if (typeof request !== 'function') return
      const root = document.documentElement
      let active = true
      let streamController = null
      let streamActive = false
      let reconnectTimer = null
      let pollTimer = null
      let reconnectDelay = 500
      const publish = (payload) => {
        if (active !== true || payload === null || typeof payload !== 'object' || payload.ok !== true) return
        if (typeof payload.accent === 'string') root.style.setProperty('--dshlr-system-accent', payload.accent)
        if (typeof payload.accentLight === 'string') {
          root.style.setProperty('--dshlr-system-accent-on-dark', payload.accentLight)
        }
      }
      const readOnce = () => {
        if (active !== true) return
        request('/dsh-codex-style/system-colors', { credentials: 'same-origin', cache: 'no-store' })
          .then((response) => (response.ok === true ? response.json() : null))
          .then(publish)
          .catch(() => {})
      }
      const startPolling = () => {
        if (active !== true || pollTimer !== null) return
        pollTimer = globalThis.setInterval?.(readOnce, 3_000) ?? null
      }
      const stopPolling = () => {
        if (pollTimer === null) return
        globalThis.clearInterval?.(pollTimer)
        pollTimer = null
      }
      const handleFrame = (frame) => {
        for (const line of frame.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed.startsWith('data:')) continue
          try {
            publish(JSON.parse(trimmed.slice(5).trim()))
          } catch {
            /* a malformed frame is ignored; the stream keeps running */
          }
        }
      }
      const scheduleReconnect = () => {
        if (active !== true || reconnectTimer !== null) return
        const delay = reconnectDelay
        reconnectDelay = Math.min(reconnectDelay * 2, 8_000)
        reconnectTimer = globalThis.setTimeout?.(() => {
          reconnectTimer = null
          openStream()
        }, delay)
      }
      const openStream = () => {
        if (active !== true) return
        const controller = typeof globalThis.AbortController === 'function' ? new globalThis.AbortController() : null
        streamController = controller
        request('/dsh-codex-style/system-colors/events', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'text/event-stream' },
          ...(controller === null ? {} : { signal: controller.signal }),
        })
          .then(async (response) => {
            if (response.ok !== true || response.body === null || typeof response.body.getReader !== 'function') {
              throw new Error('event stream unavailable')
            }
            reconnectDelay = 500
            streamActive = true
            stopPolling()
            const reader = response.body.getReader()
            const decoder = new globalThis.TextDecoder()
            let buffer = ''
            for (;;) {
              const { value, done } = await reader.read()
              if (done) break
              buffer += decoder.decode(value, { stream: true })
              let boundary = buffer.indexOf('\n\n')
              while (boundary !== -1) {
                handleFrame(buffer.slice(0, boundary))
                buffer = buffer.slice(boundary + 2)
                boundary = buffer.indexOf('\n\n')
              }
            }
            throw new Error('event stream closed')
          })
          .catch(() => {})
          .then(() => {
            streamActive = false
            if (active !== true) return
            startPolling()
            scheduleReconnect()
          })
      }
      const onFocus = () => readOnce()
      const onVisibility = () => {
        if (document.visibilityState === 'hidden') return
        readOnce()
        if (streamActive !== true) {
          stopPolling()
          scheduleReconnect()
        }
      }
      readOnce()
      openStream()
      globalThis.addEventListener?.('focus', onFocus)
      document.addEventListener('visibilitychange', onVisibility)
      return () => {
        active = false
        if (reconnectTimer !== null) globalThis.clearTimeout?.(reconnectTimer)
        stopPolling()
        try {
          streamController?.abort()
        } catch {
          /* already closed */
        }
        globalThis.removeEventListener?.('focus', onFocus)
        document.removeEventListener('visibilitychange', onVisibility)
        root.style.removeProperty('--dshlr-system-accent')
        root.style.removeProperty('--dshlr-system-accent-on-dark')
      }
    }, 'left-rail: system color material')
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
              inject: () => ({ actions, adapter, display, account, updates }),
            },
            LeftRail,
          ),
        ),
      'left-rail: overlay',
    )
  }
  return {
    inject: ['slots', 'locale', 'layout', 'configForms', 'remote', 'remote.account'],
    apply,
    __test: {
      createDisplayPreferences,
      formatWallet,
      walletSummary,
      accountInitials,
      updateView,
      createAccountController,
    },
  }
})
