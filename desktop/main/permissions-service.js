// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

function getAppLangMod() {
  try {
    return require('./app-language');
  } catch (_) {
    return {
      getAppLanguage: () => 'zh-CN',
      t: (pair) => (pair && (pair.zh || pair.en)) || '',
    };
  }
}

function getElectron() {
  try {
    return require('electron') || {};
  } catch (_) {
    return {};
  }
}

const FALLBACK_DRAG_ICON_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAZ0lEQVR4nGNgGAWDFVg3fXtNDqaqA/7///+BFExVR5DrABg9oA6giiModQDFjqCGAyhyBCWJkCq5gxwH4HPYqAModkDC0l93SMHDLwRGHTCaBkYdMJoGRh0w6oABcQA1MckOGAX0AgCkHQcm9HXZLQAAAABJRU5ErkJggg==';

function createFallbackDragIcon(nativeImageMod) {
  if (nativeImageMod && typeof nativeImageMod.createFromDataURL === 'function') {
    return nativeImageMod.createFromDataURL('data:image/png;base64,' + FALLBACK_DRAG_ICON_PNG_BASE64);
  }
  return { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,' + FALLBACK_DRAG_ICON_PNG_BASE64 };
}

const PERMISSION_ITEMS = [
  {
    id: 'fullDiskAccess',
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
    supportsDragToSettings: true,
    recommended: true,
    requiredForWeChatDrop: true,
  },
  {
    id: 'screenRecording',
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
    supportsDragToSettings: true,
    recommended: true,
    requiredForWeChatDrop: false,
  },
  {
    id: 'microphone',
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    supportsDragToSettings: false,
    recommended: true,
    requiredForWeChatDrop: false,
  },
  {
    id: 'accessibility',
    settingsUrl: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    supportsDragToSettings: true,
    recommended: false,
    requiredForWeChatDrop: false,
  },
];

const PERMISSION_BY_ID = Object.fromEntries(PERMISSION_ITEMS.map((item) => [item.id, item]));

const HELPER_WINDOW_SIZE = { width: 348, height: 276 };

/**
 * 探测 macOS「完全磁盘访问权限」（kTCCServiceSystemPolicyAllFiles / Privacy_AllFiles）。
 *
 * 原理（同 Codex SlimCore.FullDiskAccessPermission）：
 * - `/Library/Preferences/com.apple.TimeMachine.plist` 在 POSIX 层对所有用户可读（0644），
 *   但受 TCC SystemPolicyAllFiles 保护；未授权时 access(R_OK) 报 EPERM/EACCES。
 * - 同时探测微信沙盒容器 `~/Library/Containers/com.tencent.xinWeChat/Data` 与 `~/Library/Safari`：
 *   任一受保护路径可读即视为已授予完全磁盘访问权限；任一路径报 EPERM/EACCES 即判定未授权。
 */
function checkFullDiskAccessStatus(deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'darwin') return 'granted';
  const fsMod = deps.fs || fs;
  const homedir = deps.homedir || os.homedir();
  const readFlag = (fsMod.constants && fsMod.constants.R_OK) || 4;
  const probes = [
    '/Library/Preferences/com.apple.TimeMachine.plist',
    path.join(homedir, 'Library/Containers/com.tencent.xinWeChat/Data'),
    path.join(homedir, 'Library/Safari'),
  ];
  let sawPermissionDenied = false;
  for (const probe of probes) {
    try {
      fsMod.accessSync(probe, readFlag);
      return 'granted';
    } catch (err) {
      const code = err && err.code;
      if (code === 'EPERM' || code === 'EACCES') {
        sawPermissionDenied = true;
      }
    }
  }
  return sawPermissionDenied ? 'not-granted' : 'granted';
}

function checkSinglePermissionStatus(id, deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'darwin') return 'granted';
  const sysPrefs = deps.systemPreferences || getElectron().systemPreferences;
  if (id === 'fullDiskAccess') {
    return checkFullDiskAccessStatus(deps);
  }
  if (id === 'screenRecording') {
    try {
      if (sysPrefs && typeof sysPrefs.getMediaAccessStatus === 'function') {
        return sysPrefs.getMediaAccessStatus('screen') === 'granted' ? 'granted' : 'not-granted';
      }
    } catch (_) { /* ignore */ }
    return 'not-granted';
  }
  if (id === 'microphone') {
    try {
      if (sysPrefs && typeof sysPrefs.getMediaAccessStatus === 'function') {
        return sysPrefs.getMediaAccessStatus('microphone') === 'granted' ? 'granted' : 'not-granted';
      }
    } catch (_) { /* ignore */ }
    return 'not-granted';
  }
  if (id === 'accessibility') {
    try {
      if (sysPrefs && typeof sysPrefs.isTrustedAccessibilityClient === 'function') {
        return sysPrefs.isTrustedAccessibilityClient(false) ? 'granted' : 'not-granted';
      }
    } catch (_) { /* ignore */ }
    return 'not-granted';
  }
  return 'not-granted';
}

