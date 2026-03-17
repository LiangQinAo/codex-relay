---
name: queue-ha
description: 任务队列与高可用机制（派发、回收、断线处理）
---

# Skills — Queue and High Availability

Skill E1 — 队列入队
入口：`enqueueTask(io, task)`
输入：task
输出：`queue:update`
副作用：写入 `data.tasks` 与 `taskQueue`
依赖：内存队列可用
失败模式：写入失败导致丢任务
用途：任务入队

Skill E2 — 任务分发
入口：`dispatchTasks(io)`
输入：队列首任务
输出：`task:assign`
副作用：标记 `claimed` / `startedAt` / `assignedAgentId`
依赖：至少一个可用 Agent
失败模式：无 Agent 在线时无法派发
用途：派发任务给 Agent

Skill E3 — 任务回收（卡死恢复）
入口：定时器
输入：`TASK_TIMEOUT_MS`
输出：任务重入队
副作用：清理 `claimed` 状态，恢复队列
依赖：服务定时器运行
失败模式：定时器停止导致任务卡死
用途：避免宕机

Skill E4 — Agent 断线回收
入口：Agent `disconnect`
输入：断线事件
输出：重入队其未完成任务
副作用：更新 Agent 状态与队列
依赖：WS 断线事件触发
失败模式：断线未触发
用途：保证任务不丢
