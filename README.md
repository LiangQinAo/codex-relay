# Codex Relay

中文 | [English](README.en.md)

一个可自托管的 **Codex CLI 远程控制中转**：
- 手机/网页端发指令
- 服务器中转
- 本地/远程 Agent 执行 Codex 并回传结果

适合做“私人 AI 管家 / Agent 中控台”，支持多会话、摘要压缩、WebSocket 实时交互和多 Agent 并发。

---

## 功能亮点

- WebSocket 实时消息 + 任务状态推送
- 多会话、会话摘要、历史自动压缩
- 多 Agent 并发执行（容量可配）
- 任务队列、超时回收、完整日志链路
- 前端支持 Markdown + 打字机效果
- 支持 REST 兼容接口与旧 Agent

---

## 项目结构

- `server.js`: 入口（Express + Socket.IO）
- `server/`: 服务器拆分模块
- `agent.js`: 本地/远程执行端（Codex CLI）
- `web/`: 前端源码（Vue + Vite + Tailwind）
- `public/`: 前端构建产物（运行时生成）
- `DOCS.md`: 系统文档与接口说明
- `SKILLS_AND_RULES.md`: Skills & Rules 索引

> 说明：`public/` 为构建输出，默认不入库，需在部署时构建生成。

---

## 快速开始

### 1) 服务器部署

```bash
cd /path/to/relay
npm install
cp .env.example .env
# 编辑 .env：AUTH_TOKEN / PORT 等
node server.js
```

推荐使用 pm2 常驻：
```bash
pm2 start server.js --name codex-relay
```

### 2) 前端构建

```bash
cd web
npm install
npm run build
```

构建产物会输出到 `public/`，服务器会自动托管。

### 3) Agent 部署（任意电脑）

```bash
cd /path/to/relay
cp .env.example .env
# 设置 SERVER_URL / AUTH_TOKEN / CODEX_CWD / AGENT_* 等
node agent.js
```

推荐 pm2：
```bash
pm2 start agent.js --name codex-agent
```

---

## 常用配置（.env）

- `AUTH_TOKEN`: API/WS 鉴权 token（请使用长随机串）
- `SERVER_URL`: 服务器地址（Agent 用）
- `CODEX_CWD`: Codex 执行工作目录
- `AGENT_CAPACITY`: Agent 并发容量
- `MAX_HISTORY_TOKENS`: 会话历史压缩阈值

完整字段请看 `.env.example`。

---

## 多 Agent 并发

同一服务器可接多个 Agent：
- 每台机器各自运行 `agent.js`
- 共享同一个 `SERVER_URL` + `AUTH_TOKEN`
- 服务端会根据 `AGENT_CAPACITY` 进行并发分配

---

## 安全建议

- **不要在公开仓库提交 `.env`**（本项目已默认忽略）
- 使用高强度 Token
- 服务器建议启用 HTTPS
- 如需最大权限执行，注意 Codex 的 sandbox/approval 配置

---

## 维护与排查

- 日志目录：`logs/`（按天滚动）
- 服务健康检查：`/health`
- 详细文档：`DOCS.md`

---

## License

MIT
