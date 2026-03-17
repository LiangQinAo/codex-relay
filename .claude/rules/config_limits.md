# 配置与限制

## 规则
- `MAX_MESSAGE_CHARS` 超限必须拒绝。
- `AUTH_TOKEN` 未设置必须报错并拒绝服务。
- `data.json` 与 `logs/` 必须可写。
- `MAX_HISTORY_TOKENS` 与 `MAX_PROMPT_TOKENS` 必须为正整数。
