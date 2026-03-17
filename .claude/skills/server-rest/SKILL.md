---
name: server-rest
description: 服务器 REST API 能力清单（健康检查、会话、消息、Agent 状态与兼容接口）
---

# Skills — Server REST

Skill A1 — Health Check
入口：`GET /health`
输入：无
输出：`{ ok, queueLength, hasToken }`
副作用：无
依赖：服务进程在线
失败模式：服务离线 / 连接失败 / 5xx
用途：前端或监控判断服务存活

Skill A2 — 获取 Agent 状态（REST）
入口：`GET /agent/status`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ lastSeenAt, status, queueLength, onlineAgents, totalAgents }`
副作用：无
依赖：`AUTH_TOKEN` 已配置
失败模式：401 未授权 / 500 (AUTH_TOKEN 未设置)
用途：外部健康探测、Agent 在线判断

Skill A3 — 获取 Agent 环境信息（REST）
入口：`GET /agent/info`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ info, diagnostics }`
副作用：无
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 500
用途：诊断 Agent 环境与自检数据

Skill A4 — 列出所有 Agent（REST）
入口：`GET /agents`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ agents: [ { id, name, status, lastSeenAt, capacity, busyCount, tags, info } ] }`
副作用：无
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 500
用途：多 Agent 监控与调度查看

Skill A5 — Agent 心跳（REST，兼容旧版）
入口：`POST /agent/heartbeat`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ status: 'ok' }`
副作用：刷新 `data.agent.lastSeenAt`，标记在线
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 500
用途：兼容旧版 Agent 心跳

Skill A6 — 列出会话
入口：`GET /sessions`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ sessions }`（仅未归档）
副作用：无
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 500
用途：加载会话列表

Skill A7 — 创建会话
入口：`POST /sessions`
输入：Header `x-auth-token` 或 `auth-token`，Body `{ title? }`
输出：`{ session }`
副作用：写入 `data.json`，新增会话
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 500
用途：新建会话

Skill A8 — 更新会话
入口：`PATCH /sessions/:id`
输入：Header `x-auth-token` 或 `auth-token`，Body `{ title?, systemPrompt?, archived? }`
输出：`{ session }`
副作用：写入 `data.json`，更新会话元数据
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 404 / 500
用途：改名、改系统提示、归档

Skill A9 — 删除会话（软归档）
入口：`DELETE /sessions/:id`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ status: 'ok' }`
副作用：`archived = true`，写入 `data.json`
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 404 / 500
用途：归档会话

Skill A10 — 读取会话消息
入口：`GET /sessions/:id/messages`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ messages, summary, summaryUpdatedAt }`
副作用：无
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 404 / 500
用途：加载聊天记录 + 摘要

Skill A11 — 发送会话消息（REST）
入口：`POST /sessions/:id/messages`
输入：Header `x-auth-token` 或 `auth-token`，Body `{ content }`
输出：`{ message, task }`
副作用：写入 message、入队 task、触发摘要调度
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 404 / 400(缺 content) / 413(过长) / 500
用途：备用通道（非 WS）

Skill A12 — 兼容旧版推送任务
入口：`POST /push-task`
输入：Header `x-auth-token` 或 `auth-token`，Body `{ command }`
输出：`{ status: 'ok', task }`
副作用：写入 message + task，触发摘要调度
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 400 / 413 / 500
用途：兼容旧版任务推送

Skill A13 — 旧版拉取任务（REST）
入口：`GET /fetch-task`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ task, queueLength }`
副作用：标记 Agent 在线；任务转为 `claimed`
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 500
用途：兼容旧版 Agent

Skill A14 — 旧版提交结果（REST）
入口：`POST /submit-result`
输入：Header `x-auth-token` 或 `auth-token`，Body `{ id, ok, result, durationMs }`
输出：`{ status: 'ok' }`
副作用：写入 assistant message / summary；更新 lastResult
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 500
用途：兼容旧版 Agent

Skill A15 — 旧版读取结果（REST）
入口：`GET /get-result`
输入：Header `x-auth-token` 或 `auth-token`
输出：`{ lastResult, queueLength }`
副作用：无
依赖：`AUTH_TOKEN` 已配置
失败模式：401 / 500
用途：兼容旧版轮询结果
