// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PRELOAD_SRC = fs.readFileSync(path.join(__dirname, '../preload/preload.js'), 'utf8');

test('preload 暴露 permissions.{getStatus,request,openSettings,startAppDrag,closeHelper,onUpdated}', () => {
  assert.match(PRELOAD_SRC, /permissions:\s*\{/);
  assert.match(PRELOAD_SRC, /getStatus:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('checkba:permissions-status'\)/);
  assert.match(PRELOAD_SRC, /request:\s*\(id,\s*opts\)\s*=>\s*ipcRenderer\.invoke\('checkba:permissions-request'/);
  assert.match(PRELOAD_SRC, /startAppDrag:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('checkba:permissions-start-app-drag'\)/);
});

test('checkFullDiskAccessStatus：根据 TCC 探针路径可读性判定完全磁盘访问权限', () => {
  const svc = require('../main/permissions-service');

  // 1. TimeMachine.plist 可读 -> granted
  const grantedStatus = svc.checkFullDiskAccessStatus({
    platform: 'darwin',
    homedir: '/Users/tester',
    fs: {
      constants: { R_OK: 4 },
      accessSync(p) {
        if (p === '/Library/Preferences/com.apple.TimeMachine.plist') return;
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    },
  });
  assert.equal(grantedStatus, 'granted');

  // 2. TimeMachine.plist 与微信容器均报 EPERM -> not-granted
  const deniedStatus = svc.checkFullDiskAccessStatus({
    platform: 'darwin',
    homedir: '/Users/tester',
    fs: {
      constants: { R_OK: 4 },
      accessSync() {
        const err = new Error('operation not permitted');
        err.code = 'EPERM';
        throw err;
      },
    },
  });
  assert.equal(deniedStatus, 'not-granted');

  // 3. 非 macOS 恒为 granted
  assert.equal(svc.checkFullDiskAccessStatus({ platform: 'win32' }), 'granted');
});

test('resolveAppBundlePath 与 startAppBundleDrag：支持将 AI WorkDeck.app 应用包拖入系统设置列表', () => {
  const svc = require('../main/permissions-service');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'awd-perm-bundle-'));
  try {
    const fakeApp = path.join(tmp, 'AI WorkDeck.app');
    const fakeExec = path.join(fakeApp, 'Contents', 'MacOS', 'AI WorkDeck');
    fs.mkdirSync(path.dirname(fakeExec), { recursive: true });
    fs.writeFileSync(fakeExec, '');

    const resolved = svc.resolveAppBundlePath({
      platform: 'darwin',
      execPath: fakeExec,
      fs,
    });
    assert.equal(resolved, fakeApp);

    const dragged = [];
    const res = svc.startAppBundleDrag(
      { startDrag: (payload) => dragged.push(payload) },
      { platform: 'darwin', execPath: fakeExec, fs }
    );
    assert.equal(res.ok, true);
    assert.equal(res.path, fakeApp);
    assert.equal(dragged.length, 1);
    assert.equal(dragged[0].file, fakeApp);
    assert.ok(dragged[0].icon, 'startDrag 必须附带非空图标');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('computeHelperWindowBounds：自动贴靠在系统设置窗口左侧或右侧且不遮挡列表区', () => {
  const svc = require('../main/permissions-service');
  const workArea = { x: 0, y: 25, width: 1440, height: 875 };

  // 系统设置在屏幕中央偏右：浮窗贴在左侧，箭头朝右指向系统设置
  const leftPlacement = svc.computeHelperWindowBounds(
    { x: 520, y: 120, width: 715, height: 640 },
    workArea,
    { width: 348, height: 276 }
  );
  assert.equal(leftPlacement.arrowDirection, 'right');
  assert.ok(leftPlacement.x + leftPlacement.width <= 520, '浮窗在系统设置左侧时不遮挡系统设置');

  // 系统设置紧贴屏幕左边缘：浮窗改贴在右侧，箭头朝左指向系统设置
  const rightPlacement = svc.computeHelperWindowBounds(
    { x: 40, y: 120, width: 715, height: 640 },
    workArea,
    { width: 348, height: 276 }
  );
  assert.equal(rightPlacement.arrowDirection, 'left');
  assert.ok(rightPlacement.x >= 40 + 715, '浮窗在系统设置右侧时不遮挡系统设置');
});

test('requestPermissionAccess：打开对应系统设置隐私页并拉起拖拽引导浮窗', async () => {
  const svc = require('../main/permissions-service');
  const openedUrls = [];
  const helperShown = [];

  const result = await svc.requestPermissionAccess(
    'fullDiskAccess',
    { showFloatingHelper: true },
    {
      platform: 'darwin',
      shell: {
        openExternal: async (url) => {
          openedUrls.push(url);
        },
      },
      onShowHelper: (permId) => helperShown.push(permId),
      fs: {
        constants: { R_OK: 4 },
        accessSync() {
          const err = new Error('EPERM');
          err.code = 'EPERM';
          throw err;
        },
      },
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.id, 'fullDiskAccess');
  assert.deepEqual(openedUrls, ['x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles']);
  assert.deepEqual(helperShown, ['fullDiskAccess']);
});
