# Agent 执行

## 规则
- Agent 只在 `task:assign` 时执行任务。
- 并发由 `AGENT_CAPACITY` 控制，`running < capacity` 才可开新任务。
- 任务执行完成必须回 `task:complete`。
- Agent 必须周期性 `agent:heartbeat`。
