// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// 一句话写 Skill：本机创建的 Skill 在插件广场的展示判定（后端 SkillView.authoredLocally / createdAt / publishedVersion）。

/** 「新建」角标持续时长：创建后 24 小时内。 */
export const NEW_BADGE_MS = 24 * 60 * 60 * 1000

/** 本机创建、且创建不足 24 小时（时钟回拨导致的「未来时间」也算新）。createdAt 缺失或无法解析时不算。 */
export function isNewlyAuthored(skill, now = Date.now()) {
  if (!skill || !skill.authoredLocally || !skill.createdAt) return false
  const at = Date.parse(skill.createdAt)
  if (!Number.isFinite(at)) return false
  return now - at < NEW_BADGE_MS
}

/** 本机创建的 Skill 才能从客户端发布；publishedVersion 为 null/undefined = 还没发布过。 */
export function publishState(skill) {
  if (!skill || !skill.authoredLocally) return 'none'
  return skill.publishedVersion == null ? 'unpublished' : 'published'
}
