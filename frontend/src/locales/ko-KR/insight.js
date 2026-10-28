// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "근거",
  "noDoc": "열린 문서 없음",
  "parse": "전체 문서 온라인 검증(요금이 부과될 수 있음)",
  "reparse": "전체 문서 온라인 재검증(요금이 부과될 수 있음)",
  "onlineHint": "클릭하면 현재 문서를 먼저 저장한 뒤 저장된 버전을 온라인으로 검증합니다. AI 및 외부 조회 시 요금이 발생할 수 있습니다.",
  "saveRequired": "문서를 저장하지 못했습니다. 저장한 후 온라인 검증을 진행하세요.",
  "running": "온라인 검증 중…",
  "done": "온라인 검증 완료",
  "failed": "온라인 검증 실패",
  "loading": "불러오는 중…",
  "loadingDetail": "조회 상세 정보를 가져오는 중…",
  "noDetail": "이 항목에는 조회 상세 정보가 없습니다",
  "loadFailed": "온라인 검증 결과를 불러오지 못했습니다",
  "parseFailed": "온라인 검증을 시작하지 못했습니다",
  "detailFailed": "조회 상세 정보를 불러오지 못했습니다",
  "refreshFailed": "다시 조회하지 못했습니다",
  "retry": "다시 시도",
  "goConnectAccount": "계정 연결하기",
  "goRecharge": "크레딧 충전",
  "hint": {
    "NO_CREDENTIAL": "이 조회 채널의 자격 증명은 관리자가 서버에서 설정해야 합니다."
  },
  "tab": {
    "retrieval": "외부 조회",
    "checks": "일관성 검사"
  },
  "kind": {
    "COMPANY": "기업",
    "LAW": "법령",
    "CASE": "판례",
    "DOC": "문서"
  },
  "entityKind": {
    "COMPANY": "기업",
    "LAW": "법령",
    "CASE": "판례",
    "DOC": "문서"
  },
  "openInNewTab": "새 탭에서 열기",
  "openDocFile": "파일 열기",
  "docNotFound": "프로젝트에서 해당 파일을 찾을 수 없습니다",
  "docMissing": "해당 파일이 더 이상 프로젝트에 없습니다",
  "source": {
    "projectFile": "프로젝트 파일",
    "qichacha": "치차차(Qichacha)"
  },
  "mentions": "{count}곳",
  "mentionsTitle": "문서 내 출처",
  "shareholders": "주주 및 출자",
  "moreCandidates": "기타 후보",
  "caseSection": {
    "ascertain": "인정 사실",
    "reason": "판단 이유",
    "result": "판결 결과",
    "gist": "판결 요지",
    "fullText": "판결문 전문"
  },
  "authoritative": "공식 원문(Pkulaw)",
  "implementDate": "시행일 {date}",
  "recognition": "사건번호 인식",
  "openInPkulaw": "Pkulaw에서 열기",
  "citation": {
    "citedText": "인용 조문",
    "candidates": "내용으로 매칭된 조문",
    "article": "제{n}조"
  },
  "severity": {
    "warn": "의심",
    "error": "오류"
  },
  "unifyTo": "{value}(으)로 통일",
  "cannotFix": "자동 수정 불가: {reason}",
  "fixNotUnique": "유일한 위치를 특정할 수 없으므로 직접 수정해 주세요.",
  "fixPartial": "{done}곳 수정 완료, {failed}곳은 유일하게 특정할 수 없어 직접 수정해 주세요.",
  "fixed": "수정됨",
  "fixedHint": "Cmd+Z로 실행 취소할 수 있으며, 다시 분석하면 결과가 새로고침됩니다.",
  "noEditor": "먼저 문서 편집 창을 활성화하세요",
  "empty": {
    "noRun": "이 문서는 아직 온라인 검증되지 않았습니다",
    "noRunHint": "일상적인 작성 힌트는 로컬에서 실행됩니다. 상단의 온라인 검증을 클릭해야 저장된 문서를 대상으로 AI 추출, 외부 조회 및 일관성 검사를 수행합니다.",
    "noEntity": "조회 가능한 개체를 찾지 못했습니다",
    "noEntityHint": "문서에 회사명, 법령 조항 또는 사건번호가 없습니다.",
    "noFinding": "전후 모순이 발견되지 않았습니다",
    "noFindingHint": "수량 진술과 통일사회신용코드가 모두 검증을 통과했습니다."
  }
}
