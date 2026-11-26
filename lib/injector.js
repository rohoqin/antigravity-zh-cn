'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const asar = require('./asar-engine');
const { findAsarPath, getStateDir } = require('./paths');
const { MENU_TAGS, buildMainMenuInjection } = require('./native-menu');

const PLUGIN_NAME = '反重力中文汉化插件';
const PLUGIN_VERSION = '1.1.0';

const TAGS = {
  START: '// --- Antigravity-ZH-CN Injection Start ---',
  END: '// --- Antigravity-ZH-CN Injection End ---',
  LEGACY_START: '// --- Antigravity Chinese Localization Injection Start ---',
  LEGACY_END: '// --- Antigravity Chinese Localization Injection End ---'
};

function sha256Buffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function validateSyntax(code, filename = 'preload.js') {
  if (typeof code !== 'string') return false;
  try {
    new vm.Script(code, { filename });
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripInjectedChinese(preloadCode) {
  let code = String(preloadCode || '');
  const pairs = [
    [TAGS.START, TAGS.END],
    [TAGS.LEGACY_START, TAGS.LEGACY_END]
  ];
  for (const [startTag, endTag] of pairs) {
    const re = new RegExp(`\\r?\\n?[ \\t]*${escapeRegExp(startTag)}[\\s\\S]*?${escapeRegExp(endTag)}\\r?\\n?`, 'g');
    code = code.replace(re, '\n');
  }
  return code;
}

function stripInjectedMainMenu(mainCode) {
  let code = String(mainCode || '');
  const re = new RegExp(`\\r?\\n?[ \\t]*${escapeRegExp(MENU_TAGS.START)}[\\s\\S]*?${escapeRegExp(MENU_TAGS.END)}\\r?\\n?`, 'g');
  return code.replace(re, '\n');
}

function injectMainMenuIntoCode(mainCode) {
  const cleaned = stripInjectedMainMenu(mainCode);
  const block = buildMainMenuInjection();
  if (/^\s*["']use strict["'];?\r?\n/.test(cleaned)) {
    return cleaned.replace(/^(\s*["']use strict["'];?\r?\n)/, `$1${block}\n`);
  }
  return `${block}\n${cleaned}`;
}

function normalizeBrandTitle(val) {
  const s = String(val || '').trim().toLowerCase();
  if (s === 'hidden' || s === 'hide' || s === 'none') return 'hidden';
  if (s === 'translated' || s === 'zh' || s === 'cn' || s === 'fanzhongli') return 'translated';
  return 'english';
}

function buildPreloadInjection(dictContent, runtimeContent, options = {}) {
  const brandTitle = normalizeBrandTitle(options.brandTitle || 'english');
  const parsedDict = JSON.parse(dictContent);
  if (!parsedDict || typeof parsedDict !== 'object' || !parsedDict.exact) {
    throw new Error('汉化词典 zh-CN.json 格式无效：缺少 exact 字段');
  }
  const i18nConfig = {
    enabled: true,
    language: 'zh-CN',
    brandTitle
  };

  return `\n${TAGS.START}
(function() {
  try {
    var _i18nConfig = ${JSON.stringify(i18nConfig)};
    var _dictData = ${dictContent.trim()};
    if (typeof window !== 'undefined') {
      window.__AGY_I18N_CONFIG__ = _i18nConfig;
      window.__AGY_I18N_DATA__ = _dictData;
    }
    if (typeof globalThis !== 'undefined') {
      globalThis.__AGY_I18N_CONFIG__ = _i18nConfig;
      globalThis.__AGY_I18N_DATA__ = _dictData;
    }
    ${runtimeContent}
  } catch (e) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[Antigravity-ZH-CN] Runtime Error:', e);
    }
  }
})();
${TAGS.END}\n`;
}

function isReadableAsar(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const pkg = JSON.parse(asar.extractFile(filePath, 'package.json').toString('utf8'));
    return Boolean(pkg && pkg.name);
  } catch {
    return false;
  }
}

function readAsarVersion(asarPath) {
  try {
    const pkg = JSON.parse(asar.extractFile(asarPath, 'package.json').toString('utf8'));
    return pkg.version || 'unknown';
  } catch {
    return 'unknown';
  }
}

function inspectAsarStatus(asarPath) {
  const version = readAsarVersion(asarPath);
  let hasPreload = false;
  let patchedBySelf = false;
  let patchedByLegacy = false;
  let hasMain = false;
  let patchedMainMenu = false;
  try {
    const preload = asar.extractFile(asarPath, 'dist/preload.js').toString('utf8');
    hasPreload = true;
    patchedBySelf = preload.includes(TAGS.START) && preload.includes(TAGS.END);
    patchedByLegacy = preload.includes(TAGS.LEGACY_START) && preload.includes(TAGS.LEGACY_END);
  } catch {}
  try {
    const mainJs = asar.extractFile(asarPath, 'dist/main.js').toString('utf8');
    hasMain = true;
    patchedMainMenu = mainJs.includes(MENU_TAGS.START) && mainJs.includes(MENU_TAGS.END);
  } catch {}
  return {
    asarPath,
    antigravityVersion: version,
    hasPreload,
    hasMain,
    patched: patchedBySelf,
    patchedMainMenu,
    patchedByLegacy
  };
}

function acquireLock(targetPath, stateDir, timeoutMs = 8000) {
  const locksDir = path.join(stateDir, 'locks');
  fs.mkdirSync(locksDir, { recursive: true });
  const key = crypto.createHash('sha256').update(path.resolve(targetPath)).digest('hex').slice(0, 16);
  const lockPath = path.join(locksDir, `${key}.lock`);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const fd = fs.openSync(lockPath, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, target: path.resolve(targetPath), at: new Date().toISOString() }));
      fs.closeSync(fd);
      return () => {
        try { if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath); } catch {}
      };
    } catch (e) {
      if (e.code === 'EEXIST') {
        try {
          const stat = fs.statSync(lockPath);
          if (Date.now() - stat.mtimeMs > 120000) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {}
        const waitUntil = Date.now() + 100;
        while (Date.now() < waitUntil) {}
        continue;
      }
      throw new Error(`无法创建文件锁 (${lockPath}): ${e.message}`);
    }
  }
  throw new Error(`获取文件锁超时 (${lockPath})，请确认没有其他安装或还原任务正在运行`);
}

function formatWritePermissionError(destFile, err) {
  const code = err && err.code ? err.code : 'UNKNOWN';
  if (process.platform === 'darwin') {
    return `目标文件无权限写入或被系统保护拦截 (${destFile})：请在反重力/终端中执行，或检查 macOS「系统设置 → 隐私与安全性 → 应用管理」权限 (${code})`;
  }
  return `目标文件被占用或无权限写入 (${destFile})：请先从系统托盘完全退出 Antigravity 客户端后重试 (${code})`;
}

function atomicReplaceFile(srcFile, destFile) {
  const destDir = path.dirname(destFile);
  const tempDest = path.join(destDir, `.app.asar.zhcn.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.copyFileSync(srcFile, tempDest);
  } catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
      throw new Error(formatWritePermissionError(destFile, e));
    }
    throw e;
  }
  try {
    fs.renameSync(tempDest, destFile);
  } catch (e) {
    try {
      fs.copyFileSync(tempDest, destFile);
    } catch (copyErr) {
      try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch {}
      if (copyErr.code === 'EBUSY' || copyErr.code === 'EPERM' || copyErr.code === 'EACCES') {
        throw new Error(formatWritePermissionError(destFile, copyErr));
      }
      throw copyErr;
    }
    try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch {}
  }
}

function getManifestPath(stateDir) {
  return path.join(stateDir, 'installation.json');
}

function readManifest(stateDir) {
  const p = getManifestPath(stateDir);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function writeManifest(stateDir, data) {
  fs.mkdirSync(stateDir, { recursive: true });
  const p = getManifestPath(stateDir);
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

async function install(options = {}) {
  const targetAsar = findAsarPath(options.asarPath || null, options);
  const stateDir = getStateDir(options);
  const i18nDir = options.i18nDir || path.resolve(__dirname, '..', 'i18n');
  const dictPath = path.join(i18nDir, 'zh-CN.json');
  const runtimePath = path.join(i18nDir, 'i18n-runtime.js');

  if (!fs.existsSync(dictPath) || !fs.existsSync(runtimePath)) {
    throw new Error(`缺少汉化资源文件：请确认 ${dictPath} 与 ${runtimePath} 存在`);
  }

  const dictContent = fs.readFileSync(dictPath, 'utf8');
  const runtimeContent = fs.readFileSync(runtimePath, 'utf8');
  const brandTitle = normalizeBrandTitle(options.brandTitle || 'english');

  const releaseLock = acquireLock(targetAsar, stateDir);
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zh-cn-install-'));
  const staging = path.join(workRoot, 'staging');
  const packed = path.join(workRoot, 'app.asar');

  try {
    const info = inspectAsarStatus(targetAsar);
    if (!info.hasPreload) {
      throw new Error(`目标 ASAR 中未找到 dist/preload.js (${targetAsar})，可能不是 Antigravity 2.x 桌面端`);
    }

    const version = info.antigravityVersion;
    const backupDir = path.join(stateDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const targetKey = crypto.createHash('sha256').update(path.resolve(targetAsar)).digest('hex').slice(0, 8);
    const baseBackupPath = path.join(backupDir, `app-${version}-${targetKey}-original.asar`);

    // 仅在尚未建立该版本的基线备份时保存快照（避免重装时用已补丁文件覆盖干净原版备份）
    if (!isReadableAsar(baseBackupPath)) {
      fs.copyFileSync(targetAsar, baseBackupPath);
    }

    // 始终基于当前 targetAsar 解包（保留其他合法组件），只对 dist/preload.js 做精准原位清洗 + 重新注入
    const sourceArchive = targetAsar;
    const originalEntries = asar.listPackage(sourceArchive);
    const unpackedPaths = asar.collectUnpackedPaths(sourceArchive);
    asar.extractAll(sourceArchive, staging);

    const preloadFile = path.join(staging, 'dist', 'preload.js');
    const rawPreload = fs.readFileSync(preloadFile, 'utf8');
    const cleanedPreload = stripInjectedChinese(rawPreload);
    if (!validateSyntax(cleanedPreload, 'dist/preload.js')) {
      throw new Error('清洗旧注入后 dist/preload.js 语法校验失败，已安全中止，未改动原文件');
    }

    const injectionBlock = buildPreloadInjection(dictContent, runtimeContent, { brandTitle });
    const finalPreload = cleanedPreload + injectionBlock;
    if (!validateSyntax(finalPreload, 'dist/preload.js')) {
      throw new Error('生成的新 dist/preload.js 语法校验失败，已安全中止，未改动原文件');
    }

    fs.writeFileSync(preloadFile, finalPreload, 'utf8');

    const mainFile = path.join(staging, 'dist', 'main.js');
    let patchedMainMenu = false;
    if (fs.existsSync(mainFile)) {
      const rawMain = fs.readFileSync(mainFile, 'utf8');
      const finalMain = injectMainMenuIntoCode(rawMain);
      if (!validateSyntax(finalMain, 'dist/main.js')) {
        throw new Error('生成的新 dist/main.js 语法校验失败，已安全中止，未改动原文件');
      }
      fs.writeFileSync(mainFile, finalMain, 'utf8');
      patchedMainMenu = true;
    }

    await asar.createPackageWithOptions(staging, packed, {
      unpackedPaths,
      writeUnpacked: false
    });

    // 逐文件校验：除 dist/preload.js 与 dist/main.js 外，其余所有非 unpacked 文件字节级 SHA-256 必须 100% 一致
    const allowedModified = new Set(['dist/preload.js']);
    if (patchedMainMenu) allowedModified.add('dist/main.js');
    let verifiedCount = 0;
    for (const entry of originalEntries) {
      const rel = entry.replace(/^\/+/, '');
      if (allowedModified.has(rel)) continue;
      const stat = asar.statFile(sourceArchive, rel);
      if (stat.files || stat.unpacked) continue;
      const beforeHash = sha256Buffer(asar.extractFile(sourceArchive, rel));
      const afterHash = sha256Buffer(asar.extractFile(packed, rel));
      if (beforeHash !== afterHash) {
        throw new Error(`完整性校验失败：未预期改动文件 ${rel}，已中止写入`);
      }
      verifiedCount++;
    }

    const newPreloadCheck = asar.extractFile(packed, 'dist/preload.js').toString('utf8');
    if (!newPreloadCheck.includes(TAGS.START) || !newPreloadCheck.includes(TAGS.END)) {
      throw new Error('打包后未检测到汉化注入标记，已中止写入');
    }

    atomicReplaceFile(packed, targetAsar);

    const backupSha256 = sha256File(baseBackupPath);
    const patchedSha256 = sha256File(targetAsar);
    const manifest = {
      pluginName: PLUGIN_NAME,
      pluginVersion: PLUGIN_VERSION,
      antigravityVersion: version,
      asarPath: path.resolve(targetAsar),
      backupPath: path.resolve(baseBackupPath),
      backupSha256,
      patchedSha256,
      brandTitle,
      patchedMainMenu,
      verifiedUntouchedFiles: verifiedCount,
      hadLegacyChineseBefore: info.patchedByLegacy,
      installedAt: new Date().toISOString(),
      restoredAt: null
    };
    writeManifest(stateDir, manifest);

    return {
      ok: true,
      ...manifest
    };
  } finally {
    try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch {}
    releaseLock();
  }
}

async function restore(options = {}) {
  const targetAsar = findAsarPath(options.asarPath || null, options);
  const stateDir = getStateDir(options);
  const manifest = readManifest(stateDir);
  const releaseLock = acquireLock(targetAsar, stateDir);

  try {
    const info = inspectAsarStatus(targetAsar);
    const currentVersion = info.antigravityVersion;

    // 优先使用同版本干净原版备份无损恢复
    if (
      manifest
      && manifest.backupPath
      && isReadableAsar(manifest.backupPath)
      && readAsarVersion(manifest.backupPath) === currentVersion
    ) {
      const backupInfo = inspectAsarStatus(manifest.backupPath);
      if (!backupInfo.patched && !backupInfo.patchedByLegacy && !backupInfo.patchedMainMenu) {
        atomicReplaceFile(manifest.backupPath, targetAsar);
        const restoredSha256 = sha256File(targetAsar);
        const nextManifest = Object.assign({}, manifest, {
          restoredAt: new Date().toISOString(),
          restoredSha256,
          restoreMode: 'backup'
        });
        writeManifest(stateDir, nextManifest);
        return {
          ok: true,
          mode: 'backup',
          asarPath: path.resolve(targetAsar),
          backupPath: manifest.backupPath,
          antigravityVersion: currentVersion,
          restoredSha256
        };
      }
    }

    // 兜底：若备份缺失或版本不匹配，执行原位精准清洗（只移除成对汉化标记块）
    if (!info.patched && !info.patchedByLegacy && !info.patchedMainMenu) {
      if (manifest) {
        writeManifest(stateDir, Object.assign({}, manifest, {
          restoredAt: new Date().toISOString(),
          restoreMode: 'already_clean'
        }));
      }
      return {
        ok: true,
        mode: 'already_clean',
        asarPath: path.resolve(targetAsar),
        antigravityVersion: currentVersion
      };
    }

    const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zh-cn-restore-'));
    const staging = path.join(workRoot, 'staging');
    const packed = path.join(workRoot, 'app.asar');
    try {
      const unpackedPaths = asar.collectUnpackedPaths(targetAsar);
      asar.extractAll(targetAsar, staging);
      const preloadFile = path.join(staging, 'dist', 'preload.js');
      const cleaned = stripInjectedChinese(fs.readFileSync(preloadFile, 'utf8'));
      if (!validateSyntax(cleaned, 'dist/preload.js')) {
        throw new Error('原位清洗后 dist/preload.js 语法校验失败，已中止写入');
      }
      fs.writeFileSync(preloadFile, cleaned, 'utf8');
      const mainFile = path.join(staging, 'dist', 'main.js');
      if (fs.existsSync(mainFile)) {
        const cleanedMain = stripInjectedMainMenu(fs.readFileSync(mainFile, 'utf8'));
        if (!validateSyntax(cleanedMain, 'dist/main.js')) {
          throw new Error('原位清洗后 dist/main.js 语法校验失败，已中止写入');
        }
        fs.writeFileSync(mainFile, cleanedMain, 'utf8');
      }
      await asar.createPackageWithOptions(staging, packed, {
        unpackedPaths,
        writeUnpacked: false
      });
      atomicReplaceFile(packed, targetAsar);
      const restoredSha256 = sha256File(targetAsar);
      writeManifest(stateDir, Object.assign({}, manifest || {}, {
        pluginName: PLUGIN_NAME,
        pluginVersion: PLUGIN_VERSION,
        asarPath: path.resolve(targetAsar),
        antigravityVersion: currentVersion,
        restoredAt: new Date().toISOString(),
        restoredSha256,
        restoreMode: 'in_place_clean'
      }));
      return {
        ok: true,
        mode: 'in_place_clean',
        asarPath: path.resolve(targetAsar),
        antigravityVersion: currentVersion,
        restoredSha256
      };
    } finally {
      try { fs.rmSync(workRoot, { recursive: true, force: true }); } catch {}
    }
  } finally {
    releaseLock();
  }
}

function getStatus(options = {}) {
  const stateDir = getStateDir(Object.assign({}, options, { ensure: false }));
  const manifest = readManifest(stateDir);
  let asarInfo = null;
  let error = null;
  try {
    const asarPath = findAsarPath(options.asarPath || null, options);
    asarInfo = inspectAsarStatus(asarPath);
  } catch (e) {
    error = e.message;
  }

  return {
    pluginName: PLUGIN_NAME,
    pluginVersion: PLUGIN_VERSION,
    stateDir,
    asarPath: asarInfo ? asarInfo.asarPath : null,
    antigravityVersion: asarInfo ? asarInfo.antigravityVersion : null,
    patched: asarInfo ? asarInfo.patched : false,
    patchedMainMenu: asarInfo ? asarInfo.patchedMainMenu : false,
    patchedByLegacy: asarInfo ? asarInfo.patchedByLegacy : false,
    intentionallyRestored: Boolean(
      manifest && manifest.restoredAt && (!manifest.installedAt || String(manifest.restoredAt) > String(manifest.installedAt))
    ),
    manifest,
    error
  };
}

module.exports = {
  PLUGIN_NAME,
  PLUGIN_VERSION,
  TAGS,
  MENU_TAGS,
  validateSyntax,
  stripInjectedChinese,
  stripInjectedMainMenu,
  injectMainMenuIntoCode,
  normalizeBrandTitle,
  buildPreloadInjection,
  inspectAsarStatus,
  install,
  restore,
  getStatus
};
