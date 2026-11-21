/**
 * Client-half render test for dsh-night-museum.
 *
 * Loads the Web client bundle the way the Web module loader does (entry +
 * package-local chunks), renders it with a tiny hook-capable renderer, and
 * points its `fetch` at the real host routes from lib/index.js (fake
 * sessionController, throwaway DSH_HOME). This exercises the actual page
 * markup and click paths without a browser:
 *
 *   node test/client-render.mjs
 */

import './harness/clock.mjs'
import assert from 'node:assert/strict'
import { plugin, styleTags, audio } from './harness/client.mjs'
import {
  hostState,
  hostFetch,
  waitHost,
  hostSessions,
  ctxSwitch,
  setStateOverride,
  disposeHome,
} from './harness/host.mjs'
import {
  React,
  setRoot,
  clearHooks,
  getTree,
  flush,
  click,
  textOf,
  find,
  findByText,
  findByProp,
  walk,
} from './harness/react.mjs'

const view = () => ({ children: getTree() })

const itemsOf = () =>
  [...walk(view())].filter(
    (node) =>
      node.type === 'li' &&
      typeof node.props?.className === 'string' &&
      node.props.className.split(/\s+/).includes('nm-item'),
  )
const rowsOf = () => itemsOf().filter((node) => node.props?.draggable === true)
const tabOf = (label) =>
  find(view(), (node) => node.props?.role === 'tab' && textOf(node).includes(label))
async function openTab(label) {
  const node = tabOf(label)
  assert.ok(node, `tab ${label} missing`)
  await click(node)
  await flush(20)
}

/* -------------------------------------------------------------------- tests */

console.log('dsh-night-museum client render test')

const seats = {}

async function mountApp() {
  function App() {
    return React.createElement(
      'div',
      { className: 'app' },
      React.createElement(seats['main:night-museum'].component, {}),
      React.createElement(seats['shell.overlay:night-museum-overlay'].component, {}),
    )
  }
  setRoot(React.createElement(App, {}))
  await flush(40)
}

