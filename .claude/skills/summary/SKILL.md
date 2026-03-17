---
name: summary
description: 上下文压缩与摘要任务的调度、执行与回写
---

# Skills — Summary and Compaction

Skill D1 — 会话摘要任务调度
入口：`scheduleSummaryIfNeeded(sessionId, io)`
输入：历史 messages + 已有 summary
输出：入队 `task.type = 'summary'`
副作用：`summaryPending = true`，写入 task 队列
依赖：`MAX_HISTORY_TOKENS`、`SUMMARY_CHUNK_MAX_CHARS`
失败模式：无可压缩 chunk / 会话不存在
用途：自动压缩上下文

Skill D2 — 摘要生成（Codex）
入口：`task.type = 'summary'` 执行
输入：`buildSummaryPrompt` 生成的提示
输出：新的 summary
副作用：更新 `summary` / `summaryAnchor` / `summaryUpdatedAt`
依赖：Codex 可执行
失败模式：摘要为空或失败则不更新 summary
用途：保持历史不膨胀

Skill D3 — 摘要清空
入口：`scheduleSummaryIfNeeded` 发现历史不足
输入：`totalTokens <= MAX_HISTORY_TOKENS`
输出：summary 置空并广播
副作用：更新 `summaryAnchor=0`、`summaryPending=false`
依赖：会话存在
失败模式：无
用途：避免短会话保留旧摘要
