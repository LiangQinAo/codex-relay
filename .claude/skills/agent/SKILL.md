---
name: agent
description: 本地 Agent 能力清单（执行 Codex、心跳、环境上报、自检）
---

# Skills — Agent

Skill C1 — 执行 Codex 任务
入口：`task:assign`
输入：`task.prompt` 或 `task.command`
输出：`task:complete`
副作用：调用 `codex exec --full-auto --skip-git-repo-check`
依赖：本地已安装 Codex CLI，具备工作目录权限
失败模式：codex 缺失 / 命令失败 / 退出非 0
用途：核心执行能力

Skill C2 — Agent 环境信息上报
入口：`agent:hello` / `agent:request-info`
输入：无
输出：`agent:info`
副作用：采集本机环境信息（OS/Node/Codex 版本等）
依赖：可执行 `codex --version`
失败模式：命令不可用
用途：状态回传

Skill C3 — Agent 心跳
入口：定时 `agent:heartbeat`
输入：`{ busyCount, capacity, lastTaskId }`
输出：在线状态
副作用：刷新在线时间
依赖：WS 已连接
失败模式：心跳中断导致离线
用途：在线保持

Skill C4 — Agent 诊断
入口：`agent:diagnose`
输入：无
输出：`agent:diagnose-result`
副作用：采集 uptime/loadavg/mem/codexVersion
依赖：系统权限允许读取
失败模式：获取失败则字段为空
用途：自检与调试
