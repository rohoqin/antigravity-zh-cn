'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { findAsarPath, getStateDir } = require('./paths');

const MAC_LABEL = 'com.antigravity-zh-cn.auto-repatch';
const WIN_TASK_NAME = 'AntigravityZhCNAutoRepatch';

function escapeXml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function buildMacScript({ stateDir, pluginDir, asarPath, nodeBin }) {
  const appDir = path.resolve(asarPath, '..', '..', '..');
  return `#!/bin/bash
set -euo pipefail

ASAR_PATH=${JSON.stringify(asarPath)}
STATE_DIR=${JSON.stringify(stateDir)}
PLUGIN_DIR=${JSON.stringify(pluginDir)}
LOG_FILE="\${STATE_DIR}/auto-repatch.log"
LOCK_DIR="/tmp/${MAC_LABEL}.lock"

mkdir -p "\${STATE_DIR}"

log() {
  printf '[%s] %s\\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "\${LOG_FILE}"
}

if [ -f "\${LOG_FILE}" ] && [ "$(wc -c < "\${LOG_FILE}")" -gt 204800 ]; then
  tail -n 200 "\${LOG_FILE}" > "\${LOG_FILE}.tmp" && mv "\${LOG_FILE}.tmp" "\${LOG_FILE}"
fi

if [ -d "\${LOCK_DIR}" ] && find "\${LOCK_DIR}" -maxdepth 0 -mmin +10 2>/dev/null | grep -q .; then
  rm -rf "\${LOCK_DIR}"
fi
if ! mkdir "\${LOCK_DIR}" 2>/dev/null; then
  log "SKIP: another auto-repatch instance is running"
  exit 0
fi
trap 'rmdir "\${LOCK_DIR}" 2>/dev/null || true' EXIT

resolve_node() {
  if [ -x ${JSON.stringify(nodeBin)} ]; then
    echo ${JSON.stringify(nodeBin)}
    return 0
  fi
  local candidate
  for candidate in "$HOME"/.nvm/versions/node/v*/bin/node /opt/homebrew/bin/node /usr/local/bin/node; do
    if [ -x "\${candidate}" ]; then
      echo "\${candidate}"
      return 0
    fi
  done
  command -v node 2>/dev/null || return 1
}

NODE_BIN="$(resolve_node || true)"
if [ -z "\${NODE_BIN}" ]; then
  log "ERROR: Node.js not found"
  exit 1
fi

if [ "\${AG_ZH_NO_DELAY:-0}" != "1" ]; then
  sleep 5
fi

if [ ! -f "\${ASAR_PATH}" ]; then
  log "SKIP: app.asar not found (${appDir})"
  exit 0
fi

STATUS_JSON="$("\${NODE_BIN}" "\${PLUGIN_DIR}/cli.js" status --path "\${ASAR_PATH}" --json 2>/dev/null || true)"
ACTION="$("\${NODE_BIN}" -e '
try {
  const s = JSON.parse(process.argv[1] || "{}");
  const brand = (s.manifest && s.manifest.brandTitle) || "english";
  if (s.intentionallyRestored) { console.log("SKIP:restored"); process.exit(0); }
  if (s.patched === true) { console.log("OK:" + (s.antigravityVersion || "unknown")); process.exit(0); }
  if (s.asarPath) { console.log("REPATCH:" + (s.antigravityVersion || "unknown") + ":" + brand); process.exit(0); }
  console.log("SKIP:unknown");
} catch {
  console.log("SKIP:parse_error");
}
' "\${STATUS_JSON}")"

case "\${ACTION}" in
  OK:*)
    log "OK: already patched (\${ACTION#OK:})"
    ;;
  SKIP:*)
    log "\${ACTION}"
    ;;
  REPATCH:*)
    REST="\${ACTION#REPATCH:}"
    VER="\${REST%%:*}"
    BRAND="\${REST#*:}"
    [ -z "\${BRAND}" ] && BRAND="english"
    log "DETECTED update (\${VER}); re-installing (brand=\${BRAND})..."
    set +e
    INSTALL_OUT="$("\${NODE_BIN}" "\${PLUGIN_DIR}/cli.js" install --path "\${ASAR_PATH}" --brand "\${BRAND}" 2>&1)"
    INSTALL_RC=$?
    set -e
    printf '%s\\n' "\${INSTALL_OUT}" >> "\${LOG_FILE}"
    if [ "\${INSTALL_RC}" -eq 0 ]; then
      log "SUCCESS: re-patched Antigravity \${VER}"
      /usr/bin/osascript -e "display notification \\"Antigravity \${VER} 已自动补装简体中文，重启客户端后生效。\\" with title \\"反重力中文汉化插件\\"" >/dev/null 2>&1 || true
    elif printf '%s' "\${INSTALL_OUT}" | grep -qiE "EPERM|EACCES|operation not permitted|应用管理"; then
      log "BLOCKED_TCC: macOS App Management permission denied for background launchd script (Antigravity \${VER})"
      /usr/bin/osascript -e "display notification \\"Antigravity \${VER} 已更新，后台受 macOS 应用管理权限限制；请在反重力里运行安装或双击「安装汉化.command」补装。\\" with title \\"反重力中文汉化插件\\"" >/dev/null 2>&1 || true
      exit 1
    else
      log "ERROR: re-patch failed for Antigravity \${VER} (exit=\${INSTALL_RC})"
      /usr/bin/osascript -e "display notification \\"Antigravity \${VER} 自动补装失败，请先更新汉化插件后重装。\\" with title \\"反重力中文汉化插件\\"" >/dev/null 2>&1 || true
      exit 1
    fi
    ;;
esac
`;
}

