/**
 * dsh-night-museum — client dialogs for the gallery page.
 */

window.__ModuleLoader__.load({
  id: 'dsh-night-museum',
  chunk: 'client.dialogs.js',
  factory(require) {
    const core = require('dsh-night-museum/client.core.js')
    const forms = require('dsh-night-museum/client.forms.js')
    const { h, React, Dot, Btn, Dialog } = core
    const { ExhibitForm, RunSummary } = forms

    function formDialog(view) {
      const { dialog, busy, setDialog, submitForm, sessions, workspaces, pickersLoading } = view
      return h(
        Dialog,
        {
          title: dialog.exhibit ? '编辑展品' : '录入新展品',
          subtitle: dialog.exhibit ? '调整内容或关联会话；正在巡展的展品需先停止才能修改。' : '展品会在开演时被投进关联的会话里执行。',
          onClose: busy ? undefined : () => setDialog(null),
        },
        h(ExhibitForm, {
          initial: dialog.exhibit,
          sessions,
          workspaces,
          loading: pickersLoading,
          busy,
          onSubmit: submitForm,
          onCancel: () => setDialog(null),
        }),
      )
    }

    function deleteDialog(view) {
      const { dialog, busy, setDialog, removeExhibit } = view
      return h(
        Dialog,
        {
          title: '撤下这件展品？',
          subtitle: dialog.exhibit.title,
          small: true,
          onClose: () => setDialog(null),
          footer: h(
            'div',
            { className: 'nm-right', style: { marginLeft: 'auto' } },
            h(Btn, { variant: 'ghost', onClick: () => setDialog(null) }, '取消'),
            h(Btn, { variant: 'danger', disabled: busy, onClick: () => removeExhibit(dialog.exhibit) }, '删除'),
          ),
        },
        h('p', { className: 'nm-hint', style: { margin: 0 } }, '展品内容与顺序记录会一起删除，已生成的会话与它的产出不受影响。'),
      )
    }

    function startDialog(view) {
      const { dialog, busy, setDialog, exhibits, peak, confirmStart } = view
      const resume = dialog.resume === true
      const targets = resume
        ? exhibits.filter((item) => (dialog.ids || []).includes(item.id))
        : exhibits.filter((item) => item.status !== 'done')
      return h(
        Dialog,
        {
          title: resume ? '接着上一轮继续巡展？' : '开始《博物馆奇妙夜》？',
          subtitle: resume
            ? '确认后会往原来的会话里再发一条「继续」，接着上一轮的进度做。'
            : '确认后会把未闭馆的展品投进各自的会话，现在就开始。',
          onClose: busy ? undefined : () => setDialog(null),
          footer: h(
            'div',
            { className: 'nm-right', style: { marginLeft: 'auto' } },
            h(Btn, { variant: 'ghost', onClick: () => setDialog(null), disabled: busy }, '再等等'),
            h(
              Btn,
              { variant: 'primary', iconName: resume ? 'resume' : 'play', onClick: confirmStart, disabled: busy },
              busy ? '开演中…' : resume ? '确认继续' : '确认开演',
            ),
          ),
        },
        h(RunSummary, { pending: targets, peak, resume }),
      )
    }

    function stopDialog(view) {
      const { dialog, busy, setDialog, exhibits, confirmStop } = view
      return h(
        Dialog,
        {
          title: '停止这些展品的巡展？',
          subtitle: '会中断对应会话当前正在跑的这一轮。',
          small: true,
          onClose: () => setDialog(null),
          footer: h(
            'div',
            { className: 'nm-right', style: { marginLeft: 'auto' } },
            h(Btn, { variant: 'ghost', onClick: () => setDialog(null) }, '取消'),
            h(Btn, { variant: 'danger', iconName: 'stop', disabled: busy, onClick: confirmStop }, busy ? '停止中…' : '停止巡展'),
          ),
        },
        h(
          'ul',
          { className: 'nm-confirm-list' },
          exhibits
            .filter((item) => (dialog.ids || []).includes(item.id))
            .map((item) => h('li', { key: item.id }, h(Dot, { tone: 'run' }), h('span', null, item.title))),
        ),
      )
    }

    /** Render whichever page dialog is open; returns a single Fragment node. */
    function renderDialogs(view) {
      const kind = view.dialog?.kind
      let node = null
      if (kind === 'form') node = formDialog(view)
      else if (kind === 'delete') node = deleteDialog(view)
      else if (kind === 'start') node = startDialog(view)
      else if (kind === 'stop') node = stopDialog(view)
      return h(React.Fragment, null, node)
    }

    return { renderDialogs }
  },
})
