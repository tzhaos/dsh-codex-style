/**
 * Zero-dependency verification for the merged attachment-actions feature.
 *
 * Run with `node checks/attachment-actions.mjs`. The shipped browser bundle is
 * loaded with only this feature built (the bundle's test filter); the suite
 * exercises the real client component through a miniature React/hooks runtime
 * and a DOM-shaped fake that mirrors the host attachment surfaces, and it reads
 * the merged manifest/catalog contract.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const manifest = JSON.parse(read('package.json'))
const clientSource = read('client.js')
const sourceSource = read('src/conversation/attachment-actions.js')

let checks = 0

/** Compare two JSON-shaped values. */
function assertEqual(actual, expected, message) {
  assert.deepEqual(actual, expected, message)
}

/** Copy a value out of the vm realm so deep equality checks plain data. */
function plain(value) {
  return JSON.parse(JSON.stringify(value))
}

/**
 * Run one named check.
 * @param {string} name - check name.
 * @param {Function} body - check body.
 */
async function check(name, body) {
  try {
    await body()
    checks += 1
    console.log('ok ' + name)
  } catch (error) {
    console.error('FAIL ' + name)
    console.error('     ' + (error?.message ?? error))
    process.exitCode = 1
  }
}

/** @returns {string} flattened element text. */
function textOf(element) {
  if (element === null || element === undefined) return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(textOf).join('')
  if (element.children === undefined) return textOf(element.props?.children)
  return Array.isArray(element.children)
    ? element.children.map(textOf).join('')
    : textOf(element.children)
}

/** Find every element matching a predicate. */
function findAll(root, predicate) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (predicate(node)) found.push(node)
    walk(node.children)
  }
  walk(root)
  return found
}

/** Find one element matching a predicate, or fail. */
function findOne(root, predicate) {
  const matches = findAll(root, predicate)
  assert(matches.length >= 1, 'expected one match, found ' + matches.length)
  return matches[0]
}

/**
 * Extract one merged feature's section of the shipped bundle.
 * @param {string} id - merged feature id.
 * @returns {string} the feature body slice.
 */
function featureSource(id) {
  const marker = '* Feature: ' + id
  const start = clientSource.indexOf(marker)
  assert(start !== -1, 'bundle carries feature ' + id)
  const next = clientSource.indexOf('* Feature: ', start + marker.length)
  return clientSource.slice(start, next === -1 ? undefined : next)
}

/** @returns {string} the stylesheet template of one merged feature. */
function featureCSS(id) {
  const source = featureSource(id)
  const start = source.indexOf('const CSS = `')
  const end = source.indexOf('\n`', start)
  assert(start !== -1 && end !== -1, 'stylesheet found for ' + id)
  return source.slice(start, end)
}

/** @returns {boolean} whether an element is a menu action button. */
const isMenuButton = (element) => element.type === 'button' && element.props?.role === 'menuitem'

// ---------------------------------------------------------------------------
// 1. Static contract
// ---------------------------------------------------------------------------

await check('the catalog maps the feature to its source file', () => {
  const catalog = JSON.parse(read('src/catalog.json'))
  const group = catalog.find((entry) => entry.id === 'content')
  assert(group !== undefined, 'content group exists')
  const feature = group.features.find((entry) => entry.id === 'dsh-attachment-actions')
  assert(feature !== undefined, 'feature listed under content')
  assert.equal(feature.source, 'src/conversation/attachment-actions.js')
})

await check('the source registers the feature exactly once', () => {
  assert.equal((sourceSource.match(/__DSH_FEATURE\('dsh-attachment-actions'/g) ?? []).length, 1)
})

await check('every merged feature registers exactly once in the shipped bundle', () => {
  assert.equal((clientSource.match(/__DSH_FEATURE\('dsh-attachment-actions'/g) ?? []).length, 1)
  const start = clientSource.indexOf("__DSH_FEATURE('dsh-attachment-actions'")
  assert(start !== -1, 'feature present')
  assert(
    start > clientSource.indexOf("__DSH_FEATURE('dsh-file-link-actions'"),
    'attachment menu registers after the file-link menu so its capture listener runs second',
  )
})

await check('settings metadata covers the feature in both locales', () => {
  const settings = read('src/settings.js')
  for (const suffix of ['title', 'summary', 'note']) {
    assert.equal(
      (settings.match(new RegExp("'feature\\." + 'dsh-attachment-actions' + "\\." + suffix + "'", 'g')) ?? [])
        .length,
      2,
      suffix + ' exists in zh and en',
    )
  }
})

await check('the feature only requires frozen platform modules', () => {
  const requires = [...new Set([...featureSource('dsh-attachment-actions').matchAll(/require\('([^']+)'\)/g)]
    .map((match) => match[1]))].sort()
  assert.deepEqual(requires, ['@deepseek-ai/dsh-client-ui-primitives', 'react'])
})

await check('the stylesheet keeps colors in theme tokens', () => {
  const css = featureCSS('dsh-attachment-actions')
  assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]), [], 'literal colors')
  assert(css.includes('.dshaa-anchor'), 'menu anchor style')
})

await check('the feature never re-parents host-owned DOM', () => {
  for (const marker of ['insertAdjacentElement', 'replaceChildren', 'MutationObserver', 'innerHTML']) {
    assert(!sourceSource.includes(marker), 'no ' + marker)
  }
  assert(sourceSource.includes('document.head.appendChild(style)'), 'own stylesheet only')
  assert(sourceSource.includes('document.body.append(anchor)'), 'own download anchor only')
})

await check('the manifest still declares the merged bundle', () => {
  assert.equal(manifest.name, 'dsh-codex-style')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
})

// ---------------------------------------------------------------------------
// 2. Fake React runtime, DOM and platform globals
// ---------------------------------------------------------------------------

