/**
 * Host-half smoke test for dsh-night-museum.
 *
 * Runs lib/index.js against a fake cordis context and a scripted
 * sessionController, then walks every route like the Web UI would:
 * list sessions → create exhibits → reorder → start → poll → stop.
 *
 *   node test/smoke.mjs
 *
 * Uses a throwaway DSH_HOME so the real gallery is never touched.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const home = await mkdtemp(path.join(os.tmpdir(), 'nm-home-'))
process.env.DSH_HOME = home

const { apply } = await import('../lib/index.js')

/* ------------------------------------------------------ fake session host */

/** One scripted session: a turn takes `latency` ms, then yields one record. */
function makeSessions({ latency = 120, gate = false } = {}) {
  let seq = 0
  const sessions = new Map()
  const prompts = []

  function ensure(id, cwd) {
    let session = sessions.get(id)
    if (!session) {
      session = {
        id,
        cwd: cwd ?? `/tmp/${id}`,
        cursor: 0,
        records: [],
        running: false,
        cancelled: false,
        queue: [],
        pendingInput: [],
      }
      sessions.set(id, session)
    }
    return session
  }

  /** Admit the prompt (cursor moves, queue drains), then finish the turn later. */
  function runTurn(session, text, signal) {
    session.running = true
    session.queue = [{ rpcId: 'pending' }]
    session.onAbort = () => {
      session.cancelled = true
      session.running = false
      session.queue = []
      session.abort?.()
    }
    signal?.addEventListener('abort', session.onAbort, { once: true })

    setTimeout(() => {
      if (session.cancelled) return
      session.cursor += 1 // the prompt itself lands in history
      session.queue = []
      session.admitted = session.cursor
    }, 20)

    session.finish = new Promise((resolve) => {
      session.abort = () => resolve('aborted')
      setTimeout(() => {
        if (session.cancelled) return resolve('aborted')
        session.cursor += 1
        session.records.push({ seq: session.cursor, type: 'assistant/message', text })
        session.running = false
        resolve('done')
      }, latency)
    })
  }

  /** Admit the prompt, then stop and ask a question until answer() is called. */
  function askTurn(session, text, signal) {
    session.running = true
    session.queue = [{ rpcId: 'pending' }]
    session.onAbort = () => {
      session.cancelled = true
      session.running = false
      session.queue = []
      session.pendingInput = []
      session.release?.()
      session.abort?.()
    }
    signal?.addEventListener('abort', session.onAbort, { once: true })

    setTimeout(() => {
      if (session.cancelled) return
      session.cursor += 1 // the prompt itself lands in history
      session.queue = []
      session.pendingInput = ['question']
      session.finish = new Promise((resolve) => {
        session.answer = () => {
          session.pendingInput = []
          resolve('answered')
        }
        session.release = () => resolve('aborted')
      }).then((why) => {
        session.finish = null
        session.answer = null
        session.release = null
        if (session.cancelled || why === 'aborted') return
        session.cursor += 1
        session.records.push({ seq: session.cursor, type: 'assistant/message', text: `按你的回应完成：${text}` })
        session.running = false
      })
    }, 20)
  }

  const controller = {
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
      signal?.throwIfAborted()
      const session = ensure(request.sessionId)
      session.cancelled = false
      prompts.push({ sessionId: request.sessionId, text: request.content?.[0]?.text ?? '', at: Date.now() })
      const body = request.content?.[0]?.text ?? ''
      if (gate) askTurn(session, body, signal)
      else runTurn(session, body, signal)
      signal?.throwIfAborted()
      return { accepted: true }
    },
    async state({ sessionId }) {
      const session = ensure(sessionId)
      return {
        cursor: session.cursor,
        active: true,
        running: session.running,
        queue: session.queue,
        pendingInput: session.pendingInput,
      }
    },
    async wait({ sessionId, afterSeq = 0, timeoutMs = 5000 }) {
      const session = ensure(sessionId)
      if (session.pendingInput.length > 0) {
        return {
          reason: 'input-required',
          state: { cursor: session.cursor, pendingInput: session.pendingInput },
          output: { records: [], truncated: false },
        }
      }
      if (session.finish) await session.finish
      const fresh = session.records.filter((record) => record.seq > afterSeq)
      return { reason: 'idle', state: { cursor: session.cursor }, output: { records: fresh, truncated: false } }
    },
    async cancel({ sessionId }) {
      const session = ensure(sessionId)
      session.cancelled = true
      session.running = false
      session.pendingInput = []
      clearTimeout(session.timer)
      session.release?.()
      return { accepted: true }
    },
  }

  return { controller, prompts, sessions, seq: () => seq, answer: (id) => sessions.get(id)?.answer?.() }
}

