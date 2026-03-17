---
name: aliases
description: 高复用 skill 别名索引（便于自动规划与调用）
---

# Skills — Aliases (High Reuse)

skill.send_message_ws
入口：`message:send`
输入：`{ sessionId, content }`
输出：`{ message, task }`
副作用：写入 message、入队 task、触发摘要调度
依赖：WS 已连接
失败模式：`ok=false`
用途：发送用户指令

skill.subscribe_session
入口：`session:subscribe`
输入：`sessionId`
输出：加入 `session:<id>`
副作用：无
依赖：WS 已连接
失败模式：sessionId 无效
用途：接收指定会话消息

skill.run_agent_diagnostics
入口：`agent:run-diagnostics`
输入：无
输出：`agent:diagnose-result`
副作用：触发 Agent 自检
依赖：Agent 在线
失败模式：无 Agent 在线
用途：远程自检

skill.request_agent_info
入口：`agent:request-info`
输入：无
输出：`agent:info`
副作用：触发 Agent 上报
依赖：Agent 在线
失败模式：无 Agent 在线
用途：刷新 Agent 环境

skill.get_sessions
入口：`GET /sessions`
输入：Header token
输出：`{ sessions }`
副作用：无
依赖：AUTH_TOKEN
失败模式：401
用途：加载会话列表

skill.get_session_messages
入口：`GET /sessions/:id/messages`
输入：Header token
输出：`{ messages, summary, summaryUpdatedAt }`
副作用：无
依赖：AUTH_TOKEN
失败模式：401 / 404
用途：获取历史 + 摘要

skill.create_session
入口：`POST /sessions`
输入：Header token
输出：`{ session }`
副作用：写入 data.json
依赖：AUTH_TOKEN
失败模式：401
用途：创建会话

skill.update_session
入口：`PATCH /sessions/:id`
输入：Header token + Body
输出：`{ session }`
副作用：更新会话元数据
依赖：AUTH_TOKEN
失败模式：401 / 404
用途：修改标题 / 系统提示 / 归档

skill.enqueue_task
入口：`enqueueTask`
输入：task
输出：`queue:update`
副作用：写入队列
依赖：服务内存队列
失败模式：写入失败
用途：任务入队

skill.dispatch_task
入口：`dispatchTasks`
输入：队列
输出：`task:assign`
副作用：标记 claimed
依赖：有可用 Agent
失败模式：无 Agent 在线
用途：派发任务

skill.complete_task
入口：`task:complete`
输入：`{ id, ok, result, durationMs }`
输出：assistant message 或 summary
副作用：更新任务状态
依赖：Agent 回传
失败模式：结果丢失
用途：结束任务

skill.summary_compaction
入口：`scheduleSummaryIfNeeded`
输入：messages + summary
输出：summary task
副作用：入队 summary
依赖：MAX_HISTORY_TOKENS
失败模式：无可压缩 chunk
用途：触发 Codex 摘要压缩
