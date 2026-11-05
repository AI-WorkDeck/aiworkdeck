// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 团队「本周」看板的纯函数：周一至周五的日期、成员周汇总、负荷档位、热力格等级。
// 周一本周还没有过完的工作日，看板改看上周（boardWeek）。

/** 每个工作日的预期工时（分钟）：8 小时 */
export const EXPECTED_DAY_MINUTES = 8 * 60
/** 负荷比 < 此值 = 有余力 */
export const LIGHT_MAX_RATIO = 0.6
/** 负荷比 <= 此值 = 适中，超过 = 忙碌 */
export const BALANCED_MAX_RATIO = 1.0

const pad = (n) => String(n).padStart(2, '0')

function ymd(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 本地时间周一起算的本周 Mon..Fri；周六日仍指本周的周一至周五 */
export function weekDays(today) {
  const offset = (today.getDay() + 6) % 7 // 周一=0 … 周日=6
  const days = []
  for (let i = 0; i < 5; i++) {
    days.push(ymd(new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset + i)))
  }
  return days
}

export function memberWeek(member, days) {
  const byDate = new Map()
  for (const d of (member && member.daily) || []) {
    if (d && d.date) byDate.set(d.date, Number(d.activeMinutes) || 0)
  }
  const cells = days.map((date) => ({ date, minutes: byDate.get(date) || 0 }))
  const project = (member && member.currentProject) || null
  return {
    cells,
    weekMinutes: cells.reduce((s, c) => s + c.minutes, 0),
    currentLabel: (project && project.label) || null,
    hasProject: !!project,
  }
}

/**
 * 本周**已结束**的工作日数（周一至昨天，周六日按 5）。
 * 团队用量只上报已经过完的日子（桌面端 TeamUsageUploadService 从昨天往前补传），
 * 今天的工时永远不在数据里——把今天算进「应有工时」会让每周一全员显示「有余力」。
 */
export function completedWorkdays(today) {
  const dow = today.getDay()
  if (dow === 0 || dow === 6) return 5
  return dow - 1
}

/**
 * 看板该看哪一周。平日看本周（周一至昨天）；周一本周还没有过完的工作日，
 * 改看上周一至周五（整周 5 天），界面据 lastWeek 标明「上周」。
 */
export function boardWeek(today) {
  const done = completedWorkdays(today)
  if (done > 0) return { days: weekDays(today), workdays: done, lastWeek: false }
  const lastMonday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7)
  return { days: weekDays(lastMonday), workdays: 5, lastWeek: true }
}

/** 负荷比 = 看板那一周已上报工时 / (8h × 那一周已结束的工作日)，口径见 boardWeek。 */
export function loadRatio(weekMinutes, today) {
  return weekMinutes / (EXPECTED_DAY_MINUTES * boardWeek(today).workdays)
}

/** 'light' | 'balanced' | 'busy' */
export function loadBand(weekMinutes, today) {
  const ratio = loadRatio(weekMinutes, today)
  if (ratio < LIGHT_MAX_RATIO) return 'light'
  if (ratio <= BALANCED_MAX_RATIO) return 'balanced'
  return 'busy'
}

export function cellLevel(minutes) {
  const m = Number(minutes) || 0
  if (m <= 0) return 0
  if (m < 120) return 1
  if (m < 300) return 2
  if (m < 480) return 3
  return 4
}