/** A minimal React runtime with hook slots, effect cleanups and unmount. */
function createFakeReact() {
  const hooks = []
  let cursor = 0
  let dirty = false
  let queued = []

  const depsEqual = (left, right) => {
    if (left === undefined || right === undefined) return false
    if (left.length !== right.length) return false
    return left.every((value, index) => Object.is(value, right[index]))
  }

  const react = {
    createElement(type, props, ...children) {
      const merged = { ...(props ?? {}) }
      const flat = []
      const push = (child) => {
        if (child === null || child === undefined || typeof child === 'boolean') return
        if (Array.isArray(child)) {
          for (const value of child) push(value)
          return
        }
        flat.push(child)
      }
      for (const child of children) push(child)
      if (flat.length === 1) merged.children = flat[0]
      else if (flat.length > 1) merged.children = flat
      return { type, props: merged }
    },
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      const setState = (next) => {
        const value = typeof next === 'function' ? next(hooks[index].value) : next
        if (Object.is(value, hooks[index].value)) return
        hooks[index].value = value
        dirty = true
      }
      return [hooks[index].value, setState]
    },
    useRef(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useEffect(effect, deps) {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (previous !== undefined && deps !== undefined && depsEqual(previous.deps, deps)) return
      hooks[index] = { deps, cleanup: undefined }
      queued.push({ index, effect })
    },
    Fragment: Symbol('Fragment'),
  }

  return {
    react,
    begin() {
      cursor = 0
      dirty = false
      queued = []
    },
    end() {
      const effects = queued
      queued = []
      for (const { index, effect } of effects) {
        const slot = hooks[index]
        if (typeof slot.cleanup === 'function') slot.cleanup()
        const cleanup = effect()
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }
      return effects.length
    },
    isDirty: () => dirty,
    unmount() {
      for (const slot of hooks) {
        if (typeof slot.cleanup === 'function') slot.cleanup()
        slot.cleanup = undefined
      }
    },
  }
}

/** Render a component tree with the fake runtime. */
function mountComponent(component, props, runtime) {
  let currentProps = props
  let tree = null
  const renderTree = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(renderTree)
    const { type, props: elementProps } = node
    if (typeof type === 'function') return renderTree(type(elementProps))
    const next = { type, props: elementProps, children: [] }
    const children = elementProps.children
    if (Array.isArray(children)) next.children = children.map(renderTree)
    else if (children !== undefined) next.children = renderTree(children)
    return next
  }
  const rerender = () => {
    for (let pass = 0; pass < 8; pass += 1) {
      runtime.begin()
      tree = renderTree(component(currentProps))
      const ran = runtime.end()
      if (!runtime.isDirty() && ran === 0) break
    }
    return tree
  }
  rerender()
  return {
    get tree() {
      return tree
    },
    rerender,
    unmount() {
      runtime.unmount()
    },
    setProps(patch) {
      currentProps = { ...currentProps, ...patch }
      return rerender()
    },
  }
}

/** Parse one simple selector (tag + attribute tests) and test an element. */
function matchesSelector(node, selector) {
  const pattern = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:\[[^\]]*\])*)$/.exec(selector.trim())
  if (pattern === null) return false
  const [, tag, attributes] = pattern
  if (tag !== undefined && node.tagName !== tag.toUpperCase()) return false
  const attributePattern = /\[([^\]=*^$~|]+)(?:([*^$]?=)"([^"]*)")?\]/g
  let match
  while ((match = attributePattern.exec(attributes)) !== null) {
    const [, name, operator, expected] = match
    const value = node.getAttribute(name)
    if (value === null) return false
    if (operator === undefined) continue
    if (operator === '=' && value !== expected) return false
    if (operator === '*=' && !value.includes(expected)) return false
    if (operator === '^=' && !value.startsWith(expected)) return false
    if (operator === '$=' && !value.endsWith(expected)) return false
  }
  return true
}

/** Create one DOM-shaped element. */
function createElement(tag, options = {}) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: options.className ?? '',
    attributes: new Map(Object.entries(options.attrs ?? {})),
    children: [],
    parentElement: null,
    dataset: {},
    style: {},
    text: options.text ?? '',
    clickCount: 0,
    onclick: null,
    currentSrc: options.currentSrc,
    src: options.src,
    getAttribute(name) {
      if (name === 'class') return this.className
      return this.attributes.has(name) ? this.attributes.get(name) : null
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value))
    },
    hasAttribute(name) {
      return this.attributes.has(name)
    },
    get textContent() {
      return this.text + this.children.map((child) => child.textContent).join('')
    },
    append(...nodes) {
      for (const child of nodes) {
        child.parentElement = this
        this.children.push(child)
      }
    },
    appendChild(child) {
      this.append(child)
    },
    remove() {
      const parent = this.parentElement
      if (parent !== null) parent.children = parent.children.filter((child) => child !== this)
      this.parentElement = null
    },
    insertAdjacentElement(position, child) {
      if (position !== 'afterend') return null
      const parent = this.parentElement
      if (parent === null) return null
      child.parentElement = parent
      const index = parent.children.indexOf(this)
      parent.children.splice(index + 1, 0, child)
      return child
    },
    contains(candidate) {
      let cursor = candidate
      while (cursor !== null && cursor !== undefined) {
        if (cursor === this) return true
        cursor = cursor.parentElement
      }
      return false
    },
    closest(selector) {
      let cursor = this
      while (cursor !== null && cursor !== undefined) {
        if (cursor.nodeType === 1 && matchesSelector(cursor, selector)) return cursor
        cursor = cursor.parentElement
      }
      return null
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null
    },
    querySelectorAll(selector) {
      const found = []
      const walk = (current) => {
        for (const child of current.children) {
          if (matchesSelector(child, selector)) found.push(child)
          walk(child)
        }
      }
      walk(this)
      return found
    },
    getBoundingClientRect() {
      return { left: 100, top: 120, right: 180, bottom: 160, width: 80, height: 40, x: 100, y: 120 }
    },
    click() {
      this.clickCount += 1
      this.onclick?.({ target: this, preventDefault() {}, stopPropagation() {} })
    },
  }
  return node
}

/** A DOM-shaped fake that records listeners, styles and downloads. */
function createFakeDocument(globals) {
  const listeners = new Map()
  const styles = []
  const downloads = []
  const head = createElement('head')
  const body = createElement('body')
  const createElementFor = (tag) => {
    if (tag === 'canvas') {
      return {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
        toBlob: (callback, type) => callback(new Blob(['encoded'], { type })),
      }
    }
    const node = createElement(tag)
    if (tag === 'a') {
      node.click = () => {
        node.clickCount += 1
        downloads.push({
          name: node.download,
          href: node.href,
          blob: globals.url.map.get(node.href),
        })
      }
    }
    if (tag === 'style') node.remove = () => {}
    return node
  }
  return {
    head: { appendChild: (node) => head.append(node), append: (node) => head.append(node) },
    body: {
      append: (node) => body.append(node),
      appendChild: (node) => body.append(node),
    },
    createElement: createElementFor,
    addEventListener(type, callback, capture) {
      if (!listeners.has(type)) listeners.set(type, [])
      listeners.get(type).push({ callback, capture })
    },
    removeEventListener(type, callback, capture) {
      const entries = listeners.get(type) ?? []
      listeners.set(
        type,
        entries.filter((entry) => entry.callback !== callback || entry.capture !== capture),
      )
    },
    dispatch(type, event) {
      for (const entry of [...(listeners.get(type) ?? [])]) entry.callback(event)
    },
    listenerCount(type) {
      return (listeners.get(type) ?? []).length
    },
    injectedStyles: () => styles,
    styles: () => head.children.filter((child) => child.tagName === 'STYLE'),
    downloads: () => downloads,
    element: createElement,
  }
}

