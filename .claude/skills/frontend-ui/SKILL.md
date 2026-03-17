---
name: frontend-ui
description: 前端 UI 能力清单（WS 管理、消息渲染、打字机、MD 渲染、会话与 Agent UI）
---

# Skills — Frontend UI

Skill G1 — WebSocket 连接管理
入口：Vue 初始化
输入：token
输出：连接状态 UI
副作用：自动订阅会话
依赖：WS 可连接
失败模式：鉴权失败、网络断开
用途：实时交互

Skill G2 — 消息实时渲染
入口：`message:new`
输入：message
输出：UI message list
副作用：去重、自动滚动
依赖：会话已订阅
失败模式：消息丢失导致不刷新
用途：实时聊天

Skill G3 — 打字机效果
入口：assistant message
输入：message.content
输出：逐字显示
副作用：定时器驱动
依赖：前端定时器
失败模式：定时器被清理
用途：模拟打字效果

Skill G4 — Markdown 渲染
入口：message 渲染
输入：message.content
输出：HTML（DOMPurify 清洗）
副作用：无
依赖：`marked` + `dompurify`
失败模式：渲染异常
用途：支持 MD

Skill G5 — 会话 UI
入口：会话列表/按钮
输入：搜索、点击、标题
输出：会话切换/创建/归档
副作用：会话状态变更
依赖：REST/WS 可用
失败模式：接口失败
用途：会话管理

Skill G6 — Agent 操作 UI
入口：按钮点击
输入：`agent:request-info` / `agent:run-diagnostics`
输出：Agent 信息与自检记录
副作用：触发 Agent 行为
依赖：Agent 在线
失败模式：Agent 离线
用途：运维控制
