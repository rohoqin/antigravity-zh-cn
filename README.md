# 反重力中文汉化插件（antigravity-zh-cn）

轻量纯净版 **Google Antigravity 2.x 桌面端** 简体中文汉化工具——支持 **macOS / Windows**，零第三方依赖，一键汉化，一键无损还原，可选开启官方更新后自动补装。

> **平台验证状态说明**：
> - **macOS**：已在真实 macOS 环境（Antigravity `v2.34.0`）完成安装、还原与副本校验实测。
> - **Windows**：**⚠️ Windows 真机尚未验证**（当前仅在 macOS 环境下通过跨平台路径解析、`.bat` 格式与脚本生成单元测试；欢迎 Windows 用户实机测试并反馈）。

> **适用范围说明**：
> - 本工具适用于 **Antigravity 2.x 桌面端**（Electron 客户端）。
> - 如果你用的是 **Antigravity IDE**（VS Code 编辑器版），直接在扩展商店搜索安装微软官方的 `Chinese (Simplified) Language Pack` 即可，无需使用本工具。

---

## 为什么做这个纯净版？

- **全界面轻侵入汉化，更抗官方升级**：
  - `dist/preload.js`：注入带成对标记的网页界面汉化引擎与 3,800+ 词条（覆盖侧边栏、设置页、语音模式、界面布局、对话确认卡片等）；
  - `dist/main.js`：注入轻量原生菜单/托盘/Dock 菜单汉化钩子（`文件 / 编辑 / 视图 / 窗口 / 帮助`、`新建窗口`、`检查更新`、托盘运行状态等）；
  - **不修改 `dist/utils.js` 主进程核心流程**，不注入代理、Token 统计或解锁补丁，最大程度避免被官方架构升级破坏。
- **零外部依赖，开箱即用**：内置纯原生 Node.js ASAR 解包/封包引擎，不需要 `npm install`，仅需系统已安装 Node.js（建议 ≥ 22.4）。
- **安全可逆**：安装前自动按客户端版本号保存原版 `app.asar` 备份；写入前做 JS 语法校验，并对除汉化注入文件外的全部官方原文件做逐文件 SHA-256 校验；支持备份无损还原与无备份时的原位精准清洗。

### 汉化边界说明（客观限制）
- **已覆盖**：桌面端网页主界面、设置与权限页、语音模式与界面布局、对话确认卡片常用选项、顶部原生菜单栏、系统托盘与 Dock 右键菜单。
- **刻意不翻译 / 无法覆盖**：AI 实时回复内容与代码/终端输出、模型名称选择器（防误翻）、操作系统原生权限弹窗（由系统语言决定），以及官方后续新版本新增但尚未收录进 `i18n/zh-CN.json` 的新文案。

---

## 快速开始

### 前置条件
电脑已安装 **Node.js 22.4 或更高版本**（可在终端运行 `node -v` 查看，未安装可前往 [nodejs.org](https://nodejs.org/) 下载）。

### macOS 使用方法
1. 克隆或下载本仓库到本地：
   ```bash
   git clone https://github.com/rohoqin/antigravity-zh-cn.git
   cd antigravity-zh-cn
   ```
2. **双击运行 `安装汉化.command`**（或在终端运行 `node cli.js install`）。
   > 首次双击若提示权限，可在终端进入本目录执行一次 `chmod +x *.command`，或直接运行 `node cli.js install`。
3. **完全退出 Antigravity（按 `⌘ + Q`）** 再重新打开，界面即切换为简体中文。
4. （可选）希望以后官方自动更新后自动补装中文：双击 **`开启更新自动补装.command`** 或运行 `node cli.js auto-watch on`。
5. 如需恢复官方英文原版：双击 **`还原英文.command`** 或运行 `node cli.js restore`，再重启客户端即可。

### Windows 使用方法（⚠️ 真机尚未验证）
1. 克隆或下载本仓库到本地：
   ```powershell
   git clone https://github.com/rohoqin/antigravity-zh-cn.git
   cd antigravity-zh-cn
   ```
2. **先完全退出 Antigravity**（包括右下角系统托盘图标右键“退出”，避免 `app.asar` 被占用）。
3. **双击运行 `安装汉化.bat`**（或在终端运行 `node cli.js install`）。
4. 重新打开 Antigravity，界面即切换为简体中文。
5. 如需恢复官方英文原版：完全退出 Antigravity 后，双击 **`还原英文.bat`** 或运行 `node cli.js restore`。

---

## 命令行用法

```bash
# 环境与路径预检
node cli.js check

# 一键安装简体中文（左上角品牌名默认保留 Antigravity）
node cli.js install

# 安装并将左上角品牌名显示为“反重力”（可选值：english / translated / hidden）
node cli.js install --brand translated

# 自定义客户端路径安装
node cli.js install --path "/path/to/app.asar"

# 查看当前汉化与备份状态
node cli.js status

# 开启 / 关闭官方更新后自动补装
node cli.js auto-watch on
node cli.js auto-watch off

# 一键无损还原官方英文原版
node cli.js restore
```

---

## 更新后自动补装原理（`auto-watch`）

- **macOS**：创建系统 `LaunchAgent` 监听 `Antigravity.app/Contents/Info.plist` 变化（不轮询、不改写官方更新器）。官方更新替换文件后，后台检测若补丁已失效且你未主动卸载，会自动补装并弹出系统通知提醒重启生效。
- **Windows**：注册用户登录触发的计划任务（`AntigravityZhCNAutoRepatch`），检测到更新覆盖后自动补装。
- 运行 `node cli.js restore` 主动卸载后，自动补装脚本会自动跳过，不会和你对抗；运行 `node cli.js auto-watch off` 可彻底移除监听。

---

## 常见问题

1. **为什么部分系统原生弹窗或新版本刚出的文案还是英文？**
   - macOS / Windows 系统原生弹窗不在网页 DOM 内，无法由前端词典拦截。
   - 官方新版本新增的文案若尚未收录进 `i18n/zh-CN.json`，直接往 `i18n/zh-CN.json` 里补充对应中英文词条并重新运行 `node cli.js install` 即可。
2. **和 `antigravity-context-viewer` 同时装会冲突吗？**
   - 本插件在安装时会自动清洗旧汉化标记，避免双重翻译。建议两者二选一；如果你只需要纯中文界面，优先使用本插件。
3. **备份文件存在哪里？**
   - macOS：`~/Library/Application Support/AntigravityZhCN/backups/`
   - Windows：`%LOCALAPPDATA%\AntigravityZhCN\backups\`

---

## 开发与测试

```bash
npm test
```

所有自动化测试均在系统临时目录中生成隔离 ASAR 副本运行，不会触碰本机真实的 Antigravity 客户端。

---

## 开源协议与致谢

本项目基于 **MIT License** 开源，欢迎自由使用、修改与分享。

- 原生 ASAR 引擎与基础 `zh-CN` 词典/运行时组件借鉴自 MIT 开源项目 `antigravity-context-viewer`，特此致谢。