/* --------------------------------------------------------- fake cordis ctx */

const routes = new Map()
const disposers = []
const sessions = makeSessions()

const ctx = {
  connection: {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
  },
  sessionController: sessions.controller,
  workspaceRegistry: {
    list: () => [
      { id: 'ws-one', path: '/tmp/ws-one', title: '一号工作区', sessionIds: [] },
      { id: 'ws-two', path: '/tmp/ws-two', title: '二号工作区', sessionIds: [] },
    ],
  },
  effect(fn) {
    const dispose = fn()
    disposers.push(dispose)
    return { dispose }
  },
}

apply(ctx, {})

/* ----------------------------------------------------------------- helpers */

async function call(method, routePath, body) {
  const route = routes.get(routePath)
  assert.ok(route, `route not registered: ${routePath}`)
  assert.ok(route.methods.includes(method), `${routePath} does not accept ${method}`)
  const request = new Request(`http://127.0.0.1${routePath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const response = await route.fetch(request)
  const data = await response.json()
  return { status: response.status, data }
}

const get = (p) => call('GET', p)
const post = (p, body) => call('POST', p, body)

async function waitFor(check, label, timeout = 15000) {
  const started = Date.now()
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() - started > timeout) throw new Error(`timeout waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 120))
  }
}

/* -------------------------------------------------------------------- tests */

const results = []
function step(name, fn) {
  return (async () => {
    try {
      await fn()
      results.push({ name, ok: true })
      console.log(`  ✓ ${name}`)
    } catch (error) {
      results.push({ name, ok: false, error: error?.message ?? String(error) })
      console.log(`  ✗ ${name}\n      ${error?.stack ?? error}`)
    }
  })()
}

console.log('dsh-night-museum host smoke test')
console.log(`  DSH_HOME=${home}`)

await step('routes registered', () => {
  assert.deepEqual(
    [...routes.keys()].sort(),
    ['/api/night-museum/exhibit', '/api/night-museum/run', '/api/night-museum/session', '/api/night-museum/sessions', '/api/night-museum/state'],
  )
})

let state
await step('GET /state on a fresh home', async () => {
  const { status, data } = await get('/api/night-museum/state')
  assert.equal(status, 200)
  assert.equal(data.ok, true)
  assert.deepEqual(data.exhibits, [])
  assert.equal(typeof data.peak, 'boolean')
  assert.equal(data.run.running, false)
})

await step('GET /sessions maps cwd to workspace and sorts by updatedAt', async () => {
  const { data } = await get('/api/night-museum/sessions')
  assert.equal(data.ok, true)
  assert.equal(data.sessions.length, 2)
  assert.equal(data.sessions[0].id, 's-one')
  assert.equal(data.sessions[0].workspaceId, 'ws-one')
  assert.equal(data.sessions[0].title, '一号会话')
  assert.equal(data.sessions[1].workspaceId, 'ws-two')
  assert.equal(data.sessions[1].title, '空白会话')
  assert.deepEqual(data.workspaces.map((workspace) => workspace.id), ['ws-one', 'ws-two'])
})

