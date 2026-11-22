'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function getCandidateAsarPaths(options = {}) {
  const platform = options.platform || process.platform;
  const home = options.homeDir || os.homedir();
  const env = options.env || process.env;
  const candidates = [];

  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    const programFiles = env.ProgramFiles || 'C:\\Program Files';
    const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
    candidates.push(
      path.join(localAppData, 'Programs', 'antigravity', 'resources', 'app.asar'),
      path.join(localAppData, 'Programs', 'Antigravity', 'resources', 'app.asar'),
      path.join(localAppData, 'Programs', 'Google Antigravity', 'resources', 'app.asar'),
      path.join(programFiles, 'Antigravity', 'resources', 'app.asar'),
      path.join(programFiles, 'Google Antigravity', 'resources', 'app.asar'),
      path.join(appData, 'antigravity', 'resources', 'app.asar')
    );
  } else if (platform === 'darwin') {
    candidates.push(
      '/Applications/Antigravity.app/Contents/Resources/app.asar',
      path.join(home, 'Applications', 'Antigravity.app', 'Contents', 'Resources', 'app.asar'),
      '/Applications/Google Antigravity.app/Contents/Resources/app.asar',
      path.join(home, 'Applications', 'Google Antigravity.app', 'Contents', 'Resources', 'app.asar')
    );
  } else {
    candidates.push(
      '/opt/antigravity/resources/app.asar',
      '/usr/lib/antigravity/resources/app.asar',
      '/usr/share/antigravity/resources/app.asar',
      path.join(home, '.local', 'share', 'antigravity', 'resources', 'app.asar')
    );
  }

  return [...new Set(candidates)];
}

function findAsarPath(customPath = null, options = {}) {
  const fsImpl = options.fs || fs;
  const env = options.env || process.env;
  const explicit = (customPath && String(customPath).trim())
    || (env.AG_ZH_ASAR_PATH ? String(env.AG_ZH_ASAR_PATH).trim() : '');

  if (explicit) {
    const resolved = path.resolve(explicit);
    if (fsImpl.existsSync(resolved) && fsImpl.statSync(resolved).isDirectory()) {
      const checks = [
        path.join(resolved, 'Contents', 'Resources', 'app.asar'),
        path.join(resolved, 'resources', 'app.asar'),
        path.join(resolved, 'app.asar')
      ];
      for (const candidate of checks) {
        if (fsImpl.existsSync(candidate)) return candidate;
      }
    }
    if (fsImpl.existsSync(resolved) && fsImpl.statSync(resolved).isFile()) {
      return resolved;
    }
    throw new Error(`在指定路径未找到 app.asar: ${explicit}`);
  }

  const candidates = getCandidateAsarPaths(options);
  for (const candidate of candidates) {
    if (fsImpl.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    '未自动检测到 Antigravity 桌面端 (app.asar)。\n'
    + '请确认已安装 Antigravity 2.x 桌面端，或使用 --path "<app.asar 路径>" 手动指定。\n'
    + '（注：Antigravity IDE 请直接在扩展商店安装微软官方 Chinese Language Pack）'
  );
}

function getStateDir(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const home = options.homeDir || os.homedir();
  const fsImpl = options.fs || fs;

  let dir;
  if (options.stateDir && String(options.stateDir).trim()) {
    dir = path.resolve(String(options.stateDir).trim());
  } else if (env.AG_ZH_STATE_DIR && String(env.AG_ZH_STATE_DIR).trim()) {
    dir = path.resolve(String(env.AG_ZH_STATE_DIR).trim());
  } else if (platform === 'win32') {
    const base = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    dir = path.join(base, 'AntigravityZhCN');
  } else if (platform === 'darwin') {
    dir = path.join(home, 'Library', 'Application Support', 'AntigravityZhCN');
  } else {
    const base = env.XDG_STATE_HOME || path.join(home, '.local', 'state');
    dir = path.join(base, 'AntigravityZhCN');
  }

  if (options.ensure !== false) {
    fsImpl.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function validateNodeVersion(versionStr = process.versions.node) {
  const parts = String(versionStr || '0.0.0').split('.').map(n => Number(n) || 0);
  const [major] = parts;
  const ok = major >= 18;
  return { ok, version: versionStr, minRequired: '18.0.0' };
}

module.exports = {
  getCandidateAsarPaths,
  findAsarPath,
  getStateDir,
  validateNodeVersion
};
