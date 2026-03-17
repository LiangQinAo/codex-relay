# Codex Relay — 项目文档（完整版）

本文档为本项目的“可操作说明书 + 运行参考手册”。内容覆盖系统结构、接口、数据结构、部署运维、常见问题与排查方式。

---

## 1. 系统概览

**目标**：将本地 Codex CLI 作为执行引擎，通过服务器中转与 Web 控制台实现远程 AI 管家能力。

**核心组件**：
- **Server（中转服务器）**：接收消息、维护会话、调度任务、存储记录、记录日志。
- **Agent（本地执行端）**：连接服务器，获取任务并调用 `codex exec` 执行。
- **Web UI（控制台）**：WebSocket 交互、会话管理、Markdown 渲染、打字机效果。

**通信方式**：
- 主通道：**Socket.IO WebSocket**
- 兼容通道：REST API（保留，兼容旧客户端）

---

## 2. 文件结构

```
relay/
├── server.js                # 后端主服务
├── agent.js                 # 本地执行 Agent
├── data.json                # 会话 & 消息持久化
├── logs/                    # 日志（按天分文件）
├── public/                  # 前端构建产物
├── web/                     # Vue + Vite 前端工程
├── .env.example             # 配置示例
└── README.md                # 快速说明
```

---

## 3. 配置说明（.env）

**Server 配置：**
- `PORT`: 服务端口
- `AUTH_TOKEN`: 访问令牌
- `DEFAULT_SYSTEM_PROMPT`: 默认系统提示
- `MAX_HISTORY`: 每次对话保留的历史条数
- `SUMMARY_MAX_CHARS`: 摘要最大长度
- `SUMMARY_CHUNK_MAX_CHARS`: 摘要任务单次最大内容长度
- `TASK_TIMEOUT_MS`: 任务超时回收时间
- `AGENT_OFFLINE_MS`: Agent 离线判定
- `MAX_MESSAGE_CHARS`: 单条消息上限长度
- `MAX_BODY_MB`: HTTP 请求体大小上限（单位 MB）
- `MAX_TASK_HISTORY`: 任务记录保留上限（完成任务会被裁剪）

**Agent 配置：**
- `SERVER_URL`: 服务器地址
- `RESULT_MAX_CHARS`: 输出截断长度
- `CODEX_CWD`: 执行时的工作目录
- `HEARTBEAT_MS`: 心跳间隔
- `AGENT_ID`: Agent 唯一标识（建议固定）
- `AGENT_NAME`: Agent 显示名称
- `AGENT_CAPACITY`: 并发执行容量（>=1）
- `AGENT_TAGS`: Agent 标签（逗号分隔，用于未来路由）

---

## 4. REST API 一览（兼容）

> 所有接口需 Header `x-auth-token`

- `GET /health`
- `GET /agent/status`
- `GET /agent/info`
- `POST /agent/heartbeat`
- `GET /sessions`
- `POST /sessions`
- `PATCH /sessions/:id`
- `DELETE /sessions/:id`
- `GET /sessions/:id/messages`
- `POST /sessions/:id/messages`
- `POST /upload`（图片上传，返回 URL）
- `POST /push-task`（兼容旧版）
- `GET /fetch-task`（兼容旧版）
- `POST /submit-result`（兼容旧版）

---

## 5. WebSocket 事件

### 前端事件
- `session:subscribe`
- `message:send`
- `agent:request-info`
- `agent:run-diagnostics`

### 服务端推送
- `message:new`
- `task:status`
- `queue:update`
- `agent:status`
- `agent:info`
- `agent:diagnostics`
- `summary:update`

---

## 6. 任务调度机制

1. 前端发送消息
2. 服务端创建 message + task
3. 任务入队 `taskQueue`
4. 若 Agent 在线且有剩余并发容量，立即派发
5. Agent 执行后 `task:complete`
6. 服务端写回助手消息并广播
7. 触发摘要任务（如果历史过长）

---

## 7. 会话摘要（上下文压缩）

- 当历史超过 `MAX_HISTORY` 时触发摘要任务
- 摘要任务由 **Codex 本身执行**
- 摘要内容用于后续 prompt 的“摘要区”
- 摘要任务分块执行，避免一次过长

---

## 8. 多 Agent 与并发执行

系统支持多台安装 Codex CLI 的机器同时连接。

调度规则：
1. Agent 通过 `AGENT_ID` 注册，保持唯一
2. `AGENT_CAPACITY` 决定可并发任务数
3. 服务端会根据空闲容量轮询派发任务
4. Agent 掉线时，会回收其未完成任务

示例：
- Agent A（capacity=2）和 Agent B（capacity=3）同时在线
- 总并发能力 = 5

---

---

## 8. Agent 自检

Agent 支持：
- 上报运行环境（平台、Node、Codex 版本）
- 诊断信息（CPU、内存、uptime）

前端可点击“运行自检”触发

---

## 9. 日志与监控

日志路径：`logs/YYYY-MM-DD.log`

类型：
- `http`：HTTP 请求记录
- `ws`：WebSocket 连接
- `warn`：任务回收
- `error`：异常

---

## 10. 部署流程（服务器端）

```
cd relay
npm install
pm2 start server.js --name codex-relay
pm2 save
```

前端构建：
```
cd web
npm install
npm run build
```

---

## 11. 本地 Agent 启动

```
cd relay
node agent.js
```

后台运行：
```
nohup node agent.js > agent.log 2>&1 &
```

---

## 12. 常见问题

**Q1：页面不更新**
- 检查 WebSocket 是否连接

**Q2：Agent 离线**
- 检查本地 Agent 是否启动

**Q3：摘要不更新**
- 检查是否达到 `MAX_HISTORY`

---
