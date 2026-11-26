'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const asar = require('../lib/asar-engine');
const { getCandidateAsarPaths, findAsarPath, validateNodeVersion } = require('../lib/paths');
const {
  TAGS,
  MENU_TAGS,
  validateSyntax,
  stripInjectedChinese,
  stripInjectedMainMenu,
  install,
  restore,
  getStatus
} = require('../lib/injector');
const {
  enableAutoWatch,
  disableAutoWatch,
  getAutoWatchStatus
} = require('../lib/auto-watch');

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

async function createSyntheticAsar(tmpRoot, overrides = {}) {
  const srcDir = path.join(tmpRoot, 'src-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(path.join(srcDir, 'dist'), { recursive: true });

  fs.writeFileSync(
    path.join(srcDir, 'package.json'),
    JSON.stringify({ name: 'antigravity', version: overrides.version || '2.34.0' }, null, 2),
    'utf8'
  );
  fs.writeFileSync(
    path.join(srcDir, 'dist', 'utils.js'),
    overrides.utilsJs || '"use strict";\nfunction loadHubWindowUrl(win, url) { return win.loadURL(url); }\nmodule.exports = { loadHubWindowUrl };\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(srcDir, 'dist', 'main.js'),
    overrides.mainJs || '"use strict";\nconsole.log("main ready");\n',
    'utf8'
  );
  if (overrides.omitPreload !== true) {
    fs.writeFileSync(
      path.join(srcDir, 'dist', 'preload.js'),
      overrides.preloadJs || '"use strict";\nconst electron_1 = { contextBridge: { exposeInMainWorld() {} } };\nconsole.log("preload ready");\n',
      'utf8'
    );
  }
  fs.writeFileSync(path.join(srcDir, 'dist', 'asset.bin'), Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));

  const outAsar = path.join(tmpRoot, 'app.asar');
  await asar.createPackage(srcDir, outAsar);
  return outAsar;
}

