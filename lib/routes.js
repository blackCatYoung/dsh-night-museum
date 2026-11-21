/**
 * dsh-night-museum — HTTP routes.
 *
 * 所有响应都是 JSON；异常在 guarded/action 边界内转成可读错误，避免宿主
 * webserver 把抛出的异常变成空白 HTTP 400。
 */

import path from 'node:path'
import { ROUTE, describeError, fail, jsonResponse, sessionTitle, text } from './util.js'

async function readJson(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

function guarded(label, handler) {
  return async (request) => {
    try {
      return await handler(request)
    } catch (error) {
      console.warn(`[dsh-night-museum] ${label} 失败:`, describeError(error))
      return fail(describeError(error), 500)
    }
  }
}

async function listSessions(ctx, museum) {
  await museum.ready
  const sc = ctx.sessionController
  const signal = AbortSignal.timeout(15000)
  const [listed, workspaces] = await Promise.all([
    sc.list({}, signal).catch((error) => {
      console.warn('[dsh-night-museum] 无法列出会话:', describeError(error))
      return { items: [] }
    }),
    Promise.resolve()
      .then(() => ctx.workspaceRegistry.list())
      .catch(() => []),
  ])
  const byPath = new Map()
  const workspaceList = (Array.isArray(workspaces) ? workspaces : []).map((workspace) => {
    const item = {
      id: String(workspace.id),
      title: String(workspace.title || path.basename(workspace.path) || workspace.path),
      path: String(workspace.path),
    }
    byPath.set(item.path, item)
    return item
  })
  const sessions = (Array.isArray(listed.items) ? listed.items : [])
    .map((summary) => {
      const cwd = typeof summary.cwd === 'string' ? summary.cwd : ''
      const workspace = byPath.get(cwd)
      return {
        id: String(summary.sessionId),
        title: sessionTitle(summary),
        cwd,
        running: summary.running === true,
        blank: summary.blank === true,
        updatedAt: Number(summary.updatedAt) || 0,
        workspaceId: workspace?.id ?? null,
        workspaceTitle: workspace?.title ?? (cwd ? path.basename(cwd) : ''),
      }
    })
    .sort((a, b) => b.updatedAt - a.updatedAt)
  return jsonResponse({ ok: true, sessions, workspaces: workspaceList })
}

async function handleExhibit(museum, request) {
  await museum.ready
  const body = await readJson(request)
  const action = String(body.action ?? '')
  try {
    if (action === 'create') {
      const exhibit = museum.createExhibit(body.exhibit ?? {})
      await museum.save()
      return jsonResponse({ ok: true, exhibit, state: museum.snapshot() })
    }
    if (action === 'update') {
      const exhibit = museum.updateExhibit(body)
      await museum.save()
      return jsonResponse({ ok: true, exhibit, state: museum.snapshot() })
    }
    if (action === 'delete') {
      const removed = museum.deleteExhibit(String(body.id ?? ''))
      await museum.save()
      return jsonResponse({ ok: true, removed: removed.id, state: museum.snapshot() })
    }
    if (action === 'reorder') {
      const ids = museum.reorder(body.ids)
      await museum.save()
      return jsonResponse({ ok: true, ids, state: museum.snapshot() })
    }
    if (action === 'reset') {
      const exhibit = museum.resetExhibit(String(body.id ?? ''))
      await museum.save()
      return jsonResponse({ ok: true, exhibit, state: museum.snapshot() })
    }
    if (action === 'new-session') {
      const exhibit = museum.newSession(String(body.id ?? ''))
      await museum.save()
      return jsonResponse({ ok: true, exhibit, state: museum.snapshot() })
    }
    return fail(`未知操作：${action}`)
  } catch (error) {
    return fail(describeError(error))
  }
}

async function handleRun(museum, request) {
  await museum.ready
  const body = await readJson(request)
  const action = String(body.action ?? '')
  try {
    if (action === 'start' || action === 'resume') {
      const result = await museum.start(body.ids, { resume: action === 'resume' })
      return jsonResponse({ ok: true, ...result, state: museum.snapshot() })
    }
    if (action === 'stop') {
      const ids = await museum.stop(body.ids)
      return jsonResponse({ ok: true, ids, state: museum.snapshot() })
    }
    if (action === 'dismiss') {
      museum.dismissReminder()
      await museum.save()
      return jsonResponse({ ok: true, state: museum.snapshot() })
    }
    return fail(`未知操作：${action}`)
  } catch (error) {
    return fail(describeError(error))
  }
}

async function handleCreateSession(ctx, museum, request) {
  await museum.ready
  const body = await readJson(request)
  const workspaceId = text(body.workspaceId, 160)
  const cwd = text(body.cwd, 1024)
  try {
    if (workspaceId === '' && cwd === '') return fail('缺少工作区')
    const created = await ctx.sessionController.create(
      workspaceId ? { workspaceId } : { cwd },
      AbortSignal.timeout(30000),
    )
    return jsonResponse({ ok: true, sessionId: created.sessionId })
  } catch (error) {
    return fail(describeError(error))
  }
}

/**
 * Register every night-museum route and return the disposer that unregisters
 * them in reverse order.
 */
export function registerRoutes(ctx, museum) {
  const disposers = []
  const register = (route) => {
    disposers.push(ctx.connection.fetch.register(route))
  }

  register({
    path: ROUTE.state,
    methods: ['GET'],
    // A GET route must declare a buffered body: the host otherwise builds a
    // Request WITH a streaming body for GET and Node throws, which surfaces as
    // a blank HTTP 400.
    requestBody: 'buffered',
    fetch: guarded('读取展厅状态', async () => {
      await museum.ready
      return jsonResponse(museum.snapshot())
    }),
  })

  register({
    path: ROUTE.sessions,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: guarded('列出会话', () => listSessions(ctx, museum)),
  })

  register({
    path: ROUTE.exhibit,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleExhibit(museum, request),
  })

  register({
    path: ROUTE.run,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleRun(museum, request),
  })

  register({
    path: ROUTE.createSession,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleCreateSession(ctx, museum, request),
  })

  return function disposeNightMuseum() {
    museum.dispose()
    for (const disposer of disposers.splice(0).reverse()) {
      try {
        disposer()
      } catch {
        /* ignore */
      }
    }
  }
}
