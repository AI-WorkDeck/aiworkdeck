// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

// A pointer moving towards the near edge of a submenu may cross a sibling row.
// Keep that submenu open within the triangle, including when it flips to the left.
export function isWithinSubmenuAim(point, origin, rect, side = 'right') {
  if (!point || !origin || !rect) return false
  const edge = side === 'left' ? rect.right : rect.left
  if (edge === origin.x) return false
  const progress = (point.x - origin.x) / (edge - origin.x)
  if (progress < 0 || progress > 1) return false
  const top = origin.y + (rect.top - 6 - origin.y) * progress
  const bottom = origin.y + (rect.bottom + 6 - origin.y) * progress
  return point.y >= top && point.y <= bottom
}
