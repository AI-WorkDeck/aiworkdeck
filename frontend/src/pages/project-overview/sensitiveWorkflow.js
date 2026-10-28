// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// 脱敏/复敏读取磁盘前，只等待目标文件的编辑器；保存失败不能继续处理旧内容。
export async function saveSensitiveInput(fileId, libreRefs = {}, plainTextRefs = {}) {
  let isEn = false
  try {
    const l = (typeof localStorage !== 'undefined' && localStorage.getItem('checkba_app_language'))
      || (typeof document !== 'undefined' && document.documentElement?.lang)
      || ''
    if (l && !l.startsWith('zh')) isEn = true
  } catch (_) { /* ignore */ }
  const matches = inst => inst?.file?.id != null && String(inst.file.id) === String(fileId)
  const office = Object.values(libreRefs).filter(matches)
  const plain = Object.values(plainTextRefs).filter(matches)
  let changed = false
  for (const inst of new Set([...office, ...plain])) {
    const failed = () => inst.saveFailed || inst.statusKey === 'saveFailed'
    if (!(inst.dirty || inst.saving || failed())) continue
    if (office.includes(inst) && (!inst.ready || inst.isError || inst.docLoadFailed || inst._reloading)) {
      throw new Error(isEn ? 'The editor is not ready yet and cannot save current changes. Please try again later' : '编辑器尚未就绪，无法保存当前修改，请稍后重试')
    }
    changed = true
    await inst.flushSave()
    if (inst.dirty || inst.saving || failed() || inst._reloading) {
      throw new Error(isEn ? 'Current changes have not been saved yet. Please save the file and try again' : '当前修改尚未保存成功，请先保存文件后重试')
    }
  }
  return changed
}
