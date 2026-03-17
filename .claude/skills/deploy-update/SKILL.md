---
name: deploy-update
description: 将本地改动同步到服务器并完成构建/重启的部署流程
---

# 部署更新到服务器

## 1. 适用场景
- 用户要求“直接部署到服务器”“上线更新”“同步改动到 8.134.251.152”。
- 前端改动需要构建（Vite build）。
- 后端改动需要重启（pm2）。

## 2. 核心约束
- 默认走 SFTP 上传，服务器为 Windows 路径 `C:\Users\Administrator\relay`。
- 若涉及前端改动，必须在服务器执行 `npm run build`。
- 后端改动后需 `pm2 restart codex-relay --update-env`（若更新 .env）。
- 不要改动与本次任务无关的文件。
- 默认使用 SSH Key 免密登录（`~/.ssh/id_ed25519`），不在文档内记录明文密码。
- 禁止使用 `rsync`/`root@` 路径（服务器为 Windows + Administrator 账号）。
- 禁止上传 `node_modules`（体积巨大且可能污染环境）。
- Windows 远程命令不要使用 `tail`，如需截断输出使用 PowerShell `Select-Object -Last`。

## 3. 标准流程

### 3.1 上传文件
- 使用 sftp 上传变更文件至服务器对应路径。
- 例：
  - 本地：`/Users/liangqinao/work/codex/relay/server.js`
  - 服务器：`/C:/Users/Administrator/relay/server.js`
- 免密示例：`sftp -i ~/.ssh/id_ed25519 Administrator@8.134.251.152`
- 前端推荐只传源码与配置，避免整目录：`web/src`, `web/index.html`, `web/package*.json`, `web/vite.config.js`, `web/tailwind.config.cjs`, `web/postcss.config.cjs`。
- 如果误上传产生 `src/src` 嵌套，需在服务器执行：\n  `if exist src\\src ( move /Y src\\src\\* src\\ & rmdir /S /Q src\\src )`

### 3.2 前端构建（若前端改动）
在服务器执行：
```bat
cd /d C:\Users\Administrator\relay\web
npm run build
```

### 3.3 重启服务
在服务器执行：
```bat
cd /d C:\Users\Administrator\relay
pm2 restart codex-relay --update-env
```

## 4. 验证步骤（最少一项）
- 本机：`http://127.0.0.1:3200/health` 返回 `ok: true`
- 或：`netstat -ano | findstr ":3200"` 监听成功
- 或：外网访问 `http://8.134.251.152:3200/` 正常

## 5. 失败处理
- 构建失败：输出错误日志，停止重启并提示用户修复。
- 端口占用：排查旧进程，避免多实例冲突。
- 访问失败：确认安全组 + Windows 防火墙 + 端口监听。
- Windows 下无 `tail` 时查看日志：\n  `powershell -Command \"Get-Content <path> | Select-Object -Last 50\"`
