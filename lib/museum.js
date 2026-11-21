/**
 * dsh-night-museum — persisted gallery model.
 *
 * 展品存在 `~/.dsh/night-museum/state.json`，跨会话、跨重启保留。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { startRun, stopRun } from './schedule.js'
import {
  MAX_PROMPT,
  MAX_TITLE,
  STATUSES,
  describeError,
  dshHome,
  isPeak,
  oneLine,
  text,
  todayKey,
} from './util.js'

export class Museum {
  constructor(ctx) {
    this.ctx = ctx
    this.dir = path.join(dshHome(), 'night-museum')
    this.file = path.join(this.dir, 'state.json')
    this.data = { version: 1, exhibits: [], reminderDay: null, lastRunAt: 0, lastRun: null }
    this.active = new Map()
    this.running = false
    this.startedAt = 0
    this.runTotal = 0
    this.resumeIds = new Set()
    this.saveChain = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    try {
      const raw = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.exhibits)) {
        this.data = {
          version: 1,
          exhibits: parsed.exhibits.filter((item) => item && typeof item.id === 'string'),
          reminderDay: typeof parsed.reminderDay === 'string' ? parsed.reminderDay : null,
          lastRunAt: Number.isFinite(parsed.lastRunAt) ? parsed.lastRunAt : 0,
          lastRun: parsed.lastRun && typeof parsed.lastRun === 'object' ? parsed.lastRun : null,
        }
      }
    } catch {
      /* first boot, or an unreadable file: start from an empty gallery */
    }
    for (const item of this.data.exhibits) {
      if (!STATUSES.has(item.status)) item.status = 'pending'
      if (typeof item.title !== 'string' || item.title === '') item.title = oneLine(item.prompt, 40) || '未命名展品'
      if (typeof item.note !== 'string') item.note = ''
      if (item.status === 'running') {
        item.status = 'stopped'
        item.note = '上次宿主关闭时中断'
      }
      // 旧版「新增会话」的展品每轮都另起会话；现在把已经建过的会话接回来，
      // 这样半途停下的展品可以在原会话里继续。
      if (item.mode === 'new' && !item.sessionId && typeof item.lastSessionId === 'string' && item.lastSessionId) {
        item.sessionId = item.lastSessionId
      }
    }
    // 不阻塞 ready：页面先显示上次的展品，对账随后把「等你回应」收拾掉。
    void this.reconcileBlocked()
  }

  /**
   * 重启后的对账。
   *
   * 「等你回应」是唯一一种把展品留在原地等人的状态：宿主这时被关掉，就没有人
   * 再盯着那个会话了。下次启动时逐个看一眼：
   * - 你回应之后那一轮已经跑完（会话里有比对账时间更新的 assistant 输出）→ 已闭馆；
   * - 还挂着提问，或者还没跑完 → 继续留在「等你回应」，并说明要点「继续」。
   */
  async reconcileBlocked() {
    const sc = this.ctx?.sessionController
    if (!sc) return
    let changed = false
    for (const item of [...this.data.exhibits]) {
      if (item.status !== 'blocked' || !item.sessionId) continue
      const markedAt = Number(item.updatedAt) || 0
      let state = null
      try {
        state = await sc.state({ sessionId: item.sessionId }, AbortSignal.timeout(5000))
      } catch (error) {
        console.warn(`[dsh-night-museum] 对账「${item.title}」时读不到会话状态:`, describeError(error))
      }
      if (item.status !== 'blocked') continue
      const readEvents = typeof sc.events === 'function' ? sc.events.bind(sc) : typeof sc.page === 'function' ? sc.page.bind(sc) : null
      if (state && !state.pendingInput?.length && readEvents) {
        try {
          const page = await readEvents(
            { address: { kind: 'session', sessionId: item.sessionId }, maxMessages: 64 },
            AbortSignal.timeout(8000),
          )
          const answered = (Array.isArray(page?.records) ? page.records : []).some(
            (record) =>
              record?.type === 'event' &&
              record.event?.type === 'assistant/message' &&
              Number(record.event.time) > markedAt,
          )
          if (item.status !== 'blocked') continue
          if (answered) {
            item.status = 'done'
            item.note = '已闭馆（你回应之后那一轮已经跑完）'
            item.updatedAt = Date.now()
            changed = true
            continue
          }
        } catch (error) {
          console.warn(`[dsh-night-museum] 对账「${item.title}」时读不到会话记录:`, describeError(error))
        }
      }
      if (item.status !== 'blocked') continue
      const note = state?.pendingInput?.length
        ? '上次等你回应时中断，回答后点「继续」接着做'
        : '上次等你回应时中断，点「继续」接着做'
      if (item.note !== note) {
        item.note = note
        changed = true
      }
    }
    if (changed) await this.save()
  }

  save() {
    const payload = JSON.stringify(this.data, null, 2)
    this.saveChain = this.saveChain
      .then(async () => {
        await mkdir(this.dir, { recursive: true })
        const tmp = `${this.file}.${process.pid}.tmp`
        await writeFile(tmp, payload, 'utf8')
        await rename(tmp, this.file)
      })
      .catch((error) => {
        console.warn('[dsh-night-museum] 状态保存失败:', describeError(error))
      })
    return this.saveChain
  }

  snapshot() {
    const now = new Date()
    const pending = this.data.exhibits.filter((item) => item.status !== 'done')
    // 「正在等你回应」的展品没有结束，仍算这一轮里还活着的一件。
    const scheduled = this.data.exhibits.filter((item) => item.status === 'running' || this.active.has(item.id))
    const done = this.data.exhibits.filter((item) => item.status === 'done').length
    return {
      ok: true,
      now: now.getTime(),
      peak: isPeak(now),
      serverHour: now.getHours(),
      exhibits: this.data.exhibits.map((item) => ({ ...item, active: this.active.has(item.id) })),
      run: {
        running: this.running,
        startedAt: this.startedAt,
        total: this.runTotal,
        done: this.running ? Math.max(0, this.runTotal - scheduled.length) : 0,
      },
      reminder: {
        due: now.getHours() >= 18 && pending.length > 0 && !this.running && this.data.reminderDay !== todayKey(now),
        pending: pending.length,
        day: todayKey(now),
        dismissedToday: this.data.reminderDay === todayKey(now),
      },
      lastRun: this.data.lastRun,
    }
  }

  /* ------------------------------------------------------------- exhibit */

  createExhibit(input) {
    const prompt = text(input.prompt, MAX_PROMPT)
    if (prompt === '') throw new Error('展品内容不能为空')
    const mode = input.mode === 'existing' ? 'existing' : 'new'
    const exhibit = {
      id: randomUUID(),
      title: text(input.title, MAX_TITLE) || oneLine(prompt, 36),
      prompt,
      mode,
      sessionId: null,
      sessionTitle: '',
      workspaceId: null,
      workspacePath: '',
      workspaceTitle: '',
      status: 'pending',
      note: '',
      lastSessionId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (mode === 'existing') {
      const sessionId = text(input.sessionId, 120)
      if (sessionId === '') throw new Error('请选择一个已存在的会话')
      exhibit.sessionId = sessionId
      exhibit.sessionTitle = text(input.sessionTitle, 120)
      exhibit.workspaceId = text(input.workspaceId, 160) || null
      exhibit.workspacePath = text(input.workspacePath, 1024)
      exhibit.workspaceTitle = text(input.workspaceTitle, 120)
    } else {
      const workspaceId = text(input.workspaceId, 160)
      const workspacePath = text(input.workspacePath, 1024)
      if (workspaceId === '' && workspacePath === '') throw new Error('请选择新会话所在的工作区')
      exhibit.workspaceId = workspaceId || null
      exhibit.workspacePath = workspacePath
      exhibit.workspaceTitle = text(input.workspaceTitle, 120)
    }
    this.data.exhibits.push(exhibit)
    return exhibit
  }

  find(id) {
    return this.data.exhibits.find((item) => item.id === id)
  }

  /** 还在这一轮巡展里（正在跑，或正在等你回应）。 */
  busy(exhibit) {
    return exhibit.status === 'running' || this.active.has(exhibit.id)
  }

  updateExhibit(input) {
    const exhibit = this.find(text(input.id, 120))
    if (!exhibit) throw new Error('展品不存在')
    if (this.busy(exhibit)) throw new Error('展品还在巡展中（或在等你回应），先停止再修改')
    const patch = input.patch && typeof input.patch === 'object' ? input.patch : {}
    if (typeof patch.title === 'string') exhibit.title = text(patch.title, MAX_TITLE) || exhibit.title
    if (typeof patch.prompt === 'string') {
      const prompt = text(patch.prompt, MAX_PROMPT)
      if (prompt === '') throw new Error('展品内容不能为空')
      exhibit.prompt = prompt
    }
    if (patch.mode === 'existing' || patch.mode === 'new') exhibit.mode = patch.mode
    if (exhibit.mode === 'existing') {
      if (typeof patch.sessionId === 'string' && patch.sessionId.trim() !== '') {
        exhibit.sessionId = text(patch.sessionId, 120)
        exhibit.sessionTitle = text(patch.sessionTitle, 120)
        exhibit.workspaceId = text(patch.workspaceId, 160) || exhibit.workspaceId
        exhibit.workspacePath = text(patch.workspacePath, 1024) || exhibit.workspacePath
        exhibit.workspaceTitle = text(patch.workspaceTitle, 120) || exhibit.workspaceTitle
      }
      if (!exhibit.sessionId) throw new Error('请选择一个已存在的会话')
    } else {
      const workspaceId = text(patch.workspaceId, 160)
      const workspacePath = text(patch.workspacePath, 1024)
      if (workspaceId === '' && workspacePath === '' && !exhibit.workspaceId && !exhibit.workspacePath) {
        throw new Error('请选择新会话所在的工作区')
      }
      if (workspaceId !== '') exhibit.workspaceId = workspaceId
      if (workspacePath !== '') exhibit.workspacePath = workspacePath
      if (typeof patch.workspaceTitle === 'string' && patch.workspaceTitle.trim() !== '') {
        exhibit.workspaceTitle = text(patch.workspaceTitle, 120)
      }
    }
    exhibit.updatedAt = Date.now()
    return exhibit
  }

  deleteExhibit(id) {
    const index = this.data.exhibits.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('展品不存在')
    if (this.busy(this.data.exhibits[index])) throw new Error('展品还在巡展中（或在等你回应），先停止再删除')
    const [removed] = this.data.exhibits.splice(index, 1)
    return removed
  }

  reorder(ids) {
    if (!Array.isArray(ids)) throw new Error('顺序参数不合法')
    const current = new Map(this.data.exhibits.map((item) => [item.id, item]))
    if (ids.length !== current.size || new Set(ids).size !== ids.length) throw new Error('顺序参数与展品列表不匹配')
    const next = []
    for (const id of ids) {
      const exhibit = current.get(id)
      if (!exhibit) throw new Error('顺序参数与展品列表不匹配')
      next.push(exhibit)
    }
    this.data.exhibits = next
    return next.map((item) => item.id)
  }

  resetExhibit(id) {
    const exhibit = this.find(id)
    if (!exhibit) throw new Error('展品不存在')
    if (this.busy(exhibit)) throw new Error('展品还在巡展中（或在等你回应），先停止再重置')
    exhibit.status = 'pending'
    exhibit.note = exhibit.sessionId ? '下次巡展还在这个会话里继续' : ''
    exhibit.updatedAt = Date.now()
    return exhibit
  }

  /** 「新增会话」的展品：丢掉当前会话，下一轮重新开一个干净会话。 */
  newSession(id) {
    const exhibit = this.find(id)
    if (!exhibit) throw new Error('展品不存在')
    if (exhibit.mode !== 'new') throw new Error('只有「新增会话」的展品才能换会话')
    if (this.busy(exhibit)) throw new Error('展品还在巡展中（或在等你回应），先停止再换会话')
    exhibit.sessionId = null
    exhibit.sessionTitle = ''
    exhibit.lastSessionId = null
    exhibit.status = 'pending'
    exhibit.note = '下次巡展会在该工作区新建会话'
    exhibit.updatedAt = Date.now()
    return exhibit
  }

  /* ---------------------------------------------------------------- runs */

  /**
   * 投递到会话的消息就是展品内容本身：不带标题、不带任何前后缀说明。
   * 半途继续的展品只发一句「继续」——会话里已经有上一轮的上下文。
   */
  buildPrompt(exhibit) {
    if (this.resumeIds.has(exhibit.id)) return '继续'
    return String(exhibit.prompt ?? '').trim()
  }

  pendingTargets(ids) {
    const wanted = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null
    return this.data.exhibits.filter((item) => item.status !== 'done' && (!wanted || wanted.has(item.id)))
  }

  /** 半途停下的展品：已停止 / 出岔子 / 等你回应 / 还没开始。 */
  resumableTargets(ids) {
    const wanted = Array.isArray(ids) && ids.length > 0 ? new Set(ids) : null
    return this.data.exhibits.filter(
      (item) =>
        (item.status === 'stopped' || item.status === 'failed' || item.status === 'blocked' || item.status === 'pending') &&
        (!wanted || wanted.has(item.id)),
    )
  }

  start(ids, options) {
    return startRun(this, ids, options)
  }

  stop(ids) {
    return stopRun(this, ids)
  }

  dismissReminder() {
    this.data.reminderDay = todayKey()
  }

  dispose() {
    for (const entry of this.active.values()) {
      try {
        entry.controller.abort(new Error('disposed'))
      } catch {
        /* ignore */
      }
    }
    this.active.clear()
    this.running = false
  }
}
