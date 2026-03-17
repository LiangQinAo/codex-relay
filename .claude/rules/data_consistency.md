# 数据一致性

## 规则
- 消息写入与任务入队必须成对出现，顺序一致。
- 任务完成后必须写 assistant message，除 summary 任务外。
- `summaryPending = true` 时不得重复入队摘要任务。
- `summaryAnchor` 必须单调递增，禁止回退。