/** Platform globals the feature touches, with recording fakes. */
function createFakeGlobals() {
  const state = {
    texts: [],
    textCopies: 0,
    failTextCopy: false,
    writes: [],
    failImageCopy: false,
    fetchUrls: [],
    fetchResponses: new Map(),
    fetchFailures: new Set(),
    createdUrls: 0,
    revokedUrls: 0,
    urls: new Map(),
    timers: [],
    nextTimer: 0,
  }
  class ClipboardItem {
    constructor(items) {
      this.items = items
    }
  }
  class FakeImage {
    constructor() {
      this.naturalWidth = 40
      this.naturalHeight = 20
    }
    set src(value) {
      this._src = value
    }
    get src() {
      return this._src
    }
    decode() {
      return Promise.resolve()
    }
  }
  const url = {
    createObjectURL(blob) {
      state.createdUrls += 1
      const value = 'blob:fixture-' + state.createdUrls
      state.urls.set(value, blob)
      return value
    },
    revokeObjectURL(value) {
      state.revokedUrls += 1
      state.urls.delete(value)
    },
    map: state.urls,
  }
  async function fetch(urlValue) {
    state.fetchUrls.push(urlValue)
    if (state.fetchFailures.has(urlValue)) throw new Error('network down')
    const blob = state.fetchResponses.get(urlValue)
    if (blob === undefined) return { ok: false, status: 404, blob: async () => new Blob([]) }
    return { ok: true, status: 200, blob: async () => blob }
  }
  const navigator = {
    clipboard: {
      async write(items) {
        if (state.failImageCopy) throw new Error('clipboard denied')
        state.writes.push(items)
      },
    },
  }
  return {
    styleState: state,
    state,
    ClipboardItem,
    Image: FakeImage,
    url,
    fetch,
    navigator,
    setTimeout: (callback) => {
      state.nextTimer += 1
      state.timers.push({ id: state.nextTimer, callback })
      return state.nextTimer
    },
    clearTimeout: () => {},
  }
}

/** Fake primitives: Menu renders items as menuitem buttons, Toast as an alert. */
function createFakePrimitives(runtime, globals) {
  const h = runtime.react.createElement
  const Menu = (props) =>
    h(
      'div',
      {
        role: 'menu',
        'data-open': props.open,
        onClose: props.onClose,
        onSelect: props.onSelect,
        'data-anchor-rect': JSON.stringify(props.getAnchorRect()),
      },
      (props.items ?? []).map((item) => {
        if (item.type === 'label') return h('span', { key: item.id, role: 'presentation' }, item.text)
        if (item.type === 'separator') return h('span', { key: item.id, role: 'separator' })
        return h(
          'button',
          {
            key: item.id,
            type: 'button',
            role: 'menuitem',
            onClick: () => props.onSelect(item.id),
          },
          item.label,
        )
      }),
    )
  const Toast = (props) =>
    h(
      'div',
      { role: 'alert', 'data-tone': props.tone ?? 'none', onDone: props.onDone },
      props.text,
    )
  const icon = () => h('span', {})
  const writeClipboard = async (text) => {
    globals.state.textCopies += 1
    if (globals.state.failTextCopy) return false
    globals.state.texts.push(text)
    return true
  }
  return {
    Menu,
    Toast,
    writeClipboard,
    IconCopyOutlineRegular: icon,
    IconLinkOutlineRegular: icon,
    IconDownloadOutlineRegular: icon,
    IconFullscreenOutlineRegular: icon,
    IconFolderOpenRegular: icon,
    IconRightUpOutlineRegular: icon,
    IconTrashOutlineRegular: icon,
    IconWarningOutlineRegular: icon,
    IconCloseOutlineRegular: icon,
  }
}

/** Simple locale translator for one dictionary. */
function translator(dictionary) {
  return (key, params = {}) => {
    const template = dictionary[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_match, name) => String(params[name] ?? '{' + name + '}'))
  }
}

/** Load the merged client module with only attachment-actions built. */
function loadClientModule({ react, primitives, globals, fakeDocument, hostPaths }) {
  let loaded
  const windowObject = {
    __ModuleLoader__: {
      load(definition) {
        loaded = definition
      },
    },
    setTimeout: globals.setTimeout,
    clearTimeout: globals.clearTimeout,
  }
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-attachment-actions'],
    window: windowObject,
    document: fakeDocument,
    console,
    setTimeout: globals.setTimeout,
    clearTimeout: globals.clearTimeout,
    navigator: globals.navigator,
    ClipboardItem: globals.ClipboardItem,
    Image: globals.Image,
    URL: globals.url,
    fetch: globals.fetch,
    Blob,
    btoa,
    ...(hostPaths === undefined ? {} : { __DSH_HOST_PATHS__: hostPaths }),
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  const plugin = loaded.factory((id) => {
    if (id === 'react') return react
    if (id === '@deepseek-ai/dsh-client-ui-primitives') return primitives
    throw new Error('unexpected require ' + id)
  })
  return { registration: loaded, plugin }
}

/**
 * Build a mounted attachment-menu scenario.
 * @param {object} options - services, desktop paths and remote behavior.
 * @returns {object} scenario handle.
 */