/**
 * 解析当前应用对应的 `.app` 包路径，供拖入 macOS「系统设置」隐私列表使用。
 * - 打包态：从 `process.execPath`（`.../AI WorkDeck.app/Contents/MacOS/AI WorkDeck`）向上定位 `.app`；
 * - 开发态（`Electron.app`）：若 `/Applications/AI WorkDeck.app` 已安装则优先使用它，否则回退 `Electron.app`。
 */
function resolveAppBundlePath(deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'darwin') return '';
  const fsMod = deps.fs || fs;
  const execPath = String(deps.execPath || process.execPath || '');
  let foundApp = '';
  if (execPath && path.isAbsolute(execPath)) {
    let cur = path.resolve(execPath);
    while (cur && cur !== path.dirname(cur)) {
      if (/\.app$/i.test(path.basename(cur))) {
        foundApp = cur;
        break;
      }
      cur = path.dirname(cur);
    }
  }
  const installedCandidate = deps.installedAppPath || '/Applications/AI WorkDeck.app';
  const isDevElectronApp = !foundApp || /^Electron\.app$/i.test(path.basename(foundApp));
  if (isDevElectronApp) {
    try {
      if (typeof fsMod.existsSync === 'function' && fsMod.existsSync(installedCandidate)) {
        return installedCandidate;
      }
      if (typeof fsMod.statSync === 'function' && fsMod.statSync(installedCandidate)) {
        return installedCandidate;
      }
    } catch (_) { /* fallback to foundApp */ }
  }
  if (foundApp) {
    try {
      if (typeof fsMod.statSync === 'function') {
        fsMod.statSync(foundApp);
      }
      return foundApp;
    } catch (_) {
      return '';
    }
  }
  return '';
}

let cachedAppDragIcon = null;
function resolveAppDragIcon(deps = {}) {
  if (deps.icon) return deps.icon;
  const electronMod = getElectron();
  const nativeImageMod = deps.nativeImage || electronMod.nativeImage;
  if (cachedAppDragIcon && nativeImageMod === electronMod.nativeImage) return cachedAppDragIcon;
  if (nativeImageMod && typeof nativeImageMod.createFromPath === 'function') {
    const iconCandidate = path.join(__dirname, '../build/icon.png');
    try {
      if (fs.existsSync(iconCandidate)) {
        const img = nativeImageMod.createFromPath(iconCandidate);
        if (img && typeof img.isEmpty === 'function' && !img.isEmpty()) {
          const resized = typeof img.resize === 'function' ? img.resize({ width: 64, height: 64 }) : img;
          if (nativeImageMod === electronMod.nativeImage) cachedAppDragIcon = resized;
          return resized;
        }
      }
    } catch (_) { /* fall through */ }
  }
  return createFallbackDragIcon(nativeImageMod);
}

function getAppIconDataUrl(deps = {}) {
  try {
    const icon = resolveAppDragIcon(deps);
    if (icon && typeof icon.toDataURL === 'function') {
      return icon.toDataURL();
    }
  } catch (_) { /* ignore */ }
  return '';
}

/**
 * 启动 `.app` 应用包的系统级原生拖拽（`NSPasteboardTypeFileURL`），
 * 用户可直接将其拖入 macOS「系统设置 → 隐私与安全性」列表中完成授权。
 */
function startAppBundleDrag(sender, deps = {}) {
  if (!sender || typeof sender.startDrag !== 'function') {
    return { ok: false, reason: 'no-sender' };
  }
  const bundlePath = resolveAppBundlePath(deps);
  if (!bundlePath || !path.isAbsolute(bundlePath) || !/\.app$/i.test(bundlePath)) {
    return { ok: false, reason: 'app-bundle-not-found' };
  }
  const icon = resolveAppDragIcon(deps);
  if (!icon || (typeof icon.isEmpty === 'function' && icon.isEmpty())) {
    return { ok: false, reason: 'no-icon' };
  }
  try {
    sender.startDrag({ file: bundlePath, icon });
    return { ok: true, path: bundlePath };
  } catch (e) {
    return {
      ok: false,
      reason: 'start-drag-failed',
      message: String((e && e.message) || e),
    };
  }
}

