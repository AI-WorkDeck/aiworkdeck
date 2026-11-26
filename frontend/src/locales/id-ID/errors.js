// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Anda sedang offline, jadi permintaan tidak terkirim. Periksa koneksi, lalu pilih “Coba lagi”.",
  "timeout": "Layanan terlalu lama merespons. Coba lagi sebentar lagi; untuk file besar, bagi menjadi bagian yang lebih kecil.",
  "localServiceDown": "Layanan lokal belum siap atau sudah berhenti. Tunggu beberapa detik; jika terus terjadi, mulai ulang AI WorkDeck.",
  "signInRequired": "Fitur ini memerlukan akun AI WorkDeck. Masuk, dan Anda akan langsung kembali ke sini.",
  "sessionExpired": "Sesi masuk Anda telah berakhir. Masuk lagi; pekerjaan yang belum disimpan tetap aman.",
  "forbidden": "Anda tidak memiliki izin untuk melakukan ini. Minta akses kepada penanggung jawab perkara atau admin firma Anda.",
  "balanceLow": "Kredit AI Anda sudah habis; permintaan ini tidak dikenai biaya. Isi ulang di Pengaturan → Akun & saldo.",
  "rateLimited": "Terlalu banyak permintaan saat ini, sehingga layanan model membatasi laju. Tunggu semenit lalu coba lagi.",
  "modelUnavailable": "Model yang dipilih sedang tidak tersedia. Coba lagi nanti, atau pilih model lain di bawah kotak pesan.",
  "modelKeyInvalid": "Penyedia model menolak kunci yang masih digunakan perangkat ini dari pengaturan lama. Masuk untuk menggunakan AI milik AI WorkDeck sebagai gantinya.",
  "accountReconnect": "Koneksi akun AI Anda perlu diperbarui, jadi permintaan ini tidak terkirim. Pilih \"Masuk lagi\", lalu coba lagi; tidak ada yang hilang.",
  "streamInterrupted": "Jawaban terputus; bagian yang sudah diterima tetap tersimpan di atas. Pilih “Coba lagi” untuk membuatnya ulang.",
  "serverError": "Terjadi masalah di sisi kami dan tindakan ini tidak selesai. Coba lagi nanti; jika terus terjadi, kirimi kami “Masukan”.",
  "conflict": "Ini diubah di tempat lain, atau tindakan sebelumnya masih berjalan. Segarkan lalu coba lagi.",
  "fileTooLarge": "File terlalu besar (batas {limit}). Kompres atau bagi file, lalu unggah lagi.",
  "fileUnreadable": "File ini tidak dapat dibuka; mungkin rusak atau dilindungi kata sandi. Simpan salinan baru dari aplikasi aslinya lalu coba lagi.",
  "notFound": "Item ini tidak ditemukan; mungkin sudah dipindahkan atau dihapus. Segarkan daftar.",
  "marketplaceUnavailable": "Marketplace Plugin tidak dapat dijangkau saat ini; plugin yang sudah terpasang tetap berfungsi. Periksa koneksi, lalu pilih “Segarkan”.",
  "pluginInstallFailed": "Tidak dapat memasang “{name}”; tidak ada hal lain yang berubah. Coba lagi nanti; jika tetap gagal, kirim masukan beserta detailnya.",
  "unknown": "Tindakan tidak berhasil. Coba lagi; jika terus terjadi, kirim masukan beserta detailnya.",
  "actions": {
    "retry": "Coba lagi",
    "details": "Detail",
    "hideDetails": "Sembunyikan detail",
    "continue": "Lanjutkan",
    "refresh": "Segarkan",
    "signIn": "Masuk",
    "reconnect": "Masuk lagi",
    "feedback": "Masukan"
  }
}
