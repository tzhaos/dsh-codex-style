/**
 * Checks for the merged settings shell: the single Settings → Codex Style
 * section, its per-feature tabs, the shared enable switch and its locale copy.
 *
 * The shipped bundle is loaded with only the shell feature built (the bundle's
 * test filter), rendered through a miniature React/hooks runtime, and driven by
 * clicking the elements the real section renders.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { FEATURE_ORDER, FEATURE_GROUPS } from '../scripts/build-client.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8')
const clientSource = read('client.js')
const manifest = JSON.parse(read('package.json'))

let checks = 0

/** Run one named check. */
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

/** Flatten rendered text. */
function textOf(element) {
  if (element === null || element === undefined) return ''
  if (typeof element === 'string' || typeof element === 'number') return String(element)
  if (Array.isArray(element)) return element.map(textOf).join('')
  return textOf(element.props?.children)
}

/** Find every rendered element matching a predicate. */
function findAll(root, predicate) {
  const found = []
  const visit = (node) => {
    if (node === null || node === undefined || typeof node !== 'object') return
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    if (predicate(node)) found.push(node)
    visit(node.props?.children)
  }
  visit(root)
  return found
}

/** Find one rendered element matching a predicate. */
function findOne(root, predicate) {
  const matches = findAll(root, predicate)
  assert(matches.length >= 1, 'expected one match, found ' + matches.length)
  return matches[0]
}

/**
 * Miniature React runtime: createElement, hooks and function components.
 * @returns {{ React: object, render: (component: Function, props: object) => object }} runtime.
 */
function createRuntime() {
  const instances = new Map()
  let current = null

  const React = {
    createElement(type, props, ...children) {
      const childList = children.length === 0 ? undefined : children.length === 1 ? children[0] : children
      return { type, props: { ...(props ?? {}), children: childList } }
    },
    useState(initial) {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        instance.hooks[index] = typeof next === 'function' ? next(instance.hooks[index]) : next
      }
      return [instance.hooks[index], set]
    },
    useRef(initial) {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = { current: initial }
      return instance.hooks[index]
    },
    useId() {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = 'id-' + index + '-' + instances.size
      return instance.hooks[index]
    },
    useEffect(factory) {
      const cleanup = factory()
      return cleanup
    },
    Component: class FakeComponent {
      constructor(props) {
        this.props = props
        this.state = {}
      }

      setState(next) {
        this.state = { ...this.state, ...next }
      }
    },
  }

  /** Render one node tree, invoking function components with hook context. */
  function renderNode(node) {
    if (node === null || node === undefined) return node
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(renderNode)
    if (typeof node.type === 'function') {
      let instance = instances.get(node.type)
      if (instance === undefined) {
        instance = { hooks: [], index: 0 }
        instances.set(node.type, instance)
      }
      instance.index = 0
      const previous = current
      current = instance
      const output = node.type(node.props)
      current = previous
      return renderNode(output)
    }
    return { type: node.type, props: { ...node.props, children: renderNode(node.props.children) } }
  }

  return {
    React,
    render(component, props) {
      return renderNode(React.createElement(component, props))
    },
  }
}

/**
 * Load the shipped bundle with only the settings shell built.
 * @param {object} React - miniature React runtime.
 * @returns {object} loaded bundle and mount helpers.
 */