function getPermissionsState(deps = {}) {
  const platform = deps.platform || process.platform;
  const supported = platform === 'darwin';
  const appBundlePath = resolveAppBundlePath(deps);
  const items = PERMISSION_ITEMS.map((item) => ({
    ...item,
    status: checkSinglePermissionStatus(item.id, deps),
  }));
  const recommendedItems = items.filter((item) => item.recommended);
  return {
    platform,
    supported,
    appDisplayName: 'AI WorkDeck',
    appBundlePath,
    appBundleName: appBundlePath ? path.basename(appBundlePath) : 'AI WorkDeck.app',
    appIconDataUrl: getAppIconDataUrl(deps),
    allGranted: items.every((item) => item.status === 'granted'),
    recommendedGranted: recommendedItems.every((item) => item.status === 'granted'),
    items,
  };
}

/**
 * 计算拖拽引导浮窗相对于 macOS「系统设置」窗口的贴靠坐标：
 * - 优先贴在「系统设置」左侧（箭头朝右 `right` 指向设置列表）；
 * - 若左侧空间不足则贴在「系统设置」右侧（箭头朝左 `left`）；
 * - 若两侧均不足则停靠在屏幕工作区偏左处，确保不遮挡「系统设置」右侧的开关列表。
 */
function computeHelperWindowBounds(settingsBounds, workArea = { x: 0, y: 25, width: 1440, height: 875 }, helperSize = HELPER_WINDOW_SIZE) {
  const width = helperSize.width || HELPER_WINDOW_SIZE.width;
  const height = helperSize.height || HELPER_WINDOW_SIZE.height;
  const gap = 16;
  const minX = workArea.x + 12;
  const maxX = workArea.x + workArea.width - width - 12;
  const minY = workArea.y + 16;
  const maxY = workArea.y + workArea.height - height - 16;

  if (settingsBounds && Number.isFinite(settingsBounds.x) && Number.isFinite(settingsBounds.width)) {
    const leftCandidate = Math.round(settingsBounds.x - width - gap);
    const rightCandidate = Math.round(settingsBounds.x + settingsBounds.width + gap);
    const targetY = Math.max(
      minY,
      Math.min(maxY, Math.round(settingsBounds.y + Math.max(40, (settingsBounds.height - height) * 0.34)))
    );

    if (leftCandidate >= minX) {
      return { x: leftCandidate, y: targetY, width, height, arrowDirection: 'right' };
    }
    if (rightCandidate <= maxX) {
      return { x: rightCandidate, y: targetY, width, height, arrowDirection: 'left' };
    }
    return { x: minX, y: targetY, width, height, arrowDirection: 'right' };
  }

  return {
    x: Math.max(minX, Math.round(workArea.x + workArea.width * 0.1)),
    y: Math.max(minY, Math.min(maxY, Math.round(workArea.y + (workArea.height - height) * 0.36))),
    width,
    height,
    arrowDirection: 'right',
  };
}

const SYSTEM_SETTINGS_BOUNDS_JXA = `
ObjC.import("AppKit");
ObjC.import("CoreGraphics");
const apps = $.NSRunningApplication.runningApplicationsWithBundleIdentifier("com.apple.systempreferences");
const pids = {};
for (let i = 0; i < apps.count; i++) {
  pids[apps.objectAtIndex(i).processIdentifier] = true;
}
const list = ObjC.castRefToObject($.CGWindowListCopyWindowInfo($.kCGWindowListOptionOnScreenOnly | $.kCGWindowListExcludeDesktopElements, 0));
let found = null;
for (let i = 0; i < list.count; i++) {
  const win = list.objectAtIndex(i);
  const pid = ObjC.unwrap(win.objectForKey("kCGWindowOwnerPID"));
  const layer = ObjC.unwrap(win.objectForKey("kCGWindowLayer")) || 0;
  const bounds = ObjC.unwrap(win.objectForKey("kCGWindowBounds"));
  if (pids[pid] && layer === 0 && bounds && bounds.Width > 300 && bounds.Height > 300) {
    found = { x: Number(bounds.X), y: Number(bounds.Y), width: Number(bounds.Width), height: Number(bounds.Height) };
    break;
  }
}
JSON.stringify({ running: apps.count > 0, window: found });
`.trim();

