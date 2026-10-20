/**
 * dsh-left-rail 1.9.4 — merged feature of dsh-codex-style.
 *
 * Source: dsh-plugins/6cebd96 packages/dsh-left-rail/client.js (verbatim body).
 * The factory wrapper is provided by scripts/build-client.mjs; the body still
 * returns { inject, apply } and is only built when the feature is enabled.
 */
__DSH_FEATURE('dsh-left-rail', function (require, env) {
    const React = require('react')
    const { useEffect, useRef, useState } = React
    const h = React.createElement

    const NS = 'leftRail'

    const zh = {
      'rail.chat': '会话',
      'rail.automation': '自动化任务',
      'rail.plugins': '插件',
      'rail.settings': '设置',
      'rail.toggle': '展开／收起左侧栏',
      'rail.account': '本地账号',
      'rail.feedback': '意见反馈',
      'rail.logout': '退出登录',
      'rail.menu': '设置菜单',
      'rail.unavailable': '{name}面板未安装',
    }

    const en = {
      'rail.chat': 'Conversations',
      'rail.automation': 'Automation',
      'rail.plugins': 'Plugins',
      'rail.settings': 'Settings',
      'rail.toggle': 'Toggle left sidebar',
      'rail.account': 'Local account',
      'rail.feedback': 'Feedback',
      'rail.logout': 'Log out',
      'rail.menu': 'Settings menu',
      'rail.unavailable': '{name} panel is not installed',
    }

    const ICONS = {
      chat: ['M2.5 7.2 8 2.8l5.5 4.4V13a1 1 0 0 1-1 1H9.5v-3.4h-3V14H3.5a1 1 0 0 1-1-1Z'],
      automation: ['M8 3.2a4.8 4.8 0 1 1-3.4 1.4', 'M3 4v3h3', 'M8 5.5V8l1.8 1.1'],
      plugins: ['M6 3.5h4v2.2a1.3 1.3 0 1 0 0 2.6v2.2H3.5v-2.2a1.3 1.3 0 1 0 0-2.6V3.5Z', 'M12.5 8.5v4h-2.2a1.3 1.3 0 1 0-2.6 0H3.5v-4'],
      settings: ['M8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z', 'M8 2.7v1.2M8 12.1v1.2M2.7 8h1.2M12.1 8h1.2M4.25 4.25l.85.85M10.9 10.9l.85.85M11.75 4.25l-.85.85M5.1 10.9l-.85.85'],
    }

    /** Solid active glyphs: the same objects as the outline rail icons. */
    const FILLED_ICONS = {
      chat: [{ d: 'M2.2 7.1 8 2.4l5.8 4.7V13a1.2 1.2 0 0 1-1.2 1.2H9.6v-3.4H6.4v3.4H3.4A1.2 1.2 0 0 1 2.2 13Z' }],
      plugins: [
        { d: 'M8 8C6.6 5.7 7.2 2.8 9.4 1.5c1.8 2 2 5 .7 6.5Z' },
        { d: 'M8 8C6.6 5.7 7.2 2.8 9.4 1.5c1.8 2 2 5 .7 6.5Z', transform: 'rotate(90 8 8)' },
        { d: 'M8 8C6.6 5.7 7.2 2.8 9.4 1.5c1.8 2 2 5 .7 6.5Z', transform: 'rotate(180 8 8)' },
        { d: 'M8 8C6.6 5.7 7.2 2.8 9.4 1.5c1.8 2 2 5 .7 6.5Z', transform: 'rotate(270 8 8)' },
      ],
      automation: [{ d: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm-.6 3h1.2v3.2l2.3 1.3-.6 1.1-2.9-1.7Z', fillRule: 'evenodd' }],
      settings: [{ d: 'M6.7 1.8h2.6l.3 1.6c.4.2.8.4 1.1.7l1.5-.6 1.3 2.3-1.2 1.1c.1.4.1.9 0 1.3l1.2 1.1-1.3 2.3-1.5-.6c-.3.3-.7.5-1.1.7l-.3 1.6H6.7l-.3-1.6a4.8 4.8 0 0 1-1.1-.7l-1.5.6-1.3-2.3 1.2-1.1a5 5 0 0 1 0-1.3L2.5 5.8l1.3-2.3 1.5.6c.3-.3.7-.5 1.1-.7Zm1.3 4.1a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z', fillRule: 'evenodd' }],
    }

    /** Solid active icon; inactive items keep the host outline glyph. */
    function FilledIcon({ name, size = 18 }) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'currentColor',
        'aria-hidden': true,
      }, (FILLED_ICONS[name] ?? FILLED_ICONS.chat).map((part, index) => h('path', {
        key: index,
        d: part.d,
        transform: part.transform,
        fillRule: part.fillRule,
      })))
    }

    /** @param {string} name @param {number} size @returns {object} SVG icon. */
    function Icon({ name, size = 18 }) {
      const paths = ICONS[name] ?? ICONS.chat
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.35,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': true,
      }, paths.map((d, index) => h('path', { key: index, d })))
    }

    /**
     * Read the SVG the Host already renders for a panel row, so the rail uses
     * the product's own icon instead of a hand-drawn substitute.
     * @param {string} kind - plugins, automation or settings.
     * @returns {string} serialized SVG markup, or '' when unavailable.
     */
    function hostGlyphMarkup(kind) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return ''
      const labels = kind === 'plugins' ? ['插件', 'Plugins']
        : kind === 'automation' ? ['自动化', 'Automation', 'Scheduled']
          : ['设置', 'Settings']
      for (const button of document.querySelectorAll('button[aria-label]')) {
        if (button.closest?.('[data-dshlr-rail]') !== null && button.closest?.('[data-dshlr-rail]') !== undefined) continue
        const label = button.getAttribute?.('aria-label') ?? ''
        if (!labels.some((candidate) => label.startsWith(candidate))) continue
        const svg = button.querySelector?.('svg')
        if (svg !== null && svg !== undefined) return svg.outerHTML ?? ''
      }
      return ''
    }

    /**
     * Prefer the Host's original panel glyph; fall back to the rail drawing
     * until the sidebar panel list has mounted (or if the panel is absent).
     * @param {object} props - icon kind and fallback name.
     * @returns {object} glyph element.
     */
    function OriginalIcon({ kind, active = false }) {
      const [markup, setMarkup] = useState('')
      useEffect(() => {
        let alive = true
        const paint = () => {
          if (!alive) return
          const next = hostGlyphMarkup(kind)
          if (next !== '') setMarkup(next)
        }
        paint()
        const observer = typeof MutationObserver === 'function' ? new MutationObserver(paint) : null
        observer?.observe?.(document.body, { childList: true, subtree: true })
        const timer = typeof setInterval === 'function' ? setInterval(paint, 800) : null
        return () => {
          alive = false
          observer?.disconnect?.()
          if (timer !== null) clearInterval(timer)
        }
      }, [kind])
      if (active) return h(FilledIcon, { name: kind })
      if (markup !== '') return h('span', { className: 'dshlr-glyph', dangerouslySetInnerHTML: { __html: markup } })
      return h(Icon, { name: kind })
    }

    /** Hide the native sidebar rows whose entry now lives in the rail. */
    function hideNativePanelRows() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return
      const labels = ['插件', 'Plugins', '自动化', 'Automation', 'Scheduled']
      for (const button of document.querySelectorAll('button[aria-label]')) {
        if (button.closest?.('[data-dshlr-rail]') !== null && button.closest?.('[data-dshlr-rail]') !== undefined) continue
        const label = button.getAttribute?.('aria-label') ?? ''
        if (labels.some((candidate) => label.startsWith(candidate))) button.setAttribute?.('data-dshlr-hidden', '')
      }
    }

    /** Hide the host titlebar toggle; the rail renders a matching control after the arrows. */
    function hideNativeSidebarToggle() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return
      for (const button of document.querySelectorAll('button[aria-label]')) {
        if (button.hasAttribute?.('data-dshlr-toggle') === true) continue
        if (button.closest?.('[data-dshlr-rail]') !== null && button.closest?.('[data-dshlr-rail]') !== undefined) continue
        const label = button.getAttribute?.('aria-label') ?? ''
        if (/左侧栏|侧边栏|sidebar/i.test(label)) button.setAttribute?.('data-dshlr-hidden', '')
      }
    }

    /** Hide the host new-session button when the collapsed sidebar parks it in the titlebar row. */
    function hideCollapsedNewSession() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return
      for (const button of document.querySelectorAll('button[aria-label]')) {
        if (button.closest?.('[data-dshlr-rail]') !== null && button.closest?.('[data-dshlr-rail]') !== undefined) continue
        const className = typeof button.className === 'string' ? button.className : ''
        // The brand button reuses the "new session" label; never hide the DeepSeek logo.
        if (/brand/i.test(className)) {
          button.removeAttribute?.('data-dshlr-hidden')
          continue
        }
        if (!/newSession/i.test(className)) continue
        const label = button.getAttribute?.('aria-label') ?? ''
        if (!/新建会话|New chat|New session/i.test(label)) continue
        let top = 0
        try { top = button.getBoundingClientRect?.().top ?? 0 } catch { top = 0 }
        if (top < 60) button.setAttribute?.('data-dshlr-hidden', '')
        else button.removeAttribute?.('data-dshlr-hidden')
      }
    }

    /** @returns {Element|null} host settings button. */
    function settingsButton() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null
      for (const button of document.querySelectorAll('button[aria-label]')) {
        const label = button.getAttribute?.('aria-label') ?? ''
        if (label === '设置' || label === 'Settings') return button
      }
      return null
    }

    /** @param {string[]} labels @returns {Element|null} first matching host button. */
    function actionButton(labels) {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return null
      for (const button of document.querySelectorAll('button[aria-label]')) {
        if (button.closest?.('[data-dshlr-rail]') !== null && button.closest?.('[data-dshlr-rail]') !== undefined) continue
        const label = button.getAttribute?.('aria-label') ?? ''
        if (labels.some((candidate) => label === candidate || label.includes(candidate))) return button
      }
      return null
    }

    /** Read the host's existing account label/avatar when it is rendered on the right. */
    function detectAccount() {
      if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return { email: '', avatar: '' }
      let email = ''
      for (const node of document.querySelectorAll('span, div')) {
        if (node.children?.length > 0) continue
        const text = node.textContent?.trim() ?? ''
        if (text.length <= 64 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) { email = text; break }
      }
      let avatar = ''
      for (const image of document.querySelectorAll('img')) {
        const src = image.getAttribute?.('src') ?? ''
        if (src !== '') { avatar = src; break }
      }
      return { email, avatar }
    }

    /**
     * One rail button.
     * @param {object} props - name, label, active, disabled, onClick and icons.
     * @returns {object} button element.
     */
    function RailButton({ name, label, active, disabled, onClick, onTip }) {
      return h('button', {
        type: 'button',
        className: 'dshlr-button' + (active ? ' dshlr-active' : ''),
        'data-dshlr-button': name,
        'aria-label': label,
        disabled,
        onMouseEnter: (event) => onTip?.(event.currentTarget, label),
        onMouseLeave: () => onTip?.(null),
        onFocus: (event) => onTip?.(event.currentTarget, label),
        onBlur: () => onTip?.(null),
        onClick,
      }, h(OriginalIcon, { kind: name, active }))
    }

    /**
     * Codex-style account/settings popover anchored beside the rail.
     * @param {object} props - account, actions, translator and close callback.
     * @returns {object} menu.
     */
    function SettingsMenu({ account, actions, t, onClose }) {
      return h('div', { className: 'dshlr-menu', role: 'menu', 'aria-label': t('rail.menu') },
        h('div', { className: 'dshlr-account' },
          account.avatar === ''
            ? h('span', { className: 'dshlr-avatar', 'aria-hidden': true }, h(Icon, { name: 'settings' }))
            : h('img', { className: 'dshlr-avatar dshlr-avatar-image', src: account.avatar, alt: '' }),
          h('span', { className: 'dshlr-account-text' },
            h('span', { className: 'dshlr-account-name' }, account.email === '' ? t('rail.account') : account.email),
            account.email === '' ? null : h('span', { className: 'dshlr-account-sub' }, t('rail.account')))),
        h('span', { className: 'dshlr-menu-separator' }),
        h('button', { type: 'button', className: 'dshlr-menu-item', role: 'menuitem', 'data-dshlr-menu-item': 'settings', onClick: () => { actions.openSettings(); onClose() } },
          h(Icon, { name: 'settings' }), h('span', null, t('rail.settings'))),
        h('button', { type: 'button', className: 'dshlr-menu-item', role: 'menuitem', 'data-dshlr-menu-item': 'feedback', onClick: () => { actions.openFeedback(); onClose() } },
          h(Icon, { name: 'chat' }), h('span', null, t('rail.feedback'))),
        h('button', { type: 'button', className: 'dshlr-menu-item', role: 'menuitem', 'data-dshlr-menu-item': 'logout', onClick: () => { actions.logout(); onClose() } },
          h(Icon, { name: 'automation' }), h('span', null, t('rail.logout'))))
    }

    /**
     * The fixed left rail.
     * @param {object} props - injected navigation actions and translator.
     * @returns {object} rail.
     */
    function LeftRail({ actions, t }) {
      const [active, setActive] = useState(actions.activePanel())
      const [tip, setTip] = useState(null)
      const [menuOpen, setMenuOpen] = useState(false)
      const [account, setAccount] = useState({ email: '', avatar: '' })
      const tipRef = useRef(null)
      useEffect(() => actions.subscribe(setActive), [actions])
      useEffect(() => {
        if (tip === null || tipRef.current === null) return undefined
        const place = () => {
          const box = tipRef.current?.getBoundingClientRect?.()
          const anchor = tip.element?.getBoundingClientRect?.()
          if (box === undefined || anchor === undefined) return
          const viewportWidth = window.innerWidth ?? document.documentElement.clientWidth
          const viewportHeight = window.innerHeight ?? document.documentElement.clientHeight
          const gap = 8
          const edge = 8
          let left = anchor.right + gap
          if (left + box.width > viewportWidth - edge) left = anchor.left - gap - box.width
          left = Math.max(edge, Math.min(viewportWidth - box.width - edge, left))
          let top = anchor.top + (anchor.height - box.height) / 2
          top = Math.max(edge, Math.min(viewportHeight - box.height - edge, top))
          tipRef.current.style.left = left + 'px'
          tipRef.current.style.top = top + 'px'
        }
        place()
        window.addEventListener('resize', place)
        document.addEventListener('scroll', place, true)
        return () => {
          window.removeEventListener('resize', place)
          document.removeEventListener('scroll', place, true)
        }
      }, [tip])
      const showTip = (element, label) => setTip(element === null ? null : { element, label })
      return h(React.Fragment, null,
        h('button', {
          type: 'button',
          className: 'dshlr-toggle',
          'data-dshlr-toggle': '',
          'aria-label': t('rail.toggle'),
          title: t('rail.toggle'),
          onClick: () => actions.toggleSidebar(),
        }, h('svg', { viewBox: '0 0 16 16', width: 13, height: 13, fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, 'aria-hidden': true },
          h('rect', { x: 2.5, y: 3, width: 11, height: 10, rx: 2 }),
          h('path', { d: 'M6.5 3v10' }))),
        h('nav', { className: 'dshlr-rail', 'data-dshlr-rail': '' },
        h(RailButton, {
          name: 'chat',
          label: t('rail.chat'),
          active: active === null,
          onClick: () => actions.openChat(),
          onTip: showTip,
        }),
        h(RailButton, {
          name: 'plugins',
          label: actions.hasPanel('plugins')
            ? t('rail.plugins')
            : t('rail.unavailable', { name: t('rail.plugins') }),
          active: active === 'plugins',
          disabled: !actions.hasPanel('plugins'),
          onClick: () => actions.openPanel('plugins'),
          onTip: showTip,
        }),
        h(RailButton, {
          name: 'automation',
          label: actions.hasPanel('schedules')
            ? t('rail.automation')
            : t('rail.unavailable', { name: t('rail.automation') }),
          active: active === 'schedules',
          disabled: !actions.hasPanel('schedules'),
          onClick: () => actions.openPanel('schedules'),
          onTip: showTip,
        }),
        h('span', { className: 'dshlr-spacer' }),
        h(RailButton, {
          name: 'settings',
          label: t('rail.settings'),
          active: menuOpen,
          onClick: () => {
            setAccount(detectAccount())
            setMenuOpen((open) => !open)
            showTip(null)
          },
          onTip: showTip,
        }),
        menuOpen ? h(SettingsMenu, { account, actions, t, onClose: () => setMenuOpen(false) }) : null,
        tip === null ? null : h('div', { ref: tipRef, className: 'dshlr-tooltip', role: 'tooltip' }, tip.label)))
    }

    /**
     * Fade the sidebar's content before/after the native width transition, so
     * collapsing does not leave a blank slab sliding shut and expanding does
     * not pop its content in at full opacity.
     * @param {{toggleSidebar: Function}} layout - layout controller.
     * @returns {boolean} whether an animation was started.
     */
    function toggleSidebarWithContentFade(layout) {
      const column = document.querySelector?.('[class*="BynINW_sidebarCol"]')
      if (column === null || column === undefined) {
        layout.toggleSidebar()
        return false
      }
      if (column.hasAttribute('data-dshlr-collapsing') || column.hasAttribute('data-dshlr-expanding')) return true
      const collapsed = column.getBoundingClientRect?.().width < 2
      if (collapsed) {
        layout.toggleSidebar()
        column.setAttribute('data-dshlr-expanding', '')
        setTimeout(() => column.removeAttribute('data-dshlr-expanding'), 240)
      } else {
        column.setAttribute('data-dshlr-collapsing', '')
        setTimeout(() => {
          layout.toggleSidebar()
          setTimeout(() => column.removeAttribute('data-dshlr-collapsing'), 260)
        }, 150)
      }
      return true
    }

    /** @param {unknown} value @returns {string|undefined} binding session id. */
    function sessionIdOfValue(value) {
      if (typeof value === 'string' && value !== '') return value
      if (value !== null && typeof value === 'object') {
        if (typeof value.key === 'string' && value.key !== '') return value.key
        if (typeof value.sessionId === 'string' && value.sessionId !== '') return value.sessionId
      }
      return undefined
    }

    /** @param {string} path @returns {string} last path segment. */
    function basenameOf(path) {
      if (typeof path !== 'string') return ''
      const trimmed = path.replace(/[\\/]+$/, '')
      return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || path
    }

    /**
     * Make the DeepSeek brand a single menu button: the host brand button plus
     * its inline chevron open a workspace switcher rather than starting a new
     * session. Workspaces carry different conversation context, so switching
     * here changes how the assistant answers.
     * @param {object} ctx - client root context.
     * @returns {Function} disposer.
     */
    function installBrandDropdown(ctx) {
      if (typeof document === 'undefined') return () => {}
      let menu = null
      let brand = null
      let chevron = null
      let observer = null
      let timer = null
      let onDocumentPointer = null
      let onDocumentKey = null
      let onResize = null

      const closeMenu = () => {
        if (menu !== null) menu.hidden = true
        brand?.setAttribute?.('aria-expanded', 'false')
        document.removeEventListener?.('mousedown', onDocumentPointer, true)
        document.removeEventListener?.('keydown', onDocumentKey, true)
        window.removeEventListener?.('resize', onResize)
      }

      const placeMenu = () => {
        if (menu === null || brand === null || menu.hidden) return
        const anchor = brand.getBoundingClientRect()
        const box = menu.getBoundingClientRect()
        const edge = 8
        const viewportWidth = window.innerWidth ?? document.documentElement.clientWidth
        const viewportHeight = window.innerHeight ?? document.documentElement.clientHeight
        let left = anchor.left
        if (left + box.width > viewportWidth - edge) left = viewportWidth - box.width - edge
        left = Math.max(edge, left)
        let top = anchor.bottom + 6
        if (top + box.height > viewportHeight - edge) top = anchor.top - box.height - 6
        top = Math.max(edge, top)
        menu.style.left = left + 'px'
        menu.style.top = top + 'px'
      }

      const fillMenu = () => {
        if (menu === null) return
        menu.textContent = ''
        const uiWorkspace = typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : undefined
        const snapshot = uiWorkspace?.workspaces?.list?.getSnapshot?.()
        const items = Array.isArray(snapshot?.items) ? snapshot.items : []
        const archived = Array.isArray(snapshot?.archivedSessionIds) ? snapshot.archivedSessionIds : []
        const sessions = uiWorkspace?.sessions?.list?.getSnapshot?.()
        const uiSession = typeof ctx.get === 'function' ? ctx.get('uiSession') : undefined
        const currentId = sessionIdOfValue(uiSession?.current?.value)
        const currentDirectory = sessions?.byId?.[currentId]?.cwd
        if (items.length === 0) {
          const empty = document.createElement('div')
          empty.className = 'dshlr-workspace-empty'
          empty.textContent = '没有可切换的工作区'
          menu.appendChild(empty)
          return
        }
        for (const item of items) {
          const title = typeof item.title === 'string' && item.title !== '' ? item.title : basenameOf(item.path)
          const path = typeof item.path === 'string' ? item.path : ''
          const active = typeof currentDirectory === 'string' && currentDirectory !== '' && path !== ''
            && currentDirectory.replace(/[\\/]+$/, '').toLowerCase() === path.replace(/[\\/]+$/, '').toLowerCase()
          const row = document.createElement('button')
          row.type = 'button'
          row.className = 'dshlr-workspace-item' + (active ? ' dshlr-workspace-item-active' : '')
          row.setAttribute('role', 'menuitemradio')
          row.setAttribute('aria-checked', active ? 'true' : 'false')
          const text = document.createElement('span')
          text.className = 'dshlr-workspace-text'
          const name = document.createElement('span')
          name.className = 'dshlr-workspace-name'
          name.textContent = title
          const subtitle = document.createElement('span')
          subtitle.className = 'dshlr-workspace-path'
          subtitle.textContent = path
          text.append(name, subtitle)
          row.append(text)
          if (active) {
            const check = document.createElement('span')
            check.className = 'dshlr-workspace-check'
            check.textContent = '✓'
            row.append(check)
          }
          row.addEventListener('click', () => {
            closeMenu()
            if (active) return
            if (uiWorkspace === undefined || uiWorkspace === null) return
            const candidates = Array.isArray(item.sessionIds) ? [...item.sessionIds].reverse() : []
            const target = candidates.find((id) => !archived.includes(id) && sessions?.byId?.[id] !== undefined)
            try {
              if (target !== undefined) uiWorkspace.openSession(target)
              else uiWorkspace.openWorkspace(item.workspaceId)
            } catch {
              // A stale workspace entry is ignored.
            }
          })
          menu.appendChild(row)
        }
      }

      const openMenu = () => {
        if (menu === null || brand === null) return
        fillMenu()
        menu.hidden = false
        brand.setAttribute('aria-expanded', 'true')
        placeMenu()
        onDocumentPointer = (event) => {
          if (menu.contains(event.target) || brand.contains(event.target)) return
          closeMenu()
        }
        onDocumentKey = (event) => { if (event.key === 'Escape') closeMenu() }
        onResize = placeMenu
        document.addEventListener('mousedown', onDocumentPointer, true)
        document.addEventListener('keydown', onDocumentKey, true)
        window.addEventListener?.('resize', onResize)
      }

      const activateBrand = (event) => {
        event.preventDefault()
        event.stopImmediatePropagation()
        if (menu !== null && !menu.hidden) closeMenu()
        else openMenu()
      }

      const ensure = () => {
        const logoRow = document.querySelector?.('[class*="logoRow"]')
        const nextBrand = logoRow?.querySelector?.('button[class*="brand"]') ?? null
        if (nextBrand === null) {
          if (brand !== null) { closeMenu(); brand = null }
          return
        }
        if (brand !== nextBrand) {
          brand = nextBrand
          brand.setAttribute?.('aria-label', 'DeepSeek Harness')
          brand.setAttribute?.('aria-haspopup', 'menu')
          brand.setAttribute?.('aria-expanded', 'false')
          brand.addEventListener?.('click', activateBrand, true)
        }
        const identity = brand.querySelector?.('[class*="brandIdentity"]') ?? brand
        if (chevron === null) {
          chevron = document.createElement('span')
          chevron.className = 'dshlr-brand-chevron'
          chevron.setAttribute('aria-hidden', 'true')
          chevron.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="m4 6 4 4 4-4"/></svg>'
        }
        if (identity !== null && identity !== undefined) {
          identity.classList?.add?.('dshlr-brand-pill')
          if (chevron.parentElement !== identity) identity.appendChild(chevron)
        }
        if (menu === null) {
          menu = document.createElement('div')
          menu.className = 'dshlr-workspace-menu'
          menu.hidden = true
          menu.setAttribute('role', 'menu')
          document.body.appendChild(menu)
        }
        if (menu !== null && !menu.hidden) placeMenu()
      }

      ensure()
      observer = typeof MutationObserver === 'function' ? new MutationObserver(ensure) : null
      observer?.observe?.(document.body, { childList: true, subtree: true })
      timer = typeof setInterval === 'function' ? setInterval(ensure, 800) : null
      return () => {
        observer?.disconnect?.()
        if (timer !== null) clearInterval(timer)
        closeMenu()
        chevron?.remove?.()
        brand?.querySelector?.('[class*="brandIdentity"]')?.classList?.remove?.('dshlr-brand-pill')
        menu?.remove?.()
        if (brand !== null) brand.removeEventListener?.('click', activateBrand, true)
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'left-rail: dictionaries')
      ctx.effect(() => installBrandDropdown(ctx), 'left-rail: brand workspace switcher')
      ctx.effect(() => {
        if (typeof document === 'undefined' || typeof document.createElement !== 'function') return () => {}
        const style = document.createElement('style')
        style.dataset.dshPlugin = 'dsh-left-rail'
        style.textContent = `html { --dsh-left-rail-width: 64px; }
[data-dshlr-hidden] { display: none !important; }
.BynINW_sidebarCol[data-dshlr-collapsing] > * {
  opacity: 0 !important;
  transform: translateX(-10px);
  transition: opacity 150ms ease, transform 150ms ease;
}
.BynINW_sidebarCol[data-dshlr-expanding] > * {
  animation: dshlr-content-in 220ms ease both;
}
@keyframes dshlr-content-in {
  from { opacity: 0; transform: translateX(-10px); }
  to { opacity: 1; transform: translateX(0); }
}
/* Keep the viewport grid animated even when the host's transient
   data-animating token is missed by a plugin-triggered toggle. */
html[data-windows-titlebar] .BynINW_frame:not([data-dragging]):not([data-rightbar-instant]) {
  transition: grid-template-columns var(--ds-transition-duration-slow) var(--ds-ease-in-out);
}
#root { margin-left: var(--dsh-left-rail-width); width: calc(100% - var(--dsh-left-rail-width)); }
.dshlr-rail {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--dsh-left-rail-width);
  z-index: 95;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  padding: calc(var(--dsh-frame-top-clearance, 0px) + 8px) 6px 10px;
  background: var(--dsw-specific-sidebar-fill);
  -webkit-app-region: no-drag;
}
.dshlr-button {
  box-sizing: border-box;
  width: 32px;
  height: 32px;
  flex: none;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshlr-button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshlr-button:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dshlr-button.dshlr-active {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshlr-button:disabled {
  opacity: .35;
  cursor: default;
}
.dshlr-spacer { flex: 1; }
.dshlr-toggle {
  position: fixed;
  left: 33px;
  top: 10px;
  z-index: 96;
  box-sizing: border-box;
  width: 14px;
  height: 18px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.dshlr-toggle:hover,
.dshlr-toggle:focus-visible {
  background: transparent;
  color: var(--dsw-alias-label-primary);
}
.dshlr-toggle svg { display: block; }
.dshlr-brand-chevron {
  display: inline-flex;
  flex: none;
  align-items: center;
  margin-left: 4px;
  color: var(--dsw-alias-label-secondary);
  pointer-events: none;
}
.dshlr-brand-chevron svg { display: block; }
.dshlr-brand-pill {
  box-sizing: border-box;
  width: fit-content;
  max-width: 100%;
  flex: 0 1 auto !important;
  gap: 4px !important;
  padding: 3px 7px 3px 6px;
  border-radius: 7px;
  background: var(--dsw-alias-interactive-bg-hover);
  transition: background 120ms ease;
}
.dshlr-brand-pill:hover { background: var(--dsw-alias-interactive-bg-active); }
.dshlr-workspace-menu {
  position: fixed;
  z-index: 120;
  width: 280px;
  max-height: min(420px, 70vh);
  overflow: auto;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  box-shadow: var(--dsw-elevation-soft);
  color: var(--dsw-alias-label-primary);
  -webkit-app-region: no-drag;
}
.dshlr-workspace-menu[hidden] { display: none; }
.dshlr-workspace-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dshlr-workspace-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshlr-workspace-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dshlr-workspace-name { font-size: 14px; line-height: 20px; }
.dshlr-workspace-path {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.dshlr-workspace-check { flex: none; color: var(--dsw-alias-label-primary); }
.dshlr-workspace-empty { padding: 12px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
.dshlr-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}
.dshlr-glyph svg {
  display: block;
  width: 18px !important;
  height: 18px !important;
}
.dshlr-menu {
  position: fixed;
  left: 72px;
  bottom: 12px;
  z-index: 98;
  width: 232px;
  box-sizing: border-box;
  padding: 8px;
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  border: 1px solid var(--dsw-alias-border-l2);
  box-shadow: var(--dsw-elevation-soft);
  color: var(--dsw-alias-label-primary);
  -webkit-app-region: no-drag;
}
.dshlr-account {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 7px 9px;
  min-width: 0;
}
.dshlr-avatar {
  width: 30px;
  height: 30px;
  flex: none;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
}
.dshlr-avatar-image { object-fit: cover; }
.dshlr-account-text { display: flex; flex-direction: column; min-width: 0; }
.dshlr-account-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshlr-account-sub { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dshlr-menu-separator { display: block; height: 1px; margin: 2px 7px 6px; background: var(--dsw-alias-border-l2); }
.dshlr-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  box-sizing: border-box;
  padding: 7px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.dshlr-menu-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshlr-menu-item .dshlr-brand-arrow {
  position: fixed;
  z-index: 97;
  box-sizing: border-box;
  width: 22px;
  height: 22px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dshlr-brand-arrow:hover { color: var(--dsw-alias-label-primary); }
.dshlr-brand-arrow[hidden] { display: none; }
.dshlr-workspace-menu {
  position: fixed;
  z-index: 120;
  width: 280px;
  max-height: min(420px, 70vh);
  overflow: auto;
  box-sizing: border-box;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 12px;
  background: var(--dsw-alias-bg-base);
  box-shadow: var(--dsw-elevation-soft);
  color: var(--dsw-alias-label-primary);
  -webkit-app-region: no-drag;
}
.dshlr-workspace-menu[hidden] { display: none; }
.dshlr-workspace-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  padding: 9px 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.dshlr-workspace-item:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshlr-workspace-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.dshlr-workspace-name { font-size: 14px; line-height: 20px; }
.dshlr-workspace-path {
  font-size: 12px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}
.dshlr-workspace-check { flex: none; color: var(--dsw-alias-label-primary); }
.dshlr-workspace-empty { padding: 12px; color: var(--dsw-alias-label-tertiary); font-size: 13px; }
.dshlr-glyph { width: 16px; height: 16px; color: var(--dsw-alias-label-secondary); }
.dshlr-tooltip {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 97;
  max-width: 220px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: var(--dsw-elevation-soft);
}
`
        document.head?.appendChild?.(style)
        return () => style.remove?.()
      }, 'left-rail: styles')

      ctx.effect(() => {
        hideNativePanelRows()
        hideNativeSidebarToggle()
        hideCollapsedNewSession()
        const observer = typeof MutationObserver === 'function' ? new MutationObserver(() => { hideNativePanelRows(); hideNativeSidebarToggle(); hideCollapsedNewSession() }) : null
        observer?.observe?.(document.body, { childList: true, subtree: true })
        const timer = typeof setInterval === 'function' ? setInterval(() => { hideNativePanelRows(); hideNativeSidebarToggle(); hideCollapsedNewSession() }, 800) : null
        return () => {
          observer?.disconnect?.()
          if (timer !== null) clearInterval(timer)
          for (const button of document.querySelectorAll?.('[data-dshlr-hidden]') ?? []) button.removeAttribute?.('data-dshlr-hidden')
        }
      }, 'left-rail: hide native panel rows')

      const layout = typeof ctx.get === 'function' ? ctx.get('layout') : undefined
      if (layout?.panelInfo === undefined) return
      const actions = {
        activePanel: () => layout.panelInfo.getSnapshot().activePanelId ?? null,
        subscribe(listener) {
          return layout.panelInfo.subscribe(() => listener(actions.activePanel()))
        },
        hasPanel: (id) => layout.hasMainPanel(id),
        openChat: () => layout.selectPanel(null),
        toggleSidebar: () => toggleSidebarWithContentFade(layout),
        openPanel: (id) => {
          if (layout.hasMainPanel(id)) layout.selectPanel(id)
        },
        openSettings: () => settingsButton()?.click(),
        openFeedback: () => actionButton(['意见反馈', 'Feedback'])?.click(),
        logout: () => actionButton(['退出登录', 'Log out', 'Sign out'])?.click(),
      }
      ctx.effect(() => {
        return ctx.slots.inject('shell.overlay', () => {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'left-rail.overlay',
            locale: NS,
            inject: () => ({ actions }),
          }, LeftRail)
        })
      }, 'left-rail: overlay')
    }

    return {
      inject: ['slots', 'locale', 'layout'],
      apply,
    }
})