function loadBundle(React, seedStorage = {}) {
  const registrations = []
  const storage = new Map(Object.entries(seedStorage))
  const styles = []
  const sandbox = {
    __DSH_CODEX_STYLE_FEATURES__: ['dsh-codex-style.settings'],
    window: {
      __ModuleLoader__: { load: (definition) => registrations.push(definition) },
      localStorage: {
        getItem: (key) => storage.has(key) ? storage.get(key) : null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    },
    document: {
      createElement: () => ({ dataset: {}, style: {}, textContent: '', remove() {} }),
      head: { appendChild: (tag) => styles.push(tag) },
      querySelector: () => null,
    },
    console,
  }
  vm.runInNewContext(clientSource, sandbox, { filename: 'client.js' })
  assert.equal(registrations.length, 1, 'one bundle registration')
  const module = registrations[0].factory((specifier) => {
    if (specifier === 'react') return React
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {
      Switch: ({ checked, label, onChange }) => React.createElement('button', { role: 'switch', 'aria-checked': String(checked), 'aria-label': label, onClick: () => onChange(!checked) }),
    }
    if (specifier === 'react-dom') return { createPortal: (node) => node }
    throw new Error('unexpected require ' + specifier)
  })
  return { module, sandbox, storage, styles, registration: registrations[0] }
}

/**
 * Mount the settings shell on a fake client context.
 * @returns {object} mount, dictionaries, render helpers and captured state.
 */
function mount(language = 'zh', seedStorage = {}) {
  const runtime = createRuntime()
  const loaded = loadBundle(runtime.React, seedStorage)
  const dictionaries = {}
  const registered = []
  const effects = []
  let activeLanguage = language

  const ctx = {
    effect(factory) { effects.push(factory()) },
    locale: {
      register(namespace, dicts) { dictionaries[namespace] = dicts },
      bind(namespace) {
        return (key, vars) => {
          const dict = (dictionaries[namespace] ?? {})[activeLanguage] ?? {}
          let value = dict[key]
          if (typeof value !== 'string') return key
          if (vars !== undefined) {
            for (const [name, replacement] of Object.entries(vars)) value = value.split('{' + name + '}').join(String(replacement))
          }
          return value
        }
      },
    },
    slots: {
      inject(name, callback) { return callback() },
      register(options, component) { registered.push({ options, component }); return () => {} },
    },
  }

  loaded.module.apply(ctx)
  const section = registered.find((entry) => entry.options.name === 'settings.section')
  assert(section !== undefined, 'settings.section registered')
  const t = ctx.locale.bind('codexStyle')

  return {
    module: loaded.module,
    dictionaries,
    storage: loaded.storage,
    styles: loaded.styles,
    section,
    effects,
    t,
    setLanguage(next) { activeLanguage = next },
    render() { return runtime.render(section.component, { t }) },
  }
}

const tabsOf = (tree) => findAll(tree, (node) => node.props?.role === 'tab')
const cardsOf = (tree) => findAll(tree, (node) => node.props?.['data-feature'])
const switchOf = (node) => findOne(node, (item) => item.props?.role === 'switch')
const selectGroup = (mounted, id) => { const i = FEATURE_GROUPS.findIndex((group) => group.id === id); tabsOf(mounted.render())[i].props.onClick(); return mounted.render() }

await check('settings registers the Codex Workbench section in both locales', () => {
 const mounted=mount(); assert.equal(mounted.section.options.id,'codex-style'); assert.equal(mounted.section.options.label(),'Codex 工作台')
 mounted.setLanguage('en'); assert.equal(mounted.section.options.label(),'Codex Workbench')
})
await check('all capabilities have bilingual copy and exactly one task group', () => {
 const mounted=mount(); const ids=FEATURE_GROUPS.flatMap(group=>group.features.map(feature=>feature.id))
 assert.equal(new Set(ids).size,FEATURE_ORDER.length)
 for(const lang of ['zh','en'])for(const id of ids)for(const suffix of ['title','summary','note'])assert.equal(typeof mounted.dictionaries.codexStyle[lang]['feature.'+id+'.'+suffix],'string')
})
await check('task groups replace the old one-tab-per-package navigation', () => {
 const mounted=mount(); const tree=mounted.render(); assert.equal(tabsOf(tree).length,5)
 assert.equal(textOf(tabsOf(tree)[0]),'会话与导航')
 assert.deepEqual(cardsOf(tree).map(card=>card.props['data-feature']),FEATURE_GROUPS[0].features.map(feature=>feature.id))
})
await check('composer capabilities share a page and retain independent switches', () => {
 const mounted=mount(); const tree=selectGroup(mounted,'composer'); const cards=cardsOf(tree)
 assert.equal(cards.length,8)
 const queue=cards.find(card=>card.props['data-feature']==='dsh-queue-withdraw')
 switchOf(queue).props.onClick()
 assert.deepEqual(JSON.parse(mounted.storage.get('dsh.codexStyle.features')),{'dsh-queue-withdraw':false})
 const updated=cardsOf(mounted.render()).find(card=>card.props['data-feature']==='dsh-queue-withdraw')
 assert.equal(switchOf(updated).props['aria-checked'],'false')
})
await check('keyboard arrows and Home/End navigate task groups', () => {
 const mounted=mount(); const event=(key)=>({key,preventDefault(){}})
 tabsOf(mounted.render())[0].props.onKeyDown(event('ArrowRight'))
 assert.equal(tabsOf(mounted.render())[1].props['aria-selected'],'true')
 tabsOf(mounted.render())[1].props.onKeyDown(event('End'))
 assert.equal(tabsOf(mounted.render()).at(-1).props['aria-selected'],'true')
 tabsOf(mounted.render()).at(-1).props.onKeyDown(event('ArrowRight'))
 assert.equal(tabsOf(mounted.render())[0].props['aria-selected'],'true')
})
await check('tab and panel ARIA references follow the selected task group', () => {
 const mounted=mount(); const tree=selectGroup(mounted,'content'); const tab=tabsOf(tree)[2]
 const panel=findOne(tree,node=>node.props?.role==='tabpanel')
 assert.equal(panel.props['aria-labelledby'],tab.props.id); assert.equal(tab.props['aria-controls'],panel.props.id)
})
await check('a malformed preference document keeps capabilities enabled', () => {
 const mounted=mount('zh',{'dsh.codexStyle.features':'{bad json'})
 assert(cardsOf(mounted.render()).every(card=>switchOf(card).props['aria-checked']==='true'))
})
await check('legacy quick-fork preferences migrate without re-enabling its selection actions', () => {
 const mounted=mount('zh',{'dsh.codexStyle.features':JSON.stringify({'dsh-quick-fork':false})})
 const quotes=cardsOf(selectGroup(mounted,'composer')).find(card=>card.props['data-feature']==='dsh-selection-quotes')
 assert.equal(switchOf(quotes).props['aria-checked'],'false')
 const toolbar=cardsOf(selectGroup(mounted,'content')).find(card=>card.props['data-feature']==='dsh-selection-toolbar')
 assert.equal(switchOf(toolbar).props['aria-checked'],'false')
})
await check('explicit selection preferences override the legacy umbrella toggle', () => {
 const mounted=mount('zh',{'dsh.codexStyle.features':JSON.stringify({'dsh-quick-fork':false,'dsh-selection-quotes':true})})
 const quotes=cardsOf(selectGroup(mounted,'composer')).find(card=>card.props['data-feature']==='dsh-selection-quotes')
 assert.equal(switchOf(quotes).props['aria-checked'],'true')
})
await check('restart guidance appears once across the grouped capability cards', () => {
 const mounted=mount(); const tree=selectGroup(mounted,'composer')
 assert.equal(findAll(tree,node=>node.props?.className==='dshcs-restart').length,1)
})
await check('failure badges belong to the task group and the affected capability', () => {
 const mounted=mount('zh',{'dsh.codexStyle.failures':JSON.stringify({'dsh-queue-withdraw':{state:'failed',phase:'apply',message:'queue boom',at:1}})})
 let tree=mounted.render(); assert.equal(findAll(tabsOf(tree)[1],node=>node.props?.className==='dshcs-tabBadge').length,1)
 tree=selectGroup(mounted,'composer'); const queue=cardsOf(tree).find(card=>card.props['data-feature']==='dsh-queue-withdraw')
 assert(textOf(queue).includes('queue boom')); assert.equal(findAll(tree,node=>node.props?.className==='dshcs-alert').length,1)
})
await check('quarantined and skipped states retain their own labels', () => {
 for(const [id,state,group] of [['dsh-hover-polish','quarantined','interaction'],['dsh-quick-fork','skipped','panels']]){
 const mounted=mount('en',{'dsh.codexStyle.failures':JSON.stringify({[id]:{state,phase:'dependency',message:'dependency unavailable',at:1}})})
 const tree=selectGroup(mounted,group); const alert=findOne(tree,node=>node.props?.className==='dshcs-alert')
 assert.equal(alert.props['data-state'],state); assert(textOf(alert).includes('dependency unavailable'))
 }
})
await check('a healthy task group contains no failure alert', () => {
 const mounted=mount(); assert.equal(findAll(mounted.render(),node=>node.props?.className==='dshcs-alert').length,0)
})
console.log('\n'+(process.exitCode===1?'some checks failed':'all checks passed ('+checks+')'))
