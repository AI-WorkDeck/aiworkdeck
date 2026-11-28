// SPDX-FileCopyrightText: 2026 北京公富信息技术有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-facing error catalogue (POLISH X7). Each message = what happened + what to do.
export default {
  "offline": "Bạn đang ngoại tuyến nên yêu cầu chưa được gửi. Hãy kiểm tra kết nối, rồi chọn “Thử lại”.",
  "timeout": "Dịch vụ phản hồi quá lâu. Hãy thử lại sau giây lát; với tệp lớn, hãy chia thành các phần nhỏ hơn.",
  "localServiceDown": "Dịch vụ cục bộ chưa sẵn sàng hoặc đã dừng. Hãy đợi vài giây; nếu vẫn lặp lại, hãy khởi động lại AI WorkDeck.",
  "signInRequired": "Tính năng này cần có tài khoản AI WorkDeck. Hãy đăng nhập và bạn sẽ quay lại ngay đây.",
  "sessionExpired": "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại; công việc chưa lưu vẫn được giữ.",
  "forbidden": "Bạn không có quyền thực hiện thao tác này. Hãy nhờ người phụ trách vụ việc hoặc quản trị viên văn phòng cấp quyền truy cập.",
  "balanceLow": "Số dư AI của bạn đã hết; yêu cầu này không bị tính phí. Hãy nạp thêm tại Cài đặt → Tài khoản và số dư.",
  "rateLimited": "Hiện có quá nhiều yêu cầu nên dịch vụ mô hình đang giới hạn tốc độ. Hãy đợi một phút rồi thử lại.",
  "modelUnavailable": "Mô hình đã chọn hiện không khả dụng. Hãy thử lại sau, hoặc chọn mô hình khác bên dưới ô nhập tin nhắn.",
  "modelKeyInvalid": "Nhà cung cấp mô hình đã từ chối khóa mà thiết bị này vẫn đang dùng từ thiết lập cũ. Hãy đăng nhập để dùng AI của AI WorkDeck thay thế.",
  "accountReconnect": "Cần làm mới kết nối tài khoản AI nên yêu cầu này chưa được gửi. Chọn \"Đăng nhập lại\" rồi thử lại; không mất nội dung nào.",
  "streamInterrupted": "Câu trả lời bị ngắt giữa chừng; phần đã nhận được vẫn được giữ ở trên. Chọn “Thử lại” để tạo lại.",
  "streamInterruptedResumable": "Câu trả lời bị ngắt giữa chừng; phần đã nhận được vẫn được giữ ở trên. Chọn “Tiếp tục” để chạy tiếp từ chỗ dừng, hoặc “Thử lại” để bắt đầu lại.",
  "streamInterruptedTwice": "Câu trả lời lại bị ngắt. Chọn “Thử lại” để tạo lại toàn bộ câu trả lời.",
  "serverError": "Đã có sự cố từ phía chúng tôi và thao tác này chưa hoàn tất. Hãy thử lại sau; nếu vẫn lặp lại, hãy gửi “Phản hồi” cho chúng tôi.",
  "conflict": "Nội dung này đã được thay đổi ở nơi khác, hoặc thao tác trước đó vẫn đang chạy. Hãy làm mới rồi thử lại.",
  "fileTooLarge": "Tệp quá lớn (giới hạn {limit}). Hãy nén hoặc chia nhỏ tệp rồi tải lên lại.",
  "fileUnreadable": "Không thể mở tệp này; tệp có thể bị hỏng hoặc được bảo vệ bằng mật khẩu. Hãy lưu một bản sao mới từ ứng dụng gốc rồi thử lại.",
  "notFound": "Không tìm thấy mục này; có thể nó đã bị di chuyển hoặc xóa. Hãy làm mới danh sách.",
  "marketplaceUnavailable": "Hiện không thể kết nối tới Chợ plugin; các plugin đã cài vẫn hoạt động. Hãy kiểm tra kết nối, rồi chọn “Làm mới”.",
  "pluginInstallFailed": "Không thể cài “{name}”; không có gì khác bị thay đổi. Hãy thử lại sau; nếu vẫn lỗi, hãy gửi phản hồi kèm chi tiết.",
  "unknown": "Thao tác không thành công. Hãy thử lại; nếu vẫn lặp lại, hãy gửi phản hồi kèm chi tiết.",
  "actions": {
    "retry": "Thử lại",
    "details": "Chi tiết",
    "hideDetails": "Ẩn chi tiết",
    "continue": "Tiếp tục",
    "continueTooltip": "Tiếp tục từ chỗ dừng mà không tạo lại phần đã có",
    "refresh": "Làm mới",
    "signIn": "Đăng nhập",
    "reconnect": "Đăng nhập lại",
    "topUp": "Nạp tiền",
    "feedback": "Phản hồi"
  }
}
