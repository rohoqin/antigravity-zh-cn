'use strict';

const MENU_TAGS = {
  START: '// --- Antigravity-ZH-CN Native Menu Injection Start ---',
  END: '// --- Antigravity-ZH-CN Native Menu Injection End ---'
};

const NATIVE_MENU_DICT = {
  'File': '文件',
  'Edit': '编辑',
  'View': '视图',
  'Window': '窗口',
  'Help': '帮助',
  'Services': '服务',
  'Speech': '语音',
  'Start Speaking': '开始朗读',
  'Stop Speaking': '停止朗读',
  'New Window': '新建窗口',
  'Close': '关闭',
  'Close Window': '关闭窗口',
  'Undo': '撤销',
  'Redo': '重做',
  'Cut': '剪切',
  'Copy': '复制',
  'Paste': '粘贴',
  'Paste and Match Style': '粘贴并匹配样式',
  'Delete': '删除',
  'Select All': '全选',
  'Reload': '重新加载',
  'Force Reload': '强制重新加载',
  'Toggle Developer Tools': '切换开发者工具',
  'Actual Size': '实际大小',
  'Zoom In': '放大',
  'Zoom Out': '缩小',
  'Toggle Full Screen': '切换全屏',
  'Enter Full Screen': '进入全屏',
  'Exit Full Screen': '退出全屏',
  'Minimize': '最小化',
  'Zoom': '缩放',
  'Front': '全部置于顶层',
  'Bring All to Front': '前置全部窗口',
  'Docs': '文档',
  'Learn More': '了解更多',
  'Connect to WSL': '连接到 WSL',
  'Reopen Locally': '在本地重新打开',
  'Quit': '退出',
  'Quit Antigravity': '退出 Antigravity',
  'Hide Antigravity': '隐藏 Antigravity',
  'Hide Others': '隐藏其他',
  'Show All': '全部显示',
  'About Antigravity': '关于 Antigravity',
  'Open Antigravity': '打开 Antigravity',
  'No agents running': '暂无运行中的智能体',
  'Check for Updates': '检查更新',
  'Checking for Updates...': '正在检查更新...',
  'Downloading Update...': '正在下载更新...',
  'Restart to Update': '重启以更新'
};

function buildMainMenuInjection() {
  return `${MENU_TAGS.START}
(function() {
  try {
    var _electron = require('electron');
    if (!_electron || !_electron.Menu) return;
    if (globalThis.__AG_ZH_CN_MENU_HOOKED__) return;
    globalThis.__AG_ZH_CN_MENU_HOOKED__ = true;

    var _dict = ${JSON.stringify(NATIVE_MENU_DICT)};
    var _updateAliased = false;
    try {
      var _upd = require('./updater');
      if (_upd && _upd.updateActions && typeof _upd.updateActions === 'object') {
        var _pairs = [
          ['Check for Updates', '检查更新'],
          ['Checking for Updates...', '正在检查更新...'],
          ['Downloading Update...', '正在下载更新...'],
          ['Restart to Update', '重启以更新']
        ];
        for (var _i = 0; _i < _pairs.length; _i++) {
          var _en = _pairs[_i][0];
          var _zh = _pairs[_i][1];
          if (Object.prototype.hasOwnProperty.call(_upd.updateActions, _en)) {
            _upd.updateActions[_zh] = _upd.updateActions[_en];
          }
        }
        _updateAliased = true;
      }
    } catch (_e) {}

    function _translateLabel(label, itemId) {
      if (typeof label !== 'string' || !label) return label;
      if (itemId === 'check-for-updates' && !_updateAliased) return label;
      if (Object.prototype.hasOwnProperty.call(_dict, label)) return _dict[label];
      var _mAgent = label.match(/^(\\d+)\\s+agents?\\s+running$/i);
      if (_mAgent) return _mAgent[1] + ' 个智能体运行中';
      var _mOpen = label.match(/^Open\\s+(.+)$/);
      if (_mOpen) return '打开 ' + _mOpen[1];
      var _mQuit = label.match(/^Quit\\s+(.+)$/);
      if (_mQuit) return '退出 ' + _mQuit[1];
      var _mHide = label.match(/^Hide\\s+(.+)$/);
      if (_mHide && _mHide[1] !== 'Others') return '隐藏 ' + _mHide[1];
      var _mAbout = label.match(/^About\\s+(.+)$/);
      if (_mAbout) return '关于 ' + _mAbout[1];
      return label;
    }

    function _translateMenuObj(menu, isAppMenu) {
      if (!menu || !Array.isArray(menu.items)) return;
      for (var i = 0; i < menu.items.length; i++) {
        var item = menu.items[i];
        if (!item) continue;
        try {
          if (typeof item.label === 'string' && item.label) {
            // Windows 异步添加 WSL 菜单时会按 'File' 查找，仅 macOS 汉化顶层菜单名
            var skipTopFile = isAppMenu && process.platform === 'win32' && item.label === 'File';
            if (!skipTopFile) {
              var next = _translateLabel(item.label, item.id);
              if (next !== item.label) item.label = next;
            }
          }
          if (item.submenu) _translateMenuObj(item.submenu, false);
        } catch (_e) {}
      }
    }

    function _translateTemplate(template) {
      if (!Array.isArray(template)) return template;
      return template.map(function(entry) {
        if (!entry || typeof entry !== 'object') return entry;
        var copy = Object.assign({}, entry);
        if (typeof copy.label === 'string') {
          copy.label = _translateLabel(copy.label, copy.id);
        }
        if (Array.isArray(copy.submenu)) {
          copy.submenu = _translateTemplate(copy.submenu);
        }
        return copy;
      });
    }

    var _origSetAppMenu = _electron.Menu.setApplicationMenu.bind(_electron.Menu);
    _electron.Menu.setApplicationMenu = function(menu) {
      try { _translateMenuObj(menu, true); } catch (_e) {}
      return _origSetAppMenu(menu);
    };

    var _origBuildFromTemplate = _electron.Menu.buildFromTemplate.bind(_electron.Menu);
    _electron.Menu.buildFromTemplate = function(template) {
      try { template = _translateTemplate(template); } catch (_e) {}
      return _origBuildFromTemplate(template);
    };

    if (_electron.Tray && _electron.Tray.prototype && typeof _electron.Tray.prototype.setContextMenu === 'function') {
      var _origSetContextMenu = _electron.Tray.prototype.setContextMenu;
      _electron.Tray.prototype.setContextMenu = function(menu) {
        try { _translateMenuObj(menu, false); } catch (_e) {}
        return _origSetContextMenu.call(this, menu);
      };
    }
  } catch (_err) {}
})();
${MENU_TAGS.END}
`;
}

module.exports = {
  MENU_TAGS,
  NATIVE_MENU_DICT,
  buildMainMenuInjection
};
