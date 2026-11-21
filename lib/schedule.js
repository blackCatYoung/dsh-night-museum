/**
 * dsh-night-museum — run orchestration.
 *
 * 巡展时按「会话」分组：不同会话并发，同一会话内严格顺序。每件展品只是往
 * 会话里投一条 prompt，然后等这个会话静默下来。
 */

import { randomUUID } from 'node:crypto'
import path from 'node:path'
import {
  POLL_MS,
  RUN_HARD_DEADLINE_MS,
  WAIT_SLICE_MS,
  describeError,
  sleep,
  todayKey,
} from './util.js'

export async function startRun(m, ids, options = {}) {
  if (m.running) throw new Error('正在巡展中，请等待结束或先停止')
  const resume = options.resume === true
  const targets = resume ? m.resumableTargets(ids) : m.pendingTargets(ids)
  if (targets.length === 0) throw new Error(resume ? '没有需要接着跑的展品' : '没有还未展出的展品')
  m.resumeIds = new Set(
    resume ? targets.filter((item) => item.sessionId && item.status !== 'pending').map((item) => item.id) : [],
  )
  m.running = true
  m.startedAt = Date.now()
  m.runTotal = targets.length
  m.data.reminderDay = todayKey()
  for (const item of targets) {
    item.status = 'running'
    item.note = m.resumeIds.has(item.id) ? '正在接着上一轮做' : '等待点亮'
    item.updatedAt = Date.now()
  }
  await m.save()

  const groups = new Map()
  for (const item of targets) {
    const key = item.sessionId ? `session:${item.sessionId}` : `fresh:${item.id}`
    const group = groups.get(key) ?? []
    group.push(item)
    groups.set(key, group)
  }

  const startedAt = m.startedAt
  const total = targets.length
  const count = (status) => targets.filter((item) => item.status === status).length
  void Promise.allSettled([...groups.values()].map((group) => runGroup(m, group)))
    .then(async () => {
      for (const item of m.data.exhibits) {
        if (item.status === 'running') {
          item.status = 'stopped'
          item.note = '巡展意外结束'
        }
      }
      m.running = false
      m.runTotal = 0
      m.resumeIds = new Set()
      m.startedAt = 0
      m.data.lastRunAt = Date.now()
      m.data.lastRun = {
        startedAt,
        finishedAt: Date.now(),
        total,
        done: count('done'),
        failed: count('failed'),
        stopped: count('stopped'),
        blocked: count('blocked'),
      }
      await m.save()
    })
    .catch((error) => {
      console.warn('[dsh-night-museum] 巡展收尾失败:', describeError(error))
      m.running = false
    })

  return { total, groups: groups.size }
}

async function runGroup(m, group) {
  for (const item of group) {
    if (item.status !== 'running') continue
    try {
      await runItem(m, item)
    } catch (error) {
      if (item.status === 'stopped' || error?.name === 'AbortError') {
        item.status = 'stopped'
        item.note = item.note || '已停止'
      } else if (item.status !== 'blocked' && item.status !== 'failed') {
        item.status = 'failed'
        item.note = describeError(error)
      }
    } finally {
      item.updatedAt = Date.now()
      m.active.delete(item.id)
      await m.save()
    }
  }
}

/**
 * 会话停下来等你回应（审批 / 提问）时，展品没有结束——只是原地等着。
 * 这里保持巡展进行中，轮询到你在会话里回应过、pendingInput 清空，再把展品
 * 放回「巡展中」继续等结果；等待期间 run 仍然是 running，可以随时停止。
 */
async function awaitUserResponse(m, item, sessionId, signal) {
  const sc = m.ctx.sessionController
  item.status = 'blocked'
  item.note = '回答会话里的提问后会自动接着巡展'
  item.updatedAt = Date.now()
  await m.save()

  let failures = 0
  for (;;) {
    await sleep(POLL_MS, signal)
    if (signal.aborted || item.status !== 'blocked') return
    let state
    try {
      state = await sc.state({ sessionId }, signal)
      failures = 0
    } catch (error) {
      if (signal.aborted) throw error
      failures += 1
      if (failures >= 20) {
        item.status = 'failed'
        item.note = `无法确认会话状态：${describeError(error)}`
        throw error
      }
      continue
    }
    if (signal.aborted || item.status !== 'blocked') return
    if (state.pendingInput?.length) continue
    item.status = 'running'
    item.note = '正在巡展'
    item.updatedAt = Date.now()
    await m.save()
    return
  }
}

