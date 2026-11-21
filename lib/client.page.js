/**
 * dsh-night-museum — client gallery page.
 */

window.__ModuleLoader__.load({
  id: 'dsh-night-museum',
  chunk: 'client.page.js',
  factory(require) {
    const core = require('dsh-night-museum/client.core.js')
    const forms = require('dsh-night-museum/client.forms.js')
    const rowsView = require('dsh-night-museum/client.rows.js')
    const dialogs = require('dsh-night-museum/client.dialogs.js')
    const { React, h, cx, icon, clockOf, dateOf, isPeak, call, primeAudio, services, Dot, Btn, Toast } = core
    const { renderLoading, renderEmpty, renderRow } = rowsView
    const { renderDialogs } = dialogs

    const TAB_KEY = 'dsh-night-museum.tab'

    function readTab() {
      try {
        return window.sessionStorage.getItem(TAB_KEY) === 'closed' ? 'closed' : 'active'
      } catch {
        return 'active'
      }
    }

    function NightMuseumPage() {
      const [snapshot, setSnapshot] = React.useState(null)
      const [tab, setTab] = React.useState(readTab)
      const [loadError, setLoadError] = React.useState('')
      const [order, setOrder] = React.useState([])
      const [selected, setSelected] = React.useState(() => new Set())
      const [dialog, setDialog] = React.useState(null)
      const [sessions, setSessions] = React.useState(null)
      const [workspaces, setWorkspaces] = React.useState([])
      const [pickersLoading, setPickersLoading] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState(null)
      const [dragId, setDragId] = React.useState(null)
      const [overId, setOverId] = React.useState(null)

      const orderRef = React.useRef([])
      const draggingRef = React.useRef(false)
      const snapshotRef = React.useRef(null)

      React.useEffect(() => {
        orderRef.current = order
      }, [order])

      React.useEffect(() => {
        snapshotRef.current = snapshot
      }, [snapshot])

      React.useEffect(() => {
        try {
          window.sessionStorage.setItem(TAB_KEY, tab)
        } catch {
          /* 面板切走再回来时能停在同一个 tab 就够了，存不下也不影响使用 */
        }
      }, [tab])

      const showToast = React.useCallback((text, tone, detail) => {
        setToast({ text, tone, detail, id: `${Date.now()}-${Math.random()}` })
      }, [])

      React.useEffect(() => {
        let alive = true
        let timer = 0
        async function tick() {
          try {
            const data = await call('/state')
            if (!alive) return
            setSnapshot(data)
            setLoadError('')
            if (!draggingRef.current) setOrder(data.exhibits.map((item) => item.id))
            setSelected((previous) => {
              if (previous.size === 0) return previous
              const next = new Set()
              for (const id of previous) if (data.exhibits.some((item) => item.id === id)) next.add(id)
              return next.size === previous.size ? previous : next
            })
          } catch (error) {
            if (alive) setLoadError(error.message)
          } finally {
            if (alive) timer = setTimeout(tick, 2000)
          }
        }
        tick()
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [])

      const exhibits = snapshot?.exhibits || []
      const byId = React.useMemo(() => new Map(exhibits.map((item) => [item.id, item])), [exhibits])
      const ordered = React.useMemo(() => {
        const mapped = order.map((id) => byId.get(id)).filter(Boolean)
        if (mapped.length === exhibits.length && order.length === exhibits.length) return mapped
        return exhibits
      }, [order, byId, exhibits])
      const activeRows = React.useMemo(() => ordered.filter((item) => item.status !== 'done'), [ordered])
      const closedRows = React.useMemo(
        () =>
          exhibits
            .filter((item) => item.status === 'done')
            .slice()
            .sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0)),
        [exhibits],
      )
      const rows = tab === 'closed' ? closedRows : activeRows

      const counts = React.useMemo(() => {
        const result = { pending: 0, running: 0, done: 0, failed: 0, blocked: 0, stopped: 0 }
        for (const item of exhibits) result[item.status] = (result[item.status] || 0) + 1
        return result
      }, [exhibits])

      const now = React.useMemo(() => new Date(snapshot?.now || Date.now()), [snapshot?.now])
      const peak = isPeak(now)
      const running = snapshot?.run?.running === true
      const remaining = exhibits.length - counts.done
      // 「等你回应」的展品没有结束：仍算这一轮里活着的一件，也能被停止。
      const live = React.useMemo(
        () => exhibits.filter((item) => item.status === 'running' || item.active),
        [exhibits],
      )
      const waiting = React.useMemo(
        () => exhibits.filter((item) => item.active && item.status === 'blocked'),
        [exhibits],
      )
      const selectedStoppable = React.useMemo(
        () => exhibits.filter((item) => selected.has(item.id) && (item.status === 'running' || item.active)),
        [exhibits, selected],
      )

      async function ensurePickers() {
        if (sessions !== null) return
        setPickersLoading(true)
        try {
          const data = await call('/sessions')
          setSessions(data.sessions || [])
          setWorkspaces(data.workspaces || [])
        } catch (error) {
          showToast(error.message, 'error')
          setSessions([])
        } finally {
          setPickersLoading(false)
        }
      }

      async function openForm(mode, exhibit) {
        setDialog({ kind: 'form', exhibit: exhibit || null })
        await ensurePickers()
        if (sessions !== null) {
          try {
            const data = await call('/sessions')
            setSessions(data.sessions || [])
            setWorkspaces(data.workspaces || [])
          } catch {
            /* 保留上一次读取结果 */
          }
        }
      }

      function openDelete(exhibit) {
        setDialog({ kind: 'delete', exhibit })
      }

      async function submitForm(payload) {
        setBusy(true)
        try {
          if (dialog?.exhibit) {
            const data = await call('/exhibit', {
              action: 'update',
              id: dialog.exhibit.id,
              patch: payload,
            })
            setSnapshot(data.state)
          } else {
            const data = await call('/exhibit', { action: 'create', exhibit: payload })
            setSnapshot(data.state)
            setTab('active')
            showToast('展品已录入展厅。')
          }
          setDialog(null)
        } catch (error) {
          showToast(error.message, 'error')
        } finally {
          setBusy(false)
        }
      }

      async function removeExhibit(exhibit) {
        setBusy(true)
        try {
          const data = await call('/exhibit', { action: 'delete', id: exhibit.id })
          setSnapshot(data.state)
          setDialog(null)
          showToast('展品已撤出展厅。')
        } catch (error) {
          showToast(error.message, 'error')
        } finally {
          setBusy(false)
        }
      }

      async function resetExhibit(exhibit) {
        try {
          const data = await call('/exhibit', { action: 'reset', id: exhibit.id })
          setSnapshot(data.state)
          if (exhibit.status === 'done') {
            setTab('active')
            showToast('展品已移回展厅。')
          }
        } catch (error) {
          showToast(error.message, 'error')
        }
      }

      async function newSessionFor(exhibit) {
        try {
          const data = await call('/exhibit', { action: 'new-session', id: exhibit.id })
          setSnapshot(data.state)
          if (exhibit.status === 'done') setTab('active')
          showToast('这件展品下次巡展会开一个干净的新会话。')
        } catch (error) {
          showToast(error.message, 'error')
        }
      }

      async function persistOrder(ids) {
        try {
          const data = await call('/exhibit', { action: 'reorder', ids })
          setSnapshot(data.state)
        } catch (error) {
          showToast(error.message, 'error')
        }
      }

      function switchTab(next) {
        if (next === tab) return
        draggingRef.current = false
        setDragId(null)
        setOverId(null)
        setTab(next)
      }

      function onDragStart(event, id) {
        draggingRef.current = true
        setDragId(id)
        try {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', id)
        } catch {
          /* ignore */
        }
      }

      function onDragOver(event, id) {
        event.preventDefault()
        if (!draggingRef.current || dragId === null || dragId === id) return
        setOverId(id)
        setOrder((previous) => {
          const from = previous.indexOf(dragId)
          const to = previous.indexOf(id)
          if (from < 0 || to < 0 || from === to) return previous
          const next = previous.slice()
          next.splice(from, 1)
          next.splice(to, 0, dragId)
          return next
        })
      }

      function onDragEnd() {
        const ids = orderRef.current
        draggingRef.current = false
        setDragId(null)
        setOverId(null)
        persistOrder(ids)
      }

      function toggleSelected(id) {
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(id)) next.delete(id)
          else next.add(id)
          return next
        })
      }

      function openStart() {
        if (!snapshot) return
        if (running) {
          showToast('巡展正在进行中。', undefined, '等这一轮结束，或者先停止。')
          return
        }
        if (remaining === 0) {
          showToast('没有还未展出的展品。')
          return
        }
        setDialog({ kind: 'start' })
      }

      async function confirmStart() {
        setBusy(true)
        primeAudio()
        const resume = dialog?.resume === true
        try {
          const data = await call('/run', resume ? { action: 'resume', ids: dialog?.ids } : { action: 'start' })
          setSnapshot(data.state)
          setDialog(null)
          showToast(
            resume
              ? `《博物馆奇妙夜》继续开演：${data.total} 件展品接着上一轮做，${data.groups} 条会话并行。`
              : `《博物馆奇妙夜》开演：${data.total} 件展品，${data.groups} 条会话并行。`,
          )
        } catch (error) {
          showToast(error.message, 'error')
        } finally {
          setBusy(false)
        }
      }

      function openResume(item) {
        if (!snapshot) return
        if (running) {
          showToast('巡展正在进行中。', undefined, '等这一轮结束，或者先停止。')
          return
        }
        if (!item.sessionId) {
          showToast('这件展品还没有自己的会话。', undefined, '点「一键开始」时会在它的工作区新建一个。')
          return
        }
        setDialog({ kind: 'start', ids: [item.id], resume: true })
      }

      function openStop(ids) {
        if (!running) {
          showToast('当前没有正在巡展的展品。')
          return
        }
        if (Array.isArray(ids) && ids.length > 0) {
          setDialog({ kind: 'stop', ids })
          return
        }
        if (selectedStoppable.length > 0) {
          setDialog({ kind: 'stop', ids: selectedStoppable.map((item) => item.id) })
          return
        }
        const all = exhibits.filter((item) => item.status === 'running' || item.active)
        setDialog({ kind: 'stop', ids: all.map((item) => item.id) })
      }

      async function confirmStop() {
        setBusy(true)
        try {
          const data = await call('/run', { action: 'stop', ids: dialog?.ids })
          setSnapshot(data.state)
          setDialog(null)
          showToast(`已停止 ${data.ids.length} 件展品的巡展。`)
        } catch (error) {
          showToast(error.message, 'error')
        } finally {
          setBusy(false)
        }
      }

      function jumpToSession(sessionId) {
        if (!sessionId) return
        try {
          services.uiWorkspace?.openSession(sessionId)
        } catch (error) {
          showToast(`无法跳转会话：${error.message}`, 'error')
        }
      }

      const progress = snapshot?.run?.total ? (counts.done / Math.max(1, counts.done + live.length)) * 100 : 0

      const rowView = {
        dragId,
        overId,
        selected,
        onDragStart,
        onDragOver,
        onDragEnd,
        toggleSelected,
        jumpToSession,
        openResume,
        resetExhibit,
        newSessionFor,
        openForm,
        openDelete,
        openStop,
      }

      const body = (() => {
        if (!snapshot) return renderLoading(loadError)
        if (rows.length === 0) {
          if (tab === 'closed') return renderEmpty({ variant: 'closed' })
          if (exhibits.length === 0) return renderEmpty({ variant: 'all', onAdd: () => openForm('create') })
          return renderEmpty({
            variant: 'active',
            onAdd: () => openForm('create'),
            onOpenClosed: () => switchTab('closed'),
          })
        }
        return h(
          'ul',
          { className: 'nm-list' },
          rows.map((item, index) => renderRow(item, index, rowView)),
        )
      })()

      return h(
        'div',
        { className: 'nm-page' },
        h(
          'header',
          { className: 'nm-head' },
          h(
            'div',
            null,
            h('div', { className: 'nm-eyebrow' }, 'Night at the Museum · 夜间巡展'),
            h('h1', null, '博物馆奇妙夜'),
            h('p', { className: 'nm-sub' }, '闭馆之后，展品会自己走动。把任务录成展品，到点后按会话并发、同会话顺序地自动巡展。'),
          ),
          h(
            'div',
            { className: 'nm-head-right' },
            h('span', { className: 'nm-clock', title: '本机时间' }, icon('clock'), h('b', null, clockOf(now)), h('span', null, peak ? '峰时' : '夜间')),
            h(
              'span',
              { className: cx('nm-chip', peak ? 'nm-chip--peak' : 'nm-chip--brand') },
              running ? (waiting.length > 0 && waiting.length === live.length ? `等你回应 ${waiting.length}` : `巡展中 ${live.length}`) : peak ? '峰时运行' : '待命',
            ),
            h(Btn, { variant: 'ghost', iconName: 'stop', className: 'nm-btn--danger', disabled: !running, onClick: () => openStop() }, selectedStoppable.length > 0 ? `停止选中 ${selectedStoppable.length}` : '一键停止'),
            h(Btn, { variant: 'primary', iconName: 'play', disabled: running || remaining === 0, onClick: openStart }, '一键开始'),
          ),
        ),
        h(
          'div',
          { className: 'nm-tabs', role: 'tablist', 'aria-label': '展品分组' },
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'active',
              className: cx('nm-tab', tab === 'active' && 'is-on'),
              onClick: () => switchTab('active'),
            },
            h('span', null, '展厅'),
            h('span', { className: 'nm-tab-count' }, activeRows.length),
          ),
          h(
            'button',
            {
              type: 'button',
              role: 'tab',
              'aria-selected': tab === 'closed',
              className: cx('nm-tab', tab === 'closed' && 'is-on'),
              title: '已经闭馆的展品',
              onClick: () => switchTab('closed'),
            },
            h('span', null, '已闭馆'),
            h('span', { className: 'nm-tab-count' }, counts.done),
          ),
        ),
        h(
          'div',
          { className: 'nm-bar' },
          h(
            'div',
            { className: 'nm-stats' },
            h('span', { className: 'nm-stat' }, '待巡展', h('b', null, counts.pending)),
            h('span', { className: 'nm-stat' }, h(Dot, { tone: 'run' }), '巡展中', h('b', null, counts.running)),
            h('span', { className: 'nm-stat' }, h(Dot, { tone: 'done' }), '已闭馆', h('b', null, counts.done)),
            counts.failed ? h('span', { className: 'nm-stat' }, h(Dot, { tone: 'err' }), '出岔子', h('b', null, counts.failed)) : null,
            counts.blocked ? h('span', { className: 'nm-stat' }, h(Dot, { tone: 'warn' }), '等回应', h('b', null, counts.blocked)) : null,
            running ? h('span', { className: 'nm-chip nm-chip--brand' }, `进度 ${counts.done}/${counts.done + live.length}`) : null,
          ),
          h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Btn, { variant: 'primary', iconName: 'plus', onClick: () => openForm('create') }, '新增展品'),
          ),
        ),
        running ? h('div', { className: 'nm-progress', role: 'progressbar', 'aria-valuenow': Math.round(progress) }, h('span', { style: { width: `${Math.max(3, progress)}%` } })) : null,
        body,
        h(
          'div',
          { className: 'nm-foot' },
          h(
            'span',
            null,
            tab === 'closed'
              ? '已闭馆的展品按闭馆时间倒序排列，点重置会回到展厅。'
              : '拖动展品左侧手柄调整出场顺序。',
          ),
          h('span', null, snapshot?.lastRun ? `上一场：${dateOf(snapshot.lastRun.finishedAt)} · ${snapshot.lastRun.done}/${snapshot.lastRun.total} 件闭馆` : '还没有办过巡展。'),
        ),
        renderDialogs({
          dialog,
          busy,
          setDialog,
          submitForm,
          removeExhibit,
          sessions,
          workspaces,
          pickersLoading,
          exhibits,
          peak,
          confirmStart,
          confirmStop,
        }),
        h(Toast, { toast, onClose: () => setToast(null) }),
      )
    }

    return { NightMuseumPage }
  },
})