function buildMacPlist({ scriptPath, stateDir, infoPlistPath }) {
  const outLog = path.join(stateDir, 'auto-repatch-launchd.out.log');
  const errLog = path.join(stateDir, 'auto-repatch-launchd.err.log');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${MAC_LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
\t\t<string>/bin/bash</string>
\t\t<string>${escapeXml(scriptPath)}</string>
\t</array>
\t<key>WatchPaths</key>
\t<array>
\t\t<string>${escapeXml(infoPlistPath)}</string>
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>ThrottleInterval</key>
\t<integer>30</integer>
\t<key>StandardOutPath</key>
\t<string>${escapeXml(outLog)}</string>
\t<key>StandardErrorPath</key>
\t<string>${escapeXml(errLog)}</string>
</dict>
</plist>
`;
}

function buildWindowsScript({ stateDir, pluginDir, asarPath, nodeBin }) {
  const q = (s) => String(s).replace(/'/g, "''");
  return `$ErrorActionPreference = 'Continue'
$AsarPath = '${q(asarPath)}'
$StateDir = '${q(stateDir)}'
$PluginDir = '${q(pluginDir)}'
$NodeBin = '${q(nodeBin)}'
$LogFile = Join-Path $StateDir 'auto-repatch.log'
$LockDir = Join-Path $StateDir 'auto-repatch.lock'
$NotifiedFile = Join-Path $StateDir '.notified-version'
$LastStateFile = Join-Path $StateDir '.last-watch-state'

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Write-Log([string]$Msg) {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  Add-Content -Path $LogFile -Value "[$ts] $Msg" -Encoding UTF8
}

function Show-Notice([string]$Title, [string]$Body) {
  try {
    Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
    Add-Type -AssemblyName System.Drawing -ErrorAction Stop
    $notify = New-Object System.Windows.Forms.NotifyIcon
    $notify.Icon = [System.Drawing.SystemIcons]::Information
    $notify.BalloonTipTitle = $Title
    $notify.BalloonTipText = $Body
    $notify.Visible = $true
    $notify.ShowBalloonTip(6000)
    Start-Sleep -Milliseconds 1500
    $notify.Dispose()
  } catch {}
}

# Rotate log if > 200KB
if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 204800)) {
  $tail = Get-Content -Path $LogFile -Tail 200 -Encoding UTF8
  Set-Content -Path $LogFile -Value $tail -Encoding UTF8
}

