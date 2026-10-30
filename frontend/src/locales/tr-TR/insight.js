// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "Dayanaklar",
  "noDoc": "Açık belge yok",
  "parse": "Tam belge çevrimiçi doğrulama (ücret uygulanabilir)",
  "reparse": "Tam belge çevrimiçi doğrulamayı tekrarla (ücret uygulanabilir)",
  "onlineHint": "Tıklandığında bu belge kaydedilir ve kaydedilen sürüm çevrimiçi olarak doğrulanır. AI ve dış sorgulamalar ücrete tabi olabilir.",
  "saveRequired": "Bu belge kaydedilemedi. Çevrimiçi doğrulamadan önce başarıyla kaydedin.",
  "running": "Çevrimiçi doğrulanıyor…",
  "done": "Çevrimiçi doğrulama tamamlandı",
  "failed": "Çevrimiçi doğrulama başarısız oldu",
  "loading": "Yükleniyor…",
  "loadingDetail": "Sorgu ayrıntıları alınıyor…",
  "noDetail": "Bu öğe için sorgu ayrıntısı yok",
  "loadFailed": "Çevrimiçi doğrulama sonuçları yüklenemedi",
  "parseFailed": "Çevrimiçi doğrulama başlatılamadı",
  "detailFailed": "Sorgu ayrıntıları yüklenemedi",
  "refreshFailed": "Sorgu yeniden çalıştırılamadı",
  "retry": "Tekrar dene",
  "goConnectAccount": "Hesap bağla",
  "goRecharge": "Kredi ekle",
  "hint": {
    "NO_CREDENTIAL": "Bu sorgu kanalı için yöneticiniz tarafından sunucuda kimlik bilgisi yapılandırılmalıdır."
  },
  "tab": {
    "retrieval": "Dış Sorgular",
    "checks": "Tutarlılık"
  },
  "kind": {
    "COMPANY": "Şirketler",
    "LAW": "Mevzuat",
    "CASE": "Kararlar",
    "DOC": "Belgeler"
  },
  "entityKind": {
    "COMPANY": "Şirket",
    "LAW": "Mevzuat",
    "CASE": "Karar",
    "DOC": "Belge"
  },
  "openInNewTab": "Yeni sekmede aç",
  "openDocFile": "Dosyayı aç",
  "docNotFound": "Bu projede böyle bir dosya bulunamadı",
  "docMissing": "Bu dosya artık projede değil",
  "source": {
    "projectFile": "Proje dosyası",
    "qichacha": "Qichacha"
  },
  "mentions": "{count} geçiş",
  "mentionsTitle": "Belgedeki geçişler",
  "shareholders": "Ortaklar ve paydaşlar",
  "moreCandidates": "Diğer adaylar",
  "caseSection": {
    "ascertain": "Tespit edilen vakıalar",
    "reason": "Gerekçe",
    "result": "Hüküm",
    "gist": "Karar özeti",
    "fullText": "Kararın tam metni"
  },
  "authoritative": "Resmî metin (Pkulaw)",
  "implementDate": "Yürürlük tarihi: {date}",
  "recognition": "Dosya numarası tanıma",
  "openInPkulaw": "Pkulaw’da aç",
  "citation": {
    "citedText": "Atıf yapılan madde",
    "candidates": "İçeriğe göre eşleşen maddeler",
    "article": "Madde {n}"
  },
  "severity": {
    "warn": "Şüpheli",
    "error": "Hata"
  },
  "unifyTo": "Tümünü {value} olarak birleştir",
  "cannotFix": "Otomatik düzeltilemiyor: {reason}",
  "fixNotUnique": "Tekil bir eşleşme bulunamadı — lütfen elle düzenleyin.",
  "fixPartial": "{done} düzeltildi; {failed} tekil eşleşmeye sahip değil — lütfen bunları elle düzenleyin.",
  "fixed": "Düzeltildi",
  "fixedHint": "Geri almak için Cmd+Z tuşlarına basın; bulguları yenilemek için yeniden analiz edin.",
  "noEditor": "Önce bir belge düzenleyici penceresini etkinleştirin",
  "empty": {
    "noRun": "Bu belge henüz çevrimiçi doğrulanmadı",
    "noRunHint": "Günlük yazım ipuçları yerel olarak çalışır. Yalnızca çevrimiçi doğrulamaya tıklandığında kaydedilen belge AI çıkarımı, dış sorgular ve tutarlılık kontrolleri için gönderilir.",
    "noEntity": "Sorgulanabilir varlık bulunamadı",
    "noEntityHint": "Belgede şirket adı, kanun maddesi veya dosya numarası geçmiyor.",
    "noFinding": "Tutarsızlık bulunamadı",
    "noFindingHint": "Miktar ifadeleri ve birleşik sosyal kredi kodları doğrulamadan geçti."
  }
}
