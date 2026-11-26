// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Çevrimdışısınız, bu yüzden istek gönderilmedi. Bağlantınızı kontrol edin, ardından “Tekrar dene”yi seçin.",
  "timeout": "Hizmet yanıt vermekte çok gecikti. Biraz sonra tekrar deneyin; büyük dosyaları daha küçük parçalara bölün.",
  "localServiceDown": "Yerel hizmet hazır değil ya da durdu. Birkaç saniye bekleyin; sorun sürerse AI WorkDeck’i yeniden başlatın.",
  "signInRequired": "Bu özellik için bir AI WorkDeck hesabı gerekir. Giriş yapın, hemen buraya geri döneceksiniz.",
  "sessionExpired": "Oturumunuzun süresi doldu. Yeniden giriş yapın; kaydedilmemiş çalışmanız korunur.",
  "forbidden": "Bunu yapma izniniz yok. Dosya sorumlusundan veya büronuzun yöneticisinden erişim isteyin.",
  "balanceLow": "AI krediniz bitti; bu istek için ücret alınmadı. Ayarlar → Hesap ve bakiye bölümünden yükleme yapın.",
  "rateLimited": "Şu anda çok fazla istek var, bu yüzden model hizmeti hızı sınırlıyor. Bir dakika bekleyip tekrar deneyin.",
  "modelUnavailable": "Seçilen model şu anda kullanılamıyor. Daha sonra tekrar deneyin veya mesaj kutusunun altından başka bir model seçin.",
  "modelKeyInvalid": "Model sağlayıcı, bu cihazın eski bir kurulumdan hâlâ kullandığı anahtarı reddetti. Bunun yerine AI WorkDeck’in yapay zekâsını kullanmak için giriş yapın.",
  "accountReconnect": "Yapay zekâ hesabı bağlantınızın yenilenmesi gerekiyor, bu yüzden bu istek gönderilmedi. \"Yeniden oturum aç\"ı seçip tekrar deneyin; hiçbir şey kaybolmaz.",
  "streamInterrupted": "Yanıt yarıda kesildi; şimdiye kadar gelen kısım yukarıda duruyor. Yeniden oluşturmak için “Tekrar dene”yi seçin.",
  "serverError": "Bizim tarafımızda bir sorun oluştu ve işlem tamamlanmadı. Daha sonra tekrar deneyin; sorun sürerse bize “Geri Bildirim” gönderin.",
  "conflict": "Bu başka bir yerde değiştirildi ya da önceki işlem hâlâ çalışıyor. Yenileyip tekrar deneyin.",
  "fileTooLarge": "Dosya çok büyük (sınır {limit}). Sıkıştırın veya bölün, ardından yeniden yükleyin.",
  "fileUnreadable": "Bu dosya açılamıyor; zarar görmüş veya parolayla korunuyor olabilir. Özgün uygulamadan yeni bir kopya kaydedip tekrar deneyin.",
  "notFound": "Bu öğe bulunamadı; taşınmış veya silinmiş olabilir. Listeyi yenileyin.",
  "marketplaceUnavailable": "Eklenti Mağazası’na şu anda ulaşılamıyor; yüklü eklentiler çalışmaya devam eder. Bağlantınızı kontrol edin, ardından “Yenile”yi seçin.",
  "pluginInstallFailed": "“{name}” yüklenemedi; başka hiçbir şey değişmedi. Daha sonra tekrar deneyin; yine olmazsa ayrıntılarla birlikte geri bildirim gönderin.",
  "unknown": "Olmadı. Tekrar deneyin; sorun sürerse ayrıntılarla birlikte geri bildirim gönderin.",
  "actions": {
    "retry": "Tekrar dene",
    "details": "Ayrıntılar",
    "hideDetails": "Ayrıntıları gizle",
    "continue": "Devam Et",
    "refresh": "Yenile",
    "signIn": "Giriş yap",
    "reconnect": "Yeniden oturum aç",
    "feedback": "Geri Bildirim"
  }
}