function scenario(options = {}) {
  const globals = createFakeGlobals()
  const fakeDocument = createFakeDocument(globals)
  const reactRuntime = createFakeReact()
  const primitives = createFakePrimitives(reactRuntime, globals)
  for (const [url, blob] of Object.entries(options.images ?? {})) {
    globals.state.fetchResponses.set(url, blob)
  }
  for (const url of options.failingImages ?? []) globals.state.fetchFailures.add(url)
  if (options.failTextCopy === true) globals.state.failTextCopy = true
  if (options.failImageCopy === true) globals.state.failImageCopy = true
  const remoteCalls = []
  const services = {
    sessions: {
      scope: (sessionId) => options.scope?.(sessionId),
    },
    remote: {
      session: {
        openWorkspacePath: async (request) => {
          remoteCalls.push(request)
          if (options.remoteReject !== undefined) throw new Error(options.remoteReject)
          return options.remoteResult ?? { ok: true, value: { opened: true } }
        },
      },
    },
  }
  const localeRegistrations = []
  const registrations = []
  const { plugin } = loadClientModule({
    react: reactRuntime.react,
    primitives,
    globals,
    fakeDocument,
    hostPaths: options.hostPaths,
  })
  const ctx = {
    effect: (factory) => {
      const cleanup = factory()
      return () => {
        if (typeof cleanup === 'function') cleanup()
      }
    },
    get: (name) => services[name],
    locale: {
      register: (ns, dicts) => {
        localeRegistrations.push({ ns, dicts })
        return () => {}
      },
    },
    slots: {
      inject: (_slot, callback) => callback(),
      register: (entryOptions, component) => {
        registrations.push({ options: entryOptions, component })
        return () => {}
      },
    },
  }
  plugin.apply(ctx)
  const overlay = registrations.find((entry) => entry.options.name === 'shell.overlay')
  const language = options.language ?? 'zh'
  const t = translator(localeRegistrations[0].dicts[language])
  const harness = mountComponent(
    overlay.component,
    { t, ...overlay.options.inject() },
    reactRuntime,
  )
  return {
    plugin,
    harness,
    dom: fakeDocument,
    globals,
    services,
    remoteCalls,
    localeRegistrations,
    registrations,
    t,
  }
}

/** One synthetic context-menu event. */
function contextEvent(target, overrides = {}) {
  const event = {
    target,
    clientX: 640,
    clientY: 500,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      event.defaultPrevented = true
    },
    stopPropagation() {
      event.propagationStopped = true
    },
    stopImmediatePropagation() {
      event.propagationStopped = true
    },
    ...overrides,
  }
  return event
}

/** Await pending promise chains and rerender the overlay. */
async function settle(scenarioHandle = null, times = 3) {
  for (let index = 0; index < times; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  scenarioHandle?.harness.rerender()
}

const menuButton = (tree, label) =>
  findOne(tree, (element) => isMenuButton(element) && textOf(element) === label)
const menuItemIds = (tree) =>
  findAll(tree, isMenuButton).map((element) => textOf(element))

// ---------------------------------------------------------------------------
// 3. Attachment surface builders mirroring the host DOM
// ---------------------------------------------------------------------------

const BLOB_IMAGE = 'blob:http://127.0.0.1:3980/attachment-image'

/** Build a composer image thumbnail inside a rail item. */
function composerImage(dom, { name = 'photo.png', src = BLOB_IMAGE, includeRemove = true } = {}) {
  const session = dom.element('div', { attrs: { 'data-conversation-session': 's1' } })
  const card = dom.element('div', { attrs: { 'data-composer-card': '' } })
  const rail = dom.element('div', { className: 'srf2qa_rail' })
  const root = dom.element('div', { className: 'Mrat-G_root' })
  const list = dom.element('div', { className: 'Mrat-G_rail' })
  const item = dom.element('div', { className: 'Mrat-G_item' })
  const wrapper = dom.element('div', { className: 'srf2qa_imageItem' })
  const button = dom.element('button', {
    className: 'srf2qa_thumbnail',
    attrs: { type: 'button', title: 'image.openOriginal' },
  })
  const image = dom.element('img', { attrs: { src, alt: name }, src, currentSrc: src })
  button.append(image)
  wrapper.append(button)
  let remove = null
  if (includeRemove) {
    remove = dom.element('button', { className: 'srf2qa_remove', attrs: { 'aria-label': 'image.remove' } })
    wrapper.append(remove)
  }
  item.append(wrapper)
  list.append(item)
  root.append(list)
  rail.append(root)
  card.append(rail)
  session.append(card)
  return { session, card, rail, item, wrapper, button, image, remove }
}

/** Build a composer file card inside a rail item. */
function composerFile(
  dom,
  { name = 'notes.txt', meta = 'TXT 12 B', includeRemove = true, includeTitle = true } = {},
) {
  const session = dom.element('div', { attrs: { 'data-conversation-session': 's1' } })
  const card = dom.element('div', { attrs: { 'data-composer-card': '' } })
  const rail = dom.element('div', { className: 'srf2qa_rail' })
  const item = dom.element('div', { className: 'Mrat-G_item' })
  const fileCard = dom.element('div', {
    className: 'GjTS2W_card',
    ...(includeTitle ? { attrs: { title: name } } : {}),
  })
  const icon = dom.element('span', { className: 'GjTS2W_icon', attrs: { 'aria-hidden': 'true' } })
  const body = dom.element('span', { className: 'GjTS2W_body' })
  const nameNode = dom.element('span', { className: 'GjTS2W_name', text: name })
  const metaNode = dom.element('span', { className: 'GjTS2W_meta', text: meta })
  body.append(nameNode, metaNode)
  fileCard.append(icon, body)
  let remove = null
  if (includeRemove) {
    remove = dom.element('button', { className: 'GjTS2W_remove', attrs: { 'aria-label': 'file.remove' } })
    fileCard.append(remove)
  }
  item.append(fileCard)
  rail.append(item)
  card.append(rail)
  session.append(card)
  return { session, card, rail, item, fileCard, nameNode, metaNode, remove }
}

/** Build one message attachment row with one image frame. */
function messageImage(dom, { name = 'shot.png', src = BLOB_IMAGE, variant = 'single' } = {}) {
  const session = dom.element('div', { attrs: { 'data-conversation-session': 's1' } })
  const row = dom.element('div', { className: 'cJsG2q_attachmentRow', attrs: { 'data-message-attachments': 'true' } })
  const gallery = dom.element('div', { className: 'Nhu-QW_gallery', attrs: { 'data-align': 'end' } })
  const frame = dom.element('button', {
    className: 'Nhu-QW_frame',
    attrs: { type: 'button', 'data-variant': variant, title: 'image.openOriginal' },
  })
  const image = dom.element('img', { attrs: { src, alt: name }, src, currentSrc: src })
  frame.append(image)
  gallery.append(frame)
  row.append(gallery)
  session.append(row)
  return { session, row, gallery, frame, image }
}

/** Build one message attachment row with one file card. */
function messageFile(dom, { name = 'report.pdf', meta = 'PDF 1.2 MB' } = {}) {
  const session = dom.element('div', { attrs: { 'data-conversation-session': 's1' } })
  const row = dom.element('div', { className: 'cJsG2q_attachmentRow', attrs: { 'data-message-attachments': 'true' } })
  const card = dom.element('span', { className: 'cJsG2q_fileCard', attrs: { title: name } })
  const content = dom.element('span', { className: 'cJsG2q_fileContent' })
  const nameNode = dom.element('span', { className: 'cJsG2q_fileName', text: name })
  const metaNode = dom.element('span', { className: 'cJsG2q_fileMeta', text: meta })
  content.append(nameNode, metaNode)
  card.append(content)
  row.append(card)
  session.append(row)
  return { session, row, card, nameNode, metaNode }
}

/** Build the document-level original-image lightbox. */
function lightbox(dom, { name = 'photo.png', src = BLOB_IMAGE } = {}) {
  const backdrop = dom.element('div', {
    className: '_backdrop_19zw2_2',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'image.preview' },
  })
  const stage = dom.element('div', { className: '_stage_19zw2_9' })
  const mask = dom.element('div', { className: '_mask_19zw2_19', attrs: { 'aria-hidden': 'true' } })
  const image = dom.element('img', { className: '_image_19zw2_26', attrs: { src, alt: name }, src, currentSrc: src })
  const close = dom.element('button', { className: '_close_19zw2_37', attrs: { 'aria-label': 'image.closePreview' } })
  stage.append(mask, image, close)
  backdrop.append(stage)
  return { backdrop, stage, mask, image, close }
}

