/**
 * dsh-night-museum — client list rows and empty state.
 */

window.__ModuleLoader__.load({
  id: 'dsh-night-museum',
  chunk: 'client.rows.js',
  factory(require) {
    const core = require('dsh-night-museum/client.core.js')
    const { h, cx, icon, basename, dateOf, pad2, RESUMABLE, Pill, IconBtn, Btn } = core

    function renderEmpty({ variant = 'all', onAdd, onOpenClosed }) {
      if (variant === 'closed') {
        return h(
          'div',
          { className: 'nm-empty' },
          icon('moon'),
          h('h3', null, '还没有展品闭馆'),
          h('p', null, '巡展跑完的展品会收进这里，按闭馆时间排列；点重置就会回到展厅，等待下一场。'),
        )
      }
      if (variant === 'active') {
        return h(
          'div',
          { className: 'nm-empty' },
          icon('moon'),
          h('h3', null, '展厅已经清空'),
          h('p', null, '今晚的展品都闭馆了。去「已闭馆」看看它们，或者接着录入新的展品。'),
          h(
            'div',
            { className: 'nm-empty-acts' },
            h(Btn, { variant: 'ghost', iconName: 'check', onClick: onOpenClosed }, '查看已闭馆'),
            h(Btn, { variant: 'primary', iconName: 'plus', onClick: onAdd }, '录入新展品'),
          ),
        )
      }
      return h(
        'div',
        { className: 'nm-empty' },
        icon('moon'),
        h('h3', null, '展厅还是空的'),
        h('p', null, '把今晚想跑的任务录成展品。18 点之后，它们会按各自关联的会话自动走上展台——不同会话并行，同一会话按你排的顺序。'),
        h(Btn, { variant: 'primary', iconName: 'plus', onClick: onAdd }, '录入第一件展品'),
      )
    }

    function renderLoading(loadError) {
      return h(
        'div',
        { className: 'nm-empty' },
        icon('moon'),
        h('h3', null, loadError ? '展厅暂时打不开' : '正在开灯…'),
        h('p', null, loadError || '正在读取今晚的展品清单。'),
      )
    }

    function renderRow(item, index, view) {
      const {
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
      } = view
      const archived = item.status === 'done'
      return h(
        'li',
        {
          key: item.id,
          className: cx('nm-item', archived && 'nm-item--archived', dragId === item.id && 'is-drag', overId === item.id && dragId !== item.id && 'is-over', selected.has(item.id) && 'is-sel'),
          draggable: !archived,
          onDragStart: archived ? undefined : (event) => onDragStart(event, item.id),
          onDragOver: archived ? undefined : (event) => onDragOver(event, item.id),
          onDrop: archived
            ? undefined
            : (event) => {
                event.preventDefault()
                onDragEnd()
              },
          onDragEnd: archived ? undefined : onDragEnd,
        },
        archived
          ? h('span', { className: 'nm-grip nm-grip--static', 'aria-hidden': 'true' }, icon('check'))
          : h('span', { className: 'nm-grip', title: '拖动调整顺序', 'aria-hidden': 'true' }, icon('grip')),
        archived
          ? h('span', { className: 'nm-check nm-check--static', 'aria-hidden': 'true' })
          : h('input', {
              type: 'checkbox',
              className: 'nm-check',
              checked: selected.has(item.id),
              onChange: () => toggleSelected(item.id),
              'aria-label': `选择 ${item.title}`,
            }),
        h('span', { className: 'nm-idx' }, pad2(index + 1)),
        h(
          'div',
          { className: 'nm-body' },
          h('div', { className: 'nm-item-title' }, item.title),
          h('div', { className: 'nm-item-prompt' }, item.prompt),
          h(
            'div',
            { className: 'nm-meta' },
            h(
              'span',
              { className: 'nm-meta-item' },
              icon('link'),
              item.sessionId || item.lastSessionId
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'nm-link',
                      title: '在当前窗口打开该会话',
                      onClick: () => jumpToSession(item.sessionId || item.lastSessionId),
                    },
                    item.sessionTitle || (item.mode === 'new' ? '夜间巡展会话' : '关联会话'),
                  )
                : h('span', { style: { opacity: 0.75 } }, '首次巡展时新建会话，之后沿用'),
            ),
            h(
              'span',
              { className: 'nm-meta-item', title: item.workspacePath || '' },
              icon('folder'),
              h('span', null, item.workspaceTitle || basename(item.workspacePath) || '未记录工作区'),
            ),
            RESUMABLE.has(item.status) && !item.active
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: 'nm-link nm-link--resume',
                    title: '在这个会话里再发一条「继续」，接着上一轮的进度做',
                    onClick: () => openResume(item),
                  },
                  icon('resume'),
                  '继续',
                )
              : null,
            item.note ? h('span', { className: 'nm-meta-item' }, icon('clock'), h('span', null, item.note)) : null,
            item.status === 'done' && item.updatedAt
              ? h('span', { className: 'nm-meta-item' }, h('span', { className: 'nm-mono' }, dateOf(item.updatedAt)), h('span', null, '闭馆'))
              : null,
          ),
        ),
        h(
          'div',
          { className: 'nm-side' },
          h(Pill, { status: item.status }),
          h(
            'div',
            { className: 'nm-acts' },
            item.status === 'running' || item.active
              ? h(IconBtn, { iconName: 'stop', label: '停止这件展品', danger: true, onClick: () => openStop([item.id]) })
              : null,
            !item.active &&
            (item.status === 'done' || item.status === 'failed' || item.status === 'stopped' || item.status === 'blocked')
              ? h(IconBtn, { iconName: 'reset', label: '重置为待巡展', onClick: () => resetExhibit(item) })
              : null,
            item.mode === 'new' && item.sessionId && item.status !== 'running' && !archived && !item.active
              ? h(IconBtn, { iconName: 'fresh', label: '下次换一个新会话', onClick: () => newSessionFor(item) })
              : null,
            h(IconBtn, { iconName: 'edit', label: '编辑展品', onClick: () => openForm('edit', item) }),
            h(IconBtn, { iconName: 'trash', label: '删除展品', danger: true, onClick: () => openDelete(item) }),
          ),
        ),
      )
    }

    return { renderLoading, renderEmpty, renderRow }
  },
})
