# Codex Relay Instructions (Claude)

Purpose
- This repo provides a Codex relay server, a local Agent runner, and a Web UI.
- These instructions follow Claude Code conventions and reference separate Skills and Rules files.

Where to read Skills and Rules
- Skills index: `.claude/skills/00-index.md`
- Rules index: `.claude/rules/00-index.md`

Operating model (high level)
- Frontend sends a message via WS or REST
- Server writes message + queues task
- Agent runs Codex CLI locally
- Server stores assistant reply and pushes it to UI
- Summary tasks compress long context automatically

Usage expectations
- Use Skills exactly as documented. Do not invent endpoints or events.
- Follow Rules before executing any action.
- Prefer direct execution. Only ask the user when a hard constraint blocks progress.
