// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "Optional components",
  "panelSubtitle": "These components are not bundled with the installer. Download only what you use — everything runs on this computer and nothing leaves it.",
  "installSelected": "Download selected",
  "installOne": "Download this component",
  "later": "Pas maintenant",
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
  "retry": "Réessayer",
  "chatTitle": "A component is required",
  "chatConfirm": "Download and continue",
  "chatCancel": "Pas maintenant",
  "chatInstalling": "Preparing the component…",
  "chatStage": {
    "preparing": "Preparing the component…",
    "downloading": "Downloading. Tap \"Download in background\" to keep chatting meanwhile.",
    "verifying": "Download finished. Verifying its contents…",
    "extracting": "Unpacking and installing. There are many files, so this can take a few minutes.",
    "checking": "Checking the unpacked files…",
    "finalizing": "Almost done. Writing to the install folder…",
    "model": "Downloading the model…",
    "starting": "Démarrage du composant…"
  },
  "chatResending": "Le composant est prêt. Poursuite de votre requête…",
  "chatReadyRetry": "Le composant est prêt. Vous pouvez renvoyer votre requête.",
  "chatReadyContinue": "Le composant est prêt. Vous pouvez poursuivre l'étape en cours.",
  "chatReadyContinueBtn": "Continuer",
  "backgroundDownload": "Télécharger en arrière-plan",
  "backgroundStarted": "Téléchargement en arrière-plan. Suivez la progression dans Paramètres → Composants.",
  "backgroundDone": "{name} est installé et démarré. Vous pouvez l'essayer.",
  "backgroundFailed": "Échec du téléchargement de {name} : {msg}",
  "asrRuntimeMissingAction": "Télécharger la reconnaissance vocale locale",
  "pptxRuntime": {
    "name": "Diapositives et PDF vers Word",
    "unlocks": "Génération de diapositives par IA, lecture et mise en forme de fichiers PPTX, conversion Word avec mise en page préservée pour les PDF textuels ; les PDF numérisés nécessitent également le moteur OCR ci-dessous",
    "impact": "ces fonctionnalités sont indisponibles ; l'aperçu PDF et la conversion structurelle fonctionnent toujours"
  },
  "mineruRuntime": {
    "name": "Moteur OCR pour documents numérisés (MinerU)",
    "unlocks": "Conversion Word et reconnaissance de mise en page pour les PDF numérisés sans couche de texte, export PPT modifiable ; nécessaire uniquement pour les numérisations, et requiert « Diapositives et PDF vers Word »",
    "impact": "les PDF numérisés ne peuvent pas être convertis en Word ; les PDF textuels ne sont pas concernés"
  },
  "kokoroRuntime": {
    "name": "Synthèse vocale",
    "unlocks": "l'onglet Synthèse vocale du panneau Vocal",
    "impact": "la synthèse vocale est indisponible"
  },
  "asrRuntime": {
    "name": "Reconnaissance vocale locale",
    "unlocks": "le niveau de transcription « les enregistrements ne quittent jamais cet ordinateur »",
    "impact": "seuls les deux niveaux de transcription cloud restent disponibles"
  },
  "features": {
    "pptxGenerate": "Génération de diapositives par IA",
    "pptxFormat": "Lecture/édition et mise en forme PPTX",
    "pdfToWordLayout": "PDF vers Word (mise en page préservée)",
    "scannedOcrEntry": "Entrée OCR pour documents numérisés (nécessite également le moteur OCR)",
    "scannedPdfToWord": "PDF numérisé vers Word",
    "ocrParse": "Analyse OCR de la mise en page",
    "pptxEditableExport": "Export PPT modifiable",
    "ttsPanel": "panneau de synthèse vocale",
    "localTranscription": "transcription locale"
  }
}