/** Build one trajectory/tool image thumbnail outside the message row. */
function galleryImage(dom, { name = 'render.png', src = BLOB_IMAGE } = {}) {
  const column = dom.element('div', { className: 'Nhu-QW_gallery', attrs: { 'data-align': 'start' } })
  const frame = dom.element('button', {
    className: 'Nhu-QW_frame',
    attrs: { type: 'button', 'data-variant': 'thumbnail' },
  })
  const image = dom.element('img', { attrs: { src, alt: name }, src, currentSrc: src })
  frame.append(image)
  column.append(frame)
  return { column, frame, image }
}

/** Build one generic dialog that is not the image lightbox. */
function genericDialog(dom) {
  const dialog = dom.element('div', { attrs: { role: 'dialog', 'aria-modal': 'true' } })
  const image = dom.element('img', { attrs: { src: 'https://example.com/preview.png' } })
  dialog.append(image)
  return { dialog, image }
}

// ---------------------------------------------------------------------------
// 4. Surface detection
// ---------------------------------------------------------------------------

await check('a composer image thumbnail is recognised with its remove control', () => {
  const { dom, plugin } = scenario()
  const surface = composerImage(dom)
  const hit = plugin.__test.findSurface(surface.image)
  assert(hit !== null, 'hit found')
  assert.equal(hit.kind, 'image')
  assert.equal(hit.surface, 'composer')
  assert.equal(hit.opener, surface.button, 'thumbnail is the lightbox opener')
  assert.equal(hit.remove, surface.remove, 'remove control resolved')
  assert.equal(hit.url, BLOB_IMAGE)
  assert.equal(hit.name, 'photo.png')
})

await check('the composer remove control keeps the native menu', () => {
  const { dom, plugin } = scenario()
  const surface = composerImage(dom)
  assert.equal(plugin.__test.findSurface(surface.remove), null)
})

await check('a composer file card is recognised', () => {
  const { dom, plugin } = scenario()
  const surface = composerFile(dom)
  const hit = plugin.__test.findSurface(surface.nameNode)
  assert(hit !== null, 'hit found')
  assert.equal(hit.kind, 'file')
  assert.equal(hit.surface, 'composer')
  assert.equal(hit.name, 'notes.txt')
  assert.equal(hit.meta, 'TXT 12 B')
  assert.equal(hit.remove, surface.remove)
})

await check('a composer card without a title cannot be resolved as a file', () => {
  const { dom, plugin } = scenario()
  const surface = composerFile(dom, { includeTitle: false })
  assert.equal(plugin.__test.findSurface(surface.nameNode), null)
})

await check('a message image frame is recognised inside its attachment row', () => {
  const { dom, plugin } = scenario()
  const surface = messageImage(dom)
  const hit = plugin.__test.findSurface(surface.image)
  assert(hit !== null, 'hit found')
  assert.equal(hit.kind, 'image')
  assert.equal(hit.surface, 'message')
  assert.equal(hit.opener, surface.frame)
  assert.equal(hit.name, 'shot.png')
})

await check('trajectory and tool thumbnails are recognised outside message rows', () => {
  const { dom, plugin } = scenario()
  const surface = galleryImage(dom)
  const hit = plugin.__test.findSurface(surface.image)
  assert(hit !== null, 'hit found')
  assert.equal(hit.kind, 'image')
  assert.equal(hit.surface, 'gallery')
  assert.equal(hit.opener, surface.frame)
})

await check('a message file card is recognised through its title', () => {
  const { dom, plugin } = scenario()
  const surface = messageFile(dom)
  const hit = plugin.__test.findSurface(surface.nameNode)
  assert(hit !== null, 'hit found')
  assert.equal(hit.kind, 'file')
  assert.equal(hit.surface, 'message')
  assert.equal(hit.name, 'report.pdf')
  assert.equal(hit.meta, 'PDF 1.2 MB')
  assert.equal(hit.remove, undefined)
})

await check('the original-image lightbox is recognised with its close control', () => {
  const { dom, plugin } = scenario()
  const surface = lightbox(dom)
  const hit = plugin.__test.findSurface(surface.image)
  assert(hit !== null, 'hit found')
  assert.equal(hit.kind, 'image')
  assert.equal(hit.surface, 'lightbox')
  assert.equal(hit.close, surface.close)
  assert.equal(hit.name, 'photo.png')
})

await check('a generic dialog keeps the native menu', () => {
  const { dom, plugin } = scenario()
  const surface = genericDialog(dom)
  assert.equal(plugin.__test.findSurface(surface.image), null)
})

await check('the conversation body is a valid menu scope', () => {
  const { dom, plugin } = scenario()
  const session = dom.element('div', { attrs: { 'data-conversation-session': 's1' } })
  const markdown = dom.element('div', { className: '_markdown' })
  session.append(markdown)
  assert.equal(plugin.__test.findSurface(markdown), null)
  assert.equal(plugin.__test.conversationSessionOf(markdown), 's1')
  const editor = dom.element('textarea', { attrs: { 'contenteditable': 'true' } })
  session.append(editor)
  assert.equal(plugin.__test.conversationSessionOf(editor), '')
  const card = dom.element('div', { attrs: { 'data-composer-card': '' } })
  session.append(card)
  assert.equal(plugin.__test.conversationSessionOf(card), '')
})

