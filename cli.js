#!/usr/bin/env node
'use strict';
process.noAsar = true;

const path = require('path');
const { findAsarPath, getStateDir, validateNodeVersion } = require('./lib/paths');
const {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  install,
  restore,
  getStatus
} = require('./lib/injector');
const {
  enableAutoWatch,
  disableAutoWatch,
  getAutoWatchStatus
} = require('./lib/auto-watch');

function parseArgs(argv) {
  const args = argv.slice(2);
  const positional = [];
  const flags = {
    path: null,
    brand: 'english',
    json: false
  };

  for (let i = 0; i < args.length; i++) {
    const token = args[i];
    if (token === '--path' && args[i + 1]) {
      flags.path = args[++i];
    } else if (token === '--brand' && args[i + 1]) {
      flags.brand = args[++i];
    } else if (token === '--json') {
      flags.json = true;
    } else if (token === '-h' || token === '--help') {
      flags.help = true;
    } else if (token === '-v' || token === '--version') {
      flags.version = true;
    } else {
      positional.push(token);
    }
  }
  return { cmd: positional[0] || 'help', sub: positional[1] || null, flags };
}

function printHelp() {
  console.log(`
${PLUGIN_NAME} (antigravity-zh-cn) v${PLUGIN_VERSION}
轻量纯净版 Antigravity 2.x 简体中文汉化工具（零依赖 / 仅单点注入 preload.js）

用法:
  node cli.js check [--path <app.asar>]             环境与安装路径预检
  node cli.js install [--path <app.asar>] [--brand english|translated|hidden]
                                                    一键安装简体中文汉化（自动备份原文件）
  node cli.js status [--path <app.asar>] [--json]   查看当前汉化与备份状态
  node cli.js restore [--path <app.asar>]           一键无损还原为官方英文原版
  node cli.js auto-watch <on|off|status> [--path <app.asar>]
                                                    开启/关闭/查看官方更新后自动补装（macOS / Windows）

示例:
  node cli.js install
  node cli.js install --brand translated
  node cli.js auto-watch on
  node cli.js restore
`.trim());
}

