// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "title": "Căn cứ",
  "noDoc": "Chưa mở tài liệu",
  "parse": "Xác minh trực tuyến toàn văn (có thể phát sinh phí)",
  "reparse": "Xác minh lại trực tuyến toàn văn (có thể phát sinh phí)",
  "onlineHint": "Nhấn vào sẽ lưu tài liệu hiện tại trước, sau đó xác minh phiên bản đã lưu trực tuyến. AI và tra cứu bên ngoài có thể phát sinh phí.",
  "saveRequired": "Không thể lưu tài liệu hiện tại. Vui lòng lưu thành công trước khi xác minh trực tuyến.",
  "running": "Đang xác minh trực tuyến…",
  "done": "Đã hoàn tất xác minh trực tuyến",
  "failed": "Xác minh trực tuyến thất bại",
  "loading": "Đang tải…",
  "loadingDetail": "Đang lấy chi tiết tra cứu…",
  "noDetail": "Mục này không có chi tiết tra cứu",
  "loadFailed": "Không thể tải kết quả xác minh trực tuyến",
  "parseFailed": "Không thể bắt đầu xác minh trực tuyến",
  "detailFailed": "Không thể tải chi tiết tra cứu",
  "refreshFailed": "Không thể chạy lại tra cứu",
  "retry": "Thử lại",
  "goConnectAccount": "Kết nối tài khoản",
  "goRecharge": "Nạp thêm tín dụng",
  "hint": {
    "NO_CREDENTIAL": "Kênh tra cứu này cần được quản trị viên cấu hình thông tin xác thực trên máy chủ."
  },
  "tab": {
    "retrieval": "Tra cứu ngoài",
    "checks": "Kiểm tra nhất quán"
  },
  "kind": {
    "COMPANY": "Công ty",
    "LAW": "Văn bản pháp luật",
    "CASE": "Án lệ / Bản án",
    "DOC": "Tài liệu"
  },
  "entityKind": {
    "COMPANY": "Công ty",
    "LAW": "Văn bản pháp luật",
    "CASE": "Bản án",
    "DOC": "Tài liệu"
  },
  "openInNewTab": "Mở trong thẻ mới",
  "openDocFile": "Mở tệp",
  "docNotFound": "Không tìm thấy tệp này trong dự án",
  "docMissing": "Tệp đó không còn trong dự án này",
  "source": {
    "projectFile": "Tệp dự án",
    "qichacha": "Qichacha"
  },
  "mentions": "{count} vị trí",
  "mentionsTitle": "Vị trí xuất hiện trong văn bản",
  "shareholders": "Cổ đông góp vốn",
  "moreCandidates": "Ứng viên khác",
  "caseSection": {
    "ascertain": "Tình tiết xác minh",
    "reason": "Lập luận xét xử",
    "result": "Kết quả phán quyết",
    "gist": "Tóm tắt bản án",
    "fullText": "Toàn văn bản án"
  },
  "authoritative": "Văn bản chuẩn (Pkulaw)",
  "implementDate": "Hiệu lực từ {date}",
  "recognition": "Nhận diện số hiệu bản án",
  "openInPkulaw": "Mở trong Pkulaw",
  "citation": {
    "citedText": "Điều khoản trích dẫn",
    "candidates": "Điều khoản khớp theo nội dung",
    "article": "Điều {n}"
  },
  "severity": {
    "warn": "Nghi vấn",
    "error": "Lỗi"
  },
  "unifyTo": "Thống nhất thành {value}",
  "cannotFix": "Không thể sửa tự động: {reason}",
  "fixNotUnique": "Không thể định vị duy nhất — vui lòng chỉnh sửa thủ công.",
  "fixPartial": "Đã sửa {done} chỗ; còn {failed} chỗ không định vị duy nhất được — vui lòng sửa thủ công.",
  "fixed": "Đã sửa",
  "fixedHint": "Nhấn Cmd+Z để hoàn tác; phân tích lại để làm mới kết luận.",
  "noEditor": "Vui lòng kích hoạt một cửa sổ soạn thảo tài liệu trước",
  "empty": {
    "noRun": "Tài liệu này chưa được xác minh trực tuyến",
    "noRunHint": "Gợi ý viết hằng ngày chạy cục bộ. Chỉ khi nhấn xác minh trực tuyến ở trên, tài liệu đã lưu mới được gửi để AI trích xuất thực thể, tra cứu bên ngoài và kiểm tra tính nhất quán.",
    "noEntity": "Không tìm thấy thực thể nào để tra cứu",
    "noEntityHint": "Tài liệu không đề cập đến tên công ty, điều khoản pháp luật hoặc số hiệu bản án.",
    "noFinding": "Không phát hiện mâu thuẫn",
    "noFindingHint": "Các số liệu và mã số tín dụng xã hội thống nhất đều khớp."
  }
}
