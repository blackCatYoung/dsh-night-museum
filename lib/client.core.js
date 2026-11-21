/**
 * dsh-night-museum — client core: shared state, helpers and primitives.
 *
 * Loaded as a package-local chunk (`require.async('./client.core.js')`) and
 * shared synchronously by the other chunks.
 */

window.__ModuleLoader__.load({
  id: 'dsh-night-museum',
  chunk: 'client.core.js',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const PANEL_ID = 'night-museum'
    const API = '/api/night-museum'
    const SEEN_KEY = 'dsh-night-museum.seen-run'

    const services = {}

    /* -------------------------------------------------------------- utils */

    function cx(...values) {
      return values.filter(Boolean).join(' ')
    }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function pad3(value) {
      return String(value).padStart(3, '0')
    }

    function clockOf(date) {
      return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`
    }

    function dateOf(ms) {
      if (!ms) return ''
      const date = new Date(ms)
      const today = new Date()
      const sameDay = date.toDateString() === today.toDateString()
      return sameDay ? `今天 ${clockOf(date)}` : `${date.getMonth() + 1}月${date.getDate()}日 ${clockOf(date)}`
    }

    function isPeak(date) {
      const day = date.getDay()
      if (day < 1 || day > 5) return false
      const minutes = date.getHours() * 60 + date.getMinutes()
      return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080)
    }

    function basename(target) {
      if (typeof target !== 'string' || target === '') return ''
      const parts = target.replace(/[\\/]+$/, '').split(/[\\/]/)
      return parts[parts.length - 1] || target
    }

    function shortPath(target, max = 42) {
      if (!target) return ''
      if (target.length <= max) return target
      return `…${target.slice(target.length - max + 1)}`
    }

    async function call(path, body) {
      const init =
        body === undefined
          ? { headers: { accept: 'application/json' } }
          : {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }
      const response = await fetch(`${API}${path}`, init)
      let data = {}
      try {
        data = await response.json()
      } catch {
        data = {}
      }
      if (!response.ok || data.ok === false) throw new Error(data.error || `请求失败（HTTP ${response.status}）`)
      return data
    }

    /* -------------------------------------------------------------- audio */

    let audioContext = null

    function primeAudio() {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext
        if (!Ctor) return
        if (!audioContext) audioContext = new Ctor()
        if (audioContext.state === 'suspended') audioContext.resume().catch(() => {})
      } catch {
        /* 没有音频也不影响巡展 */
      }
    }

    function playChime() {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext
        if (!Ctor) return
        if (!audioContext) audioContext = new Ctor()
        const ctx = audioContext
        if (ctx.state === 'suspended') ctx.resume().catch(() => {})
        const start = ctx.currentTime + 0.02
        const notes = [
          [523.25, 0],
          [659.25, 0.16],
          [783.99, 0.32],
          [1046.5, 0.54],
          [1318.5, 0.72],
        ]
        for (const [frequency, offset] of notes) {
          const oscillator = ctx.createOscillator()
          const gain = ctx.createGain()
          oscillator.type = 'sine'
          oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0.0001, start + offset)
          gain.gain.exponentialRampToValueAtTime(0.09, start + offset + 0.04)
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 1.15)
          oscillator.connect(gain)
          gain.connect(ctx.destination)
          oscillator.start(start + offset)
          oscillator.stop(start + offset + 1.2)
        }
      } catch {
        /* 浏览器拦截了声音就安静收场 */
      }
    }

    try {
      if (!Number(window.localStorage.getItem(SEEN_KEY))) window.localStorage.setItem(SEEN_KEY, '0')
    } catch {
      /* ignore */
    }

    /* ------------------------------------------------------------- visuals */

    const RESUMABLE = new Set(['stopped', 'failed', 'blocked'])

    const STATUS = {
      pending: { label: '待巡展', tone: '' },
      running: { label: '巡展中', tone: 'run' },
      done: { label: '已闭馆', tone: 'done' },
      failed: { label: '出岔子', tone: 'err' },
      stopped: { label: '已停止', tone: 'warn' },
      blocked: { label: '等你回应', tone: 'warn' },
    }

    function icon(name, props) {
      const common = {
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        className: 'nm-ico',
        'aria-hidden': 'true',
        ...(props || {}),
      }
      switch (name) {
        case 'play':
          return h('svg', common, h('path', { d: 'M5 3.6 12 8l-7 4.4V3.6Z', fill: 'currentColor', stroke: 'none' }))
        case 'stop':
          return h('svg', common, h('rect', { x: 4.5, y: 4.5, width: 7, height: 7, rx: 1.6, fill: 'currentColor', stroke: 'none' }))
        case 'plus':
          return h('svg', common, h('path', { d: 'M8 3.5v9M3.5 8h9' }))
        case 'edit':
          return h('svg', common, h('path', { d: 'M10.6 2.9 13 5.3 5.8 12.5l-3 .5.5-3L10.6 2.9Z' }))
        case 'trash':
          return h('svg', common, h('path', { d: 'M3 4.5h10M6.4 4.5V3h3.2v1.5M4.6 4.5l.5 8.2h5.8l.5-8.2' }))
        case 'reset':
          return h('svg', common, h('path', { d: 'M3.2 8a4.8 4.8 0 1 0 1.5-3.4M3 2.6v2.8h2.8' }))
        case 'resume':
          return h(
            'svg',
            common,
            h('path', { d: 'M3.3 8a4.7 4.7 0 1 0 1.6-3.5M3.1 2.5v3h3' }),
            h('path', { d: 'M7 6.2 10.2 8 7 9.8V6.2Z', fill: 'currentColor', stroke: 'none' }),
          )
        case 'fresh':
          return h(
            'svg',
            common,
            h('path', { d: 'M2.8 4h10.4v6.4H8.2L5.4 13v-2.6H2.8V4Z' }),
            h('path', { d: 'M8 5.8v2.8M6.6 7.2h2.8' }),
          )
        case 'up':
          return h('svg', common, h('path', { d: 'M8 12.5V4M4.6 7.2 8 3.8l3.4 3.4' }))
        case 'down':
          return h('svg', common, h('path', { d: 'M8 3.5V12M4.6 8.8 8 12.2l3.4-3.4' }))
        case 'link':
          return h('svg', common, h('path', { d: 'M6.6 9.4 9.4 6.6M7.2 4.6l1-1a2.6 2.6 0 0 1 3.7 3.7l-1 1M8.8 11.4l-1 1a2.6 2.6 0 0 1-3.7-3.7l1-1' }))
        case 'folder':
          return h('svg', common, h('path', { d: 'M2.4 4.4h4l1.2 1.5h5.9v6.2H2.4V4.4Z' }))
        case 'clock':
          return h('svg', common, h('circle', { cx: 8, cy: 8, r: 5.6 }), h('path', { d: 'M8 4.9V8l2.1 1.4' }))
        case 'moon':
          return h('svg', { ...common, viewBox: '0 0 24 24', strokeWidth: 1.4, className: 'nm-ico', style: { width: 30, height: 30 } },
            h('path', { d: 'M20 14.4A8.4 8.4 0 0 1 9.6 4a8.6 8.6 0 1 0 10.4 10.4Z' }))
        case 'check':
          return h('svg', common, h('path', { d: 'M3.4 8.4 6.6 11.6 12.8 5' }))
        case 'sound':
          return h('svg', common, h('path', { d: 'M4 6.4h2.2L9.4 4v8L6.2 9.6H4a.8.8 0 0 1-.8-.8V7.2a.8.8 0 0 1 .8-.8ZM11.6 6.2a2.6 2.6 0 0 1 0 3.6M13.4 4.6a4.8 4.8 0 0 1 0 6.8' }))
        case 'close':
          return h('svg', common, h('path', { d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6' }))
        case 'grip':
          return h('svg', { viewBox: '0 0 8 16', width: 8, height: 16, 'aria-hidden': 'true', fill: 'currentColor', className: 'nm-ico' },
            h('circle', { cx: 2, cy: 4, r: 1.1 }), h('circle', { cx: 6, cy: 4, r: 1.1 }),
            h('circle', { cx: 2, cy: 8, r: 1.1 }), h('circle', { cx: 6, cy: 8, r: 1.1 }),
            h('circle', { cx: 2, cy: 12, r: 1.1 }), h('circle', { cx: 6, cy: 12, r: 1.1 }))
        case 'peak':
          return h('svg', common, h('path', { d: 'M8 2.6 13.4 12H2.6L8 2.6ZM8 6.6v2.6M8 10.8v.1' }))
        default:
          return null
      }
    }

    function Dot({ tone }) {
      return h('i', { className: cx('nm-dot', tone === 'run' && 'nm-dot--run', tone === 'done' && 'nm-dot--done', tone === 'warn' && 'nm-dot--warn', tone === 'err' && 'nm-dot--err') })
    }

    function Pill({ status }) {
      const meta = STATUS[status] || STATUS.pending
      return h('span', { className: cx('nm-pill', meta.tone && `nm-pill--${meta.tone}`) }, h(Dot, { tone: meta.tone }), meta.label)
    }

    function Btn({ variant, iconName, children, ...rest }) {
      return h(
        'button',
        { type: 'button', ...rest, className: cx('nm-btn', variant && `nm-btn--${variant}`, rest.className) },
        iconName ? icon(iconName) : null,
        children,
      )
    }

    function IconBtn({ iconName, label, danger, ...rest }) {
      return h(
        'button',
        { type: 'button', 'aria-label': label, title: label, ...rest, className: cx('nm-icon-btn', danger && 'nm-icon-btn--danger', rest.className) },
        icon(iconName),
      )
    }

    function Dialog({ title, subtitle, onClose, children, footer, small, width }) {
      React.useEffect(() => {
        function onKey(event) {
          if (event.key === 'Escape') onClose?.()
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [onClose])
      return h(
        'div',
        {
          className: 'nm-mask',
          onMouseDown: (event) => {
            if (event.target === event.currentTarget) onClose?.()
          },
        },
        h(
          'div',
          { className: cx('nm-dialog', small && 'nm-dialog--sm'), style: width ? { width } : undefined, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
          h(
            'div',
            { className: 'nm-dialog-head' },
            h('div', null, h('h2', null, title), subtitle ? h('p', null, subtitle) : null),
            onClose ? h(IconBtn, { iconName: 'close', label: '关闭', onClick: onClose }) : null,
          ),
          h('div', { className: 'nm-dialog-body' }, children),
          footer ? h('div', { className: 'nm-dialog-foot' }, footer) : null,
        ),
      )
    }

    function Toast({ toast, onClose }) {
      React.useEffect(() => {
        if (!toast) return undefined
        const timer = setTimeout(onClose, toast.duration || 7000)
        return () => clearTimeout(timer)
      }, [toast, onClose])
      if (!toast) return null
      return h(
        'div',
        { className: cx('nm-toast', toast.tone === 'error' && 'nm-toast--error'), role: 'status' },
        h('div', { style: { minWidth: 0 } }, toast.text, toast.detail ? h('em', null, toast.detail) : null),
        h('button', { type: 'button', onClick: onClose, 'aria-label': '关闭提示' }, '×'),
      )
    }

    return {
      React,
      h,
      PANEL_ID,
      API,
      SEEN_KEY,
      services,
      cx,
      pad2,
      pad3,
      clockOf,
      dateOf,
      isPeak,
      basename,
      shortPath,
      call,
      primeAudio,
      playChime,
      RESUMABLE,
      STATUS,
      icon,
      Dot,
      Pill,
      Btn,
      IconBtn,
      Dialog,
      Toast,
    }
  },
})
