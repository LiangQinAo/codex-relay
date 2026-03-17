# 安全与鉴权

## 规则
- 所有 REST/WS 调用必须携带正确 token。
- WS 必须在 `auth.token` 中提供 token。
- 未授权操作必须拒绝，不允许降级运行。
- 前端不得明文日志打印 token。
