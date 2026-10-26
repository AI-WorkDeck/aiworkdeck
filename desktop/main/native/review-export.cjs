// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Writer's DOCX exporter must see all revision layers. Restore the actual view
// before the caller can publish the resulting bytes to the data authority.
async function exportWithInlineRevisions(view, exportBytes) {
  const before = await view();
  if (!['all', 'final', 'balloons', 'margin'].includes(before.mode)) throw Error('审阅显示状态不可读，保留原文件');
  if (before.mode === 'all') return exportBytes();
  try {
    await view({ mode: 'all', internal: true, refresh: true });
    return await exportBytes();
  } finally {
    // A failed restore rejects the whole export. The caller must leave its
    // dirty flag set and must not upload or commit a version afterward.
    await view({ mode: before.mode, internal: true, refresh: true });
  }
}
module.exports = { exportWithInlineRevisions };