const results = []
async function step(name, fn) {
  try {
    await fn()
    results.push({ name, ok: true })
    console.log(`  ✓ ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error?.message ?? String(error) })
    console.log(`  ✗ ${name}\n      ${error?.stack ?? error}`)
  }
}

await step('client half registers three seats', async () => {
  assert.ok(plugin, 'factory did not run')
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'uiWorkspace', 'layout'])
  const injected = []
  const ctx = {
    slots: {
      inject(name, factory) {
        injected.push(name)
        factory()
      },
      register(meta, component) {
        seats[meta.name + ':' + (meta.key ?? meta.id ?? '')] = { meta, component }
      },
    },
    uiWorkspace: { openSession(id) { seats.jumped = id } },
    layout: { selectPanel() {} },
  }
  await plugin.apply(ctx)
  assert.deepEqual(injected.sort(), ['main', 'shell.overlay', 'sidebar.panellist'])
  assert.equal(seats['main:night-museum'].meta.key, 'night-museum')
  assert.equal(seats['sidebar.panellist:night-museum'].meta.id, 'night-museum')
  assert.equal(seats['sidebar.panellist:night-museum'].meta.label(), '博物馆奇妙夜')
  assert.equal(seats['shell.overlay:night-museum-overlay'].meta.id, 'night-museum-overlay')
})

await step('page renders an empty gallery and the primary actions', async () => {
  await mountApp()
  const text = textOf(view())
  assert.match(text, /博物馆奇妙夜/)
  assert.match(text, /展厅还是空的/)
  assert.match(text, /录入第一件展品/)
  assert.match(text, /新增展品/)
  assert.match(text, /一键开始/)
  assert.match(text, /一键停止/)
  const startButton = findByText(view(), /一键开始/)
  assert.equal(startButton.props.disabled, true, 'nothing to run yet')
})

await step('styles are injected once, tagged to the plugin', async () => {
  assert.equal(styleTags.length, 1)
  assert.equal(styleTags[0].dataset.plugin, 'dsh-night-museum')
  assert.match(styleTags[0].textContent, /--dsw-alias-bg-base/)
  // 实心主按钮必须用「填充 / 前景」配对的主题变量：暗色主题里 brand-primary 接近白色，
  // 直接写 color:#fff 会变成白底白字。
  assert.match(styleTags[0].textContent, /\.nm-btn--primary\{[^}]*background:var\(--dsw-alias-button-primary-fill/)
  assert.match(styleTags[0].textContent, /\.nm-btn--primary\{[^}]*color:var\(--dsw-alias-label-primary-foreground\)/)
  assert.doesNotMatch(styleTags[0].textContent, /color:#fff/)
})

await step('opening the form lists real sessions and workspaces', async () => {
  await click(findByText(view(), /新增展品/))
  const form = findByProp(view(), 'id', /^nm-prompt$/)
  assert.ok(form, 'form did not open')
  const text = textOf(view())
  assert.match(text, /录入新展品/)
  assert.match(text, /一号会话/)
  assert.match(text, /空白会话/)
  await click(findByText(view(), /新增会话/))
  const after = textOf(view())
  assert.match(after, /一号工作区/)
  assert.match(after, /二号工作区/)
  await click(findByText(view(), /选择已有会话/))
})

await step('creating an exhibit from the form puts it on the list', async () => {
  const prompt = findByProp(view(), 'id', /^nm-prompt$/)
  prompt.props.onChange({ target: { value: '修复登录页的提交按钮' } })
  await flush()
  await click(findByText(view(), /一号会话/))
  assert.match(textOf(view()), /关联会话后自动带出工作区/)
  const form = find(view(), (candidate) => candidate.props?.onSubmit)
  await form.props.onSubmit({ preventDefault() {} })
  await flush()
  const text = textOf(view())
  assert.match(text, /修复登录页的提交按钮/)
  assert.match(text, /待巡展/)
  assert.match(text, /一号会话/)
  assert.match(text, /一号工作区/)
})

await step('overlay asks whether to start once 18:00 has passed', async () => {
  const text = textOf(view())
  assert.match(text, /《博物馆奇妙夜》该开演了/)
  assert.match(text, /18 点已过，还有 1 件展品没有闭馆/)
  assert.match(text, /稍后再提醒/)
  assert.match(text, /今天不再提醒/)
  assert.match(text, /开始巡展/)
  assert.equal(audio.oscillators, 0, 'no chime before a run finishes')
})

await step('start shows a confirm dialog and warns during peak hours', async () => {
  const startButton = findByText(view(), /一键开始/)
  assert.equal(startButton.props.disabled, false)
  await click(startButton)
  const text = textOf(view())
  assert.match(text, /开始《博物馆奇妙夜》？/)
  assert.match(text, /共 1 件展品/)
  assert.match(text, /1 条会话并行/)
  assert.match(text, /确认开演/)

  const mondayTen = new Date(2026, 10, 16, 10, 0, 0).getTime() // 2026-11-16 is a Monday
  setStateOverride({ now: mondayTen, peak: true })
  await flush()
  assert.match(textOf(view()), /现在是峰时/)
  setStateOverride(null)
  await flush()
})

await step('confirming start runs the exhibit to done', async () => {
  await click(findByText(view(), /确认开演/))
  await waitHost((state) => state.run.running === false && state.exhibits.every((item) => item.status === 'done'), 'run to finish')
  await flush(30)
  const text = textOf(view())
  assert.match(text, /已闭馆/)
  assert.match(text, /上一场/)
  assert.equal(hostSessions.prompts.length, 1)
  assert.match(hostSessions.prompts[0].text, /修复登录页的提交按钮/)
})

await step('closed exhibits move out of the gallery into the 已闭馆 tab', async () => {
  assert.equal(rowsOf().length, 0, 'main list must not show closed exhibits')
  assert.match(textOf(view()), /展厅已经清空/)
  assert.equal(tabOf('展厅').props['aria-selected'], true)

  await openTab('已闭馆')
  assert.equal(tabOf('已闭馆').props['aria-selected'], true)
  const items = itemsOf()
  assert.equal(items.length, 1)
  assert.match(textOf(items[0]), /修复登录页的提交按钮/)
  assert.equal(items[0].props.draggable, false, 'closed rows must not be draggable')
  assert.equal(find(items[0], (node) => node.props?.type === 'checkbox'), null, 'closed rows have no checkbox')
})

await step('session link jumps to the associated session', async () => {
  const link = find(view(), (candidate) => candidate.props?.className === 'nm-link')
  assert.ok(link, 'session link missing')
  await click(link)
  assert.equal(seats.jumped, 's-one')
})

await step('dragging a row reorders the gallery', async () => {
  await openTab('展厅')
  const createdB = await hostFetch('/api/night-museum/exhibit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'create', exhibit: { prompt: '整理夜间拍摄的素材', mode: 'existing', sessionId: 's-two' } }),
  })
  assert.equal((await createdB.json()).ok, true)
  const createdC = await hostFetch('/api/night-museum/exhibit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'create', exhibit: { prompt: '核对夜间展览清单', mode: 'existing', sessionId: 's-two' } }),
  })
  const idC = (await createdC.json()).exhibit.id
  await flush(30)

  const before = rowsOf().map((row) => textOf(row))
  assert.equal(before.length, 2)
  const drag = { dataTransfer: { effectAllowed: '', setData() {} }, preventDefault() {} }
  rowsOf()[0].props.onDragStart(drag)
  await flush(10)
  rowsOf()[1].props.onDragOver(drag)
  await flush(10)
  rowsOf()[1].props.onDragEnd()
  await flush(30)

  const state = await hostState()
  const order = state.exhibits.map((item) => item.prompt)
  assert.ok(
    order.indexOf('核对夜间展览清单') < order.indexOf('整理夜间拍摄的素材'),
    'dropped row becomes first among the gallery rows',
  )
  assert.equal(rowsOf().length, 2)

  const removed = await hostFetch('/api/night-museum/exhibit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id: idC }),
  })
  assert.equal((await removed.json()).ok, true)
  await flush(20)
})

await step('overlay plays the chime once the run finishes', async () => {
  assert.ok(audio.contexts >= 1, 'audio context was never created')
  assert.ok(audio.oscillators >= 5, `expected 5 chime notes, got ${audio.oscillators}`)
  const text = textOf(view())
  assert.match(text, /巡展结束/)
  assert.match(text, /1\/1 件展品已闭馆/)
})

await step('selecting a running exhibit switches the stop button and stops it', async () => {
  // Only the pending exhibit should be picked up by 一键开始; the closed one stays in its tab.
  const slowController = {
    async list() { return { items: [] } },
    async create() { return { sessionId: 'slow-session' } },
    async prompt() { return { accepted: true } },
    async state() { return { cursor: 0, active: true, running: false, queue: [], pendingInput: [] } },
    wait() { return new Promise(() => {}) },
    async cancel() { return { accepted: true } },
  }
  ctxSwitch(slowController)

  await flush(30)
  await click(findByText(view(), /一键开始/))
  await click(findByText(view(), /确认开演/))
  await waitHost((state) => state.run.running === true, 'run to start')
  await flush(30)
  assert.match(textOf(view()), /停止选中 0|一键停止/)

  const box = find(view(), (candidate) => candidate.props?.type === 'checkbox')
  box.props.onChange({ target: { checked: true } })
  await flush(20)
  assert.match(textOf(view()), /停止选中 1/)

  await click(findByText(view(), /停止选中 1/))
  assert.match(textOf(view()), /停止这些展品的巡展？/)
  await click(findByText(view(), /^停止巡展$/))
  await waitHost((state) => state.run.running === false, 'run to stop')
  await flush(30)
  assert.match(textOf(view()), /已停止/)
  ctxSwitch(hostSessions.controller)
})

await step('a stopped exhibit offers 继续 and resumes in the same session', async () => {
  const before = (await hostState()).exhibits.find((item) => item.status === 'stopped')
  assert.ok(before, 'expected a stopped exhibit from the previous test')
  const stoppedRow = rowsOf().find((row) => textOf(row).includes(before.prompt))
  assert.ok(stoppedRow, 'stopped row missing')
  const resumeChip = find(stoppedRow, (candidate) => candidate.type === 'button' && /继续/.test(textOf(candidate)))
  assert.ok(resumeChip, '继续 chip missing on a stopped exhibit')

  await click(resumeChip)
  const text = textOf(view())
  assert.match(text, /接着上一轮继续巡展？/)
  assert.match(text, /再发一条「继续」/)
  assert.match(text, /共 1 件展品/)
  assert.match(text, /确认继续/)

  await click(findByText(view(), /确认继续/))
  await waitHost((state) => state.run.running === false, 'resume run to finish')
  await flush(30)

  const after = (await hostState()).exhibits.find((item) => item.id === before.id)
  assert.equal(after.sessionId, before.sessionId, 'continue must stay in the same session')
  assert.equal(after.status, 'done')
  const last = hostSessions.prompts.filter((entry) => entry.sessionId === before.sessionId).pop()
  assert.equal(last.text, '继续')
  assert.match(textOf(view()), /继续开演/)
})

await step('delete dialog removes the exhibit', async () => {
  await openTab('已闭馆')
  const trash = find(view(), (candidate) => candidate.props?.['aria-label'] === '删除展品')
  await click(trash)
  assert.match(textOf(view()), /撤下这件展品？/)
  await click(findByText(view(), /^删除$/))
  await flush(30)
  const rows = itemsOf()
  assert.equal(rows.length, 1, 'only the deleted exhibit is gone')
  assert.match(textOf(rows[0]), /修复登录页的提交按钮/)
  assert.doesNotMatch(textOf(rows[0]), /整理夜间拍摄的素材/)
  assert.match(textOf(view()), /展品已撤出展厅/)
})

await step('the closed tab explains its own empty state', async () => {
  const remaining = (await hostState()).exhibits.find((item) => item.status === 'done')
  assert.ok(remaining, 'expected one closed exhibit left')
  const removed = await hostFetch('/api/night-museum/exhibit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id: remaining.id }),
  })
  assert.equal((await removed.json()).ok, true)
  await flush(30)
  assert.equal(itemsOf().length, 0)
  assert.match(textOf(view()), /还没有展品闭馆/)
})

await step('a bound new-session exhibit can switch to a fresh conversation', async () => {
  const created = await hostFetch('/api/night-museum/exhibit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'create',
      exhibit: { prompt: '把夜间导出的文件归档', mode: 'new', workspaceId: 'ws-two', workspacePath: '/tmp/ws-two', workspaceTitle: '二号工作区' },
    }),
  })
  const id = (await created.json()).exhibit.id
  const started = await hostFetch('/api/night-museum/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'start', ids: [id] }),
  })
  assert.equal((await started.json()).ok, true)
  await waitHost((state) => state.run.running === false, 'new-mode run to finish')
  await flush(30)

  const bound = (await hostState()).exhibits.find((item) => item.id === id)
  assert.ok(bound.sessionId, 'the new-mode exhibit keeps the session it created')
  const row = itemsOf().find((node) => textOf(node).includes('把夜间导出的文件归档'))
  assert.ok(row, 'new-mode row missing in the closed tab')

  // Closed rows have no 换会话 button: reset brings the exhibit back to the gallery first,
  // then the fresh-session action is available again.
  const reset = find(row, (candidate) => candidate.props?.['aria-label'] === '重置为待巡展')
  assert.ok(reset, 'reset button missing on a closed exhibit')
  await click(reset)
  await flush(30)
  assert.equal(tabOf('展厅').props['aria-selected'], true, 'resetting a closed exhibit returns to the gallery')

  const activeRow = itemsOf().find((node) => textOf(node).includes('把夜间导出的文件归档'))
  assert.ok(activeRow, 'reset row missing in the gallery')
  const fresh = find(activeRow, (candidate) => candidate.props?.['aria-label'] === '下次换一个新会话')
  assert.ok(fresh, '换新会话 button missing')
  await click(fresh)
  await flush(30)
  const after = (await hostState()).exhibits.find((item) => item.id === id)
  assert.equal(after.sessionId, null)
  assert.equal(after.status, 'pending')
  assert.match(textOf(view()), /干净的新会话/)

  const removed = await hostFetch('/api/night-museum/exhibit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id }),
  })
  assert.equal((await removed.json()).ok, true)
  await flush(20)
})

await step('an exhibit waiting for your answer shows stop but no 继续 or 重置', async () => {
  setStateOverride({
    exhibits: [
      {
        id: 'waiting-exhibit',
        title: '等你回应的展品',
        prompt: '等你回应的展品',
        mode: 'existing',
        sessionId: 's-wait',
        sessionTitle: '等你回应的会话',
        status: 'blocked',
        note: '回答会话里的提问后会自动接着巡展',
        active: true,
        updatedAt: Date.now(),
      },
    ],
    run: { running: true, startedAt: Date.now(), total: 1, done: 0 },
    lastRun: null,
  })
  await flush(2100)

  assert.match(textOf(view()), /等你回应 1/)
  const row = rowsOf().find((node) => textOf(node).includes('等你回应的展品'))
  assert.ok(row, 'waiting row missing')
  assert.ok(
    find(row, (node) => node.props?.['aria-label'] === '停止这件展品'),
    'a waiting exhibit must offer stop',
  )
  assert.equal(
    find(row, (node) => node.type === 'button' && /继续/.test(textOf(node))),
    null,
    'no 继续 while it is still waiting',
  )
  assert.equal(
    find(row, (node) => node.props?.['aria-label'] === '重置为待巡展'),
    null,
    'a waiting exhibit cannot be reset',
  )

  setStateOverride(null)
})

await step('sidebar icon renders an svg at the requested size', async () => {
  setRoot(React.createElement(seats['sidebar.panellist:night-museum'].component, { size: 22, active: false }))
  clearHooks()
  await flush(3)
  const svg = find(view(), (candidate) => candidate.type === 'svg')
  assert.ok(svg, 'no svg icon')
  assert.equal(svg.props.width, 22)
  assert.equal(svg.props.height, 22)
})

await new Promise((resolve) => setTimeout(resolve, 200))

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await disposeHome()
if (failed.length > 0) {
  console.log(failed.map((entry) => ` - ${entry.name}: ${entry.error}`).join('\n'))
  process.exit(1)
}
process.exit(0)
