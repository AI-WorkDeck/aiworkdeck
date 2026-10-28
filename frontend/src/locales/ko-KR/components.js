// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "선택적 구성 요소",
  "panelSubtitle": "이 구성 요소들은 설치 프로그램에 포함되어 있지 않습니다. 사용하는 항목만 다운로드하세요. 모든 작업은 이 컴퓨터에서 실행되며 외부로 전송되지 않습니다.",
  "installSelected": "선택 항목 다운로드",
  "installOne": "이 구성 요소 다운로드",
  "later": "나중에",
  "laterHint": "설정 → 구성 요소에서 언제든지 다운로드할 수 있습니다.",
  "alreadyReady": "설치됨: {names}.",
  "nameSeparator": ", ",
  "manageTitle": "구성 요소 관리",
  "promptWithModel": "{name} 다운로드가 필요합니다(약 {runtime} MB, 모델 포함 약 {total} MB). ~/.aiworkdeck에 저장되며 설정 → 구성 요소에서 제거할 수 있습니다.",
  "promptNoModel": "{name} 다운로드가 필요합니다(약 {runtime} MB). ~/.aiworkdeck에 저장되며 설정 → 구성 요소에서 제거할 수 있습니다.",
  "promptUsage": "제공 기능: {unlocks}. 미설치 시: {impact}. 다른 기능은 정상 작동합니다.",
  "sizeUnknown": "크기 확인 중…",
  "stateNotInstalled": "미설치",
  "stateReady": "설치됨(아직 실행 안 됨)",
  "stateServiceStarted": "서비스 시작됨(기능 미확인)",
  "errorServiceUnavailable": "구성 요소 서비스를 시작할 수 없습니다. 설치 상태를 확인하고 다시 시도하세요.",
  "stateDownloadingRuntime": "런타임 다운로드 중 {percent}%",
  "stateDownloadingModel": "모델 다운로드 중 {percent}%",
  "stateStartingService": "구성 요소 시작 중…",
  "stateVerifyingRuntime": "다운로드 검증 중…",
  "stateExtractingRuntime": "압축 해제 중 {percent}%",
  "stateCheckingRuntime": "파일 확인 중…",
  "stateFinalizingRuntime": "마무리 중…",
  "errorStalled": "오랫동안 진행이 없어 대기를 중단했습니다. 다시 시도해 주세요. 계속 실패하면 ~/.aiworkdeck/logs 아래의 백엔드 로그를 확인하세요.",
  "errorBackendRestarted": "백그라운드 서비스가 재시작되어 다운로드가 중단되었습니다. 다시 시도해 주세요.",
  "stateFailed": "준비 실패: {msg}",
  "progressTotal": "전체 진행률 {done}/{count} ({percent}%)",
  "cancelDownload": "다운로드 취소",
  "checkStartup": "시작 상태 확인",
  "verifyRepair": "검증 및 복구",
  "retry": "다시 시도",
  "chatTitle": "구성 요소 다운로드 필요",
  "chatConfirm": "다운로드 후 계속",
  "chatCancel": "지금 안 함",
  "chatInstalling": "구성 요소 준비 중…",
  "chatStage": {
    "preparing": "구성 요소 준비 중…",
    "downloading": "다운로드 중입니다. '백그라운드에서 다운로드'를 누르면 그동안 대화를 계속할 수 있습니다.",
    "verifying": "다운로드 완료. 내용을 검증하는 중…",
    "extracting": "압축을 풀고 설치하는 중입니다. 파일이 많아 몇 분 정도 걸릴 수 있습니다.",
    "checking": "압축 해제된 파일 확인 중…",
    "finalizing": "거의 완료되었습니다. 설치 폴더에 기록 중…",
    "model": "모델 다운로드 중…",
    "starting": "구성 요소 시작 중…"
  },
  "chatResending": "구성 요소가 준비되었습니다. 요청을 계속 진행합니다…",
  "chatReadyRetry": "구성 요소가 준비되었습니다. 요청을 다시 보낼 수 있습니다.",
  "chatReadyContinue": "구성 요소가 준비되었습니다. 진행하던 단계를 계속할 수 있습니다.",
  "chatReadyContinueBtn": "계속",
  "backgroundDownload": "백그라운드에서 다운로드",
  "backgroundStarted": "백그라운드에서 다운로드 중입니다. 설정 → 구성 요소에서 진행률을 확인하세요.",
  "backgroundDone": "{name} 설치 및 시작이 완료되었습니다. 이제 사용할 수 있습니다.",
  "backgroundFailed": "{name} 다운로드 실패: {msg}",
  "asrRuntimeMissingAction": "온디바이스 음성 인식 다운로드",
  "pptxRuntime": {
    "name": "슬라이드 생성 및 PDF-Word 변환",
    "unlocks": "AI 슬라이드 생성, PPTX 읽기 및 서식 편집, 텍스트 기반 PDF의 레이아웃 유지 Word 변환(스캔 PDF는 아래 OCR 엔진도 필요)",
    "impact": "해당 기능을 사용할 수 없으며, PDF 미리보기 및 구조 변환은 계속 작동합니다"
  },
  "mineruRuntime": {
    "name": "스캔 문서 OCR 엔진(MinerU)",
    "unlocks": "텍스트 레이어가 없는 스캔 PDF의 Word 변환 및 레이아웃 인식, 편집 가능한 PPT 내보내기(스캔 문서에만 필요하며 '슬라이드 생성 및 PDF-Word 변환'이 먼저 설치되어야 함)",
    "impact": "스캔 PDF를 Word로 변환할 수 없습니다(텍스트 기반 PDF는 영향 없음)"
  },
  "kokoroRuntime": {
    "name": "음성 합성",
    "unlocks": "음성 패널의 '음성 합성' 탭",
    "impact": "음성 합성을 사용할 수 없습니다"
  },
  "asrRuntime": {
    "name": "온디바이스 음성 인식",
    "unlocks": "'녹음 파일이 이 컴퓨터 밖으로 나가지 않는' 전사 모드",
    "impact": "클라우드 전사 두 가지 모드만 사용할 수 있습니다"
  },
  "features": {
    "pptxGenerate": "AI 슬라이드 생성",
    "pptxFormat": "PPTX 읽기/서식 편집",
    "pdfToWordLayout": "PDF-Word 변환(레이아웃 유지)",
    "scannedOcrEntry": "스캔 문서 OCR 진입점(OCR 엔진 추가 필요)",
    "scannedPdfToWord": "스캔 PDF-Word 변환",
    "ocrParse": "OCR 레이아웃 분석",
    "pptxEditableExport": "편집 가능한 PPT 내보내기",
    "ttsPanel": "음성 합성 패널",
    "localTranscription": "온디바이스 음성 전사"
  }
}