# Stale lock cleanup (> 10 minutes)
if (Test-Path $LockDir) {
  $age = (Get-Date) - (Get-Item $LockDir).LastWriteTime
  if ($age.TotalMinutes -gt 10) {
    Remove-Item -Path $LockDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

try {
  New-Item -ItemType Directory -Path $LockDir -ErrorAction Stop | Out-Null
} catch {
  exit 0
}

try {
  if (-not (Test-Path $AsarPath)) {
    exit 0
  }

  $statusRaw = & $NodeBin (Join-Path $PluginDir 'cli.js') status --path $AsarPath --json 2>$null
  if (-not $statusRaw) {
    exit 0
  }
  $statusText = ($statusRaw -join [Environment]::NewLine)
  $status = $statusText | ConvertFrom-Json

  if ($status.intentionallyRestored) {
    exit 0
  }

  $ver = if ($status.antigravityVersion) { [string]$status.antigravityVersion } else { 'unknown' }
  $brand = if ($status.manifest -and $status.manifest.brandTitle) { [string]$status.manifest.brandTitle } else { 'english' }

  if ($status.patched -eq $true) {
    $okState = "OK:$ver"
    $prev = if (Test-Path $LastStateFile) { (Get-Content -Path $LastStateFile -Raw -Encoding UTF8).Trim() } else { '' }
    if ($prev -ne $okState) {
      Write-Log "OK: already patched ($ver)"
      Set-Content -Path $LastStateFile -Value $okState -Encoding UTF8
    }
    if (Test-Path $NotifiedFile) { Remove-Item -Path $NotifiedFile -Force -ErrorAction SilentlyContinue }
    exit 0
  }

  # Update detected (patched == false): check if Antigravity desktop is currently locking app.asar
  $running = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -ieq 'Antigravity' -or $_.ProcessName -ieq 'Google Antigravity' }
  if ($running) {
    $prevNotified = if (Test-Path $NotifiedFile) { (Get-Content -Path $NotifiedFile -Raw -Encoding UTF8).Trim() } else { '' }
    if ($prevNotified -ne $ver) {
      Write-Log "WAITING: Antigravity $ver updated but still running (app.asar locked); will auto-repatch after exit"
      Set-Content -Path $NotifiedFile -Value $ver -Encoding UTF8
      Set-Content -Path $LastStateFile -Value "WAITING:$ver" -Encoding UTF8
      Show-Notice '反重力中文汉化插件' "检测到 Antigravity $ver 已更新，从托盘退出客户端后 5 分钟内将自动补装中文（或双击「安装汉化.bat」立即补装）。"
    }
    exit 0
  }

  Write-Log "DETECTED update ($ver); re-installing (brand=$brand)..."
  $output = & $NodeBin (Join-Path $PluginDir 'cli.js') install --path $AsarPath --brand $brand 2>&1
  $output | ForEach-Object { Add-Content -Path $LogFile -Value $_ -Encoding UTF8 }
  if ($LASTEXITCODE -eq 0) {
    Write-Log "SUCCESS: re-patched Antigravity $ver"
    Set-Content -Path $LastStateFile -Value "OK:$ver" -Encoding UTF8
    if (Test-Path $NotifiedFile) { Remove-Item -Path $NotifiedFile -Force -ErrorAction SilentlyContinue }
    Show-Notice '反重力中文汉化插件' "Antigravity $ver 已自动补装简体中文，打开客户端即可生效。"
  } else {
    Write-Log "ERROR: re-patch failed for Antigravity $ver (exit=$LASTEXITCODE)"
    Set-Content -Path $LastStateFile -Value "ERROR:$ver" -Encoding UTF8
    exit 1
  }
} finally {
  Remove-Item -Path $LockDir -Recurse -Force -ErrorAction SilentlyContinue
}
`;
}

function buildWindowsVbsLauncher(ps1Path) {
  const escaped = String(ps1Path).replace(/"/g, '""');
  return `Set sh = CreateObject("WScript.Shell")\r\nsh.Run "powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & "${escaped}" & """", 0, False\r\n`;
}

function getMacPaths(options = {}) {
  const home = options.homeDir || os.homedir();
  const stateDir = getStateDir(options);
  return {
    stateDir,
    scriptPath: path.join(stateDir, 'auto-repatch.sh'),
    plistPath: path.join(home, 'Library', 'LaunchAgents', `${MAC_LABEL}.plist`)
  };
}

function getWindowsPaths(options = {}) {
  const stateDir = getStateDir(options);
  return {
    stateDir,
    scriptPath: path.join(stateDir, 'auto-repatch.ps1'),
    vbsPath: path.join(stateDir, 'auto-repatch.vbs'),
    taskName: WIN_TASK_NAME
  };
}

function isInsideTmpDir(targetPath) {
  try {
    const resolved = path.resolve(targetPath).toLowerCase().replace(/\\/g, '/');
    const tmpBase = path.resolve(os.tmpdir()).toLowerCase().replace(/\\/g, '/');
    return resolved.startsWith(tmpBase + '/') || resolved.startsWith('/tmp/') || resolved.startsWith('/private/tmp/');
  } catch {
    return false;
  }
}

function enableAutoWatch(options = {}) {
  const platform = options.platform || process.platform;
  const pluginDir = options.pluginDir || path.resolve(__dirname, '..');
  const asarPath = findAsarPath(options.asarPath || null, options);
  const nodeBin = options.nodeBin || process.execPath;
  const tmpDirWarning = (!options.dryRun && isInsideTmpDir(pluginDir))
    ? `当前插件目录位于临时目录 (${pluginDir})，重启电脑后自动补装可能会失效；建议先移动到持久化目录（如 ~/antigravity-zh-cn）再开启 auto-watch。`
    : null;

  if (platform === 'darwin') {
    const { stateDir, scriptPath, plistPath } = getMacPaths(options);
    const infoPlistPath = path.resolve(asarPath, '..', '..', 'Info.plist');
    fs.mkdirSync(stateDir, { recursive: true });
    fs.mkdirSync(path.dirname(plistPath), { recursive: true });

    fs.writeFileSync(scriptPath, buildMacScript({ stateDir, pluginDir, asarPath, nodeBin }), 'utf8');
    fs.chmodSync(scriptPath, 0o755);
    fs.writeFileSync(plistPath, buildMacPlist({ scriptPath, stateDir, infoPlistPath }), 'utf8');

    if (!options.dryRun) {
      const uid = typeof process.getuid === 'function' ? process.getuid() : '';
      try { execFileSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' }); } catch {}
      execFileSync('launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'pipe' });
    }
    return { ok: true, platform, enabled: true, scriptPath, plistPath, watchPath: infoPlistPath, tmpDirWarning };
  }

  if (platform === 'win32') {
    const { stateDir, scriptPath, vbsPath, taskName } = getWindowsPaths(options);
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(scriptPath, buildWindowsScript({ stateDir, pluginDir, asarPath, nodeBin }).replace(/\r?\n/g, '\r\n'), 'utf8');
    fs.writeFileSync(vbsPath, buildWindowsVbsLauncher(scriptPath), 'utf8');
    const taskCmd = `wscript.exe //B //Nologo "${vbsPath}"`;
    if (!options.dryRun) {
      execFileSync('schtasks', ['/Create', '/F', '/SC', 'MINUTE', '/MO', '5', '/TN', taskName, '/TR', taskCmd], { stdio: 'pipe' });
    }
    return { ok: true, platform, enabled: true, scriptPath, vbsPath, taskName, trigger: 'MINUTE(5)', tmpDirWarning };
  }

  throw new Error(`当前平台 (${platform}) 暂不支持自动监听补装，请在更新后手动运行 node cli.js install`);
}

function disableAutoWatch(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') {
    const { scriptPath, plistPath } = getMacPaths(options);
    if (!options.dryRun && fs.existsSync(plistPath)) {
      const uid = typeof process.getuid === 'function' ? process.getuid() : '';
      try { execFileSync('launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' }); } catch {}
    }
    if (fs.existsSync(plistPath)) fs.unlinkSync(plistPath);
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    return { ok: true, platform, enabled: false, plistPath };
  }

  if (platform === 'win32') {
    const { scriptPath, vbsPath, taskName } = getWindowsPaths(options);
    if (!options.dryRun) {
      try { execFileSync('schtasks', ['/Delete', '/F', '/TN', taskName], { stdio: 'ignore' }); } catch {}
    }
    if (fs.existsSync(scriptPath)) fs.unlinkSync(scriptPath);
    if (fs.existsSync(vbsPath)) fs.unlinkSync(vbsPath);
    return { ok: true, platform, enabled: false, taskName };
  }

  return { ok: true, platform, enabled: false };
}

function getAutoWatchStatus(options = {}) {
  const platform = options.platform || process.platform;
  if (platform === 'darwin') {
    const { scriptPath, plistPath } = getMacPaths(Object.assign({}, options, { ensure: false }));
    return {
      platform,
      configured: fs.existsSync(plistPath) && fs.existsSync(scriptPath),
      plistPath,
      scriptPath
    };
  }
  if (platform === 'win32') {
    const { scriptPath, vbsPath, taskName } = getWindowsPaths(Object.assign({}, options, { ensure: false }));
    return {
      platform,
      configured: fs.existsSync(scriptPath) && fs.existsSync(vbsPath),
      taskName,
      scriptPath,
      vbsPath
    };
  }
  return { platform, configured: false };
}

module.exports = {
  MAC_LABEL,
  WIN_TASK_NAME,
  buildMacScript,
  buildMacPlist,
  buildWindowsScript,
  buildWindowsVbsLauncher,
  enableAutoWatch,
  disableAutoWatch,
  getAutoWatchStatus
};