async function runItem(m, item) {
  const sc = m.ctx.sessionController
  const controller = new AbortController()
  const signal = controller.signal
  const entry = { controller, sessionId: null }
  m.active.set(item.id, entry)

  let sessionId = item.sessionId
  if (!sessionId) {
    if (item.status !== 'running') return
    const created = await sc.create(item.workspaceId ? { workspaceId: item.workspaceId } : { cwd: item.workspacePath })
    sessionId = created.sessionId
    // 建一次就落档：之后这件展品一直在这个会话里接着做，不会再每轮开新的。
    item.sessionId = sessionId
    item.sessionTitle = `${item.workspaceTitle || path.basename(item.workspacePath || '') || '工作区'} · 夜间巡展会话`
  }
  entry.sessionId = sessionId
  item.lastSessionId = sessionId
  if (item.status !== 'running') return
  item.note = '展品已就位'
  await m.save()
  if (item.status !== 'running') return

  const before = await sc.state({ sessionId }, signal)
  const requestId = randomUUID()
  try {
    await sc.prompt(
      {
        requestId,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: m.buildPrompt(item) }],
        clientTimeZone: 'Asia/Shanghai',
      },
      signal,
    )
  } catch (error) {
    throw new Error(`无法向会话投递展品：${describeError(error)}`)
  }

  // 等这条消息真正进入该会话：排队中的 rpcId 消失、游标前进。
  let cursor = before.cursor
  let admitDeadline = Date.now() + 120000
  while (Date.now() < admitDeadline) {
    const state = await sc.state({ sessionId }, signal)
    if (state.pendingInput?.length) {
      // 会话里有一条提问挡在队列前面：等它被回应，展品本身并没有结束。
      const pausedAt = Date.now()
      await awaitUserResponse(m, item, sessionId, signal)
      admitDeadline += Date.now() - pausedAt
      if (item.status !== 'running') return
      continue
    }
    const queued = Array.isArray(state.queue) && state.queue.some((slot) => slot?.rpcId === requestId)
    if (!queued && state.cursor > before.cursor) {
      cursor = state.cursor
      break
    }
    await sleep(POLL_MS, signal)
  }
  item.note = '正在巡展'
  await m.save()

  let deadline = Date.now() + RUN_HARD_DEADLINE_MS
  let emptyIdle = 0
  for (;;) {
    if (Date.now() > deadline) throw new Error('执行超时（超过 3 小时）')
    let outcome
    try {
      outcome = await sc.wait({ sessionId, afterSeq: cursor, timeoutMs: WAIT_SLICE_MS }, signal)
    } catch (error) {
      if (signal.aborted) throw error
      await sleep(2000, signal)
      continue
    }
    if (outcome.reason === 'input-required') {
      // 人在会话里说话之前不算执行时间：等回应的时间从 3 小时硬期限里扣掉。
      const pausedAt = Date.now()
      await awaitUserResponse(m, item, sessionId, signal)
      deadline += Date.now() - pausedAt
      if (item.status !== 'running') return
      continue
    }
    if (outcome.reason === 'timeout') {
      item.note = '仍在巡展'
      await m.save()
      continue
    }
    if (outcome.output?.records?.length > 0) {
      item.status = 'done'
      item.note = '已闭馆'
      return
    }
    if (++emptyIdle >= 3) {
      item.status = 'done'
      item.note = '已闭馆（无文本输出）'
      return
    }
    await sleep(1500, signal)
  }
}

export async function stopRun(m, ids) {
  const wanted = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null
  const targets = m.data.exhibits.filter(
    (item) =>
      (!wanted || wanted.has(item.id)) &&
      (item.status === 'running' || (item.status === 'blocked' && m.active.has(item.id))),
  )
  if (targets.length === 0) throw new Error('没有可停止的展品')

  // 先把状态定成 stopped，再取消会话：等待回应的轮询循环醒来时看到状态已变就会
  // 退出，不会在 cancel 与 abort 之间把展品翻回 running。
  for (const item of targets) {
    item.status = 'stopped'
    item.note = '已由你停止'
    item.updatedAt = Date.now()
  }
  const sc = m.ctx.sessionController
  for (const item of targets) {
    const entry = m.active.get(item.id)
    const sessionId = entry?.sessionId ?? (item.mode === 'existing' ? item.sessionId : null)
    if (sessionId) {
      try {
        await sc.cancel({ sessionId })
      } catch {
        /* 会话可能已经结束 */
      }
    }
    entry?.controller.abort(new Error('stopped'))
  }
  await m.save()
  return targets.map((item) => item.id)
}