test('install, idempotent reinstall, and lossless backup restore preserve untouched files', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-test-'));
  const stateDir = path.join(tmp, 'state');
  try {
    const targetAsar = await createSyntheticAsar(tmp);
    const originalHash = sha256File(targetAsar);
    const origUtils = asar.extractFile(targetAsar, 'dist/utils.js').toString('utf8');

    // 1. Install
    const res1 = await install({ asarPath: targetAsar, stateDir });
    assert.equal(res1.ok, true);
    assert.equal(res1.antigravityVersion, '2.34.0');
    assert.ok(fs.existsSync(res1.backupPath));
    assert.equal(sha256File(res1.backupPath), originalHash);
    assert.equal(asar.extractFile(targetAsar, 'dist/utils.js').toString('utf8'), origUtils);

    const status1 = getStatus({ asarPath: targetAsar, stateDir });
    assert.equal(status1.patched, true);
    assert.equal(status1.intentionallyRestored, false);

    // 2. Reinstall with --brand translated (idempotent, no duplicate markers, backup stays clean original)
    const res2 = await install({ asarPath: targetAsar, stateDir, brandTitle: 'translated' });
    assert.equal(res2.ok, true);
    assert.equal(sha256File(res2.backupPath), originalHash);
    const preloadAfter2 = asar.extractFile(targetAsar, 'dist/preload.js').toString('utf8');
    assert.equal(validateSyntax(preloadAfter2, 'dist/preload.js'), true);
    assert.equal(preloadAfter2.split(TAGS.START).length - 1, 1);
    assert.equal(preloadAfter2.split(TAGS.END).length - 1, 1);
    assert.ok(preloadAfter2.includes('"brandTitle":"translated"'));

    // 3. Lossless restore from backup
    const restoreRes = await restore({ asarPath: targetAsar, stateDir });
    assert.equal(restoreRes.ok, true);
    assert.equal(restoreRes.mode, 'backup');
    assert.equal(sha256File(targetAsar), originalHash);

    const statusAfterRestore = getStatus({ asarPath: targetAsar, stateDir });
    assert.equal(statusAfterRestore.patched, false);
    assert.equal(statusAfterRestore.intentionallyRestored, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('in-place surgical restore works cleanly when backup file is missing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-inplace-'));
  const stateDir = path.join(tmp, 'state');
  try {
    const targetAsar = await createSyntheticAsar(tmp);
    const res = await install({ asarPath: targetAsar, stateDir });
    fs.unlinkSync(res.backupPath);

    const restoreRes = await restore({ asarPath: targetAsar, stateDir });
    assert.equal(restoreRes.ok, true);
    assert.equal(restoreRes.mode, 'in_place_clean');

    const cleanedPreload = asar.extractFile(targetAsar, 'dist/preload.js').toString('utf8');
    assert.equal(validateSyntax(cleanedPreload, 'dist/preload.js'), true);
    assert.equal(cleanedPreload.includes(TAGS.START), false);
    assert.equal(cleanedPreload.includes('preload ready'), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('strips legacy Chinese localization block before injecting to prevent double translation', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-legacy-'));
  const stateDir = path.join(tmp, 'state');
  try {
    const preloadWithLegacy = `"use strict";
console.log("base preload");
${TAGS.LEGACY_START}
(function(){ console.log("old chinese"); })();
${TAGS.LEGACY_END}
`;
    const targetAsar = await createSyntheticAsar(tmp, { preloadJs: preloadWithLegacy });
    const res = await install({ asarPath: targetAsar, stateDir });
    assert.equal(res.hadLegacyChineseBefore, true);

    const finalPreload = asar.extractFile(targetAsar, 'dist/preload.js').toString('utf8');
    assert.equal(finalPreload.includes(TAGS.LEGACY_START), false);
    assert.equal(finalPreload.includes('old chinese'), false);
    assert.equal(finalPreload.split(TAGS.START).length - 1, 1);
    assert.equal(validateSyntax(finalPreload, 'dist/preload.js'), true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('injected preload runs inside sandboxed vm context without fs/ipcRenderer and translates confirmation items', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-vm-'));
  const stateDir = path.join(tmp, 'state');
  try {
    const targetAsar = await createSyntheticAsar(tmp);
    await install({ asarPath: targetAsar, stateDir });
    const preloadCode = asar.extractFile(targetAsar, 'dist/preload.js').toString('utf8');

    const fakeWindow = {
      document: null,
      addEventListener() {},
      setTimeout() { return 1; },
      clearTimeout() {}
    };
    const sandbox = {
      window: fakeWindow,
      globalThis: fakeWindow,
      console: { log() {}, warn() {}, error() {} },
      setTimeout() { return 1; },
      clearTimeout() {}
    };
    vm.createContext(sandbox);
    vm.runInContext(preloadCode, sandbox, { filename: 'dist/preload.js' });

    assert.equal(fakeWindow.__AGY_I18N_CONFIG__.enabled, true);
    assert.equal(fakeWindow.__AGY_I18N_CONFIG__.language, 'zh-CN');
    assert.ok(fakeWindow.__AGY_I18N_DATA__.exact);

    const { createI18nEngine } = require('../i18n/i18n-runtime.js');
    const engine = createI18nEngine(fakeWindow.__AGY_I18N_DATA__);
    assert.equal(engine.translate('Allow once'), '允许一次');
    assert.equal(engine.translate('Allow for this conversation'), '本次对话允许');
    assert.equal(engine.translate('Run outside sandbox'), '在沙箱外运行');
    assert.equal(engine.translate('Always allow for this workspace'), '此工作区始终允许');
    assert.equal(
      engine.translate('Always allow "npm test" in this workspace'),
      '在此工作区始终允许 "npm test"'
    );

    // v2.34.0 General Settings screenshot strings
    assert.equal(engine.translate('Interface Layout'), '界面布局');
    assert.equal(engine.translate('Knowledge Work'), '知识工作');
    assert.equal(engine.translate('Software Engineering'), '软件工程');
    assert.equal(
      engine.translate('Configure what the agent can do in local and remote conversations.'),
      '配置智能体在本地和远程对话中可以执行的操作。'
    );
    assert.equal(engine.translate('This computer'), '本机');
    assert.equal(engine.translate('Remote'), '远程');
    assert.equal(engine.translate('Controls permissions for remote conversations.'), '控制远程对话中的权限。');
    assert.equal(engine.translate('Input Box'), '输入框');
    assert.equal(engine.translate('Queued messages'), '排队消息');
    assert.equal(engine.translate('Choose which key sends a message in the chat composer.'), '选择在对话输入框中发送消息的快捷键。');
    assert.equal(engine.translate('Voice mode'), '语音模式');
    assert.equal(engine.translate('Voice'), '语音');
    assert.equal(engine.translate('The voice used in Voice mode. Powered by Gemini Live.'), '语音模式使用的声音，由 Gemini Live 驱动。');
    assert.equal(engine.translate('Not set'), '未设置');
    assert.equal(engine.translate('Change'), '更改');
    assert.equal(engine.translate('Microphone'), '麦克风');
    assert.equal(engine.translate('Input device for voice mode and dictation.'), '用于语音模式和语音输入的麦克风设备。');
    assert.equal(engine.translate('System default'), '系统默认');
    assert.equal(engine.translate("How loud Antigravity's voice is."), '控制 Antigravity 语音播放的音量大小。');

    // v2.34.0 Orchestrator Settings & Browser Settings screenshot strings
    assert.equal(engine.translate('Orchestrator Settings'), '编排器设置');
    assert.equal(engine.translate('Orchestrator Model'), '编排模型');
    assert.equal(engine.translate('Executor Model'), '执行模型');
    assert.equal(
      engine.translate('Choose the models Orchestrator uses. A larger, smarter orchestrator model with a faster, cheaper executor gives high quality for fewer tokens.'),
      '选择编排器使用的模型。用更强大、更聪明的编排模型搭配更快、更低成本的执行模型，可用更少的 Token 获得高质量结果。'
    );
    assert.equal(
      engine.translate('Carries out the plan: searches, edits, builds, and tests. Pick a faster, cheaper model.'),
      '负责执行计划：搜索、编辑、构建与测试，建议选择速度更快、成本更低的模型。'
    );
    assert.equal(engine.translate('Configure built-in browser, link opening, and browser subagent preferences.'), '配置内置浏览器、链接打开方式以及浏览器子智能体偏好。');
    assert.equal(engine.translate('Built-in Browser'), '内置浏览器');
    assert.equal(engine.translate('Open Links In'), '链接打开方式');
    assert.equal(engine.translate('Choose where links open by default when clicked.'), '选择点击链接时的默认打开位置。');
    assert.equal(engine.translate('External Browser'), '外部浏览器');
    assert.equal(engine.translate('Download Location'), '下载位置');
    assert.equal(engine.translate('Folder where files downloaded in the built-in browser are saved.'), '保存在内置浏览器中下载文件的文件夹。');
    assert.equal(engine.translate('Browsing History'), '浏览历史');
    assert.equal(engine.translate('Clear visited URLs and autocomplete suggestions from the built-in browser.'), '清除内置浏览器中的访问记录与自动补全建议。');
    assert.equal(engine.translate('Browser Subagent'), '浏览器子智能体');
    assert.equal(
      engine.translate('Configure allowed and denied URLs for the browser subagent. It runs in the built-in browser, so no separate browser install is needed.'),
      '配置浏览器子智能体允许和禁止访问的网址。它在内置浏览器中运行，无需单独安装浏览器。'
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('native menu hook translates macOS menu, tray, and keeps check-for-updates clickable', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-menu-'));
  const stateDir = path.join(tmp, 'state');
  try {
    const targetAsar = await createSyntheticAsar(tmp);
    const res = await install({ asarPath: targetAsar, stateDir });
    assert.equal(res.patchedMainMenu, true);

    const mainCode = asar.extractFile(targetAsar, 'dist/main.js').toString('utf8');
    assert.equal(validateSyntax(mainCode, 'dist/main.js'), true);
    assert.equal(mainCode.split(MENU_TAGS.START).length - 1, 1);

    let updateClicked = false;
    const fakeUpdater = {
      updateActions: {
        'Check for Updates': () => { updateClicked = true; },
        'Restart to Update': () => {}
      }
    };
    let lastAppMenu = null;
    let lastBuiltTemplate = null;
    let lastTrayMenu = null;
    function FakeTray() {}
    FakeTray.prototype.setContextMenu = function(m) { lastTrayMenu = m; };
    const fakeElectron = {
      Menu: {
        setApplicationMenu(m) { lastAppMenu = m; },
        buildFromTemplate(tpl) { lastBuiltTemplate = tpl; return { items: tpl }; }
      },
      Tray: FakeTray
    };
    const sandbox = {
      require(mod) {
        if (mod === 'electron') return fakeElectron;
        if (mod === './updater') return fakeUpdater;
        throw new Error('Unexpected require: ' + mod);
      },
      process: { platform: 'darwin' },
      globalThis: {},
      console: { log() {}, warn() {}, error() {} }
    };
    vm.createContext(sandbox);
    vm.runInContext(mainCode, sandbox, { filename: 'dist/main.js' });

    const appMenu = {
      items: [
        {
          label: 'Antigravity',
          submenu: {
            items: [{ id: 'check-for-updates', label: 'Check for Updates' }]
          }
        },
        {
          label: 'File',
          submenu: {
            items: [{ label: 'New Window' }]
          }
        }
      ]
    };
    fakeElectron.Menu.setApplicationMenu(appMenu);
    assert.equal(lastAppMenu.items[1].label, '文件');
    assert.equal(lastAppMenu.items[1].submenu.items[0].label, '新建窗口');
    const updLabel = lastAppMenu.items[0].submenu.items[0].label;
    assert.equal(updLabel, '检查更新');
    fakeUpdater.updateActions[updLabel]();
    assert.equal(updateClicked, true);

    fakeElectron.Menu.buildFromTemplate([
      { label: 'No agents running' },
      { label: 'Open Antigravity' },
      { label: 'Quit' }
    ]);
    assert.equal(lastBuiltTemplate[0].label, '暂无运行中的智能体');
    assert.equal(lastBuiltTemplate[1].label, '打开 Antigravity');
    assert.equal(lastBuiltTemplate[2].label, '退出');

    const tray = new FakeTray();
    tray.setContextMenu({ items: [{ id: 'running-agents', label: '3 agents running' }] });
    assert.equal(lastTrayMenu.items[0].label, '3 个智能体运行中');

    // In-place cleanup removes main.js menu hook too
    fs.unlinkSync(res.backupPath);
    const restoreRes = await restore({ asarPath: targetAsar, stateDir });
    assert.equal(restoreRes.mode, 'in_place_clean');
    const cleanedMain = asar.extractFile(targetAsar, 'dist/main.js').toString('utf8');
    assert.equal(cleanedMain.includes(MENU_TAGS.START), false);
    assert.equal(validateSyntax(cleanedMain, 'dist/main.js'), true);
    assert.equal(stripInjectedMainMenu(mainCode).includes(MENU_TAGS.START), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('rejects ASAR missing dist/preload.js without corrupting archive', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-invalid-'));
  const stateDir = path.join(tmp, 'state');
  try {
    const badAsar = await createSyntheticAsar(tmp, { omitPreload: true });
    const origHash = sha256File(badAsar);
    await assert.rejects(
      () => install({ asarPath: badAsar, stateDir }),
      /dist\/preload\.js/
    );
    assert.equal(sha256File(badAsar), origHash);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cross-platform path discovery and auto-watch dry-run generation for macOS and Windows', async () => {
  const macCandidates = getCandidateAsarPaths({ platform: 'darwin', homeDir: '/Users/alice', env: {} });
  assert.ok(macCandidates.includes('/Applications/Antigravity.app/Contents/Resources/app.asar'));
  assert.ok(!macCandidates.some(p => p.includes('Antigravity IDE.app')));

  const winCandidates = getCandidateAsarPaths({
    platform: 'win32',
    homeDir: 'C:\\Users\\Alice',
    env: { LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }
  });
  assert.ok(winCandidates.some(p => p.endsWith(path.join('Programs', 'antigravity', 'resources', 'app.asar'))));

  assert.equal(validateNodeVersion('18.0.0').ok, true);
  assert.equal(validateNodeVersion('22.4.0').ok, true);
  assert.equal(validateNodeVersion('24.14.0').ok, true);
  assert.equal(validateNodeVersion('16.20.0').ok, false);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-watch-'));
  try {
    const fakeAppAsar = path.join(tmp, 'Antigravity.app', 'Contents', 'Resources', 'app.asar');
    fs.mkdirSync(path.dirname(fakeAppAsar), { recursive: true });
    fs.writeFileSync(fakeAppAsar, 'stub');

    const macRes = enableAutoWatch({
      platform: 'darwin',
      homeDir: tmp,
      stateDir: path.join(tmp, 'state-mac'),
      asarPath: fakeAppAsar,
      pluginDir: path.resolve(__dirname, '..'),
      dryRun: true
    });
    assert.equal(macRes.ok, true);
    assert.ok(fs.existsSync(macRes.plistPath));
    assert.ok(fs.existsSync(macRes.scriptPath));
    const macSh = fs.readFileSync(macRes.scriptPath, 'utf8');
    assert.ok(macSh.includes('BLOCKED_TCC'));
    assert.ok(macSh.includes('--brand'));
    assert.ok(fs.readFileSync(macRes.plistPath, 'utf8').includes('Info.plist'));
    assert.equal(getAutoWatchStatus({ platform: 'darwin', homeDir: tmp, stateDir: path.join(tmp, 'state-mac') }).configured, true);

    disableAutoWatch({ platform: 'darwin', homeDir: tmp, stateDir: path.join(tmp, 'state-mac'), dryRun: true });
    assert.equal(getAutoWatchStatus({ platform: 'darwin', homeDir: tmp, stateDir: path.join(tmp, 'state-mac') }).configured, false);

    const winRes = enableAutoWatch({
      platform: 'win32',
      homeDir: tmp,
      stateDir: path.join(tmp, 'state-win'),
      asarPath: fakeAppAsar,
      pluginDir: path.resolve(__dirname, '..'),
      dryRun: true
    });
    assert.equal(winRes.ok, true);
    assert.equal(winRes.trigger, 'MINUTE(5)');
    assert.ok(fs.existsSync(winRes.scriptPath));
    assert.ok(fs.existsSync(winRes.vbsPath));
    const winPs1 = fs.readFileSync(winRes.scriptPath, 'utf8');
    assert.ok(winPs1.includes('intentionallyRestored'));
    assert.ok(winPs1.includes('-join [Environment]::NewLine'));
    assert.ok(winPs1.includes("ProcessName -ieq 'Antigravity'"));
    assert.ok(winPs1.includes("$ErrorActionPreference = 'Continue'"));
    assert.ok(winPs1.includes('.notified-version'));
    const winVbs = fs.readFileSync(winRes.vbsPath, 'utf8');
    assert.ok(winVbs.includes('WScript.Shell'));
    assert.equal(getAutoWatchStatus({ platform: 'win32', homeDir: tmp, stateDir: path.join(tmp, 'state-win') }).configured, true);

    disableAutoWatch({ platform: 'win32', homeDir: tmp, stateDir: path.join(tmp, 'state-win'), dryRun: true });
    assert.equal(getAutoWatchStatus({ platform: 'win32', homeDir: tmp, stateDir: path.join(tmp, 'state-win') }).configured, false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('lockfile is stored in stateDir/locks instead of app installation directory', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-lock-'));
  const stateDir = path.join(tmp, 'state');
  try {
    const targetAsar = await createSyntheticAsar(tmp);
    await install({ asarPath: targetAsar, stateDir });
    assert.equal(fs.existsSync(`${targetAsar}.zh-cn.lock`), false);
    assert.ok(fs.existsSync(path.join(stateDir, 'locks')));
    assert.equal(fs.readdirSync(path.join(stateDir, 'locks')).length, 0);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('cli.js --json outputs pure valid JSON for check, install, status, and restore', async () => {
  const { execFileSync } = require('node:child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-zhcn-cli-'));
  const stateDir = path.join(tmp, 'state');
  try {
    const targetAsar = await createSyntheticAsar(tmp);
    const cliPath = path.resolve(__dirname, '..', 'cli.js');
    const env = Object.assign({}, process.env, { AG_ZH_STATE_DIR: stateDir });

    const runJson = (args) => JSON.parse(
      execFileSync(process.execPath, [cliPath, ...args, '--path', targetAsar, '--json'], { env, encoding: 'utf8' })
    );

    const checkOut = runJson(['check']);
    assert.equal(checkOut.ok, true);

    const installOut = runJson(['install']);
    assert.equal(installOut.ok, true);
    assert.equal(installOut.patchedMainMenu, true);

    const statusOut = runJson(['status']);
    assert.equal(statusOut.patched, true);
    assert.equal(statusOut.patchedMainMenu, true);

    const restoreOut = runJson(['restore']);
    assert.equal(restoreOut.ok, true);
    assert.equal(restoreOut.mode, 'backup');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('stripInjectedChinese handles CRLF and preserves surrounding code cleanly', () => {
  const input = `const a = 1;\r\n${TAGS.START}\r\nconsole.log("x");\r\n${TAGS.END}\r\nconst b = 2;\r\n`;
  const out = stripInjectedChinese(input);
  assert.equal(out.includes(TAGS.START), false);
  assert.ok(out.includes('const a = 1;'));
  assert.ok(out.includes('const b = 2;'));
  assert.equal(validateSyntax(out, 'test.js'), true);
});
