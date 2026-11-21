/**
 * dsh-night-museum — 18:00 reminder overlay and run-finished chime.
 */

window.__ModuleLoader__.load({
  id: 'dsh-night-museum',
  chunk: 'client.overlay.js',
  factory(require) {
    const core = require('dsh-night-museum/client.core.js')
    const forms = require('dsh-night-museum/client.forms.js')
    const { React, h, PANEL_ID, SEEN_KEY, services, isPeak, call, primeAudio, playChime, Btn, Dialog, Toast } = core
    const { RunSummary } = forms

    function NightMuseumOverlay() {
      const [snapshot, setSnapshot] = React.useState(null)
      const [snoozeUntil, setSnoozeUntil] = React.useState(0)
      const [busy, setBusy] = React.useState(false)
      const [toast, setToast] = React.useState(null)
      const seenRef = React.useRef(undefined)

      const showToast = React.useCallback((text, tone, detail, duration) => {
        setToast({ text, tone, detail, duration, id: `${Date.now()}-${Math.random()}` })
      }, [])

      React.useEffect(() => {
        let alive = true
        let timer = 0
        async function tick() {
          try {
            const data = await call('/state')
            if (!alive) return
            setSnapshot(data)
            const finishedAt = Number(data.lastRun?.finishedAt) || 0
            if (seenRef.current === undefined) {
              let stored = 0
              try {
                stored = Number(window.localStorage.getItem(SEEN_KEY)) || 0
              } catch {
                stored = 0
              }
              seenRef.current = Math.max(stored, finishedAt)
              try {
                window.localStorage.setItem(SEEN_KEY, String(seenRef.current))
              } catch {
                /* ignore */
              }
            } else if (finishedAt > seenRef.current) {
              seenRef.current = finishedAt
              try {
                window.localStorage.setItem(SEEN_KEY, String(finishedAt))
              } catch {
                /* ignore */
              }
              const last = data.lastRun
              playChime()
              showToast(
                '《博物馆奇妙夜》巡展结束',
                undefined,
                `${last?.done ?? 0}/${last?.total ?? 0} 件展品已闭馆${last?.failed ? `，${last.failed} 件出岔子` : ''}${last?.blocked ? `，${last.blocked} 件等你回应` : ''}`,
                14000,
              )
            }
          } catch {
            /* 宿主暂时不可达时安静重试 */
          } finally {
            if (alive) timer = setTimeout(tick, 12000)
          }
        }
        tick()
        return () => {
          alive = false
          clearTimeout(timer)
        }
      }, [showToast])

      const due = snapshot?.reminder?.due === true && Date.now() >= snoozeUntil
      const pending = (snapshot?.exhibits || []).filter((item) => item.status !== 'done')
      const peak = isPeak(new Date())

      async function dismissToday() {
        try {
          const data = await call('/run', { action: 'dismiss' })
          setSnapshot(data.state)
        } catch {
          setSnoozeUntil(Date.now() + 30 * 60 * 1000)
        }
      }

      async function confirmStart() {
        setBusy(true)
        primeAudio()
        try {
          const data = await call('/run', { action: 'start' })
          setSnapshot(data.state)
          showToast(`《博物馆奇妙夜》开演：${data.total} 件展品，${data.groups} 条会话并行。`, undefined, undefined, 7000)
        } catch (error) {
          showToast(error.message, 'error', undefined, 8000)
        } finally {
          setBusy(false)
        }
      }

      function openPanel() {
        try {
          services.layout?.selectPanel(PANEL_ID)
        } catch {
          /* 面板尚未注册时忽略 */
        }
      }

      const visible = due

      return h(
        React.Fragment,
        null,
        visible
          ? h(
              Dialog,
              {
                title: '《博物馆奇妙夜》该开演了',
                subtitle: `18 点已过，还有 ${pending.length} 件展品没有闭馆。要现在开始吗？`,
                onClose: busy ? undefined : () => setSnoozeUntil(Date.now() + 30 * 60 * 1000),
                footer: h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 10 } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8 } },
                    h(Btn, { variant: 'ghost', onClick: () => setSnoozeUntil(Date.now() + 30 * 60 * 1000) }, '稍后再提醒'),
                    h(Btn, { variant: 'ghost', onClick: dismissToday }, '今天不再提醒'),
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 8 } },
                    h(Btn, { variant: 'ghost', onClick: openPanel }, '查看展厅'),
                    h(Btn, { variant: 'primary', iconName: 'play', onClick: confirmStart, disabled: busy }, busy ? '开演中…' : '开始巡展'),
                  ),
                ),
              },
              snapshot ? h(RunSummary, { pending, peak }) : null,
            )
          : null,
        toast
          ? h(Toast, {
              toast,
              onClose: () => {
                setToast(null)
              },
            })
          : null,
      )
    }

    return { NightMuseumOverlay }
  },
})
