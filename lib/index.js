/**
 * dsh-night-museum — Host half.
 *
 * 博物馆奇妙夜：把「任务」当成闭馆后自己走动的展品。
 *
 *  - 展品存在 `~/.dsh/night-museum/state.json`，跨会话、跨重启保留；
 *  - 18 点后前端会来问 `/state`，`reminder.due` 为真就弹窗；
 *  - 巡展时按「会话」分组：不同会话并发，同一会话内严格顺序；
 *  - 每件展品只是往会话里投一条 prompt，然后等这个会话静默下来；
 *  - 停止 = 对该会话调用 `sessionController.cancel()` 并中止本插件的轮询。
 *
 * 模块划分：
 *  - lib/museum.js  持久化展厅模型（CRUD、状态快照）
 *  - lib/schedule.js 巡展编排（分组、投递、等待、停止）
 *  - lib/routes.js  HTTP 路由
 *  - lib/util.js    常量与小工具
 */

import { Museum } from './museum.js'
import { registerRoutes } from './routes.js'

export const name = 'dsh-night-museum'
export const inject = ['connection', 'sessionController', 'workspaceRegistry']

export function apply(ctx, config) {
  void config
  const museum = new Museum(ctx)
  ctx.effect(() => registerRoutes(ctx, museum), 'dsh-night-museum: routes')
}
