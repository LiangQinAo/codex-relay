# 可靠性

## 规则
- `claimed` 任务超过 `TASK_TIMEOUT_MS` 必须回收入队。
- Agent 超过 `AGENT_OFFLINE_MS` 未心跳必须标记离线。
- Agent 掉线必须回收其未完成任务。
- 必须记录重要事件日志（HTTP/WS/异常）。
