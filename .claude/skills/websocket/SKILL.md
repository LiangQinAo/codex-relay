---
name: websocket
description: Socket.IO 事件能力清单（前端订阅、消息发送、Agent 上报、队列与摘要广播）
---

# WebSocket Events (Socket.IO)

## 前端 → 服务端
| 事件 | 参数 | 返回/副作用 |
|------|------|------------|
| session:subscribe | sessionId | 加入房间 |
| message:send | {sessionId, content} | ACK {ok, message, task} |
| agent:request-info | - | 触发 agent:info |
| agent:run-diagnostics | - | 触发 agent:diagnose-result |

## 服务端 → 前端广播
message:new / task:status / queue:update / agent:status / agent:info / agent:diagnostics / summary:update

## Agent → 服务端
agent:hello(info) / agent:ready / agent:heartbeat({busyCount,capacity,lastTaskId}) / agent:diagnose-result(entry) / task:complete({id,ok,result,durationMs,agentId})

## 服务端 → Agent
task:assign(task) / agent:diagnose

## 鉴权
handshake 必须带 auth.token，role=frontend|agent