const ids = {}
await step('create exhibits (existing x2 same session, new x1)', async () => {
  const a = await post('/api/night-museum/exhibit', {
    action: 'create',
    exhibit: { prompt: '修复登录页的提交按钮', mode: 'existing', sessionId: 's-one', sessionTitle: '一号会话', workspaceId: 'ws-one' },
  })
  assert.equal(a.data.ok, true)
  assert.equal(a.data.exhibit.status, 'pending')
  assert.equal(a.data.exhibit.mode, 'existing')
  ids.a = a.data.exhibit.id

  const b = await post('/api/night-museum/exhibit', {
    action: 'create',
    exhibit: { prompt: '给设置页加一个夜间主题', mode: 'existing', sessionId: 's-one', sessionTitle: '一号会话', workspaceId: 'ws-one' },
  })
  ids.b = b.data.exhibit.id

  const c = await post('/api/night-museum/exhibit', {
    action: 'create',
    exhibit: { prompt: '把构建脚本改成并行', mode: 'new', workspaceId: 'ws-two', workspacePath: '/tmp/ws-two', workspaceTitle: '二号工作区' },
  })
  assert.equal(c.data.ok, true)
  assert.equal(c.data.exhibit.sessionId, null)
  ids.c = c.data.exhibit.id

  assert.equal(c.data.state.exhibits.length, 3)
})

await step('rejects an empty exhibit', async () => {
  const { data } = await post('/api/night-museum/exhibit', { action: 'create', exhibit: { prompt: '   ' } })
  assert.equal(data.ok, false)
  assert.match(data.error, /不能为空/)
})

await step('reorder persists', async () => {
  const { data } = await post('/api/night-museum/exhibit', { action: 'reorder', ids: [ids.c, ids.a, ids.b] })
  assert.equal(data.ok, true)
  assert.deepEqual(data.state.exhibits.map((item) => item.id), [ids.c, ids.a, ids.b])
})

await step('update retitles and keeps run fields', async () => {
  const { data } = await post('/api/night-museum/exhibit', {
    action: 'update',
    id: ids.a,
    patch: { title: '登录页按钮', prompt: '修复登录页的提交按钮（含空态）', mode: 'existing', sessionId: 's-one' },
  })
  assert.equal(data.ok, true)
  assert.equal(data.exhibit.title, '登录页按钮')
  assert.match(data.exhibit.prompt, /空态/)
})

await step('start runs groups concurrently but one session sequentially', async () => {
  const { data } = await post('/api/night-museum/run', { action: 'start' })
  assert.equal(data.ok, true)
  assert.equal(data.total, 3)
  assert.equal(data.groups, 2)
  assert.equal(data.state.run.running, true)

  state = await waitFor(async () => {
    const { data } = await get('/api/night-museum/state')
    return data.run.running ? null : data
  }, 'run to finish')

  assert.deepEqual(state.exhibits.map((item) => item.status), ['done', 'done', 'done'])
  assert.equal(state.lastRun.total, 3)
  assert.equal(state.lastRun.done, 3)

  const one = sessions.prompts.filter((entry) => entry.sessionId === 's-one')
  assert.equal(one.length, 2)
  // 投递到会话的消息就是展品内容本身：没有标题、没有前后缀说明。
  assert.equal(one[0].text, '修复登录页的提交按钮（含空态）')
  assert.equal(one[1].text, '给设置页加一个夜间主题')
  assert.ok(one[0].at <= one[1].at, 'same-session prompts must be ordered')

  const fresh = state.exhibits.find((item) => item.id === ids.c)
  assert.ok(fresh.sessionId, 'a new-mode exhibit keeps the session it created')
  assert.equal(fresh.lastSessionId, fresh.sessionId)
  assert.equal(sessions.sessions.get(fresh.sessionId).cwd, '/tmp/ws-two')
  sessions.created = 0

  // 第二轮不再新开会话：同一件展品还在原来那个会话里跑。
  await post('/api/night-museum/exhibit', { action: 'reset', id: ids.c })
  const again = await post('/api/night-museum/run', { action: 'start', ids: [ids.c] })
  assert.equal(again.data.ok, true)
  await waitFor(async () => {
    const { data } = await get('/api/night-museum/state')
    return data.run.running ? null : data
  }, 'second run to finish')
  assert.equal(sessions.created, 0, 'a bound new-mode exhibit must not create another session')
  assert.equal(sessions.prompts.filter((entry) => entry.sessionId === fresh.sessionId).length, 2)
})

