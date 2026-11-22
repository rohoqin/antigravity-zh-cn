# AI 智能体自动安装与操作指南 (AGENTS.md)

当用户把本仓库交给 AI 智能体（Antigravity / Claude Code / Codex 等）安装、更新或卸载时，请严格按以下规范执行。

## 核心前提

- **零外部依赖**：内置原生 Node.js ASAR 引擎，**不要执行 `npm install`**。
- **持久化存放目录**：如果用户未指定本地目录，请克隆到持久化目录（推荐 `~/antigravity-zh-cn` 或 `%USERPROFILE%\antigravity-zh-cn`），**禁止克隆到 `/tmp` 或系统临时目录**（否则开启 `auto-watch` 后重启电脑会导致自动补装路径失效）。
- **严禁强杀宿主进程**：若你正运行在 Antigravity 会话内部，**绝对不要**执行 `kill` / `pkill` / `taskkill` 终止 Antigravity 进程。安装完成后请提醒用户自行完全退出并重开客户端。
- **适用边界**：本插件仅用于 **Antigravity 2.x 桌面端**；如用户实际要汉化的是 **Antigravity IDE（VS Code 版）**，请改用 `antigravity-ide --install-extension ms-ceintl.vscode-language-pack-zh-hans` 并在 `~/.antigravity-ide/argv.json` 设置 `"locale": "zh-cn"`。

## 标准安装流程

```bash
# 1. 环境预检（确认 Node.js >= 18 且找到 app.asar）
node cli.js check

# 2. 执行汉化安装（自动备份原版 app.asar 并逐文件校验）
node cli.js install

# 3. （可选，用户要求“更新不被覆盖”时执行）开启官方更新后自动补装
node cli.js auto-watch on

# 4. 机器可读验收（确认 patched === true 与 patchedMainMenu === true）
node cli.js status --json
```

## 异常处理规范

- **Windows 报 `EBUSY` / `EPERM`（文件被占用）**：不要强杀进程，明确告知用户从右下角系统托盘完全退出 Antigravity 后再重试 `node cli.js install`。
- **找不到默认 `app.asar`**：询问用户自定义安装路径，传入 `--path "<app.asar 路径>"`。
- **还原为官方英文原版**：
  ```bash
  node cli.js auto-watch off
  node cli.js restore
  ```
- **完成汇报要求**：向用户汇报已修改范围、原版备份路径，以及明确提醒用户**完全退出（macOS `⌘ + Q` / Windows 托盘退出）并重开 Antigravity**后生效；未重启前不得声称界面已渲染为中文。
