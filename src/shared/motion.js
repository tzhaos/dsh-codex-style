/** Shared, bounded motion for plugin-owned surfaces; never retains live dialogs. */
__DSH_FEATURE('dsh-ui-motion', function () {
  const SURFACES = [
    '.dsh-motion-surface', '.dshe-panel', '[data-dshe-native-model]', '.dshch-panel',
    '.dshst-searchModal', '.dshss-hoverCard', '.dshqf-annotationPanel',
    '.dsh-selection-toolbar', '.dshhp-tooltip', '.dshfl-toast', '.dshgit-menu',
    '.dshlr-displayMenu', '.dshss-viewMenu', '.dshwp-sidebarSearch', '.dshqf-panel',
    '.dshwp-skills', '.dshwp-taskLanding',
  ].join(',')
  const CONTROLS = `:where(${SURFACES},.dshlr-rail,.dshss-root,.dshss-settings,
    .dshcs-section,.dshst-headerActions,.dshwp-sidebar,.dshwp-taskFilter,
    .dshqw-row,.dshqw-editor,.dshqf-quotes) :where(button,[role="button"],[role="menuitem"])`
  const CSS = `
    [data-dsh-motion-managed], [data-dsh-motion-managed] [role="dialog"] { animation:none!important; }
    ${CONTROLS} {
      transition:background-color 120ms ease,color 120ms ease,border-color 120ms ease,
        box-shadow 120ms ease,opacity 120ms ease;
    }
    [data-dsh-motion-ghost], [data-dsh-motion-ghost] * { pointer-events:none!important; }
    @media(prefers-reduced-motion:reduce) {
      :is(${SURFACES}), :is(${SURFACES}) [role="dialog"] { animation:none!important; }
      ${CONTROLS} { transition:none!important; }
    }
  `
  // Visual copies contain no original classes, IDs, roles, event handlers or remote URLs.
  const PROPERTIES = (`display box-sizing position inset top right bottom left z-index isolation
    width height min-width min-height max-width max-height margin padding
    flex flex-direction flex-wrap flex-basis flex-grow flex-shrink align-items align-self
    justify-content gap row-gap column-gap grid-template-columns grid-template-rows
    grid-column grid-row vertical-align overflow overflow-x overflow-y
    background-color background-image background-size background-position background-repeat
    border-top border-right border-bottom border-left border-radius corner-shape box-shadow
    color font-family font-size font-weight font-style line-height letter-spacing
    text-align text-decoration text-overflow white-space word-break overflow-wrap
    opacity transform transform-origin translate visibility clip-path
    fill fill-rule stroke stroke-width stroke-linecap stroke-linejoin
    object-fit object-position backdrop-filter`).split(/\s+/)
  const SVG_TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])
  const SVG_ATTRS = ['viewBox', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'points']
  const OMIT = 'script,style,link,iframe,object,embed,video,audio,source,canvas,[hidden]'

  /** Cache while connected: detached elements no longer have layout or inherited styles. */
  function visualCopy(root) {
    let count = 0, textSize = 0, bytes = 0
    const budget = (value) => {
      bytes += value.length * 2
      if (bytes > 256 * 1024) throw new RangeError('surface copy is too large')
      return value
    }
    const copy = (node) => {
      if (++count > 256) throw new RangeError('surface is too large')
      if (node.nodeType === 3) {
        textSize += node.textContent.length
        if (textSize > 24000) throw new RangeError('surface text is too large')
        return document.createTextNode(budget(node.textContent))
      }
      if (node.nodeType !== 1 || node.matches(OMIT)) return null
      if (node !== root && node.matches('[data-dsh-motion-managed]')) return null
      const computed = getComputedStyle(node)
      if (computed.display === 'none' || computed.visibility === 'hidden') return null
      const tag = node.localName
      const target = SVG_TAGS.has(tag)
        ? document.createElementNS('http://www.w3.org/2000/svg', tag)
        : document.createElement(tag === 'img' ? 'img' : 'div')
      for (const property of PROPERTIES) {
        const value = computed.getPropertyValue(property)
        if (value && !/url\(/i.test(value)) target.style.setProperty(property, budget(value))
      }
      if (SVG_TAGS.has(tag)) {
        for (const name of SVG_ATTRS) {
          if (node.hasAttribute(name)) target.setAttribute(name, budget(node.getAttribute(name)))
        }
      } else if (tag === 'img') {
        const src = node.currentSrc || node.getAttribute('src') || ''
        if (/^(data:image\/|blob:)/i.test(src)) target.setAttribute('src', budget(src))
        target.setAttribute('alt', '')
      } else if (tag === 'input' || tag === 'textarea') {
        target.textContent = ['password', 'range', 'checkbox', 'radio', 'file', 'color'].includes(node.type)
          ? '' : node.value
        textSize += target.textContent.length
        if (textSize > 24000) throw new RangeError('surface text is too large')
        budget(target.textContent)
      }
      for (const child of tag === 'input' || tag === 'textarea' ? [] : node.childNodes) {
        const next = copy(child)
        if (next) target.append(next)
      }
      // Maintain scroll previews without carrying their live scrolling behavior.
      if (node.scrollTop || node.scrollLeft) {
        target.dataset.dshMotionScroll = `${node.scrollLeft},${node.scrollTop}`
      }
      return target
    }
    const rect = root.getBoundingClientRect()
    if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) return null
    let node
    try { node = copy(root) } catch (error) {
      if (!(error instanceof RangeError)) throw error
      // A long transcript/editor never gets duplicated. Its surface can still fade.
      node = document.createElement('div')
      const computed = getComputedStyle(root)
      for (const name of ['background-color', 'border-radius', 'box-shadow'])
        node.style.setProperty(name, computed.getPropertyValue(name))
    }
    if (!node) return null
    const computed = getComputedStyle(root)
    const shift = computed.translate.split(/\s+/)
    Object.assign(node.style, {
      position: 'absolute', inset: 'auto', top: `${rect.top - (parseFloat(shift[1]) || 0)}px`,
      left: `${rect.left - (parseFloat(shift[0]) || 0)}px`, width: `${rect.width}px`,
      height: `${rect.height}px`, minWidth: '0', minHeight: '0', maxWidth: 'none',
      maxHeight: 'none', boxSizing: 'border-box', margin: '0', transform: 'none',
      translate: 'none', opacity: '1', animation: 'none', transition: 'none',
    })
    return node
  }

  function install() {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const records = new Map(), dirty = new Set(), ghosts = new Set()
    let frame = null, disposed = false
    const style = document.createElement('style')
    style.dataset.dshPlugin = 'dsh-ui-motion'
    style.textContent = CSS
    document.head.append(style)
    const dropGhost = (ghost) => {
      clearTimeout(ghost.timer)
      ghost.animation?.cancel()
      ghost.node.remove()
      ghosts.delete(ghost)
    }
    const clearGhosts = () => { for (const ghost of [...ghosts]) dropGhost(ghost) }
    const cancel = (record) => {
      for (const animation of record.animations) animation.cancel()
      record.animations = []
    }
    const backingFor = (node) => {
      const anchor = node.style.getPropertyValue('--dsh-menu-anchor')
      if (!anchor) return null
      return [...document.querySelectorAll('[data-menu-backing]')].find((backing) =>
        backing.style.getPropertyValue('--dsh-menu-anchor') === anchor &&
        getComputedStyle(backing).display !== 'none') ?? null
    }
    const capture = (record) => {
      const node = record.node
      if (!node.isConnected) return
      const computed = getComputedStyle(node)
      if (computed.visibility !== 'visible' || computed.display === 'none') return
      record.snapshot = visualCopy(node)
      record.backingSnapshot = record.backing?.isConnected ? visualCopy(record.backing) : null
      let layer = 0
      for (let parent = node; parent && parent !== document.body; parent = parent.parentElement)
        layer = Math.max(layer, parseInt(getComputedStyle(parent).zIndex) || 0)
      record.layer = layer || 1000
    }
    const resize = new ResizeObserver((entries) => {
      for (const { target } of entries) if (records.has(target)) dirty.add(target)
      schedule()
    })
    const enter = (record) => {
      if (record.entered || !record.snapshot) return
      record.entered = true
      // Reopening or opening the next menu must never overlap an outgoing shadow.
      clearGhosts()
      const modal = record.node.getAttribute('role') === 'presentation'
      const keyframes = modal ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, translate: '0 3px' }, { opacity: 1, translate: '0 0' }]
      for (const node of [record.node, record.backing].filter(Boolean)) {
        record.animations.push(node.animate(keyframes, {
          duration: 150, easing: 'cubic-bezier(.2,.8,.2,1)',
        }))
      }
    }
    const exit = (record) => {
      const opacity = record.animations[0]?.effect.getComputedTiming().progress ?? 1
      cancel(record)
      resize.unobserve(record.node)
      record.node.removeAttribute('data-dsh-motion-managed')
      records.delete(record.node)
      dirty.delete(record.node)
      if (!record.snapshot || media.matches || disposed) return
      // Only paint remains; all native listeners, focus traps and ARIA are already gone.
      while (ghosts.size >= 4) dropGhost(ghosts.values().next().value)
      const node = document.createElement('div')
      node.dataset.dshMotionGhost = ''
      node.setAttribute('aria-hidden', 'true')
      node.inert = true
      Object.assign(node.style, { position: 'fixed', inset: '0', pointerEvents: 'none', opacity: String(opacity),
        zIndex: String(record.layer), overflow: 'visible' })
      if (record.backingSnapshot) node.append(record.backingSnapshot)
      node.append(record.snapshot)
      document.body.append(node)
      for (const scroll of node.querySelectorAll('[data-dsh-motion-scroll]')) {
        const [left, top] = scroll.dataset.dshMotionScroll.split(',').map(Number)
        scroll.scrollLeft = left; scroll.scrollTop = top
        scroll.removeAttribute('data-dsh-motion-scroll')
      }
      const ghost = { node, animation: node.animate([{ opacity }, { opacity: 0 }],
        { duration: 110, easing: 'ease-in', fill: 'forwards' }), timer: null }
      ghosts.add(ghost)
      ghost.animation.onfinish = () => dropGhost(ghost)
      ghost.timer = setTimeout(() => dropGhost(ghost), 180)
    }
    function schedule() {
      if (frame !== null || disposed || media.matches || !dirty.size) return
      frame = requestAnimationFrame(() => {
        frame = null
        for (const node of [...dirty]) {
          dirty.delete(node)
          const record = records.get(node)
          if (!record) continue
          if (!node.isConnected) { exit(record); continue }
          record.backing ??= backingFor(node)
          capture(record)
          enter(record)
        }
      })
    }
    const register = (surface) => {
      const node = surface.matches('[aria-modal="true"]') &&
        surface.parentElement?.matches('[role="presentation"]') ? surface.parentElement : surface
      if (records.has(node) || records.size >= 24 || node.closest('[data-dsh-motion-ghost]')) return
      node.setAttribute('data-dsh-motion-managed', '')
      records.set(node, { node, animations: [], entered: false, snapshot: null, backing: null })
      resize.observe(node)
      dirty.add(node)
    }
    const discover = (node, subtree = true) => {
      if (node.nodeType !== 1 || node.closest('[data-dsh-motion-ghost]')) return
      if (node.matches(SURFACES)) register(node)
      if (subtree) {
        for (const surface of node.querySelectorAll(SURFACES)) register(surface)
        // DSH submenus are descendants of their owned menu, not independent host menus.
        for (const submenu of node.querySelectorAll('[role="menu"]')) {
          if (submenu.parentElement?.closest(SURFACES)) register(submenu)
        }
      }
      if (node.matches('[role="menu"]') && node.parentElement?.closest(SURFACES)) register(node)
    }
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.target.parentElement?.closest('[data-dsh-motion-ghost]')) continue
        if (mutation.type === 'childList') for (const node of mutation.addedNodes) discover(node)
        if (mutation.type === 'attributes') discover(mutation.target, false)
        const parent = (mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement)
          ?.closest('[data-dsh-motion-managed]')
        if (records.has(parent)) dirty.add(parent)
      }
      for (const record of [...records.values()]) if (!record.node.isConnected) exit(record)
      schedule()
    })
    const reset = () => {
      observer.disconnect(); resize.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
      frame = null; dirty.clear(); clearGhosts()
      for (const record of records.values()) {
        cancel(record); record.node.removeAttribute('data-dsh-motion-managed')
      }
      records.clear()
    }
    const refresh = () => {
      reset()
      if (disposed || media.matches || typeof Element.prototype.animate !== 'function') return
      discover(document.body)
      observer.observe(document.body, { childList: true, subtree: true, characterData: true,
        attributes: true, attributeFilter: ['class', 'style', 'hidden', 'data-dshe-native-model'] })
      schedule()
    }
    const moved = (event) => {
      if (event?.target?.closest?.('[data-dsh-motion-ghost]')) return
      clearGhosts()
      for (const node of records.keys()) dirty.add(node)
      schedule()
    }
    media.addEventListener('change', refresh)
    window.addEventListener('resize', moved)
    window.addEventListener('scroll', moved, true)
    window.visualViewport?.addEventListener('resize', moved)
    window.visualViewport?.addEventListener('scroll', moved)
    refresh()
    return () => {
      disposed = true; reset(); style.remove()
      media.removeEventListener('change', refresh)
      window.removeEventListener('resize', moved)
      window.removeEventListener('scroll', moved, true)
      window.visualViewport?.removeEventListener('resize', moved)
      window.visualViewport?.removeEventListener('scroll', moved)
    }
  }
  return { apply(ctx) { ctx.effect(install, 'ui motion: surfaces') } }
})
