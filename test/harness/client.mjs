/**
 * Test harness: loads the plugin's Web client bundle plus its package-local
 * chunks (`client.*.js`) into one vm context, mimicking the DSH module loader.
 *
 * The loader protocol: each file calls window.__ModuleLoader__.load with
 * {id, chunk?, factory}; the entry uses require.async('./client.x.js') and
 * chunks sync-require 'dsh-night-museum/client.core.js'.
 */

import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { React } from './react.mjs'
import { hostFetch } from './host.mjs'

const storage = new Map()
export const styleTags = []
export const audio = { oscillators: 0, contexts: 0 }

class FakeAudioContext {
  constructor() {
    this.state = 'running'
    this.currentTime = 0
    this.destination = {}
    audio.contexts += 1
  }
  resume() { return Promise.resolve() }
  createOscillator() {
    audio.oscillators += 1
    return { type: '', frequency: { value: 0 }, connect() {}, start() {}, stop() {} }
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} }
  }
}

const documentStub = {
  head: { append(tag) { styleTags.push(tag) } },
  body: {},
  createElement(tag) {
    return { tagName: tag, dataset: {}, textContent: '', style: {} }
  },
  querySelector() { return null },
  addEventListener() {},
  removeEventListener() {},
}

const windowStub = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
  },
  addEventListener() {},
  removeEventListener() {},
  AudioContext: FakeAudioContext,
  devicePixelRatio: 2,
}

const registry = new Map()
windowStub.__ModuleLoader__ = {
  load(definition) {
    const key = definition.chunk ? `${definition.id}/${definition.chunk}` : definition.id
    registry.set(key, definition.factory)
  },
}

const sandbox = {
  window: windowStub,
  document: documentStub,
  console,
  // poll fast (2s page / 12s overlay), but keep the long-lived toasts alive
  setTimeout: (fn, ms) => setTimeout(fn, ms === 2000 || ms === 12000 ? 5 : ms >= 4000 ? 60000 : ms),
  clearTimeout,
  setInterval: () => 0,
  clearInterval: () => {},
  fetch: hostFetch,
  URL,
  Math,
  Date,
  JSON,
  Set,
  Map,
  Promise,
  Error,
  String,
  Number,
  Object,
  Array,
  Intl,
}
sandbox.globalThis = sandbox
const context = vm.createContext(sandbox)

const cache = new Map()

function makeRequire(ownerId) {
  const req = (spec) => {
    if (spec === 'react') return React
    if (cache.has(spec)) return cache.get(spec)
    const factory = registry.get(spec)
    if (!factory) throw new Error(`require(${spec}) from ${ownerId} was not loaded`)
    const value = factory(makeRequire(spec))
    cache.set(spec, value)
    return value
  }
  req.async = async (spec) => {
    const file = String(spec).replace(/^\.\//, '')
    const id = `dsh-night-museum/${file}`
    if (!cache.has(id)) {
      if (!registry.has(id)) {
        const source = await readFile(new URL(`../../lib/${file}`, import.meta.url), 'utf8')
        vm.runInContext(source, context, { filename: `lib/${file}` })
      }
      const factory = registry.get(id)
      if (!factory) throw new Error(`chunk ${file} did not register itself`)
      const value = factory(makeRequire(id))
      cache.set(id, value)
    }
    return cache.get(id)
  }
  return req
}

const entrySource = await readFile(new URL('../../lib/client.js', import.meta.url), 'utf8')
vm.runInContext(entrySource, context, { filename: 'lib/client.js' })

const entryFactory = registry.get('dsh-night-museum')
if (!entryFactory) throw new Error('client entry did not register')
export const plugin = entryFactory(makeRequire('dsh-night-museum'))

export { windowStub, storage }
