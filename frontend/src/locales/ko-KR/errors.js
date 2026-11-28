// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "오프라인 상태여서 요청이 전송되지 않았습니다. 연결을 확인한 뒤 “재시도”를 선택하세요.",
  "timeout": "서비스 응답이 너무 오래 걸렸습니다. 잠시 후 다시 시도하세요. 큰 파일은 작게 나누어 주세요.",
  "localServiceDown": "로컬 서비스가 준비되지 않았거나 중지되었습니다. 몇 초 기다려 주세요. 계속되면 AI WorkDeck을 다시 시작하세요.",
  "signInRequired": "이 기능은 AI WorkDeck 계정이 필요합니다. 로그인하면 바로 이 화면으로 돌아옵니다.",
  "sessionExpired": "로그인이 만료되었습니다. 다시 로그인하세요. 저장하지 않은 작업은 그대로 유지됩니다.",
  "forbidden": "이 작업을 할 권한이 없습니다. 사건 담당자나 로펌 관리자에게 접근 권한을 요청하세요.",
  "balanceLow": "AI 크레딧이 모두 소진되었으며, 이번 요청에는 요금이 청구되지 않았습니다. 설정 → 계정 및 잔액에서 충전하세요.",
  "rateLimited": "지금은 요청이 너무 많아 모델 서비스가 속도를 제한하고 있습니다. 1분 뒤에 다시 시도하세요.",
  "modelUnavailable": "선택한 모델을 지금은 사용할 수 없습니다. 나중에 다시 시도하거나 메시지 입력란 아래에서 다른 모델을 선택하세요.",
  "modelKeyInvalid": "모델 제공업체가 이 기기에서 이전 설정으로 계속 사용 중인 키를 거부했습니다. 대신 AI WorkDeck의 AI를 사용하려면 로그인하세요.",
  "accountReconnect": "AI 계정 연결을 새로 고쳐야 해서 이번 요청은 전송되지 않았습니다. 「다시 로그인」으로 연결을 새로 고친 뒤 다시 시도하세요. 내용은 사라지지 않습니다.",
  "streamInterrupted": "답변이 중간에 끊겼습니다. 지금까지 받은 내용은 위에 남아 있습니다. “재시도”를 선택하면 다시 생성합니다.",
  "streamInterruptedResumable": "답변이 중간에 끊겼습니다. 지금까지 받은 내용은 위에 남아 있습니다. “계속”을 선택하면 멈춘 지점부터 이어가고, “재시도”를 선택하면 처음부터 다시 시작합니다.",
  "streamInterruptedTwice": "다시 끊겼습니다. “재시도”를 선택하면 전체 답변을 다시 생성합니다.",
  "serverError": "저희 쪽에서 문제가 발생하여 이 작업이 끝나지 않았습니다. 나중에 다시 시도하세요. 계속되면 “피드백”을 보내 주세요.",
  "conflict": "다른 곳에서 변경되었거나 이전 작업이 아직 실행 중입니다. 새로고침한 뒤 다시 시도하세요.",
  "fileTooLarge": "파일이 너무 큽니다(제한 {limit}). 압축하거나 나눈 뒤 다시 업로드하세요.",
  "fileUnreadable": "이 파일을 열 수 없습니다. 손상되었거나 비밀번호로 보호되어 있을 수 있습니다. 원본 앱에서 새 사본을 저장한 뒤 다시 시도하세요.",
  "notFound": "이 항목을 찾을 수 없습니다. 이동되었거나 삭제되었을 수 있습니다. 목록을 새로고침하세요.",
  "marketplaceUnavailable": "지금은 플러그인 마켓플레이스에 연결할 수 없습니다. 설치된 플러그인은 계속 작동합니다. 연결을 확인한 뒤 “새로고침”을 선택하세요.",
  "pluginInstallFailed": "“{name}” 설치에 실패했습니다. 다른 것은 변경되지 않았습니다. 나중에 다시 시도하세요. 계속 실패하면 상세 내용과 함께 피드백을 보내 주세요.",
  "unknown": "작동하지 않았습니다. 다시 시도하세요. 계속되면 상세 내용과 함께 피드백을 보내 주세요.",
  "actions": {
    "retry": "재시도",
    "details": "상세 정보",
    "hideDetails": "세부 정보 숨기기",
    "continue": "계속",
    "continueTooltip": "이미 있는 내용을 다시 생성하지 않고 멈춘 지점부터 이어갑니다",
    "refresh": "새로고침",
    "signIn": "로그인",
    "reconnect": "다시 로그인",
    "topUp": "충전",
    "feedback": "피드백"
  }
}
