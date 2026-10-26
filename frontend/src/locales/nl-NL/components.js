// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "Optional components",
  "panelSubtitle": "These components are not bundled with the installer. Download only what you use — everything runs on this computer and nothing leaves it.",
  "installSelected": "Download selected",
  "installOne": "Download this component",
  "later": "Not now",
  "laterHint": "You can download them any time from Settings → Components.",
  "alreadyReady": "Already installed: {names}.",
  "nameSeparator": ", ",
  "manageTitle": "Components",
  "promptWithModel": "{name} needs to be downloaded (about {runtime} MB; about {total} MB including the model). It is stored under ~/.aiworkdeck and can be removed from Settings → Components.",
  "promptNoModel": "{name} needs to be downloaded (about {runtime} MB). It is stored under ~/.aiworkdeck and can be removed from Settings → Components.",
  "promptUsage": "It powers: {unlocks}. Without it: {impact}. Everything else keeps working.",
  "sizeUnknown": "Checking size…",
  "stateNotInstalled": "Not installed",
  "stateReady": "Installed (not run yet)",
  "stateServiceStarted": "Service started (function not yet verified)",
  "errorServiceUnavailable": "The component service could not start. Check the installation and retry.",
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
  "retry": "Opnieuw proberen",
  "chatTitle": "A component is required",
  "chatConfirm": "Download and continue",
  "chatCancel": "Not now",
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
  "backgroundStarted": "Downloaden op de achtergrond. Volg de voortgang via Instellingen → Onderdelen.",
  "backgroundDone": "{name} is geïnstalleerd en gestart. U kunt het uitproberen.",
  "backgroundFailed": "{name} kon niet worden gedownload: {msg}",
  "asrRuntimeMissingAction": "Spraakherkenning op het apparaat downloaden",
  "pptxRuntime": {
    "name": "Dia's en PDF-naar-Word",
    "unlocks": "AI-generatie van dia's, PPTX-lezen en opmaken, Word-conversie met behoud van lay-out voor op tekst gebaseerde pdf's; gescande pdf's hebben bovendien de onderstaande OCR-engine nodig",
    "impact": "die functies zijn niet beschikbaar; pdf-voorbeeld en structurele conversie werken nog steeds"
  },
  "mineruRuntime": {
    "name": "OCR-engine voor gescande documenten (MinerU)",
    "unlocks": "Word-conversie en lay-outherkenning voor gescande pdf's zonder tekstlaag, exporteerbare bewerkbare PPT; alleen nodig voor scans en vereist \"Dia's en PDF-naar-Word\"",
    "impact": "gescande pdf's kunnen niet worden geconverteerd naar Word; op tekst gebaseerde pdf's worden niet beïnvloed"
  },
  "kokoroRuntime": {
    "name": "Spraaksynthese",
    "unlocks": "het tabblad Spraaksynthese van het Spraakpaneel",
    "impact": "spraaksynthese is niet beschikbaar"
  },
  "asrRuntime": {
    "name": "Spraakherkenning op het apparaat",
    "unlocks": "het transcriptieniveau waarbij \"opnames dit apparaat nooit verlaten\"",
    "impact": "alleen de twee cloudtranscriptieniveaus blijven beschikbaar"
  },
  "features": {
    "pptxGenerate": "AI-generatie van dia's",
    "pptxFormat": "PPTX lezen/bewerken en opmaken",
    "pdfToWordLayout": "PDF naar Word (met behoud van lay-out)",
    "scannedOcrEntry": "OCR-toegang voor gescande documenten (heeft ook de OCR-engine nodig)",
    "scannedPdfToWord": "gescande pdf naar Word",
    "ocrParse": "OCR-lay-outanalyse",
    "pptxEditableExport": "export van bewerkbare PPT",
    "ttsPanel": "spraaksynthese-paneel",
    "localTranscription": "transcriptie op het apparaat"
  }
}
