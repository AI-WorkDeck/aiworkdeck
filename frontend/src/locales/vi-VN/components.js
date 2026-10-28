// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "panelTitle": "Thành phần tùy chọn",
  "panelSubtitle": "Các thành phần này không đi kèm trong bộ cài đặt. Chỉ tải xuống những gì bạn cần dùng — mọi thứ đều chạy ngay trên máy tính này và dữ liệu không bao giờ rời khỏi máy.",
  "installSelected": "Tải xuống mục đã chọn",
  "installOne": "Tải thành phần này",
  "later": "Để sau",
  "laterHint": "Bạn có thể tải xuống bất cứ lúc nào trong phần Cài đặt → Thành phần.",
  "alreadyReady": "Đã cài đặt: {names}.",
  "nameSeparator": ", ",
  "manageTitle": "Quản lý thành phần",
  "promptWithModel": "Cần tải xuống {name} (khoảng {runtime} MB; khoảng {total} MB nếu tính cả mô hình). Dữ liệu được lưu tại ~/.aiworkdeck và có thể gỡ bỏ trong Cài đặt → Thành phần.",
  "promptNoModel": "Cần tải xuống {name} (khoảng {runtime} MB). Dữ liệu được lưu tại ~/.aiworkdeck và có thể gỡ bỏ trong Cài đặt → Thành phần.",
  "promptUsage": "Dùng cho: {unlocks}. Nếu không cài đặt: {impact}. Các tính năng khác vẫn hoạt động bình thường.",
  "sizeUnknown": "Đang kiểm tra dung lượng…",
  "stateNotInstalled": "Chưa cài đặt",
  "stateReady": "Đã cài đặt (chưa chạy thử)",
  "stateServiceStarted": "Dịch vụ đã khởi động (chưa xác minh tính năng)",
  "errorServiceUnavailable": "Không thể khởi động dịch vụ thành phần. Vui lòng kiểm tra cài đặt và thử lại.",
  "stateDownloadingRuntime": "Đang tải môi trường chạy {percent}%",
  "stateDownloadingModel": "Đang tải mô hình {percent}%",
  "stateStartingService": "Đang khởi động thành phần…",
  "stateVerifyingRuntime": "Đang kiểm tra tệp tải xuống…",
  "stateExtractingRuntime": "Đang giải nén {percent}%",
  "stateCheckingRuntime": "Đang đối chiếu các tệp…",
  "stateFinalizingRuntime": "Đang hoàn tất ghi dữ liệu…",
  "errorStalled": "Không có tiến triển trong thời gian dài nên hệ thống đã ngừng chờ. Vui lòng thử lại; nếu vẫn lỗi, hãy kiểm tra nhật ký backend tại ~/.aiworkdeck/logs.",
  "errorBackendRestarted": "Dịch vụ chạy nền đã khởi động lại khiến quá trình tải bị gián đoạn. Vui lòng thử lại.",
  "stateFailed": "Chuẩn bị thất bại: {msg}",
  "progressTotal": "Tổng tiến độ {done}/{count} ({percent}%)",
  "cancelDownload": "Hủy tải xuống",
  "checkStartup": "Kiểm tra khởi động",
  "verifyRepair": "Kiểm tra và sửa chữa",
  "retry": "Thử lại",
  "chatTitle": "Cần tải thành phần bổ sung",
  "chatConfirm": "Tải xuống và tiếp tục",
  "chatCancel": "Để sau",
  "chatInstalling": "Đang chuẩn bị thành phần…",
  "chatStage": {
    "preparing": "Đang chuẩn bị thành phần…",
    "downloading": "Đang tải xuống. Nhấn \"Tải xuống trong nền\" để tiếp tục trò chuyện trong lúc chờ.",
    "verifying": "Tải xuống hoàn tất. Đang kiểm tra tính toàn vẹn…",
    "extracting": "Đang giải nén và cài đặt. Có khá nhiều tệp nên quá trình này có thể mất vài phút.",
    "checking": "Đang kiểm tra các tệp đã giải nén…",
    "finalizing": "Sắp hoàn tất. Đang ghi vào thư mục cài đặt…",
    "model": "Đang tải mô hình xuống…",
    "starting": "Đang khởi động thành phần…"
  },
  "chatResending": "Thành phần đã sẵn sàng. Đang tiếp tục yêu cầu vừa rồi của bạn…",
  "chatReadyRetry": "Thành phần đã sẵn sàng. Bạn có thể gửi lại yêu cầu vừa rồi.",
  "chatReadyContinue": "Thành phần đã sẵn sàng. Bạn có thể tiếp tục bước đang thực hiện.",
  "chatReadyContinueBtn": "Tiếp tục",
  "backgroundDownload": "Tải xuống trong nền",
  "backgroundStarted": "Đã chuyển sang tải xuống trong nền. Xem tiến độ tại Cài đặt → Thành phần.",
  "backgroundDone": "{name} đã được cài đặt và khởi động. Bạn có thể bắt đầu sử dụng.",
  "backgroundFailed": "Tải xuống {name} thất bại: {msg}",
  "asrRuntimeMissingAction": "Tải thành phần nhận dạng giọng nói trên máy",
  "pptxRuntime": {
    "name": "Tạo slide PPT và chuyển PDF sang Word",
    "unlocks": "Tạo slide bằng AI, đọc và chỉnh định dạng PPTX, chuyển đổi PDF có lớp văn bản sang Word giữ nguyên bố cục; đối với PDF bản quét cần thêm bộ máy OCR bên dưới",
    "impact": "các tính năng đó sẽ không khả dụng; xem trước PDF và chuyển đổi cấp cấu trúc vẫn hoạt động bình thường"
  },
  "mineruRuntime": {
    "name": "Bộ máy OCR cho tài liệu quét (MinerU)",
    "unlocks": "Chuyển đổi sang Word và nhận dạng bố cục cho tệp PDF bản quét không có lớp văn bản, xuất PPT có thể chỉnh sửa; chỉ cần khi xử lý bản quét và yêu cầu cài đặt \"Tạo slide PPT và chuyển PDF sang Word\" trước",
    "impact": "không thể chuyển đổi PDF bản quét sang Word; PDF có lớp văn bản không bị ảnh hưởng"
  },
  "kokoroRuntime": {
    "name": "Tổng hợp giọng nói",
    "unlocks": "thẻ \"Tổng hợp giọng nói\" trên bảng Giọng nói",
    "impact": "tính năng tổng hợp giọng nói không khả dụng"
  },
  "asrRuntime": {
    "name": "Nhận dạng giọng nói trên máy",
    "unlocks": "chế độ chuyển âm thanh thành văn bản \"bản ghi âm không rời khỏi máy tính này\"",
    "impact": "chỉ còn sử dụng được hai chế độ chuyển âm trên đám mây"
  },
  "features": {
    "pptxGenerate": "Tạo slide PPT bằng AI",
    "pptxFormat": "Đọc/chỉnh sửa định dạng PPTX",
    "pdfToWordLayout": "Chuyển PDF sang Word (giữ nguyên bố cục)",
    "scannedOcrEntry": "Lối vào OCR tài liệu quét (cần thêm bộ máy OCR)",
    "scannedPdfToWord": "Chuyển PDF bản quét sang Word",
    "ocrParse": "Phân tích bố cục OCR",
    "pptxEditableExport": "Xuất PPT có thể chỉnh sửa",
    "ttsPanel": "Bảng tổng hợp giọng nói",
    "localTranscription": "Chuyển âm thành văn bản ngay trên máy"
  }
}
