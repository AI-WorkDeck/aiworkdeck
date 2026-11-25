// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Anda di luar talian, jadi permintaan tidak dihantar. Semak sambungan anda, kemudian pilih “Cuba lagi”.",
  "timeout": "Perkhidmatan mengambil masa terlalu lama untuk bertindak balas. Cuba lagi sebentar lagi; untuk fail besar, pecahkan kepada bahagian yang lebih kecil.",
  "localServiceDown": "Perkhidmatan setempat belum sedia atau telah berhenti. Tunggu beberapa saat; jika berterusan, mulakan semula AI WorkDeck.",
  "signInRequired": "Ciri ini memerlukan akaun AI WorkDeck. Daftar masuk dan anda akan terus kembali ke sini.",
  "sessionExpired": "Daftar masuk anda telah tamat tempoh. Daftar masuk semula; kerja yang belum disimpan dikekalkan.",
  "forbidden": "Anda tidak mempunyai kebenaran untuk berbuat demikian. Minta akses daripada pemilik kes atau pentadbir firma anda.",
  "balanceLow": "Kredit AI anda telah habis; permintaan ini tidak dicaj. Tambah nilai di Tetapan → Akaun & baki.",
  "rateLimited": "Terlalu banyak permintaan sekarang, jadi perkhidmatan model mengehadkan kadar. Tunggu seminit dan cuba lagi.",
  "modelUnavailable": "Model yang dipilih tidak tersedia sekarang. Cuba lagi kemudian, atau pilih model lain di bawah kotak mesej.",
  "modelKeyInvalid": "Penyedia model menolak kunci yang masih digunakan oleh peranti ini daripada tetapan lama. Daftar masuk untuk menggunakan AI AI WorkDeck sebagai gantinya.",
  "streamInterrupted": "Jawapan terputus; bahagian yang sudah diterima dikekalkan di atas. Pilih “Cuba lagi” untuk menjananya semula.",
  "streamInterruptedResumable": "Jawapan terputus; bahagian yang sudah diterima dikekalkan di atas. Pilih “Teruskan” untuk menyambung dari titik berhenti, atau “Cuba lagi” untuk bermula semula.",
  "streamInterruptedTwice": "Terputus lagi. Pilih “Cuba lagi” untuk menjana semula keseluruhan jawapan.",
  "serverError": "Berlaku masalah di pihak kami dan tindakan ini tidak selesai. Cuba lagi kemudian; jika berterusan, hantarkan “Maklum Balas” kepada kami.",
  "conflict": "Ini telah diubah di tempat lain, atau tindakan sebelumnya masih berjalan. Muat semula dan cuba lagi.",
  "fileTooLarge": "Fail terlalu besar (had {limit}). Mampatkan atau pecahkan fail, kemudian muat naik semula.",
  "fileUnreadable": "Fail ini tidak dapat dibuka; mungkin rosak atau dilindungi kata laluan. Simpan salinan baharu daripada aplikasi asal dan cuba lagi.",
  "notFound": "Item ini tidak dijumpai; mungkin telah dialihkan atau dipadam. Segar semula senarai.",
  "marketplaceUnavailable": "Pasaran Plugin tidak dapat dicapai sekarang; plugin yang telah dipasang masih berfungsi. Semak sambungan anda, kemudian pilih “Segar semula”.",
  "pluginInstallFailed": "Tidak dapat memasang “{name}”; tiada perkara lain yang berubah. Cuba lagi kemudian; jika masih gagal, hantar maklum balas beserta butirannya.",
  "unknown": "Tindakan itu tidak berjaya. Cuba lagi; jika berterusan, hantar maklum balas beserta butirannya.",
  "actions": {
    "retry": "Cuba lagi",
    "details": "Butiran",
    "hideDetails": "Sembunyikan butiran",
    "continue": "Teruskan",
    "continueTooltip": "Sambung dari titik berhenti tanpa menjana semula bahagian yang sudah ada",
    "refresh": "Segar semula",
    "signIn": "Daftar masuk",
    "feedback": "Maklum Balas"
  }
}