function querySystemSettingsWindowBounds() {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      'osascript',
      ['-l', 'JavaScript', '-e', SYSTEM_SETTINGS_BOUNDS_JXA],
      { timeout: 1500 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        try {
          const parsed = JSON.parse(String(stdout).trim());
          return resolve(parsed && parsed.window ? parsed.window : null);
        } catch (_) {
          return resolve(null);
        }
      }
    );
  });
}

function permissionDisplayMeta(permissionId) {
  const { t } = getAppLangMod();
  const metas = {
    fullDiskAccess: {
      title: t({ zh: '完全磁盘访问权限', en: 'Full Disk Access' }),
      paneName: t({ zh: '隐私与安全性 → 完全磁盘访问权限', en: 'Privacy & Security → Full Disk Access' }),
      hint: t({
        zh: '按住下方 AI WorkDeck 图标，直接拖入右侧「系统设置」列表中即可开启（支持微信文件直接拖入）',
        en: 'Drag the AI WorkDeck icon below directly into the System Settings list to allow WeChat file drops',
      }),
    },
    screenRecording: {
      title: t({ zh: '屏幕录制与系统录音', en: 'Screen & System Audio Recording' }),
      paneName: t({ zh: '隐私与安全性 → 录屏与系统录音', en: 'Privacy & Security → Screen Recording' }),
      hint: t({
        zh: '按住下方 AI WorkDeck 图标，直接拖入右侧「系统设置」列表中即可开启跨窗口截图 OCR',
        en: 'Drag the AI WorkDeck icon below directly into the System Settings list to enable cross-window OCR',
      }),
    },
    accessibility: {
      title: t({ zh: '辅助功能权限', en: 'Accessibility' }),
      paneName: t({ zh: '隐私与安全性 → 辅助功能', en: 'Privacy & Security → Accessibility' }),
      hint: t({
        zh: '按住下方 AI WorkDeck 图标，直接拖入右侧「系统设置」列表中即可开启系统快捷辅助',
        en: 'Drag the AI WorkDeck icon below directly into the System Settings list to enable Accessibility',
      }),
    },
    microphone: {
      title: t({ zh: '麦克风权限', en: 'Microphone' }),
      paneName: t({ zh: '隐私与安全性 → 麦克风', en: 'Privacy & Security → Microphone' }),
      hint: t({
        zh: '请在「系统设置 → 隐私与安全性 → 麦克风」中打开 AI WorkDeck 开关',
        en: 'Enable the AI WorkDeck switch in System Settings → Privacy & Security → Microphone',
      }),
    },
  };
  return metas[permissionId] || metas.fullDiskAccess;
}

