# Codex Relay

English | [中文](README.md)

A self‑hosted **Codex CLI relay** that lets you:
- send commands from mobile/web
- relay through a server
- execute via local/remote Agents and return results

Ideal for building a personal AI assistant console with sessions, summaries, realtime WebSocket updates, and multi‑Agent concurrency.

---

## Highlights

- Realtime WebSocket messaging + task status
- Multi‑session with automatic summary compaction
- Multi‑Agent concurrency (capacity configurable)
- Task queue + timeout recovery + full logs
- Markdown + typewriter effect on the UI
- REST compatibility for legacy agents

---

## Structure

- `server.js`: entry (Express + Socket.IO)
- `server/`: server modules
- `agent.js`: local/remote executor (Codex CLI)
- `web/`: frontend source (Vue + Vite + Tailwind)
- `public/`: frontend build output (generated at runtime)
- `DOCS.md`: system docs & APIs
- `SKILLS_AND_RULES.md`: skills & rules index

> Note: `public/` is build output and is not committed by default.

---

## Quick Start

### 1) Server

```bash
cd /path/to/relay
npm install
cp .env.example .env
# edit .env: AUTH_TOKEN / PORT etc.
node server.js
```

Recommended with pm2:
```bash
pm2 start server.js --name codex-relay
```

### 2) Frontend Build

```bash
cd web
npm install
npm run build
```

Build output goes to `public/`, served by the server.

### 3) Agent (Any Machine)

```bash
cd /path/to/relay
cp .env.example .env
# set SERVER_URL / AUTH_TOKEN / CODEX_CWD / AGENT_* etc.
node agent.js
```

Recommended with pm2:
```bash
pm2 start agent.js --name codex-agent
```

---

## Key Config (.env)

- `AUTH_TOKEN`: API/WS auth token (use a strong random string)
- `SERVER_URL`: server URL (for Agent)
- `CODEX_CWD`: Codex working directory
- `AGENT_CAPACITY`: agent concurrency
- `MAX_HISTORY_TOKENS`: summary compaction threshold

See `.env.example` for all options.

---

## Multi‑Agent Concurrency

One server can serve multiple agents:
- run `agent.js` on each machine
- share the same `SERVER_URL` + `AUTH_TOKEN`
- server dispatches based on `AGENT_CAPACITY`

---

## Security Notes

- **Do not commit `.env` to a public repo** (already ignored)
- use a long random token
- enable HTTPS if possible
- if you need maximum execution privileges, configure Codex sandbox/approval accordingly

---

## Ops & Troubleshooting

- Logs: `logs/` (daily rolling)
- Health check: `/health`
- Full docs: `DOCS.md`

---

## License

MIT
