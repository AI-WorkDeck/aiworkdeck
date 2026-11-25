// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// IDE 化「打开文件夹 / 打开文件」共用流程：系统对话框 → open-local API → reLaunch 进项目。
// newproject 页与应用菜单（App.vue 的 menu-action 处理器）共用，两处只差 busy UI。

import { openLocalProject, openLocalFile } from '@/services/api.js'
import { host } from '@/services/host.js'
import { t } from '@/i18n'
import { createLocalOpenCoordinator } from './localOpenCoordinator.js'

const coordinator = createLocalOpenCoordinator({
  openFile: openLocalFile,
  navigate: (url) => new Promise((resolve, reject) => uni.reLaunch({ url, success: resolve, fail: reject })),
  ready: () => host.menu?.openPathsReady?.(),
  failedMessage: () => t('common.openProjectFailed'),
})

export function registerOpenWorkbench(vm) { coordinator.register(vm) }
export function unregisterOpenWorkbench(vm) { coordinator.unregister(vm) }

export function desktopFsApi() {
  return (host.fs && host.fs.showOpenDialog) ? host.fs : null
}

/** 同一个 projectId 每个会话（标签页/窗口存活期间）只弹一次截断提示，避免每次重开文件夹都再吵一遍。 */
function shouldWarnTruncatedOnce(projectId) {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return true
    const key = `awd_import_truncated_warned_${projectId}`
    if (window.sessionStorage.getItem(key)) return false
    window.sessionStorage.setItem(key, '1')
    return true
  } catch (e) {
    return true
  }
}

// 打开/新建本地文件夹要等后端导入并建初始版本：大文件夹或大文件冷启动时要几秒（D-P2 实测
// 36 MB 单文件约 1.5–5 s）。所有入口（应用菜单、欢迎页、拖放、Finder 打开方式、项目列表）都走这里，
// 所以在这里统一给一个遮罩式进度提示；弹确认框前先收起，免得遮罩挡住按钮。
function showOpening() {
  try { if (typeof uni.showLoading === 'function') uni.showLoading({ title: t('account.busyOpeningFolder'), mask: true }) } catch (e) { /* 提示失败不影响打开 */ }
}
function hideOpening() {
  try { if (typeof uni.hideLoading === 'function') uni.hideLoading() } catch (e) { /* ignore */ }
}

async function launchProject(payload) {
  showOpening()
  try {
    let r = await openLocalProject(payload)
    if (r?.data?.requiresNestedConfirmation) {
      hideOpening()
      const confirmed = await new Promise((resolve) => uni.showModal({
        title: t('common.nestedFolderTitle'),
        content: t('common.nestedFolderContent', {
          names: (r.data.overlappingProjectNames || []).join('、'),
        }),
        confirmText: t('common.nestedFolderContinue'),
        cancelText: t('common.cancel'),
        success: (result) => resolve(!!result.confirm),
        fail: () => resolve(false),
      }))
      if (!confirmed) return false
      showOpening()
      r = await openLocalProject({ ...payload, allowNested: true })
    }
    const d = (r && r.data) || {}
    if (!d.projectId) {
      throw new Error(t('common.openProjectFailed'))
    }
    if (d.truncated && shouldWarnTruncatedOnce(d.projectId)) {
      hideOpening()
      uni.showModal({
        title: t('common.folderImportTruncatedTitle'),
        content: t(d.truncatedCountCapped ? 'common.folderImportTruncatedCapped' : 'common.folderImportTruncated',
          { count: d.truncatedCount || 0 }),
        showCancel: false,
      })
    }
    return !!(await coordinator.enter(d.projectId, false))
  } finally {
    hideOpening()
  }
}

/** 打开文件夹… 返回 true=已发起导航，false=用户取消。异常上抛由调用方 toast。 */
export async function openFolderFlow() {
  const fs = desktopFsApi()
  if (!fs) return false
  const res = await fs.showOpenDialog({
    title: t('common.openFolder'),
    buttonLabel: t('common.open'),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (!res || res.canceled || !res.filePaths || !res.filePaths.length) return false
  return coordinator.enqueue(() => launchProject({ localRoot: res.filePaths[0] }))
}

/** 打开文件：仅登记所选文件，多选按顺序追加标签。 */
export async function openFileFlow() {
  const fs = desktopFsApi()
  if (!fs) return false
  const res = await fs.showOpenDialog({
    title: t('common.openFile'),
    buttonLabel: t('common.open'),
    properties: ['openFile', 'multiSelections'],
  })
  if (!res || res.canceled || !res.filePaths?.length) return false
  for (const filePath of res.filePaths) {
    if (!await openLocalFilePath(filePath)) return false
  }
  return true
}

/** 把一个绝对路径的文件夹直接作为项目打开（拖放/Dock/Finder 打开方式入口）。 */
export async function openLocalRootPath(absPath) {
  if (!absPath) return false
  return coordinator.enqueue(() => launchProject({ localRoot: absPath }))
}

/** 与系统打开方式共用，原文件保留在原位置。 */
export async function openLocalFilePath(absPath) {
  if (!absPath) return false
  return coordinator.open(absPath)
}

/** 新建项目文件夹…（命名弹窗在 newproject 页里，菜单入口跳过去自动触发）。 */
export async function createFolderFlow(parentDir, name) {
  const sep = parentDir.includes('\\') && !parentDir.includes('/') ? '\\' : '/'
  const localRoot = parentDir.replace(/[\\/]+$/, '') + sep + name.trim()
  return coordinator.enqueue(() => launchProject({ localRoot, createFolder: true, name: name.trim() }))
}