await check('plain markdown images keep the native menu', () => {
  const { dom, plugin } = scenario()
  const image = dom.element('img', { attrs: { src: 'https://example.com/a.png', alt: 'a' } })
  assert.equal(plugin.__test.findSurface(image), null)
})

await check('a text node resolves through its parent element', () => {
  const { dom, plugin } = scenario()
  const surface = messageFile(dom)
  const text = { nodeType: 3, parentElement: surface.nameNode }
  const hit = plugin.__test.findSurface(text)
  assert(hit !== null, 'hit found through the parent element')
  assert.equal(hit.name, 'report.pdf')
})

// ---------------------------------------------------------------------------
// 5. Menu composition and file names
// ---------------------------------------------------------------------------

await check('composer image menu offers copy, address, save, preview and remove', () => {
  const { dom, plugin, t } = scenario()
  const surface = composerImage(dom)
  const items = plugin.__test.menuItems(plugin.__test.findSurface(surface.image), t)
  const ids = plain(items.map((item) => item.id).filter(Boolean))
  assertEqual(ids, [
    'attachment',
    'copy-image',
    'copy-address',
    'save-image',
    'view-image',
    'separator-remove',
    'remove-attachment',
  ])
  assert(textOf({ type: 'label', props: { children: items[0].text } }).includes('photo.png'))
})

await check('desktop paths add copy-path and reveal rows to images', () => {
  const { dom, plugin, t } = scenario()
  const surface = composerImage(dom)
  const hit = { ...plugin.__test.findSurface(surface.image), path: 'D:\\pics\\photo.png' }
  const ids = plugin.__test.menuItems(hit, t).map((item) => item.id).filter(Boolean)
  assert(ids.includes('copy-path'), 'copy path row')
  assert(ids.includes('reveal-file'), 'reveal row')
  assert(ids.indexOf('separator-path') < ids.indexOf('copy-path'), 'path group is separated')
})

await check('lightbox menu offers copy, save and close but no preview row', () => {
  const { dom, plugin, t } = scenario()
  const surface = lightbox(dom)
  const ids = plugin.__test.menuItems(plugin.__test.findSurface(surface.image), t).map((item) => item.id)
  assert(ids.includes('close-preview'), 'close row')
  assert(!ids.includes('view-image'), 'no preview row inside the preview')
  assert(!ids.includes('remove-attachment'), 'no remove row for durable images')
})

await check('message file menu keeps only the copy rows', () => {
  const { dom, plugin, t } = scenario()
  const surface = messageFile(dom)
  const ids = plain(
    plugin.__test.menuItems(plugin.__test.findSurface(surface.nameNode), t)
      .map((item) => item.id)
      .filter(Boolean),
  )
  assertEqual(ids, ['attachment', 'copy-name', 'copy-info'])
})

await check('composer file menu adds save, path and remove rows when resolved', () => {
  const { dom, plugin, t } = scenario()
  const surface = composerFile(dom)
  const hit = {
    ...plugin.__test.findSurface(surface.nameNode),
    file: new Blob(['notes'], { type: 'text/plain' }),
    path: 'D:\\docs\\notes.txt',
  }
  const ids = plain(
    plugin.__test.menuItems(hit, t)
      .map((item) => item.id)
      .filter(Boolean),
  )
  assertEqual(ids, [
    'attachment',
    'copy-name',
    'save-file',
    'separator-path',
    'copy-path',
    'reveal-file',
    'open-file',
    'separator-remove',
    'remove-attachment',
  ])
})

await check('image download names keep or gain a matching extension', () => {
  const { plugin } = scenario()
  assert.equal(plugin.__test.imageFileName('photo.png', 'image/png', '图片'), 'photo.png')
  assert.equal(plugin.__test.imageFileName('photo', 'image/webp', '图片'), 'photo.webp')
  assert.equal(plugin.__test.imageFileName('a/b:c*?.png', 'image/png', '图片'), 'a_b_c__.png')
  assert(/^图片-\d+\.png$/.test(plugin.__test.imageFileName('', 'image/png', '图片')), 'fallback stem')
})

await check('host paths resolve only through the desktop bridge', () => {
  const file = new Blob(['x'], { type: 'image/png' })
  const web = scenario()
  assert.equal(web.plugin.__test.hostPathOf(file), undefined)
  const desktop = scenario({
    hostPaths: { pathFor: (candidate) => (candidate === file ? 'D:\\pics\\photo.png' : '') },
  })
  assert.equal(desktop.plugin.__test.hostPathOf(file), 'D:\\pics\\photo.png')
  const broken = scenario({
    hostPaths: {
      pathFor: () => {
        throw new Error('no bridge')
      },
    },
  })
  assert.equal(broken.plugin.__test.hostPathOf(file), undefined)
})

// ---------------------------------------------------------------------------
// 6. Behaviour through the real component
// ---------------------------------------------------------------------------

await check('right-clicking a composer image opens the menu and eats the event', () => {
  const handle = scenario()
  const surface = composerImage(handle.dom)
  const event = contextEvent(surface.image)
  handle.dom.dispatch('contextmenu', event)
  handle.harness.rerender()
  assert(event.defaultPrevented, 'native menu prevented')
  assert(event.propagationStopped, 'event stopped')
  const menu = findOne(handle.harness.tree, (element) => element.props?.role === 'menu')
  assertEqual(plain(JSON.parse(menu.props['data-anchor-rect'])).left, 640)
  const labels = menuItemIds(handle.harness.tree)
  assert(labels.includes('复制图片'))
  assert(labels.includes('复制图片地址'))
  assert(labels.includes('图片另存为…'))
  assert(labels.includes('查看大图'))
  assert(labels.includes('移除附件'))
})

