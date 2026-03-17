---
name: logging
description: 服务端日志与监控（HTTP/WS/异常）
---

# Skills — Logging and Monitoring

Skill F1 — HTTP 请求日志
入口：Express middleware
输入：HTTP 请求
输出：`logs/YYYY-MM-DD.log`
副作用：写日志文件
依赖：磁盘可写
失败模式：磁盘满 / 权限不足
用途：HTTP 可观测性

Skill F2 — WS 连接日志
入口：socket connect/disconnect
输入：WS 事件
输出：日志记录
副作用：写日志文件
依赖：磁盘可写
失败模式：磁盘满 / 权限不足
用途：WS 监控

Skill F3 — 进程异常记录
入口：`uncaughtException` / `unhandledRejection`
输入：异常
输出：日志记录
副作用：写日志文件
依赖：异常捕获已注册
失败模式：异常导致进程退出
用途：故障排查