const escapeHtml = (value) =>
  String(value || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function buildHelperWindowHtml(initialPayload = {}) {
  const { t, getAppLanguage } = getAppLangMod();
  const lang = getAppLanguage();
  const payloadJson = JSON.stringify(initialPayload).replace(/</g, '\\u003c');
  const labels = {
    stepBadge: t({ zh: '拖拽快速授权', en: 'Drag to Authorize' }),
    dragAction: t({ zh: '按住拖入设置', en: 'Drag to Settings' }),
    grantedText: t({ zh: '已成功开启权限！', en: 'Permission Granted!' }),
    reopenBtn: t({ zh: '重新打开系统设置', en: 'Reopen System Settings' }),
    footerNote: t({
      zh: '拖入列表后若开关未打开，请点击列表中的开关开启',
      en: 'After dropping into the list, make sure the toggle switch is turned on',
    }),
    closeLabel: t({ zh: '关闭', en: 'Close' }),
  };
  const labelsJson = JSON.stringify(labels).replace(/</g, '\\u003c');

  return `<!doctype html><html lang="${escapeHtml(lang)}"><head><meta charset="utf-8">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(labels.stepBadge)}</title>
<style>
:root {
  --bg: rgba(252, 251, 247, 0.97);
  --surface: #F4F1E8;
  --surface-hover: #ECE7DA;
  --text: #2B2A26;
  --text-2: #6B675C;
  --border: #DDD8CA;
  --accent: #2E5A50;
  --accent-soft: rgba(46, 90, 80, 0.12);
  --success: #256F46;
  --success-soft: rgba(37, 111, 70, 0.14);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: rgba(34, 31, 26, 0.97);
    --surface: #2D2923;
    --surface-hover: #38332B;
    --text: #EDE9DF;
    --text-2: #B0AA9C;
    --border: #3D372E;
    --accent: #89A8A0;
    --accent-soft: rgba(137, 168, 160, 0.16);
    --success: #58B881;
    --success-soft: rgba(88, 184, 129, 0.18);
  }
}
* { box-sizing: border-box; user-select: none; -webkit-user-select: none; }
html, body {
  margin: 0; padding: 0; width: 100%; height: 100%;
  background: transparent;
  font: 13px/1.5 -apple-system, BlinkMacSystemFont, "PingFang SC", "Segoe UI", sans-serif;
  color: var(--text);
  overflow: hidden;
}
.card {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  width: 100%;
  height: 100%;
  padding: 16px 18px 14px;
  background: var(--bg);
  border: 1.5px solid var(--border);
  border-radius: 16px;
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.22);
}
.top-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  -webkit-app-region: drag;
}
.badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
}
.close-btn {
  -webkit-app-region: no-drag;
  border: none;
  background: transparent;
  color: var(--text-2);
  font-size: 18px;
  line-height: 1;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  cursor: pointer;
}
.close-btn:hover { background: var(--surface); color: var(--text); }
.header { margin-top: 6px; }
.title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: -0.2px;
}
.hint {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-2);
  line-height: 1.45;
}
.drag-zone {
  -webkit-app-region: no-drag;
  margin-top: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  background: var(--surface);
  border: 1.5px dashed var(--accent);
  border-radius: 12px;
  cursor: grab;
  transition: transform 0.15s ease, background 0.15s ease, border-color 0.15s ease;
}
.drag-zone:hover {
  background: var(--surface-hover);
  transform: translateY(-1px);
}
.drag-zone:active { cursor: grabbing; transform: scale(0.99); }
.drag-zone.is-granted {
  background: var(--success-soft);
  border-style: solid;
  border-color: var(--success);
  cursor: default;
}
.app-info {
  display: flex;
  align-items: center;
  gap: 11px;
  min-width: 0;
}
.app-icon {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  flex-shrink: 0;
  object-fit: contain;
}
.app-icon-fallback {
  width: 42px;
  height: 42px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 15px;
}
.app-name {
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-sub {
  font-size: 11px;
  color: var(--text-2);
}
.drag-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 8px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}
.drag-zone.is-granted .drag-pill {
  background: var(--success);
}
.arrow {
  display: inline-block;
  animation: nudgeRight 1.1s ease-in-out infinite;
}
.arrow.is-left {
  animation-name: nudgeLeft;
}
@keyframes nudgeRight {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(4px); }
}
@keyframes nudgeLeft {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(-4px); }
}
.footer {
  -webkit-app-region: no-drag;
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-2);
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--accent);
  font-size: 11px;
  font-weight: 600;
  padding: 2px 4px;
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;
  white-space: nowrap;
}
</style>
</head>
<body>
  <div class="card">
    <div>
      <div class="top-bar">
        <span class="badge" id="stepBadge"></span>
        <button class="close-btn" id="closeBtn" type="button" title="${escapeHtml(labels.closeLabel)}">×</button>
      </div>
      <div class="header">
        <h1 class="title" id="permTitle"></h1>
        <p class="hint" id="permHint"></p>
      </div>
      <div class="drag-zone" id="dragCard" draggable="true">
        <div class="app-info">
          <img class="app-icon" id="appIcon" alt="AI WorkDeck" style="display:none" />
          <div class="app-icon-fallback" id="appIconFallback">AW</div>
          <div>
            <div class="app-name" id="appName">AI WorkDeck</div>
            <div class="app-sub" id="paneName"></div>
          </div>
        </div>
        <div class="drag-pill" id="dragPill">
          <span id="dragPillText"></span>
          <span class="arrow" id="dragArrow">→</span>
        </div>
      </div>
    </div>
    <div class="footer">
      <span id="footerNote">${escapeHtml(labels.footerNote)}</span>
      <button class="link-btn" id="reopenBtn" type="button">${escapeHtml(labels.reopenBtn)}</button>
    </div>
  </div>
<script>
(function() {
  const LABELS = ${labelsJson};
  let state = ${payloadJson};

  const stepBadgeEl = document.getElementById('stepBadge');
  const permTitleEl = document.getElementById('permTitle');
  const permHintEl = document.getElementById('permHint');
  const paneNameEl = document.getElementById('paneName');
  const appNameEl = document.getElementById('appName');
  const appIconEl = document.getElementById('appIcon');
  const appIconFallbackEl = document.getElementById('appIconFallback');
  const dragCardEl = document.getElementById('dragCard');
  const dragPillTextEl = document.getElementById('dragPillText');
  const dragArrowEl = document.getElementById('dragArrow');
  const closeBtnEl = document.getElementById('closeBtn');
  const reopenBtnEl = document.getElementById('reopenBtn');

  function render() {
    stepBadgeEl.textContent = LABELS.stepBadge;
    permTitleEl.textContent = state.title || '';
    permHintEl.textContent = state.hint || '';
    paneNameEl.textContent = state.paneName || '';
    appNameEl.textContent = state.appBundleName || 'AI WorkDeck.app';
    if (state.appIconDataUrl) {
      appIconEl.src = state.appIconDataUrl;
      appIconEl.style.display = 'block';
      appIconFallbackEl.style.display = 'none';
    }
    const isLeft = state.arrowDirection === 'left';
    dragArrowEl.textContent = isLeft ? '←' : '→';
    dragArrowEl.className = isLeft ? 'arrow is-left' : 'arrow';

    if (state.status === 'granted') {
      dragCardEl.classList.add('is-granted');
      dragCardEl.setAttribute('draggable', 'false');
      dragPillTextEl.textContent = LABELS.grantedText;
      dragArrowEl.textContent = '✓';
      dragArrowEl.className = '';
    } else {
      dragCardEl.classList.remove('is-granted');
      dragCardEl.setAttribute('draggable', 'true');
      dragPillTextEl.textContent = LABELS.dragAction;
    }
  }

  dragCardEl.addEventListener('dragstart', function(e) {
    if (state.status === 'granted') {
      e.preventDefault();
      return;
    }
    // 必须在同步 dragstart 阶段先 preventDefault 再启动系统级 startDrag（#1307 契约）
    e.preventDefault();
    if (window.checkbaPermissionHelper && window.checkbaPermissionHelper.startAppDrag) {
      window.checkbaPermissionHelper.startAppDrag();
    }
  });

  closeBtnEl.addEventListener('click', function() {
    if (window.checkbaPermissionHelper && window.checkbaPermissionHelper.closeHelper) {
      window.checkbaPermissionHelper.closeHelper();
    }
  });

  reopenBtnEl.addEventListener('click', function() {
    if (window.checkbaPermissionHelper && window.checkbaPermissionHelper.reopenSettings) {
      window.checkbaPermissionHelper.reopenSettings(state.id || 'fullDiskAccess');
    }
  });

  if (window.checkbaPermissionHelper && window.checkbaPermissionHelper.onState) {
    window.checkbaPermissionHelper.onState(function(next) {
      if (next && typeof next === 'object') {
        state = Object.assign({}, state, next);
        render();
      }
    });
  }

  render();
})();
</script>
</body></html>`;
}

async function requestPermissionAccess(permissionId, opts = {}, deps = {}) {
  const item = PERMISSION_BY_ID[permissionId] || PERMISSION_BY_ID.fullDiskAccess;
  const platform = deps.platform || process.platform;
  if (platform !== 'darwin') {
    return { ok: true, id: item.id, status: 'granted', openedSettings: false };
  }

  const electronMod = getElectron();
  const sysPrefs = deps.systemPreferences || electronMod.systemPreferences;
  const shellMod = deps.shell || electronMod.shell;

  // 麦克风：若尚未询问过系统弹窗，优先触发系统原生授权框
  if (item.id === 'microphone' && !opts.forceOpenSettings) {
    try {
      const current = sysPrefs && typeof sysPrefs.getMediaAccessStatus === 'function'
        ? sysPrefs.getMediaAccessStatus('microphone')
        : 'not-determined';
      if (current === 'not-determined' && sysPrefs && typeof sysPrefs.askForMediaAccess === 'function') {
        const granted = await sysPrefs.askForMediaAccess('microphone');
        if (granted) {
          return { ok: true, id: item.id, status: 'granted', openedSettings: false };
        }
      }
    } catch (_) { /* fall through to open System Settings */ }
  }

  // 辅助功能：可顺带触发一次系统注册提示，让应用出现在辅助功能候选列表中
  if (item.id === 'accessibility' && opts.promptNative !== false) {
    try {
      if (sysPrefs && typeof sysPrefs.isTrustedAccessibilityClient === 'function') {
        sysPrefs.isTrustedAccessibilityClient(true);
      }
    } catch (_) { /* ignore */ }
  }

  let openedSettings = false;
  if (shellMod && typeof shellMod.openExternal === 'function') {
    try {
      await shellMod.openExternal(item.settingsUrl);
      openedSettings = true;
    } catch (_) { /* ignore */ }
  }

  const showFloatingHelper = opts.showFloatingHelper !== false && item.supportsDragToSettings;
  if (showFloatingHelper && typeof deps.onShowHelper === 'function') {
    await deps.onShowHelper(item.id, opts);
  }

  return {
    ok: true,
    id: item.id,
    status: checkSinglePermissionStatus(item.id, deps),
    openedSettings,
    showedHelper: showFloatingHelper,
  };
}

function initPermissionsService(options = {}) {
  const electronMod = getElectron();
  const ipcMainMod = options.ipcMain || electronMod.ipcMain;
  const getMainWindow = options.getMainWindow || (() => null);
  let helperWindow = null;
  let activeHelperPermId = 'fullDiskAccess';
  let helperUserMoved = false;
  let pollTimer = null;
  let closeTimer = null;
  let lastBroadcastSerialized = '';
  let lastBoundsCheckAt = 0;
  let helperMoveSuppressUntil = 0;

  function broadcastPermissionsState(force = false) {
    const state = getPermissionsState(options);
    const serialized = JSON.stringify(state.items.map((i) => [i.id, i.status]));
    if (!force && serialized === lastBroadcastSerialized) return state;
    lastBroadcastSerialized = serialized;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('checkba:permissions-updated', state);
      } catch (_) { /* ignore */ }
    }
    return state;
  }

  function buildHelperPayload(permId, arrowDirection = 'right') {
    const state = getPermissionsState(options);
    const item = state.items.find((i) => i.id === permId) || state.items[0];
    const meta = permissionDisplayMeta(item.id);
    return {
      id: item.id,
      status: item.status,
      title: meta.title,
      paneName: meta.paneName,
      hint: meta.hint,
      appBundleName: state.appBundleName,
      appIconDataUrl: state.appIconDataUrl,
      arrowDirection,
    };
  }

  function stopPollingIfIdle() {
    if ((!helperWindow || helperWindow.isDestroyed()) && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function closeHelperWindow() {
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    if (helperWindow && !helperWindow.isDestroyed()) {
      try { helperWindow.close(); } catch (_) { /* ignore */ }
    }
    helperWindow = null;
    stopPollingIfIdle();
  }

  async function syncHelperPlacement() {
    if (!helperWindow || helperWindow.isDestroyed() || helperUserMoved) return;
    const now = Date.now();
    if (now - lastBoundsCheckAt < 1100) return;
    lastBoundsCheckAt = now;
    try {
      const settingsBounds = await querySystemSettingsWindowBounds();
      if (!settingsBounds || !helperWindow || helperWindow.isDestroyed() || helperUserMoved) return;
      const screenMod = getElectron().screen;
      const display = screenMod && typeof screenMod.getDisplayMatching === 'function'
        ? screenMod.getDisplayMatching(settingsBounds)
        : (screenMod && typeof screenMod.getPrimaryDisplay === 'function' ? screenMod.getPrimaryDisplay() : null);
      const workArea = (display && display.workArea) || { x: 0, y: 25, width: 1440, height: 875 };
      const next = computeHelperWindowBounds(settingsBounds, workArea, HELPER_WINDOW_SIZE);
      helperMoveSuppressUntil = Date.now() + 250;
      helperWindow.setBounds({ x: next.x, y: next.y, width: next.width, height: next.height }, true);
      helperWindow.webContents.send('checkba:permission-helper-state', {
        arrowDirection: next.arrowDirection,
      });
    } catch (_) { /* ignore */ }
  }

  function ensurePolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => {
      const state = broadcastPermissionsState(false);
      if (helperWindow && !helperWindow.isDestroyed()) {
        const current = state.items.find((i) => i.id === activeHelperPermId);
        if (current) {
          try {
            helperWindow.webContents.send('checkba:permission-helper-state', {
              id: current.id,
              status: current.status,
            });
          } catch (_) { /* ignore */ }
          if (current.status === 'granted' && !closeTimer) {
            closeTimer = setTimeout(() => {
              closeHelperWindow();
            }, 1300);
          }
        }
        syncHelperPlacement();
      } else {
        stopPollingIfIdle();
      }
    }, 800);
  }

  async function showHelperWindow(permId = 'fullDiskAccess') {
    if (process.platform !== 'darwin') return null;
    activeHelperPermId = PERMISSION_BY_ID[permId] ? permId : 'fullDiskAccess';
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }

    const screenMod = electron.screen;
    const primaryWorkArea = (screenMod && typeof screenMod.getPrimaryDisplay === 'function' && screenMod.getPrimaryDisplay()?.workArea)
      || { x: 0, y: 25, width: 1440, height: 875 };
    const settingsBounds = await querySystemSettingsWindowBounds();
    const placement = computeHelperWindowBounds(settingsBounds, primaryWorkArea, HELPER_WINDOW_SIZE);
    const payload = buildHelperPayload(activeHelperPermId, placement.arrowDirection);

    if (helperWindow && !helperWindow.isDestroyed()) {
      helperUserMoved = false;
      helperMoveSuppressUntil = Date.now() + 250;
      try {
        helperWindow.setBounds({ x: placement.x, y: placement.y, width: placement.width, height: placement.height }, true);
        helperWindow.webContents.send('checkba:permission-helper-state', payload);
        helperWindow.showInactive();
      } catch (_) { /* ignore */ }
      ensurePolling();
      return helperWindow;
    }

    helperUserMoved = false;
    const BrowserWindowCtor = getElectron().BrowserWindow;
    const win = new BrowserWindowCtor({
      width: placement.width,
      height: placement.height,
      x: placement.x,
      y: placement.y,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/permission-helper-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    helperWindow = win;
    try { win.setMenu(null); } catch (_) { /* ignore */ }
    try { win.setAlwaysOnTop(true, 'floating'); } catch (_) { /* ignore */ }
    try { win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch (_) { /* ignore */ }

    win.on('move', () => {
      if (Date.now() > helperMoveSuppressUntil) {
        helperUserMoved = true;
      }
    });
    win.on('closed', () => {
      if (helperWindow === win) helperWindow = null;
      stopPollingIfIdle();
    });
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) {
        try { win.showInactive(); } catch (_) { win.show(); }
      }
    });

    const html = buildHelperWindowHtml(payload);
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    ensurePolling();
    // 系统设置刚拉起时可能晚 400ms 才出现在屏幕上，补一次贴靠定位
    setTimeout(() => { syncHelperPlacement(); }, 450);
    return win;
  }

  if (ipcMainMod && typeof ipcMainMod.handle === 'function') {
    ipcMainMod.handle('checkba:permissions-status', async () => getPermissionsState(options));

    ipcMainMod.handle('checkba:permissions-request', async (_evt, payload = {}) => {
      const id = payload && payload.id ? String(payload.id) : 'fullDiskAccess';
      const result = await requestPermissionAccess(
        id,
        payload,
        {
          ...options,
          onShowHelper: (permId) => showHelperWindow(permId),
        }
      );
      broadcastPermissionsState(true);
      ensurePolling();
      return result;
    });

    ipcMainMod.handle('checkba:permissions-open-settings', async (_evt, payload = {}) => {
      const id = payload && payload.id ? String(payload.id) : 'fullDiskAccess';
      const result = await requestPermissionAccess(
        id,
        { ...payload, forceOpenSettings: true },
        {
          ...options,
          onShowHelper: (permId) => showHelperWindow(permId),
        }
      );
      broadcastPermissionsState(true);
      ensurePolling();
      return result;
    });

    ipcMainMod.handle('checkba:permissions-start-app-drag', async (event) => {
      return startAppBundleDrag(event.sender, options);
    });

    ipcMainMod.handle('checkba:permissions-close-helper', async () => {
      closeHelperWindow();
      return { ok: true };
    });
  }

  return {
    getPermissionsState: () => getPermissionsState(options),
    showHelperWindow,
    closeHelperWindow,
    broadcastPermissionsState,
  };
}

module.exports = {
  PERMISSION_ITEMS,
  PERMISSION_BY_ID,
  HELPER_WINDOW_SIZE,
  checkFullDiskAccessStatus,
  checkSinglePermissionStatus,
  resolveAppBundlePath,
  startAppBundleDrag,
  getPermissionsState,
  computeHelperWindowBounds,
  requestPermissionAccess,
  initPermissionsService,
};
