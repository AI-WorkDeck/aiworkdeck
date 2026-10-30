// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "view": {
    "bySection": "섹션별",
    "byParty": "당사자별"
  },
  "filter": {
    "allSections": "모든 섹션",
    "allParties": "모든 당사자"
  },
  "stat": {
    "total": "총 {count}건"
  },
  "status": {
    "all": "전체",
    "active": "정상",
    "unverified": "미확인",
    "stale": "변경됨",
    "orphan": "연결 끊김"
  },
  "group": {
    "none": "미지정",
    "untitled": "(섹션 없음)"
  },
  "action": {
    "keep": "연결 유지",
    "rebind": "다시 지정",
    "confirmRebind": "지정 확인",
    "cancelRebind": "취소",
    "delete": "삭제",
    "removeTarget": "제거",
    "open": "원본 자료 보기",
    "ignore": "무시",
    "expand": "펼치기",
    "collapse": "접기"
  },
  "method": {
    "written_review": "서면 검토",
    "written_statement": "서면 설명",
    "web_check": "온라인 확인",
    "third_party": "제3자 자료",
    "interview": "인터뷰",
    "none": "방법 미지정"
  },
  "relation": {
    "supports": "뒷받침",
    "contradicts": "상충",
    "partial": "부분 뒷받침"
  },
  "loc": {
    "wholeFile": "전체 파일",
    "page": "{page}페이지",
    "quote": "“{quote}”",
    "region": "이미지 영역",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "이 문서에 연결된 원본 자료가 아직 없습니다",
  "emptyHint": "탐색기에서 선택한 텍스트로 파일을 끌어다 놓으면 연결됩니다",
  "emptyFiltered": "현재 필터와 일치하는 연결이 없습니다",
  "fileMissing": "(파일이 더 이상 존재하지 않음)",
  "fileDeleted": "(휴지통에 있음)",
  "targetsCount": "원본 자료 {count}건",
  "rebindHint": "문서에서 새 텍스트를 선택한 후 확인을 누르세요",
  "rebindNoSelection": "먼저 문서에서 텍스트를 선택하세요",
  "rebindFailed": "다시 지정하지 못했습니다",
  "rebindRetryHint": "새 북마크가 이미 문서에 있습니다. 확인을 다시 눌러 재시도하세요.",
  "keepGone": "이 텍스트가 문서에 더 이상 없으므로 연결을 유지할 수 없습니다. 원본 자료 탭에서 다시 지정을 사용하세요.",
  "orphanGoto": "이 텍스트의 앵커가 문서에 더 이상 없습니다. 다시 지정을 눌러 새 텍스트를 선택하세요.",
  "confidence": "신뢰도 {value}",
  "loading": "불러오는 중…",
  "loadFailed": "연결을 불러오지 못했습니다",
  "fileTagsLoadFailed": "당사자 태그를 불러오지 못했습니다. \"당사자별\" 보기가 정확하지 않을 수 있습니다",
  "opFailed": "작업 실패",
  "deleteConfirm": "이 연결을 삭제하시겠습니까? 원본 파일은 삭제되지 않습니다.",
  "deleteTargetConfirm": "이 원본 자료를 제거하시겠습니까?",
  "staleOne": "이 텍스트에 {count}개의 연결된 원본 자료가 있으며 내용이 변경되었습니다",
  "staleMany": "연결된 구절 {count}개가 변경되었습니다",
  "stalePrefix": "변경됨: "
}
