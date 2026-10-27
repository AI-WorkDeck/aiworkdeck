// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// 路由只提供加载期提示；详情返回后，服务端类型是唯一事实来源。
export function resolveLooseWorkspace(project, loaded, hint) {
  return loaded ? project?.projectType === 'LOOSE_FILES' : !!hint
}
