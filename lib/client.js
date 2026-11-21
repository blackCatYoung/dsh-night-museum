/**
 * dsh-night-museum — Web client entry.
 *
 * DSH 的客户端协议只认这一个自包含入口，所以入口只做三件事：注入样式、
 * 弹出三个座位、把页面/表单/浮层拆成包内 chunk（`client.*.js`）按需加载。
 * 其他 chunk 通过 `require('dsh-night-museum/client.xxx.js')` 共享
 * `client.core.js`。
 *
 * Three seats:
 *   - `sidebar.panellist` 左侧「博物馆奇妙夜」入口
 *   - `main`             展品列表页（key 与侧栏 id 一致）
 *   - `shell.overlay`    18 点提醒、巡展结束提示音与浮层
 */

window.__ModuleLoader__.load({
  id: 'dsh-night-museum',
  factory(require) {
    const CSS = `
.nm-page{box-sizing:border-box;display:flex;flex-direction:column;gap:14px;height:100%;min-height:0;padding:22px 26px 14px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;overflow:hidden}
.nm-eyebrow{font-size:10.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--dsw-alias-label-secondary);opacity:.85}
.nm-head{flex:0 0 auto;display:flex;align-items:flex-start;justify-content:space-between;gap:18px}
.nm-head h1{margin:6px 0 0;font-size:19px;font-weight:600;letter-spacing:.02em;line-height:1.3}
.nm-sub{margin:6px 0 0;max-width:560px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.6}
.nm-head-right{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.nm-clock{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);font-variant-numeric:tabular-nums;font-size:12px;color:var(--dsw-alias-label-secondary)}
.nm-clock b{color:var(--dsw-alias-label-primary);font-weight:600;letter-spacing:.04em}
.nm-chip{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:999px;font-size:11px;line-height:1;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent);color:var(--dsw-alias-label-secondary)}
.nm-chip--peak{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary)}
.nm-chip--brand{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}
.nm-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;font-family:inherit;line-height:1;cursor:pointer;transition:background .15s,border-color .15s,color .15s,opacity .15s;white-space:nowrap}
.nm-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.nm-btn:active{transform:translateY(.5px)}
.nm-btn[disabled]{opacity:.45;cursor:not-allowed}
.nm-btn--primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary));border-color:transparent;color:var(--dsw-alias-label-primary-foreground)}
.nm-btn--primary:hover{background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-brand-primary));filter:none}
.nm-btn--ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary)}
.nm-btn--ghost:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.nm-btn--danger{color:var(--dsw-alias-state-error-primary)}
.nm-btn--danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 35%,var(--dsw-alias-border-l1))}
.nm-ico{width:13px;height:13px;flex:0 0 auto;display:block}
.nm-bar{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.nm-tabs{flex:0 0 auto;display:flex;align-items:center;gap:4px;align-self:flex-start;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1)}
.nm-tab{box-sizing:border-box;display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 12px;border:0;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12.5px;line-height:1;cursor:pointer;transition:background .15s,color .15s}
.nm-tab:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.nm-tab.is-on{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent);color:var(--dsw-alias-brand-primary);font-weight:600}
.nm-tab-count{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:17px;padding:0 5px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 13%,transparent);font-size:10.5px;font-weight:500;font-variant-numeric:tabular-nums}
.nm-tab.is-on .nm-tab-count{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 17%,transparent)}
.nm-stats{display:flex;align-items:center;gap:14px;font-size:12px;color:var(--dsw-alias-label-secondary);flex-wrap:wrap}
.nm-stat{display:inline-flex;align-items:center;gap:6px}
.nm-stat b{color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums}
.nm-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-idle-primary);flex:0 0 auto}
.nm-dot--run{background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);animation:nm-pulse 1.8s infinite}
.nm-dot--done{background:var(--dsw-alias-state-success-primary)}
.nm-dot--warn{background:var(--dsw-alias-state-warn-primary)}
.nm-dot--err{background:var(--dsw-alias-state-error-primary)}
@keyframes nm-pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dsw-alias-brand-primary) 45%,transparent)}70%{box-shadow:0 0 0 6px transparent}100%{box-shadow:0 0 0 0 transparent}}
.nm-progress{flex:0 0 auto;height:2px;border-radius:2px;background:var(--dsw-alias-border-l1);overflow:hidden}
.nm-progress span{display:block;height:100%;background:var(--dsw-alias-brand-primary);transition:width .4s ease}
.nm-list{flex:1 1 auto;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:8px;margin:0;padding:1px 2px 10px;list-style:none}
.nm-item{position:relative;box-sizing:border-box;display:grid;grid-template-columns:12px 15px 26px minmax(0,1fr) auto;gap:11px;align-items:start;padding:12px 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:11px;background:var(--dsw-alias-bg-layer-1);transition:border-color .15s,background .15s,opacity .15s}
.nm-item:hover{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l1))}
.nm-item.is-drag{opacity:.4}
.nm-item.is-over{border-color:var(--dsw-alias-brand-primary);border-style:dashed}
.nm-item.is-sel{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,var(--dsw-alias-bg-layer-1))}
.nm-grip{display:flex;align-items:center;justify-content:center;height:22px;cursor:grab;color:var(--dsw-alias-label-secondary);opacity:.5;background:none;border:0;padding:0}
.nm-item:hover .nm-grip{opacity:.9}
.nm-grip:active{cursor:grabbing}
.nm-check{margin-top:4px;width:14px;height:14px;accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.nm-check--static{display:block;cursor:default}
.nm-grip--static{cursor:default;color:var(--dsw-alias-state-success-primary);opacity:.75}
.nm-item--archived{background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,var(--dsw-alias-bg-layer-1))}
.nm-item--archived .nm-item-title{color:var(--dsw-alias-label-secondary)}
.nm-idx{padding-top:2px;font-size:11px;font-variant-numeric:tabular-nums;letter-spacing:.06em;color:var(--dsw-alias-label-secondary);opacity:.7}
.nm-body{min-width:0}
.nm-item-title{display:flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;line-height:1.4;word-break:break-word}
.nm-item-prompt{margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.nm-meta{margin-top:8px;display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.nm-meta-item{display:inline-flex;align-items:center;gap:5px;max-width:340px;min-width:0}
.nm-meta-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-link{background:none;border:0;padding:0;margin:0;font:inherit;color:var(--dsw-alias-brand-primary);cursor:pointer;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-link:hover{text-decoration:underline}
.nm-link--resume{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;margin:0;border-radius:999px;border:1px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 34%, transparent);background:color-mix(in srgb, var(--dsw-alias-brand-primary) 9%, transparent);font-size:11.5px;line-height:1.6;max-width:none}
.nm-link--resume .nm-ico{width:12px;height:12px}
.nm-link--resume:hover{text-decoration:none;background:color-mix(in srgb, var(--dsw-alias-brand-primary) 17%, transparent)}
.nm-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px}
.nm-side{display:flex;flex-direction:column;align-items:flex-end;gap:7px;flex:0 0 auto}
.nm-pill{display:inline-flex;align-items:center;gap:5px;height:21px;padding:0 9px;border-radius:999px;font-size:11px;line-height:1;white-space:nowrap;background:color-mix(in srgb,var(--dsw-alias-label-secondary) 12%,transparent);color:var(--dsw-alias-label-secondary)}
.nm-pill--run{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}
.nm-pill--done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}
.nm-pill--warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 15%,transparent);color:var(--dsw-alias-state-warn-primary)}
.nm-pill--err{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.nm-acts{display:flex;align-items:center;gap:2px;opacity:0;transition:opacity .15s}
.nm-item:hover .nm-acts,.nm-item:focus-within .nm-acts{opacity:1}
.nm-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
.nm-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.nm-icon-btn--danger:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.nm-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;border:1px dashed var(--dsw-alias-border-l1);border-radius:14px;padding:40px 24px;color:var(--dsw-alias-label-secondary);text-align:center}
.nm-empty h3{margin:0;font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary)}
.nm-empty p{margin:0;font-size:12px;line-height:1.7;max-width:380px}
.nm-empty-acts{display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap}
.nm-foot{flex:0 0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.85}
.nm-mask{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(6,8,12,.44);backdrop-filter:blur(2px)}
.nm-dialog{box-sizing:border-box;width:min(560px,100%);max-height:min(84vh,760px);display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;background:var(--dsw-alias-bg-overlay);box-shadow:0 24px 60px rgba(0,0,0,.4);color:var(--dsw-alias-label-primary);overflow:hidden}
.nm-dialog--sm{width:min(440px,100%)}
.nm-dialog-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:16px 18px 10px}
.nm-dialog-head h2{margin:0;font-size:14.5px;font-weight:600;line-height:1.4}
.nm-dialog-head p{margin:4px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.nm-dialog-body{padding:4px 18px 14px;overflow:auto;min-height:0}
.nm-dialog-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 18px;border-top:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.nm-dialog-foot .nm-right{display:flex;align-items:center;gap:8px}
.nm-form{display:flex;flex-direction:column;gap:14px}
.nm-field{display:flex;flex-direction:column;gap:6px}
.nm-label{display:flex;align-items:baseline;justify-content:space-between;gap:8px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.nm-label b{font-weight:500;color:var(--dsw-alias-label-primary)}
.nm-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.nm-input,.nm-textarea{box-sizing:border-box;width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;line-height:1.55;padding:8px 10px;outline:none;transition:border-color .15s,box-shadow .15s}
.nm-input:focus,.nm-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent)}
.nm-textarea{resize:vertical;min-height:120px}
.nm-seg{display:inline-flex;gap:2px;padding:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);align-self:flex-start}
.nm-seg button{height:26px;padding:0 12px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;cursor:pointer}
.nm-seg button.is-on{background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,.18)}
.nm-picker{max-height:228px;overflow:auto;display:flex;flex-direction:column;gap:3px;padding:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
.nm-pick{display:flex;flex-direction:column;gap:2px;width:100%;padding:7px 9px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;cursor:pointer}
.nm-pick:hover{background:var(--dsw-alias-bg-layer-2)}
.nm-pick.is-on{border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,transparent)}
.nm-pick-title{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-pick-sub{font-size:11px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.nm-pick-empty{padding:16px 10px;text-align:center;font-size:12px;color:var(--dsw-alias-label-secondary)}
.nm-note{display:flex;gap:8px;padding:9px 11px;border-radius:9px;font-size:11.5px;line-height:1.6;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.nm-note--warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 92%,var(--dsw-alias-label-primary));border:1px solid color-mix(in srgb,var(--dsw-alias-state-warn-primary) 32%,transparent)}
.nm-note--error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 11%,transparent);color:var(--dsw-alias-state-error-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-state-error-primary) 30%,transparent)}
.nm-confirm-list{display:flex;flex-direction:column;gap:6px;margin:10px 0 0;padding:0;list-style:none;max-height:220px;overflow:auto}
.nm-confirm-list li{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:7px;background:var(--dsw-alias-bg-layer-2);font-size:12px}
.nm-confirm-list li span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-kv{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);margin-top:10px;flex-wrap:wrap}
.nm-toast{position:fixed;right:20px;bottom:20px;z-index:70;display:flex;align-items:flex-start;gap:10px;max-width:380px;padding:11px 13px;border:1px solid var(--dsw-alias-border-l2);border-radius:11px;background:var(--dsw-alias-bg-overlay);box-shadow:0 14px 40px rgba(0,0,0,.35);font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-primary)}
.nm-toast--error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,var(--dsw-alias-border-l2))}
.nm-toast em{font-style:normal;color:var(--dsw-alias-label-secondary);display:block;font-size:11.5px;margin-top:2px}
.nm-toast button{background:none;border:0;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0 2px;font-size:14px;line-height:1}
.nm-spin{animation:nm-rot 1s linear infinite}
@keyframes nm-rot{to{transform:rotate(360deg)}}
.nm-visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`

    if (typeof document !== 'undefined') {
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-night-museum'
      tag.textContent = CSS
      document.head.append(tag)
    }

    return {
      inject: ['slots', 'uiWorkspace', 'layout'],
      async apply(ctx) {
        // chunk 之间用完整模块 id 同步共享 client.core.js：先把它取回来，
        // 再加载依赖它的表单/行渲染，最后加载页面与浮层。
        const core = await require.async('./client.core.js')
        await Promise.all([require.async('./client.forms.js'), require.async('./client.rows.js')])
        await require.async('./client.dialogs.js')
        const [page, overlay] = await Promise.all([
          require.async('./client.page.js'),
          require.async('./client.overlay.js'),
        ])

        const { h, PANEL_ID, services } = core
        services.uiWorkspace = ctx.uiWorkspace
        services.layout = ctx.layout

        function NightMuseumIcon(props) {
          const size = props?.size || 20
          return h(
            'svg',
            {
              width: size,
              height: size,
              viewBox: '0 0 24 24',
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 1.5,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              'aria-hidden': 'true',
            },
            h('path', { d: 'M3.6 9.6 12 4l8.4 5.6' }),
            h('path', { d: 'M5.4 9.6h13.2v9H5.4z' }),
            h('path', { d: 'M4 18.6h16' }),
            h('path', { d: 'M9 12.4v3.4M12 12.4v3.4M15 12.4v3.4' }),
            h('circle', { cx: 18.2, cy: 5.2, r: 1.4, fill: 'currentColor', stroke: 'none' }),
          )
        }

        try {
          ctx.slots.inject('main', () =>
            ctx.slots.register({ name: 'main', key: PANEL_ID, inject: () => ({}) }, page.NightMuseumPage),
          )
        } catch (error) {
          console.error('[dsh-night-museum] main 面板注册失败', error)
        }
        try {
          ctx.slots.inject('sidebar.panellist', () =>
            ctx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 7, label: () => '博物馆奇妙夜' },
              NightMuseumIcon,
            ),
          )
        } catch (error) {
          console.error('[dsh-night-museum] 侧栏入口注册失败', error)
        }
        try {
          ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'night-museum-overlay' }, overlay.NightMuseumOverlay),
          )
        } catch (error) {
          console.error('[dsh-night-museum] 浮层注册失败', error)
        }
      },
    }
  },
})
