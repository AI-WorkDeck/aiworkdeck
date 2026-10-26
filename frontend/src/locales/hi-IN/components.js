// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "Optional components",
  "panelSubtitle": "These components are not bundled with the installer. Download only what you use — everything runs on this computer and nothing leaves it.",
  "installSelected": "Download selected",
  "installOne": "Download this component",
  "later": "अभी नहीं",
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
  "cancelDownload": "डाउनलोड रद्द करें",
  "checkStartup": "स्टार्टअप जाँचें",
  "verifyRepair": "सत्यापित और मरम्मत करें",
  "retry": "पुनः प्रयास करें",
  "chatTitle": "एक घटक आवश्यक है",
  "chatConfirm": "डाउनलोड करें और जारी रखें",
  "chatCancel": "अभी नहीं",
  "chatInstalling": "घटक तैयार किया जा रहा है…",
  "chatStage": {
    "preparing": "घटक तैयार किया जा रहा है…",
    "downloading": "डाउनलोड हो रहा है। तब तक बातचीत जारी रखने के लिए \"बैकग्राउंड में डाउनलोड करें\" दबाएँ।",
    "verifying": "डाउनलोड पूरा हुआ। इसकी सामग्री सत्यापित की जा रही है…",
    "extracting": "अनपैक और इंस्टॉल किया जा रहा है। फ़ाइलें बहुत अधिक हैं, इसलिए इसमें कुछ मिनट लग सकते हैं।",
    "checking": "अनपैक की गई फ़ाइलें जाँची जा रही हैं…",
    "finalizing": "लगभग पूर्ण। इंस्टॉल फ़ोल्डर में लिखा जा रहा है…",
    "model": "मॉडल डाउनलोड किया जा रहा है…",
    "starting": "घटक प्रारंभ किया जा रहा है…"
  },
  "chatResending": "घटक तैयार है। आपका अनुरोध जारी रखा जा रहा है…",
  "chatReadyRetry": "घटक तैयार है। आप अपना अनुरोध दोबारा भेज सकते हैं।",
  "chatReadyContinue": "घटक तैयार है। आप जिस चरण पर थे, उसे जारी रख सकते हैं।",
  "chatReadyContinueBtn": "जारी रखें",
  "backgroundDownload": "बैकग्राउंड में डाउनलोड करें",
  "backgroundStarted": "बैकग्राउंड में डाउनलोड हो रहा है। प्रगति Settings → Components में देखें।",
  "backgroundDone": "{name} इंस्टॉल और प्रारंभ हो गया है। आप इसे आज़मा सकते हैं।",
  "backgroundFailed": "{name} डाउनलोड करने में विफल: {msg}",
  "asrRuntimeMissingAction": "ऑन-डिवाइस स्पीच रिकग्निशन डाउनलोड करें",
  "pptxRuntime": {
    "name": "Slides और PDF-to-Word",
    "unlocks": "AI स्लाइड जनरेशन, PPTX पढ़ना और फ़ॉर्मैटिंग, टेक्स्ट-आधारित PDFs के लिए लेआउट-संरक्षित Word रूपांतरण; स्कैन किए गए PDFs के लिए नीचे दिया गया OCR इंजन भी आवश्यक है",
    "impact": "वे सुविधाएँ अनुपलब्ध हैं; PDF पूर्वावलोकन और संरचनात्मक रूपांतरण अभी भी कार्य करते हैं"
  },
  "mineruRuntime": {
    "name": "स्कैन किए गए दस्तावेज़ का OCR इंजन (MinerU)",
    "unlocks": "बिना टेक्स्ट लेयर वाले स्कैन किए गए PDFs के लिए Word रूपांतरण और लेआउट पहचान, संपादन योग्य PPT निर्यात; केवल स्कैन के लिए आवश्यक, और \"Slides और PDF-to-Word\" आवश्यक है",
    "impact": "स्कैन किए गए PDFs को Word में बदला नहीं जा सकता; टेक्स्ट-आधारित PDFs प्रभावित नहीं होते"
  },
  "kokoroRuntime": {
    "name": "स्पीच सिंथेसिस",
    "unlocks": "Voice पैनल का स्पीच सिंथेसिस टैब",
    "impact": "स्पीच सिंथेसिस अनुपलब्ध है"
  },
  "asrRuntime": {
    "name": "ऑन-डिवाइस स्पीच रिकग्निशन",
    "unlocks": "\"रिकॉर्डिंग इस कंप्यूटर से कभी नहीं निकलती\" वाला ट्रांसक्रिप्शन स्तर",
    "impact": "केवल दो क्लाउड ट्रांसक्रिप्शन स्तर शेष हैं"
  },
  "features": {
    "pptxGenerate": "AI स्लाइड जनरेशन",
    "pptxFormat": "PPTX पढ़ना/संपादन फ़ॉर्मैटिंग",
    "pdfToWordLayout": "PDF से Word (लेआउट-संरक्षित)",
    "scannedOcrEntry": "स्कैन किए गए दस्तावेज़ की OCR प्रविष्टि (OCR इंजन भी आवश्यक)",
    "scannedPdfToWord": "स्कैन किया गया PDF से Word",
    "ocrParse": "OCR लेआउट पार्सिंग",
    "pptxEditableExport": "संपादन योग्य PPT निर्यात",
    "ttsPanel": "स्पीच सिंथेसिस पैनल",
    "localTranscription": "ऑन-डिवाइस ट्रांसक्रिप्शन"
  }
}