await check('copying a draft image writes PNG bytes without a network fetch', async () => {
  const draftFile = new Blob(['png-bytes'], { type: 'image/png' })
  const handle = scenario({
    scope: () => ({
      get: (name) =>
        name === 'conversation'
          ? {
              input: { for: () => ({ snapshot: { attachmentIds: ['draft-1'] } }) },
              resolveDraftAttachments: () => [
                { kind: 'image', id: 'draft-1', previewUrl: BLOB_IMAGE, file: draftFile },
              ],
            }
          : undefined,
    }),
  })
  const surface = composerImage(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.copyImage')).props.onClick()
  await settle(handle)
  assertEqual(handle.globals.state.writes.length, 1, 'clipboard written once')
  const item = handle.globals.state.writes[0][0]
  assert(item.items['image/png'] instanceof Blob, 'PNG blob payload')
  assertEqual(item.items['image/png'], draftFile, 'draft bytes reused')
  assertEqual(handle.globals.state.fetchUrls.length, 0, 'no fetch for a draft file')
  assert(textOf(handle.harness.tree).includes(handle.t('toast.imageCopied')))
})

await check('copying a durable image fetches the blob and encodes PNG when needed', async () => {
  const jpeg = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
  const handle = scenario({ images: { [BLOB_IMAGE]: jpeg } })
  const surface = messageImage(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.copyImage')).props.onClick()
  await settle(handle)
  assertEqual(plain(handle.globals.state.fetchUrls), [BLOB_IMAGE])
  const item = handle.globals.state.writes[0][0]
  assertEqual(item.items['image/png'].type, 'image/png')
  assert(handle.globals.state.createdUrls >= 1, 'object URL used for decoding')
  assertEqual(handle.globals.state.revokedUrls, 1, 'decode URL released')
})

await check('an unsupported image clipboard falls back to copying the address', async () => {
  const png = new Blob(['png-bytes'], { type: 'image/png' })
  const handle = scenario({ images: { [BLOB_IMAGE]: png }, failImageCopy: true })
  const surface = messageImage(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.copyImage')).props.onClick()
  await settle(handle)
  assertEqual(handle.globals.state.writes.length, 0, 'no image write')
  assertEqual(handle.globals.state.texts.length, 1, 'address copied')
  assert(handle.globals.state.texts[0].startsWith('data:image/png;base64,'), 'data URL copied')
  assert(textOf(handle.harness.tree).includes(handle.t('toast.addressData')))
})

await check('copying an image address keeps http URLs verbatim', async () => {
  const url = 'https://example.com/render.png'
  const handle = scenario()
  const surface = galleryImage(handle.dom, { src: url })
  const image = handle.dom.element('img', { attrs: { src: url, alt: 'render' }, src: url, currentSrc: url })
  surface.frame.append(image)
  handle.dom.dispatch('contextmenu', contextEvent(image))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.copyAddress')).props.onClick()
  await settle(handle)
  assertEqual(plain(handle.globals.state.texts), [url])
  assert(textOf(handle.harness.tree).includes(handle.t('toast.addressCopied')))
})

await check('copying a local image address converts the blob to a data URL', async () => {
  const png = new Blob(['png-bytes'], { type: 'image/png' })
  const handle = scenario({ images: { [BLOB_IMAGE]: png } })
  const surface = messageImage(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.copyAddress')).props.onClick()
  await settle(handle)
  assertEqual(handle.globals.state.texts.length, 1)
  assert(handle.globals.state.texts[0].startsWith('data:image/png;base64,'))
  assert(textOf(handle.harness.tree).includes(handle.t('toast.addressData')))
})

await check('saving an image downloads the original bytes under its name', async () => {
  const jpeg = new Blob(['jpeg-bytes'], { type: 'image/jpeg' })
  const handle = scenario({ images: { [BLOB_IMAGE]: jpeg } })
  const surface = messageImage(handle.dom, { name: 'shot' })
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.saveImage')).props.onClick()
  await settle(handle)
  const downloads = handle.dom.downloads()
  assertEqual(downloads.length, 1)
  assertEqual(downloads[0].name, 'shot.jpg')
  assertEqual(downloads[0].blob, jpeg, 'original bytes saved')
  assert(textOf(handle.harness.tree).includes(handle.t('toast.saved', { name: 'shot.jpg' })))
})

await check('saving a draft file reuses its browser File name and bytes', async () => {
  const file = new Blob(['hello attachment'], { type: 'text/plain' })
  const handle = scenario({
    scope: () => ({
      get: (name) =>
        name === 'conversation'
          ? {
              input: { for: () => ({ snapshot: { attachmentIds: ['draft-2'] } }) },
              resolveDraftAttachments: () => [{ kind: 'file', id: 'draft-2', file }],
            }
          : undefined,
    }),
  })
  const surface = composerFile(handle.dom)
  // The fake file has no name until a File instance is used.
  const draft = new File(['hello attachment'], 'notes.txt', { type: 'text/plain' })
  handle.services.sessions.scope = () => ({
    get: (name) =>
      name === 'conversation'
        ? {
            input: { for: () => ({ snapshot: { attachmentIds: ['draft-2'] } }) },
            resolveDraftAttachments: () => [{ kind: 'file', id: 'draft-2', file: draft }],
          }
        : undefined,
  })
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.saveFile')).props.onClick()
  await settle(handle)
  const downloads = handle.dom.downloads()
  assertEqual(downloads.length, 1)
  assertEqual(downloads[0].name, 'notes.txt')
  assertEqual(downloads[0].blob, draft)
})

await check('copying a file path resolves the draft through the session scope', async () => {
  const draft = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  const handle = scenario({
    hostPaths: { pathFor: (candidate) => (candidate === draft ? 'D:\\docs\\notes.txt' : '') },
    scope: () => ({
      get: (name) =>
        name === 'conversation'
          ? {
              input: { for: () => ({ snapshot: { attachmentIds: ['draft-3'] } }) },
              resolveDraftAttachments: () => [{ kind: 'file', id: 'draft-3', file: draft }],
            }
          : undefined,
    }),
  })
  const surface = composerFile(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.copyFilePath')).props.onClick()
  await settle(handle)
  assertEqual(plain(handle.globals.state.texts), ['D:\\docs\\notes.txt'])
  assert(textOf(handle.harness.tree).includes(handle.t('toast.pathCopied')))
})

await check('reveal and open call the desktop path gesture', async () => {
  const draft = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  const handle = scenario({
    hostPaths: { pathFor: () => 'D:\\docs\\notes.txt' },
    scope: () => ({
      get: (name) =>
        name === 'conversation'
          ? {
              input: { for: () => ({ snapshot: { attachmentIds: ['draft-4'] } }) },
              resolveDraftAttachments: () => [{ kind: 'file', id: 'draft-4', file: draft }],
            }
          : undefined,
    }),
  })
  const surface = composerFile(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.revealFile')).props.onClick()
  await settle(handle)
  assertEqual(plain(handle.remoteCalls.at(-1)), { path: 'D:\\docs\\notes.txt', action: 'reveal' })
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.openFile')).props.onClick()
  await settle(handle)
  assertEqual(plain(handle.remoteCalls.at(-1)), { path: 'D:\\docs\\notes.txt' })
})

await check('copying a file name and a name+size descriptor works', async () => {
  const handle = scenario()
  const surface = messageFile(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.copyFileName')).props.onClick()
  await settle(handle)
  assertEqual(plain(handle.globals.state.texts), ['report.pdf'])
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  const secondLabels = menuItemIds(handle.harness.tree)
  assert(secondLabels.includes(handle.t('menu.copyFileInfo')), 'copy-info row present: ' + JSON.stringify(secondLabels))
  menuButton(handle.harness.tree, handle.t('menu.copyFileInfo')).props.onClick()
  await settle(handle)
  assertEqual(handle.globals.state.texts.at(-1), 'report.pdf (PDF 1.2 MB)')
})

await check('viewing a thumbnail clicks the host lightbox opener', async () => {
  const handle = scenario()
  const surface = messageImage(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.viewImage')).props.onClick()
  await settle(handle)
  assertEqual(surface.frame.clickCount, 1, 'host frame clicked')
})

await check('closing the lightbox clicks the host close control', async () => {
  const handle = scenario()
  const surface = lightbox(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.closePreview')).props.onClick()
  await settle(handle)
  assertEqual(surface.close.clickCount, 1, 'host close clicked')
})

await check('removing a draft attachment clicks the host remove control', async () => {
  const handle = scenario()
  const surface = composerFile(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.removeAttachment')).props.onClick()
  await settle(handle)
  assertEqual(surface.remove.clickCount, 1)
  assert(textOf(handle.harness.tree).includes(handle.t('toast.removed')))
})

await check('non-attachment targets keep the native menu and open nothing', () => {
  const handle = scenario()
  const image = handle.dom.element('img', { attrs: { src: 'https://example.com/a.png' } })
  const event = contextEvent(image)
  handle.dom.dispatch('contextmenu', event)
  handle.harness.rerender()
  assertEqual(event.defaultPrevented, false)
  assertEqual(findAll(handle.harness.tree, (element) => element.props?.role === 'menu').length, 0)
})

await check('a failing host path gesture reports a localized failure', async () => {
  const draft = new File(['hello'], 'notes.txt', { type: 'text/plain' })
  const handle = scenario({
    hostPaths: { pathFor: () => 'D:\\docs\\notes.txt' },
    remoteReject: 'denied',
    scope: () => ({
      get: (name) =>
        name === 'conversation'
          ? {
              input: { for: () => ({ snapshot: { attachmentIds: ['draft-5'] } }) },
              resolveDraftAttachments: () => [{ kind: 'file', id: 'draft-5', file: draft }],
            }
          : undefined,
    }),
  })
  const surface = composerFile(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.openFile')).props.onClick()
  await settle(handle)
  assert(textOf(handle.harness.tree).includes(handle.t('toast.failed', { message: 'denied' })))
})

await check('the menu closes through its onClose callback', () => {
  const handle = scenario()
  const surface = composerImage(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  const menu = findOne(handle.harness.tree, (element) => element.props?.role === 'menu')
  menu.props.onClose()
  handle.harness.rerender()
  assertEqual(findAll(handle.harness.tree, (element) => element.props?.role === 'menu').length, 0)
})

await check('the notice is dismissed through the host toast lifecycle', async () => {
  const handle = scenario()
  const surface = messageFile(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.nameNode))
  handle.harness.rerender()
  menuButton(handle.harness.tree, handle.t('menu.copyFileName')).props.onClick()
  await settle(handle)
  const toast = findOne(handle.harness.tree, (element) => element.props?.role === 'alert')
  assertEqual(toast.props['data-tone'], 'success')
  toast.props.onDone()
  handle.harness.rerender()
  assertEqual(findAll(handle.harness.tree, (element) => element.props?.role === 'alert').length, 0)
})

await check('the listener is registered once and released on unmount', () => {
  const handle = scenario()
  assertEqual(handle.dom.listenerCount('contextmenu'), 1)
  handle.harness.rerender()
  assertEqual(handle.dom.listenerCount('contextmenu'), 1, 'single listener across renders')
  handle.harness.unmount()
  assertEqual(handle.dom.listenerCount('contextmenu'), 0, 'listener released')
})

await check('English labels are used for the whole menu', () => {
  const handle = scenario({ language: 'en' })
  const surface = messageImage(handle.dom)
  handle.dom.dispatch('contextmenu', contextEvent(surface.image))
  handle.harness.rerender()
  const labels = menuItemIds(handle.harness.tree)
  assert(labels.includes('Copy image'))
  assert(labels.includes('Copy image address'))
  assert(labels.includes('Save image as…'))
  assert(labels.includes('View image'))
})

await check('the feature registers its overlay with the feature locale', () => {
  const handle = scenario()
  assertEqual(plain(handle.plugin.inject).sort(), [
    'locale',
    'remote',
    'remote.session',
    'sessions',
    'slots',
  ])
  assertEqual(handle.localeRegistrations[0].ns, 'attachmentActions')
  assertEqual(handle.registrations[0].options.name, 'shell.overlay')
  assertEqual(handle.registrations[0].options.id, 'attachment-actions.menu')
  assertEqual(handle.registrations[0].options.locale, 'attachmentActions')
})

await check('locale dictionaries contain identical key sets', () => {
  const handle = scenario()
  const { zh, en } = handle.localeRegistrations[0].dicts
  assertEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of Object.keys(zh)) {
    assertEqual(typeof zh[key], 'string', 'zh ' + key)
    assertEqual(typeof en[key], 'string', 'en ' + key)
    assert(zh[key].length > 0 && en[key].length > 0, 'non-empty ' + key)
  }
})

await check('queue dock attachments join the same attachment menu', () => {
  const body = featureSource('dsh-attachment-actions')
  assert(body.includes('function queueImageHit'), 'queue image surfaces')
  assert(body.includes('function queueFileHit'), 'queue file surfaces')
  assert(body.includes('data-queue-dock'), 'queue dock scope')
  assert(body.includes("surface: 'queue'"), 'queue surface label')
  assert(body.includes("hit.surface === 'queue'"), 'queue files expose the info entry')
  assert(body.includes('opener: image'), 'the queue thumbnail opens the host lightbox')
})

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

if (process.exitCode === 1) {
  console.error('\n' + checks + ' check(s) passed, some failed')
} else {
  console.log('\nall checks passed (' + checks + ')')
}