await step('a done exhibit is skipped on the next run', async () => {
  const { data } = await post('/api/night-museum/run', { action: 'start' })
  assert.equal(data.ok, false)
  assert.match(data.error, /没有还未展出的展品/)
})

await step('reset returns an exhibit to pending', async () => {
  const { data } = await post('/api/night-museum/exhibit', { action: 'reset', id: ids.a })
  assert.equal(data.ok, true)
  assert.equal(data.exhibit.status, 'pending')
  assert.equal(data.exhibit.note, '下次巡展还在这个会话里继续')
})

await step('new-session action drops the binding for a fresh conversation', async () => {
  const bound = (await get('/api/night-museum/state')).data.exhibits.find((item) => item.id === ids.c)
  assert.ok(bound.sessionId)
  const { data } = await post('/api/night-museum/exhibit', { action: 'new-session', id: ids.c })
  assert.equal(data.ok, true)
  assert.equal(data.exhibit.sessionId, null)
  assert.equal(data.exhibit.status, 'pending')
  const rejected = await post('/api/night-museum/exhibit', { action: 'new-session', id: ids.a })
  assert.equal(rejected.data.ok, false)
  assert.match(rejected.data.error, /新增会话/)
})

await step('stop cancels the session and marks only the chosen exhibit', async () => {
  const slow = makeSessions({ latency: 6000 })
  ctx.sessionController = slow.controller
  await post('/api/night-museum/exhibit', {
    action: 'create',
    exhibit: { prompt: '慢展品', mode: 'existing', sessionId: 's-slow' },
  })
  const other = await post('/api/night-museum/exhibit', {
    action: 'create',
    exhibit: { prompt: '另一件慢展品', mode: 'new', workspaceId: 'ws-one' },
  })
  const started = await post('/api/night-museum/run', { action: 'start' })
  assert.equal(started.data.ok, true)
  const target = started.data.state.exhibits.find((item) => item.prompt === '慢展品')
  ids.slow = target.id

  const stopped = await post('/api/night-museum/run', { action: 'stop', ids: [target.id] })
  assert.equal(stopped.data.ok, true)
  const targetState = stopped.data.state.exhibits.find((item) => item.id === target.id)
  assert.equal(targetState.status, 'stopped')
  assert.equal(slow.sessions.get('s-slow').cancelled, true)

  const untouched = stopped.data.state.exhibits.find((item) => item.id === other.data.exhibit.id)
  assert.equal(untouched.status, 'running')

  await post('/api/night-museum/run', { action: 'stop' })
  const finalState = await waitFor(async () => {
    const { data } = await get('/api/night-museum/state')
    return data.run.running ? null : data
  }, 'run to finish after a blanket stop')
  assert.ok(finalState.exhibits.every((item) => item.status !== 'running'))

  ctx.sessionController = sessions.controller
})

