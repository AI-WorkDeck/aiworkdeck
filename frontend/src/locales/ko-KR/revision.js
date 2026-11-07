// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// 外部 Agent（MCP propose_revision）待审修订：角标、编辑器顶栏与审阅列表
export default {
  bannerCount: "외부 수정 제안 {count}건 검토 대기 중",
  review: "검토",
  collapse: "접기",
  source: "출처: {source}",
  reason: "사유: {reason}",
  accept: "수락하고 변경 내용 추적으로 적용",
  reject: "거부",
  stale: "만료됨",
  staleHint: "제안 이후 문서가 변경되어 적용할 수 없습니다. 내용 확인과 거부는 가능합니다.",
  applied: "변경 내용 추적으로 적용했습니다. 문서에서 항목별로 수락하거나 거부하세요.",
  editorNotReady: "편집기가 준비되지 않았거나 문서가 읽기 전용이라 아직 수정을 적용할 수 없습니다.",
  failed: "실패: {message}",
  noMatch: "{index}번째 수정의 원문을 현재 문서에서 찾을 수 없어 아무것도 적용하지 않았습니다. 이 제안을 거부할 수 있습니다.",
  partial: "{total}건 중 {done}건 적용 후 중단되었습니다({message}). 다시 수락하면 적용되지 않은 항목부터 이어집니다.",
  progress: "{total}건 중 {done}건 적용됨",
}
