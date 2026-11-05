// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// 平台档录音转写告知的唯一呈现处（dev-board#1713 #117/#118）：宿主可信弹窗承载告知全文与
// 「我已知悉」勾选项（不预勾选），插件面板不再自画一份。正文由后端给，与版本号同源。
import { getMeetingAsrNotice, acknowledgeMeetingAsrNotice } from '@/services/api.js'
import { showDialog } from '@/utils/dialog.js'
import { t } from '@/i18n'

/**
 * 告知没确认过就弹宿主告知框，用户勾选并确认后落库。
 * @param {{ notice?: object, isCurrent?: () => boolean }} [opts] notice 已读到时直接传入，省一次请求；
 *   isCurrent 在用户确认后、落库前再查一次调用方是否还有效。
 * @returns {Promise<object|null>} 已确认（或本来就不欠）时回最新告知状态；取消或调用方已失效回 null
 */
export async function confirmAsrNotice({ notice, isCurrent = () => true } = {}) {
  const current = notice || await getMeetingAsrNotice()
  if (!current || current.acknowledged) return current || null
  const result = await showDialog({
    title: t('meeting.noticeTitle'),
    content: String(current.body || ''),
    checkLabel: t('meeting.noticeCheckLabel'),
    confirmText: t('meeting.noticeConfirm'),
  })
  if (!result.confirm || !isCurrent()) return null
  return (await acknowledgeMeetingAsrNotice(true)) || { ...current, acknowledged: true }
}
