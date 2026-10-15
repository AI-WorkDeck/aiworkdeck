// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 组织上下文（团队 / 律所）变化的唯一广播口。
//
// 现行官网模型：一个账户至多属于一个团队；一个团队至多并入一家律所。
// 所以「切换团队」= 退出当前团队 + 用邀请码加入新团队；「切换律所」= 本团队退出律所 + 用律所码并入。
// 两步不是原子操作，由 TeamPanel 负责确认与半途失败的如实提示；其余界面（插件通讯录、侧栏）
// 只订阅 ORG_CHANGED_EVENT 重新拉取，不缓存旧组织的成员。
export const ORG_CHANGED_EVENT = 'awd:org-changed'

export function notifyOrgChanged(reason = '') {
  try {
    // eslint-disable-next-line no-undef
    if (typeof uni !== 'undefined' && uni.$emit) uni.$emit(ORG_CHANGED_EVENT, { reason: String(reason || '') })
  } catch (e) { /* ignore */ }
}
