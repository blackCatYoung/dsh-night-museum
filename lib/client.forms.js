/**
 * dsh-night-museum — client forms: session picker, exhibit editor, run summary.
 */

window.__ModuleLoader__.load({
  id: 'dsh-night-museum',
  chunk: 'client.forms.js',
  factory(require) {
    const core = require('dsh-night-museum/client.core.js')
    const { React, h, cx, icon, shortPath, basename, Dot, Btn } = core

    function SessionPicker({ sessions, value, onPick, filter, onFilter }) {
      const needle = filter.trim().toLowerCase()
      const list = (sessions || []).filter((item) => {
        if (needle === '') return true
        return `${item.title} ${item.cwd}`.toLowerCase().includes(needle)
      })
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
        h('input', {
          className: 'nm-input',
          placeholder: '搜索会话标题或路径…',
          value: filter,
          onChange: (event) => onFilter(event.target.value),
        }),
        h(
          'div',
          { className: 'nm-picker' },
          list.length === 0
            ? h('div', { className: 'nm-pick-empty' }, sessions === null ? '正在读取会话…' : '没有匹配的会话')
            : list.map((item) =>
                h(
                  'button',
                  {
                    key: item.id,
                    type: 'button',
                    className: cx('nm-pick', item.id === value && 'is-on'),
                    onClick: () => onPick(item),
                  },
                  h('span', { className: 'nm-pick-title' }, item.running ? h(Dot, { tone: 'run' }) : null, item.title),
                  h('span', { className: 'nm-pick-sub' }, `${basename(item.cwd) || '会话'} ${item.cwd ? '·' : ''} ${item.cwd ? shortPath(item.cwd, 52) : ''}`),
                ),
              ),
        ),
      )
    }

    function ExhibitForm({ initial, sessions, workspaces, loading, onSubmit, onCancel, busy }) {
      const [title, setTitle] = React.useState(initial?.title || '')
      const [prompt, setPrompt] = React.useState(initial?.prompt || '')
      const [mode, setMode] = React.useState(initial?.mode || 'existing')
      const [sessionId, setSessionId] = React.useState(initial?.sessionId || '')
      const [workspaceId, setWorkspaceId] = React.useState(initial?.workspaceId || '')
      const [filter, setFilter] = React.useState('')
      const [error, setError] = React.useState('')

      const list = sessions || []
      const picked = list.find((item) => item.id === sessionId) || null
      const pickedWorkspace = (workspaces || []).find((item) => item.id === workspaceId) || null
      const effectiveWorkspace =
        mode === 'existing'
          ? picked?.cwd || initial?.workspacePath || ''
          : pickedWorkspace?.path || initial?.workspacePath || ''

      function submit(event) {
        event.preventDefault()
        setError('')
        if (prompt.trim() === '') {
          setError('先写下这件展品要做的事。')
          return
        }
        if (mode === 'existing' && !sessionId) {
          setError('选一个要关联的会话。')
          return
        }
        if (mode === 'new' && !workspaceId) {
          setError('选一个新会话要落在哪个工作区。')
          return
        }
        const payload = { title: title.trim(), prompt, mode }
        if (mode === 'existing') {
          const fallback = picked || { title: initial?.sessionTitle || '', cwd: initial?.workspacePath || '', workspaceId: initial?.workspaceId || null, workspaceTitle: initial?.workspaceTitle || '' }
          payload.sessionId = sessionId
          payload.sessionTitle = fallback.title
          payload.workspaceId = fallback.workspaceId || null
          payload.workspacePath = fallback.cwd || ''
          payload.workspaceTitle = fallback.workspaceTitle || basename(fallback.cwd)
        } else {
          payload.workspaceId = workspaceId
          payload.workspacePath = pickedWorkspace?.path || initial?.workspacePath || ''
          payload.workspaceTitle = pickedWorkspace?.title || initial?.workspaceTitle || ''
        }
        onSubmit(payload)
      }

      return h(
        'form',
        { className: 'nm-form', onSubmit: submit },
        h(
          'div',
          { className: 'nm-field' },
          h('label', { className: 'nm-label', htmlFor: 'nm-title' }, h('b', null, '展品名称'), h('span', null, '留空则取内容首行')),
          h('input', {
            id: 'nm-title',
            className: 'nm-input',
            placeholder: '例如：补齐登录页的空状态',
            value: title,
            maxLength: 80,
            onChange: (event) => setTitle(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'nm-field' },
          h('label', { className: 'nm-label', htmlFor: 'nm-prompt' }, h('b', null, '展品内容'), h('span', null, '会被当作一条完整指令投进会话')),
          h('textarea', {
            id: 'nm-prompt',
            className: 'nm-textarea',
            placeholder: '写下这件展品今晚要完成的事：目标、范围、验收标准……',
            value: prompt,
            maxLength: 20000,
            onChange: (event) => setPrompt(event.target.value),
          }),
        ),
        h(
          'div',
          { className: 'nm-field' },
          h('div', { className: 'nm-label' }, h('b', null, '关联会话')),
          h(
            'div',
            { className: 'nm-seg', role: 'tablist' },
            h('button', { type: 'button', className: cx(mode === 'existing' && 'is-on'), onClick: () => setMode('existing') }, '选择已有会话'),
            h('button', { type: 'button', className: cx(mode === 'new' && 'is-on'), onClick: () => setMode('new') }, '新增会话'),
          ),
        ),
        mode === 'existing'
          ? h(SessionPicker, {
              sessions: loading ? null : sessionId && !picked ? [...list, { id: sessionId, title: initial?.sessionTitle || '已关联的会话', cwd: initial?.workspacePath || '' }] : list,
              value: sessionId,
              filter,
              onFilter: setFilter,
              onPick: (item) => {
                setSessionId(item.id)
                setWorkspaceId(item.workspaceId || '')
              },
            })
          : h(
              'div',
              { className: 'nm-field' },
              h('div', { className: 'nm-label' }, h('b', null, '新会话工作区'), h('span', null, '首次巡展时新建，之后一直沿用这个会话')),
              h(
                'div',
                { className: 'nm-picker' },
                (workspaces || []).length === 0
                  ? h('div', { className: 'nm-pick-empty' }, loading ? '正在读取工作区…' : '没有可选工作区')
                  : (workspaces || []).map((item) =>
                      h(
                        'button',
                        {
                          key: item.id,
                          type: 'button',
                          className: cx('nm-pick', item.id === workspaceId && 'is-on'),
                          onClick: () => setWorkspaceId(item.id),
                        },
                        h('span', { className: 'nm-pick-title' }, icon('folder'), item.title),
                        h('span', { className: 'nm-pick-sub' }, shortPath(item.path, 56)),
                      ),
                    ),
              ),
            ),
        h(
          'div',
          { className: 'nm-note' },
          icon(mode === 'existing' ? 'link' : 'folder'),
          h(
            'div',
            null,
            mode === 'existing'
              ? sessionId
                ? ['关联会话后自动带出工作区：', h('span', { key: 'p', className: 'nm-mono' }, shortPath(effectiveWorkspace || '未记录工作区', 60))]
                : '选一个会话，工作区会自动跟过来。'
              : effectiveWorkspace
                ? [
                    '首次巡展时会在该工作区新建会话，之后一直沿用；半途停下能在这个会话里继续：',
                    h('span', { key: 'p', className: 'nm-mono' }, shortPath(effectiveWorkspace, 60)),
                  ]
                : '新会话需要先落在一个工作区里。',
          ),
        ),
        error ? h('div', { className: 'nm-note nm-note--error' }, error) : null,
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          h(Btn, { type: 'button', variant: 'ghost', onClick: onCancel, disabled: busy }, '取消'),
          h(Btn, { type: 'submit', variant: 'primary', disabled: busy }, busy ? '保存中…' : initial ? '保存展品' : '录入展品'),
        ),
      )
    }

    function RunSummary({ pending, peak, resume }) {
      const sessionKeys = new Set()
      for (const item of pending) sessionKeys.add(item.sessionId ? `s:${item.sessionId}` : `n:${item.id}`)
      const lanes = sessionKeys.size
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'nm-kv' },
          h('span', null, `共 ${pending.length} 件展品`),
          h('span', null, '·'),
          h('span', null, `${lanes} 条会话并行`),
          h('span', null, '·'),
          h('span', null, '同一会话内按顺序点亮'),
        ),
        resume
          ? h(
              'div',
              { className: 'nm-note' },
              icon('resume'),
              h('div', null, '会给这些展品原来所在的会话再发一条「继续」，让它们接着上一轮的进度往下做，不会重新开头。'),
            )
          : null,
        peak
          ? h(
              'div',
              { className: 'nm-note nm-note--warn', style: { marginTop: 12 } },
              icon('peak'),
              h('div', null, '现在是峰时（周一至周五 9:00–12:00、14:00–18:00）。巡展会在这些会话里同时跑任务，可能占用你正在使用的工作区额度。'),
            )
          : null,
        h(
          'ul',
          { className: 'nm-confirm-list' },
          pending.slice(0, 40).map((item) =>
            h(
              'li',
              { key: item.id },
              h(Dot, { tone: item.status === 'running' ? 'run' : '' }),
              h('span', null, item.title),
              h(
                'span',
                { className: 'nm-chip', style: { marginLeft: 'auto' } },
                item.sessionId ? (item.mode === 'existing' ? '已有会话' : '夜间会话') : '新建会话',
              ),
            ),
          ),
          pending.length > 40 ? h('li', null, h('span', null, `…以及另外 ${pending.length - 40} 件`)) : null,
        ),
      )
    }

    return { SessionPicker, ExhibitForm, RunSummary }
  },
})
