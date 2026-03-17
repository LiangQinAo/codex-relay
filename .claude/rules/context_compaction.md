# 上下文压缩

## 规则
- 当 `totalTokens > MAX_HISTORY_TOKENS` 必须触发摘要任务。
- 摘要任务必须由 Codex 执行，不得用拼接替代。
- 摘要完成后必须广播 `summary:update`。
- 当 `totalTokens <= MAX_HISTORY_TOKENS` 必须清空摘要状态。