async function main() {
  const { cmd, sub, flags } = parseArgs(process.argv);

  if (flags.version) {
    console.log(`${PLUGIN_NAME} v${PLUGIN_VERSION}`);
    return;
  }
  if (flags.help || cmd === 'help') {
    printHelp();
    return;
  }

  const opts = { asarPath: flags.path, brandTitle: flags.brand };

  if (cmd === 'check') {
    const nodeCheck = validateNodeVersion();
    const stateDir = getStateDir({ ensure: false });
    let asarPath = null;
    let status = null;
    try {
      asarPath = findAsarPath(flags.path);
      status = getStatus(opts);
    } catch (e) {
      if (flags.json) {
        console.log(JSON.stringify({ ok: false, node: nodeCheck, stateDir, error: e.message }, null, 2));
      } else {
        console.error(`❌ 环境预检未通过: ${e.message}`);
      }
      process.exitCode = 1;
      return;
    }
    if (flags.json) {
      console.log(JSON.stringify({ ok: nodeCheck.ok, node: nodeCheck, stateDir, status }, null, 2));
      return;
    }
    console.log(`🔍 [${PLUGIN_NAME} v${PLUGIN_VERSION}] 环境预检:`);
    console.log(`  - Node.js 版本: v${nodeCheck.version} ${nodeCheck.ok ? '✅' : `⚠️ 建议 >= ${nodeCheck.minRequired}`}`);
    console.log(`  - Antigravity 路径: ${asarPath} (v${status.antigravityVersion})`);
    console.log(`  - 备份与状态目录: ${stateDir}`);
    console.log(`  - 当前汉化状态: ${status.patched ? '已安装本插件' : (status.patchedByLegacy ? '检测到其他汉化补丁（安装时会自动无缝替换）' : '官方原版（未汉化）')}`);
    console.log('✅ 环境预检通过！');
    return;
  }

  if (cmd === 'status') {
    const status = getStatus(opts);
    const watch = getAutoWatchStatus();
    if (flags.json) {
      console.log(JSON.stringify({ ...status, autoWatch: watch }, null, 2));
      return;
    }
    console.log(`📦 [${PLUGIN_NAME} v${PLUGIN_VERSION}] 当前状态:`);
    if (status.error) {
      console.log(`  - 检测异常: ${status.error}`);
    } else {
      console.log(`  - 客户端路径: ${status.asarPath}`);
      console.log(`  - 客户端版本: v${status.antigravityVersion}`);
      console.log(`  - 主界面汉化 (preload.js): ${status.patched ? '✅ 已汉化' : '⚪ 未汉化'}`);
      console.log(`  - 原生菜单/托盘汉化 (main.js): ${status.patchedMainMenu ? '✅ 已汉化' : '⚪ 未汉化'}`);
      if (status.manifest && status.manifest.backupPath) {
        console.log(`  - 原版备份文件: ${status.manifest.backupPath}`);
      }
    }
    console.log(`  - 更新自动补装: ${watch.configured ? '✅ 已开启' : '⚪ 未开启'}`);
    return;
  }

  if (cmd === 'install') {
    if (!flags.json) {
      console.log(`🚀 [${PLUGIN_NAME} v${PLUGIN_VERSION}] 正在安装简体中文汉化...`);
    }
    const res = await install(opts);
    if (flags.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    console.log(`✅ 简体中文汉化安装完成！(Antigravity v${res.antigravityVersion})`);
    console.log(`  - 目标文件: ${res.asarPath}`);
    console.log(`  - 改动范围: dist/preload.js${res.patchedMainMenu ? ' + dist/main.js (原生菜单/托盘)' : ''}（已核对 ${res.verifiedUntouchedFiles} 个官方原文件 100% 一致）`);
    console.log(`  - 原版备份: ${res.backupPath}`);
    if (res.hadLegacyChineseBefore) {
      console.log('  - 兼容处理: 已自动清洗旧汉化标记，避免重复翻译冲突');
    }
    console.log('\n👉 请完全退出 Antigravity（macOS 按 Command+Q，Windows 从托盘彻底退出）后重新打开，简体中文即刻生效！');
    return;
  }

  if (cmd === 'restore') {
    if (!flags.json) {
      console.log(`🔄 [${PLUGIN_NAME} v${PLUGIN_VERSION}] 正在还原为官方英文原版...`);
    }
    const res = await restore(opts);
    if (flags.json) {
      console.log(JSON.stringify(res, null, 2));
      return;
    }
    if (res.mode === 'backup') {
      console.log(`✅ 已从原版备份无损还原！(Antigravity v${res.antigravityVersion})`);
    } else if (res.mode === 'in_place_clean') {
      console.log(`✅ 已通过原位精准清洗移除汉化补丁！(Antigravity v${res.antigravityVersion})`);
    } else {
      console.log('ℹ️ 当前客户端已是官方原版，无需还原。');
    }
    console.log('\n👉 请完全退出并重新打开 Antigravity 生效。');
    return;
  }

  if (cmd === 'auto-watch') {
    if (sub === 'on') {
      const res = enableAutoWatch({ asarPath: flags.path, pluginDir: __dirname });
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log('✅ 已开启官方更新自动补装！');
      if (res.platform === 'darwin') {
        console.log(`  - 监听目标: ${res.watchPath}`);
        console.log(`  - 监听配置: ${res.plistPath}`);
        console.log('  - 说明: 以后 Antigravity 自动更新覆盖文件后，后台会自动补装中文并弹出系统通知。');
      } else if (res.platform === 'win32') {
        console.log(`  - 计划任务: ${res.taskName}（用户登录时自动检测并补装）`);
        console.log(`  - 执行脚本: ${res.scriptPath}`);
      }
      return;
    }
    if (sub === 'off') {
      const res = disableAutoWatch();
      if (flags.json) {
        console.log(JSON.stringify(res, null, 2));
        return;
      }
      console.log('✅ 已关闭并移除更新自动补装监听。');
      return;
    }
    const status = getAutoWatchStatus();
    if (flags.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    console.log(`更新自动补装状态 (${status.platform}): ${status.configured ? '✅ 已开启' : '⚪ 未开启'}`);
    return;
  }

  console.error(`❌ 未知命令: ${cmd}`);
  printHelp();
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(`❌ 执行失败: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
