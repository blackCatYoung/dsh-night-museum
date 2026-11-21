/**
 * Test harness: a Tiny-React-compatible hook renderer.
 *
 * Components are re-invoked from a keyed hook store on every flush, which is
 * enough for the plugin's useState/useEffect/useMemo/useRef usage.
 */

import assert from 'node:assert/strict'

const hookStores = new Map()
let typeCounts = new Map()
let currentInstance = null
let currentKey = ''
let dirty = false
let pendingEffects = []

function instanceState() {
  const key = currentKey
  let instance = hookStores.get(key)
  if (!instance) {
    instance = { hooks: [], effectDeps: new Map() }
    hookStores.set(key, instance)
  }
  instance.hi = 0
  return instance
}

export const React = {
  Fragment: 'Fragment',
  createElement(type, props, ...children) {
    const flat = []
    const push = (value) => {
      if (Array.isArray(value)) value.forEach(push)
      else if (value !== undefined) flat.push(value)
    }
    push(children)
    return { type, props: { ...(props || {}), children: flat.length ? flat : undefined } }
  },
  createContext() {
    return { Provider: 'Provider', Consumer: 'Consumer' }
  },
  useState(initial) {
    const instance = currentInstance
    const slot = instance.hi++
    if (!(slot in instance.hooks)) instance.hooks[slot] = typeof initial === 'function' ? initial() : initial
    return [
      instance.hooks[slot],
      (next) => {
        const value = typeof next === 'function' ? next(instance.hooks[slot]) : next
        if (Object.is(value, instance.hooks[slot])) return
        instance.hooks[slot] = value
        dirty = true
      },
    ]
  },
  useEffect(fn, deps) {
    const instance = currentInstance
    const slot = instance.hi++
    const key = `e${slot}`
    const previous = instance.effectDeps.get(key)
    const changed = !previous || !deps || deps.some((value, index) => !Object.is(value, previous[index]))
    instance.effectDeps.set(key, deps)
    if (changed) pendingEffects.push(fn)
  },
  useLayoutEffect() {},
  useMemo(fn) {
    currentInstance.hi++
    return fn()
  },
  useCallback(fn) {
    currentInstance.hi++
    return fn
  },
  useRef(value) {
    const instance = currentInstance
    const slot = instance.hi++
    if (!(slot in instance.hooks)) instance.hooks[slot] = { current: value }
    return instance.hooks[slot]
  },
}

function renderNode(element, out) {
  if (element === null || element === undefined || element === false || element === true) return
  if (Array.isArray(element)) {
    for (const child of element) renderNode(child, out)
    return
  }
  if (typeof element === 'string' || typeof element === 'number') {
    out.push({ text: String(element) })
    return
  }
  if (typeof element.type === 'function') {
    const token = element.type.name || 'anonymous'
    const occurrence = typeCounts.get(token) ?? 0
    typeCounts.set(token, occurrence + 1)
    currentKey = `${token}#${occurrence}`
    const previous = currentInstance
    currentInstance = instanceState()
    let rendered
    try {
      rendered = element.type(element.props || {})
    } finally {
      currentInstance = previous
    }
    renderNode(rendered, out)
    return
  }
  if (element.type === 'Fragment') {
    renderNode(element.props?.children, out)
    return
  }
  const children = []
  renderNode(element.props?.children, children)
  out.push({ type: element.type, props: element.props || {}, children })
}

export function textOf(node) {
  if (!node) return ''
  if (node.text !== undefined) return node.text
  return (node.children || []).map(textOf).join('')
}

export function htmlOf(node) {
  if (!node) return ''
  if (node.text !== undefined) return node.text
  if (!node.type) return (node.children || []).map(htmlOf).join('')
  const props = node.props || {}
  const attrs = Object.entries(props)
    .filter(([key, value]) => key !== 'children' && typeof value !== 'function' && value !== undefined && value !== false)
    .map(([key, value]) => ` ${key}="${String(value).replace(/"/g, '&quot;')}"`)
    .join('')
  return `<${node.type}${attrs}>${(node.children || []).map(htmlOf).join('')}</${node.type}>`
}

export function* walk(node) {
  if (!node) return
  yield node
  for (const child of node.children || []) yield* walk(child)
}

export function find(node, predicate) {
  for (const candidate of walk(node)) if (predicate(candidate)) return candidate
  return null
}

export function findByText(node, pattern) {
  return find(node, (candidate) => candidate.props?.onClick && pattern.test(textOf(candidate)))
}

export function findByProp(node, key, pattern) {
  return find(node, (candidate) => candidate.props && candidate.props[key] !== undefined && pattern.test(String(candidate.props[key])))
}

let root = null
let tree = null

export function setRoot(element) {
  root = element
  hookStores.clear()
}

export function clearHooks() {
  hookStores.clear()
}

export function getTree() {
  return tree
}

export async function flush(rounds = 40) {
  const startedAt = Date.now()
  for (let round = 0; round < rounds; round += 1) {
    dirty = false
    typeCounts = new Map()
    pendingEffects = []
    const out = []
    renderNode(root, out)
    tree = out
    const effects = pendingEffects.slice()
    pendingEffects = []
    for (const effect of effects) effect()
    await new Promise((resolve) => setTimeout(resolve, 12))
    if (!dirty && round > 2 && Date.now() - startedAt > 300) return tree
  }
  return tree
}

export async function click(node) {
  assert.ok(node, 'click target not found')
  await node.props.onClick({ preventDefault() {}, stopPropagation() {}, target: {}, currentTarget: {} })
  return flush()
}
