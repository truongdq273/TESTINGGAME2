# Bàn giao IT — Tower Builder (`tower-builder`)

## Tóm tắt 1 phút
- Game này dùng **Room Protocol v1** chung. Máy chủ `edupia-classroom-server` phục vụ mọi game theo chuẩn này; **không cần viết code máy chủ riêng cho game**.
- Chuyển từ demo sang lớp thật: sửa đúng **một file** `lib/game-config.js`:
  ```js
  transport: 'server',
  serverUrl: 'wss://<tên-miền-máy-chủ>/ws',
  ```
- Chủ nội dung vào `https://<tên-miền-máy-chủ>/admin`, đặt link nguồn cho gameId `tower-builder`.
- Thêm origin của trang chứa game vào `ALLOWED_ORIGINS` của máy chủ.

## Nếu máy chủ chưa được triển khai (làm một lần cho mọi game)
1. Lấy thư mục `classroom-server/` (tạo bằng `scaffold.py server`), chạy `npm ci && npm start` sau reverse proxy HTTPS (WebSocket ở `/ws`).
2. Đặt biến môi trường theo `.env.example`: `ALLOWED_ORIGINS`, `ADMIN_TOKEN`, `CONTENT_HOSTS`, `DATA_DIR` (ổ lưu bền).
3. Thay `auth.js › authenticateTeacher` bằng đăng nhập Edupia (SSO/cookie). Đây là chỗ duy nhất cần sửa trong máy chủ.
4. Cấp quyền đọc Google Docs nguồn cho máy chủ. Máy chủ gọi `export?format=txt`, nên tài liệu cần chia sẻ “bất kỳ ai có link đều xem được”. Nếu phải giữ bí mật đáp án, IT đổi `content-source.js` sang Drive API bằng service account.
5. Nhiều instance: phòng đang nằm trong RAM. Dùng sticky session theo kết nối, hoặc chuyển `rooms` sang Redis trước khi scale ngang.

## Những gì đã có sẵn (không cần làm thêm)
- Chấm điểm, hẹn giờ, chống bấm kép, chống vòng cũ, vào muộn và nối lại đều chạy trên máy chủ (`shared/room-core.js`). Máy chủ bỏ qua `playerId`, `isCorrect`, `score` do client gửi.
- Học sinh chỉ nhận câu hỏi đã lược đáp án. Đáp án chỉ trả về sau khi chính em đó đã nộp.
- Có kiểm tra origin WebSocket, giới hạn 16 KB/tin, 20 tin/giây, tối đa 20 phòng/giáo viên, và tự dọn phòng bỏ trống.
- Nguồn nội dung: bắt buộc HTTPS, host nằm trong whitelist, kiểm tra từng lần chuyển hướng, tối đa 1 MB, timeout 10 giây, tối đa 100 câu.
- Trang game có CSP. Iframe game chạy với `sandbox="allow-scripts"` và không dùng inline handler.

## Nội dung game
- Luật hoạt cảnh: Học sinh trả lời đúng sẽ thả khối xây dựng rơi trúng tháp, sai sẽ bị gió thổi bay. Tháp càng cao càng đẹp. Có hiệu ứng vật lý gió và trọng lực.
- Nhịp câu hỏi: `self` · Số người tối đa: `4`
- Dung lượng thư mục: 96915 byte (giới hạn 5.000.000)

## Kiểm thử trước khi mở lớp thật
- Chạy `python3 scripts/check_game.py <thư-mục-game>`: phải PASS.
- Mở 1 giáo viên và 4 học sinh trên **các thiết bị khác nhau**. Kiểm tra roster, điểm, reload, mất mạng rồi nối lại, và tổng kết.
- Sửa câu hỏi ở nguồn giữa vòng: vòng đang chạy không đổi, vòng mới nhận bản mới.

## Giới hạn còn lại
- Bản demo (`transport: 'local'`) chỉ chạy trên cùng máy, cùng trình duyệt, và không phải ranh giới bảo mật.
- Thêm dạng câu hỏi mới (ngoài `single-choice`) cần cập nhật `shared/question-bank.js` và `room-core.js` trên máy chủ.
