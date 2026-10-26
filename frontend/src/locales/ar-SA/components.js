// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "Optional components",
  "panelSubtitle": "These components are not bundled with the installer. Download only what you use — everything runs on this computer and nothing leaves it.",
  "installSelected": "Download selected",
  "installOne": "Download this component",
  "later": "Not now",
  "laterHint": "You can download them any time from Settings → Components.",
  "alreadyReady": "تم التثبيت مسبقًا: {names}.",
  "nameSeparator": "، ",
  "manageTitle": "المكونات",
  "promptWithModel": "يلزم تنزيل {name} (حوالي {runtime} ميجابايت؛ وحوالي {total} ميجابايت بما في ذلك النموذج). يُخزَّن في ~/.aiworkdeck ويمكن إزالته من الإعدادات ← المكونات.",
  "promptNoModel": "يلزم تنزيل {name} (حوالي {runtime} ميجابايت). يُخزَّن في ~/.aiworkdeck ويمكن إزالته من الإعدادات ← المكونات.",
  "promptUsage": "يشغّل: {unlocks}. بدونه: {impact}. وكل شيء آخر يستمر في العمل.",
  "sizeUnknown": "جارٍ التحقق من الحجم…",
  "stateNotInstalled": "غير مثبَّت",
  "stateReady": "مثبَّت (لم يُشغَّل بعد)",
  "stateServiceStarted": "بدأت الخدمة (لم يتم التحقق من الوظيفة بعد)",
  "errorServiceUnavailable": "تعذّر بدء خدمة المكوّن. تحقق من التثبيت وأعد المحاولة.",
  "stateDownloadingRuntime": "جارٍ تنزيل بيئة التشغيل {percent}%",
  "stateDownloadingModel": "جارٍ تنزيل النموذج {percent}%",
  "stateStartingService": "جارٍ تشغيل المكوّن…",
  "stateVerifyingRuntime": "جارٍ التحقق من التنزيل…",
  "stateExtractingRuntime": "جارٍ فك الحزم {percent}%",
  "stateCheckingRuntime": "جارٍ التحقق من الملفات…",
  "stateFinalizingRuntime": "جارٍ إنهاء العملية…",
  "errorStalled": "لم يحدث أي تقدّم لفترة طويلة، لذا توقفنا عن الانتظار. يُرجى إعادة المحاولة؛ وإذا استمرت المشكلة، تحقق من سجل الواجهة الخلفية في ~/.aiworkdeck/logs.",
  "errorBackendRestarted": "أعادت الخدمة الخلفية التشغيل ما أدى إلى مقاطعة التنزيل. يُرجى إعادة المحاولة.",
  "stateFailed": "فشل التحضير: {msg}",
  "progressTotal": "الإجمالي {done}/{count} ({percent}%)",
  "cancelDownload": "إلغاء التنزيل",
  "checkStartup": "فحص بدء التشغيل",
  "verifyRepair": "التحقق والإصلاح",
  "retry": "إعادة المحاولة",
  "chatTitle": "مكوّن مطلوب",
  "chatConfirm": "التنزيل والمتابعة",
  "chatCancel": "ليس الآن",
  "chatInstalling": "جارٍ تحضير المكوّن…",
  "chatStage": {
    "preparing": "جارٍ تحضير المكوّن…",
    "downloading": "جارٍ التنزيل. انقر \"التنزيل في الخلفية\" لمواصلة الدردشة في هذه الأثناء.",
    "verifying": "اكتمل التنزيل. جارٍ التحقق من محتوياته…",
    "extracting": "جارٍ فك الحزم والتثبيت. توجد ملفات كثيرة، لذا قد يستغرق ذلك بضع دقائق.",
    "checking": "جارٍ التحقق من الملفات التي تم فك حزمها…",
    "finalizing": "اقتربنا من الانتهاء. جارٍ الكتابة إلى مجلد التثبيت…",
    "model": "جارٍ تنزيل النموذج…",
    "starting": "جارٍ تشغيل المكوّن…"
  },
  "chatResending": "المكوّن جاهز. نتابع طلبك…",
  "chatReadyRetry": "المكوّن جاهز. يمكنك إعادة إرسال طلبك.",
  "chatReadyContinue": "المكوّن جاهز. يمكنك متابعة الخطوة التي كنت فيها.",
  "chatReadyContinueBtn": "متابعة",
  "backgroundDownload": "التنزيل في الخلفية",
  "backgroundStarted": "جارٍ التنزيل في الخلفية. تابع التقدّم من الإعدادات ← المكونات.",
  "backgroundDone": "تم تثبيت {name} وتشغيله. يمكنك تجربته.",
  "backgroundFailed": "فشل تنزيل {name}: {msg}",
  "asrRuntimeMissingAction": "تنزيل التعرف على الكلام على الجهاز",
  "pptxRuntime": {
    "name": "العروض التقديمية وتحويل PDF إلى Word",
    "unlocks": "إنشاء العروض التقديمية بالذكاء الاصطناعي، وقراءة PPTX وتنسيقه، وتحويل ملفات PDF النصية إلى Word مع الحفاظ على التنسيق؛ وتحتاج ملفات PDF الممسوحة ضوئيًا أيضًا إلى محرك OCR أدناه",
    "impact": "تكون هذه الميزات غير متاحة؛ ولا يزال معاينة PDF والتحويل الهيكلي يعملان"
  },
  "mineruRuntime": {
    "name": "محرك OCR للمستندات الممسوحة ضوئيًا (MinerU)",
    "unlocks": "التحويل إلى Word والتعرف على التنسيق لملفات PDF الممسوحة ضوئيًا والتي لا تحتوي على طبقة نصية، وتصدير PPT قابلة للتحرير؛ يُحتاج إليه فقط للمستندات الممسوحة ضوئيًا ويتطلب \"العروض التقديمية وتحويل PDF إلى Word\"",
    "impact": "لا يمكن تحويل ملفات PDF الممسوحة ضوئيًا إلى Word؛ أما ملفات PDF النصية فلا تتأثر"
  },
  "kokoroRuntime": {
    "name": "توليد الكلام",
    "unlocks": "علامة تبويب توليد الكلام في لوحة الصوت",
    "impact": "توليد الكلام غير متاح"
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