await step('resume continues a stopped exhibit in the same session', async () => {
  const before = (await get('/api/night-museum/state')).data.exhibits.find((item) => item.id === ids.slow)
  assert.equal(before.status, 'stopped')
  assert.equal(before.sessionId, 's-slow')

  const resumed = await post('/api/night-museum/run', { action: 'resume', ids: [ids.slow] })
  assert.equal(resumed.data.ok, true)
  assert.equal(resumed.data.total, 1)
  const target = resumed.data.state.exhibits.find((item) => item.id === ids.slow)
  assert.equal(target.status, 'running')
  await waitFor(async () => {
    const { data } = await get('/api/night-museum/state')
    return data.run.running ? null : data
  }, 'resume run to finish')

  const after = (await get('/api/night-museum/state')).data.exhibits.find((item) => item.id === ids.slow)
  assert.equal(after.status, 'done')
  assert.equal(after.sessionId, 's-slow', 'continue must not move the exhibit to another session')
  const last = sessions.prompts.filter((entry) => entry.sessionId === 's-slow').pop()
  assert.equal(last.text, '继续')
  // 已经闭馆的展品不在「继续」的范围里。
  const nothing = await post('/api/night-museum/run', { action: 'resume', ids: [ids.slow] })
  assert.equal(nothing.data.ok, false)
  assert.match(nothing.data.error, /没有需要接着跑的展品/)
})

await step('an exhibit waiting for your answer keeps the run alive and resumes itself', async () => {
  const gated = makeSessions({ gate: true })
  ctx.sessionController = gated.controller
  try {
    const created = await post('/api/night-museum/exhibit', {
      action: 'create',
      exhibit: { title: '等你回应的展品', prompt: '先说一句再问我', mode: 'existing', sessionId: 's-gate' },
    })
    const id = created.data.exhibit.id
    const started = await post('/api/night-museum/run', { action: 'start', ids: [id] })
    assert.equal(started.data.ok, true)

    const waiting = await waitFor(async () => {
      const { data } = await get('/api/night-museum/state')
      const item = data.exhibits.find((entry) => entry.id === id)
      return item?.status === 'blocked' ? data : null
    }, 'the exhibit to wait for an answer')
    const blocked = waiting.exhibits.find((entry) => entry.id === id)
    assert.equal(waiting.run.running, true, 'the run is still going while it waits')
    assert.equal(blocked.active, true)
    assert.match(blocked.note, /回答/)
    assert.equal(waiting.run.done, 0)

    gated.answer('s-gate')

    const finished = await waitFor(async () => {
      const { data } = await get('/api/night-museum/state')
      const item = data.exhibits.find((entry) => entry.id === id)
      return item?.status === 'done' ? data : null
    }, 'the exhibit to finish after the answer')
    assert.equal(finished.run.running, false)
    assert.equal(finished.exhibits.find((entry) => entry.id === id).active, false)
    assert.equal(finished.lastRun.done, 1)
    assert.equal(finished.lastRun.blocked, 0)
    assert.equal(gated.prompts.filter((entry) => entry.sessionId === 's-gate').length, 1, 'only the original prompt')
  } finally {
    ctx.sessionController = sessions.controller
  }
})

await step('an exhibit waiting for your answer can be stopped', async () => {
  const gated = makeSessions({ gate: true })
  ctx.sessionController = gated.controller
  try {
    const created = await post('/api/night-museum/exhibit', {
      action: 'create',
      exhibit: { title: '等你回应时停止', prompt: '先问我', mode: 'existing', sessionId: 's-gate-stop' },
    })
    const id = created.data.exhibit.id
    await post('/api/night-museum/run', { action: 'start', ids: [id] })
    await waitFor(async () => {
      const { data } = await get('/api/night-museum/state')
      return data.exhibits.find((entry) => entry.id === id)?.status === 'blocked' ? data : null
    }, 'the exhibit to wait for an answer')

    const stopped = await post('/api/night-museum/run', { action: 'stop', ids: [id] })
    assert.equal(stopped.data.ok, true)
    assert.deepEqual(stopped.data.ids, [id])

    const after = await waitFor(async () => {
      const { data } = await get('/api/night-museum/state')
      return data.run.running ? null : data
    }, 'the run to end after the stop')
    const item = after.exhibits.find((entry) => entry.id === id)
    assert.equal(item.status, 'stopped')
    assert.equal(item.active, false)
  } finally {
    ctx.sessionController = sessions.controller
  }
})

await step('dismiss silences today reminder', async () => {
  const { data } = await post('/api/night-museum/run', { action: 'dismiss' })
  assert.equal(data.ok, true)
  assert.equal(data.state.reminder.dismissedToday, true)
  assert.equal(data.state.reminder.due, false)
})

