/**
 * Test harness: real host routes from lib/index.js behind a fetch-shaped
 * bridge, plus a throwaway DSH_HOME and a fake sessionController.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const home = await mkdtemp(path.join(os.tmpdir(), 'nm-client-'))
process.env.DSH_HOME = home

const routes = new Map()

function makeSessions() {
  const sessions = new Map()
  const prompts = []
  function ensure(id, cwd) {
    let session = sessions.get(id)
    if (!session) {
      session = { id, cwd: cwd ?? `/tmp/${id}`, cursor: 0, records: [], running: false, cancelled: false, queue: [] }
      sessions.set(id, session)
    }
    return session
  }
  return {
    prompts,
    sessions,
    controller: {
      async list() {
        return {
          items: [
            { sessionId: 's-one', cwd: '/tmp/ws-one', updatedAt: 3, running: false, blank: false, projections: { values: { title: '一号会话' } } },
            { sessionId: 's-two', cwd: '/tmp/ws-two', updatedAt: 2, running: false, blank: true },
          ],
        }
      },
      async create(request) {
        const id = `fresh-${sessions.size + 1}`
        ensure(id, request.cwd ?? `/tmp/${request.workspaceId ?? 'ws'}`)
        return { sessionId: id }
      },
      async prompt(request, signal) {
        const session = ensure(request.sessionId)
        prompts.push({ sessionId: request.sessionId, text: request.content?.[0]?.text ?? '' })
        session.queue = [{ rpcId: request.requestId }]
        session.running = true
        setTimeout(() => {
          session.cursor += 1
          session.queue = []
        }, 10)
        setTimeout(() => {
          session.running = false
          if (session.cancelled) return
          session.cursor += 1
          session.records.push({ seq: session.cursor, type: 'assistant/message', text: 'done' })
        }, 40)
        signal?.throwIfAborted()
        return { accepted: true }
      },
      async state({ sessionId }) {
        const session = ensure(sessionId)
        return { cursor: session.cursor, active: true, running: session.queue.length > 0, queue: session.queue, pendingInput: [] }
      },
      async wait({ sessionId, afterSeq = 0, timeoutMs = 5000 }) {
        const session = ensure(sessionId)
        const started = Date.now()
        for (;;) {
          const fresh = session.records.filter((record) => record.seq > afterSeq)
          if (fresh.length > 0) return { reason: 'idle', state: { cursor: session.cursor }, output: { records: fresh } }
          // a finished turn with nothing new is idle, exactly like the real service
          if (!session.running) return { reason: 'idle', state: { cursor: session.cursor }, output: { records: [] } }
          if (Date.now() - started > timeoutMs) return { reason: 'timeout', state: { cursor: session.cursor }, output: { records: [] } }
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
      },
      async cancel({ sessionId }) {
        ensure(sessionId).cancelled = true
        return { accepted: true }
      },
    },
  }
}

export const hostSessions = makeSessions()

export const hostCtx = {
  connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } },
  sessionController: hostSessions.controller,
  workspaceRegistry: {
    list: () => [
      { id: 'ws-one', path: '/tmp/ws-one', title: '一号工作区', sessionIds: [] },
      { id: 'ws-two', path: '/tmp/ws-two', title: '二号工作区', sessionIds: [] },
    ],
  },
  effect(fn) { fn(); return { dispose() {} } },
}

const host = await import('../../lib/index.js')
host.apply(hostCtx, {})

export function ctxSwitch(controller) {
  hostCtx.sessionController = controller
}

let stateOverride = null
export function setStateOverride(value) {
  stateOverride = value
}

export async function hostState() {
  const response = await hostFetch('/api/night-museum/state')
  return response.json()
}

export async function waitHost(check, label, timeout = 15000) {
  const started = Date.now()
  for (;;) {
    const value = await hostState()
    if (check(value)) return value
    if (Date.now() - started > timeout) throw new Error(`host timeout: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
}

export async function hostFetch(url, init = {}) {
  const pathname = String(url).replace(/^https?:\/\/[^/]+/, '')
  const route = routes.get(pathname)
  if (!route) return { ok: false, status: 404, async json() { return {} } }
  if (globalThis.__log) console.log('FETCH', pathname)
  const request = new Request(`http://127.0.0.1${pathname}`, init)
  const response = await route.fetch(request)
  const text = await response.text()
  const payload = JSON.parse(text)
  const data = stateOverride && pathname.endsWith('/state') ? { ...payload, ...stateOverride } : payload
  return { ok: response.ok, status: response.status, async json() { return data }, async text() { return JSON.stringify(data) } }
}

export async function disposeHome() {
  await rm(home, { recursive: true, force: true })
}
