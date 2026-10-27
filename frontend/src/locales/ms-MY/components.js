// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "Komponen pilihan",
  "panelSubtitle": "Komponen ini tidak disertakan bersama pemasang. Muat turun hanya yang anda gunakan — semuanya berjalan pada komputer ini dan tiada apa-apa yang meninggalkannya.",
  "installSelected": "Muat turun yang dipilih",
  "installOne": "Muat turun komponen ini",
  "later": "Bukan sekarang",
  "laterHint": "Anda boleh memuat turunnya pada bila-bila masa melalui Tetapan → Komponen.",
  "alreadyReady": "Sudah dipasang: {names}.",
  "nameSeparator": ", ",
  "manageTitle": "Komponen",
  "promptWithModel": "{name} perlu dimuat turun (kira-kira {runtime} MB; kira-kira {total} MB termasuk model). Ia disimpan di bawah ~/.aiworkdeck dan boleh dibuang melalui Tetapan → Komponen.",
  "promptNoModel": "{name} perlu dimuat turun (kira-kira {runtime} MB). Ia disimpan di bawah ~/.aiworkdeck dan boleh dibuang melalui Tetapan → Komponen.",
  "promptUsage": "Ia mengaktifkan: {unlocks}. Tanpanya: {impact}. Semua yang lain tetap berfungsi.",
  "sizeUnknown": "Menyemak saiz…",
  "stateNotInstalled": "Belum dipasang",
  "stateReady": "Dipasang (belum dijalankan)",
  "stateServiceStarted": "Perkhidmatan dimulakan (fungsi belum disahkan)",
  "errorServiceUnavailable": "Perkhidmatan komponen tidak dapat dimulakan. Semak pemasangan dan cuba lagi.",
  "stateDownloadingRuntime": "Downloading runtime {percent}%",
  "stateDownloadingModel": "Downloading model {percent}%",
  "stateStartingService": "Starting the component…",
  "stateVerifyingRuntime": "Verifying the download…",
  "stateExtractingRuntime": "Unpacking {percent}%",
  "stateCheckingRuntime": "Checking files…",
  "stateFinalizingRuntime": "Finishing up…",
  "errorStalled": "No progress for a long time, so we stopped waiting. Please retry; if it keeps failing, check the backend log under ~/.aiworkdeck/logs.",
  "errorBackendRestarted": "The background service restarted and interrupted the download. Please retry.",
  "stateFailed": "Preparation failed: {msg}",
  "progressTotal": "Overall {done}/{count} ({percent}%)",
  "cancelDownload": "Cancel download",
  "checkStartup": "Check startup",
  "verifyRepair": "Verify and repair",
  "retry": "Cuba lagi",
  "chatTitle": "A component is required",
  "chatConfirm": "Download and continue",
  "chatCancel": "Bukan sekarang",
  "chatInstalling": "Preparing the component…",
  "chatStage": {
    "preparing": "Preparing the component…",
    "downloading": "Downloading. Tap \"Download in background\" to keep chatting meanwhile.",
    "verifying": "Download finished. Verifying its contents…",
    "extracting": "Unpacking and installing. There are many files, so this can take a few minutes.",
    "checking": "Checking the unpacked files…",
    "finalizing": "Almost done. Writing to the install folder…",
    "model": "Downloading the model…",
    "starting": "Starting the component…"
  },
  "chatResending": "The component is ready. Continuing your request…",
  "chatReadyRetry": "The component is ready. You can resend your request.",
  "chatReadyContinue": "The component is ready. You can continue the step you were on.",
  "chatReadyContinueBtn": "Continue",
  "backgroundDownload": "Download in background",
  "backgroundStarted": "Downloading in the background. Track progress in Settings → Components.",
  "backgroundDone": "{name} is installed and started. You can try using it.",
  "backgroundFailed": "{name} failed to download: {msg}",
  "asrRuntimeMissingAction": "Download on-device speech recognition",
  "pptxRuntime": {
    "name": "Slides and PDF-to-Word",
    "unlocks": "AI slide generation, PPTX reading and formatting, layout-preserving Word conversion for text-based PDFs; scanned PDFs also need the OCR engine below",
    "impact": "those features are unavailable; PDF preview and structural conversion still work"
  },
  "mineruRuntime": {
    "name": "Scanned-document OCR engine (MinerU)",
    "unlocks": "Word conversion and layout recognition for scanned PDFs with no text layer, editable PPT export; only needed for scans, and requires \"Slides and PDF-to-Word\"",
    "impact": "scanned PDFs cannot be converted to Word; text-based PDFs are unaffected"
  },
  "kokoroRuntime": {
    "name": "Speech synthesis",
    "unlocks": "the Speech synthesis tab of the Voice panel",
    "impact": "speech synthesis is unavailable"
  },
  "asrRuntime": {
    "name": "On-device speech recognition",
    "unlocks": "the \"recordings never leave this computer\" transcription tier",
    "impact": "only the two cloud transcription tiers remain"
  },
  "features": {
    "pptxGenerate": "AI slide generation",
    "pptxFormat": "PPTX read/edit formatting",
    "pdfToWordLayout": "PDF to Word (layout-preserving)",
    "scannedOcrEntry": "scanned-document OCR entry (also needs the OCR engine)",
    "scannedPdfToWord": "scanned PDF to Word",
    "ocrParse": "OCR layout parsing",
    "pptxEditableExport": "editable PPT export",
    "ttsPanel": "speech synthesis panel",
    "localTranscription": "on-device transcription"
  }
}