await step('create session route validates workspace', async () => {
  const { data } = await post('/api/night-museum/session', {})
  assert.equal(data.ok, false)
  const created = await post('/api/night-museum/session', { workspaceId: 'ws-two' })
  assert.equal(created.data.ok, true)
  assert.match(created.data.sessionId, /^fresh-/)
})

await step('a reload reconciles an answered exhibit and keeps an unanswered one waiting', async () => {
  // 模拟宿主关掉时留下的两件「等你回应」：一件其实回应过、那一轮已经跑完，
  // 另一件还没人回应。重启后只收尾第一件。
  for (const dispose of disposers.slice().reverse()) dispose?.()
  routes.clear()

  const markedAt = Date.now() - 5000
  const base = {
    mode: 'existing',
    createdAt: markedAt,
    updatedAt: markedAt,
    lastSessionId: null,
    sessionTitle: '',
    workspaceId: null,
    workspacePath: '',
    workspaceTitle: '',
  }
  await mkdir(path.join(home, 'night-museum'), { recursive: true })
  await writeFile(
    path.join(home, 'night-museum', 'state.json'),
    JSON.stringify({
      version: 1,
      exhibits: [
        { ...base, id: 'recon-answered', title: '回应过的展品', prompt: '回应过的展品', sessionId: 's-answered', status: 'blocked', note: '会话在等待你的确认' },
        { ...base, id: 'recon-silent', title: '还没回应的展品', prompt: '还没回应的展品', sessionId: 's-silent', status: 'blocked', note: '会话在等待你的确认' },
      ],
      reminderDay: null,
      lastRunAt: 0,
      lastRun: null,
    }),
    'utf8',
  )

  const recon = {
    async list() {
      return { items: [] }
    },
    async state() {
      return { cursor: 2, active: true, running: false, queue: [], pendingInput: [] }
    },
    async page({ address }) {
      // 只有已回应的那件在挂起之后又输出过内容。
      const records =
        address.sessionId === 's-answered'
          ? [{ type: 'event', event: { type: 'assistant/message', seq: 3, time: Date.now(), data: {} } }]
          : []
      return { cursor: 3, records }
    },
  }
  const ctx3 = { ...ctx, sessionController: recon, effect: ctx.effect }
  apply(ctx3, {})

  const reconciled = await waitFor(async () => {
    const { data } = await get('/api/night-museum/state')
    const item = data.exhibits.find((entry) => entry.id === 'recon-answered')
    return item?.status === 'done' ? data : null
  }, 'the answered exhibit to be reconciled to done')
  assert.equal(reconciled.exhibits.find((entry) => entry.id === 'recon-answered').note, '已闭馆（你回应之后那一轮已经跑完）')
  const silent = reconciled.exhibits.find((entry) => entry.id === 'recon-silent')
  assert.equal(silent.status, 'blocked')
  assert.match(silent.note, /点「继续」接着做/)
})

await step('state persists across a host reload', async () => {
  const before = (await get('/api/night-museum/state')).data.exhibits.length
  for (const dispose of disposers.slice().reverse()) dispose?.()
  routes.clear()
  const reloaded = makeSessions()
  const ctx2 = { ...ctx, sessionController: reloaded.controller, effect: ctx.effect }
  apply(ctx2, {})
  const after = (await get('/api/night-museum/state')).data.exhibits.length
  assert.equal(after, before)
  const stuck = (await get('/api/night-museum/state')).data.exhibits.filter((item) => item.status === 'running')
  assert.equal(stuck.length, 0, 'a reload must not leave exhibits running')
})

await new Promise((resolve) => setTimeout(resolve, 500))

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await rm(home, { recursive: true, force: true })
if (failed.length > 0) {
  console.log(failed.map((entry) => ` - ${entry.name}: ${entry.error}`).join('\n'))
  process.exit(1)
}
