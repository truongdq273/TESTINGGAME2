# Tài Liệu Bàn Giao Kỹ Thuật (IT Handoff) - Web Game "Ếch Bắt Muỗi"

Dành cho đội ngũ phát triển và kỹ thuật hệ thống (IT / Backend Team).

## 1. Tổng quan Kiến trúc

- **Frontend Core**: Độc lập hoàn toàn, gồm `index.html`, `teacher.html`, `student.html`, `game.html` (chạy trong iframe), `admin.html`.
- **SDK Communication**: Giữ nguyên vẹn hợp đồng `ClassroomGameSDK 1.0.0` qua `postMessage` hai chiều giữa host (`student.html`) và game bên trong iframe (`game.html`).
- **Phạm vi mô phỏng hiện tại**: Các tab chạy cùng máy / cùng origin giao tiếp thông qua `transport.js` (`BroadcastChannel`, có fallback `storage event`). Authority chấm điểm đặt tại tab Giáo viên.

## 2. Các bước IT tích hợp Máy chủ (Server Integration)

1. **Thay thế Transport**:
   - Thay module `transport.js` bằng kết nối WebSocket hoặc SSE/HTTP Long-polling kết nối tới server trung tâm.
   - Giữ nguyên 4 method của transport: `join(roomCode, player)`, `send(event)`, `onEvent(handler)`, `leave()`.

2. **Chuyển quyền Authority Chấm điểm lên Server**:
   - Không tin cậy `isCorrect` từ client học sinh.
   - Khi học sinh bấm chọn, client gửi `answerAttempt` (chỉ gồm `questionId`, `optionId`, `timeMs`).
   - Server kiểm tra khóa `(roomCode, roundId, playerId, questionId)` để chống chấm 2 lần hoặc gian lận bấm nhanh.
   - Server gửi `answerResult` kèm `isCorrect`, `correctOptionId`, `explanation`, `score` riêng về cho học sinh đó.

3. **Bảo mật Đáp án (Answer Key)**:
   - File `content.json` và API nguồn câu hỏi trên server lưu trữ đáp án đầy đủ.
   - Khi phát `loadContent` xuống máy học sinh, chỉ gửi danh sách câu hỏi dạng Learner-safe (đã lược bỏ `correctOptionId`).

4. **Nguồn Câu hỏi Ngoài (Google Docs / Google Sheets)**:
   - Chủ nội dung có link chỉnh sửa riêng (`https://docs.google.com/document/d/...`).
   - Server IT gọi Google Workspace API (Docs/Sheets export) định kỳ hoặc khi bắt đầu vòng mới để lấy nội dung chuẩn hóa, tính `contentVersion` bằng hash.

## 3. Quy chuẩn Hợp đồng SDK

- **Game → Host**:
  - `gameReady`: `{ gameId: 'ech-bat-muoi', version: '1.0.0' }`
  - `submitAnswer`: `{ playerId, questionId, answer, isCorrect, timeMs }`
  - `updateScore`: `{ playerId, score, delta }`
  - `gameEnd`: `{ roomCode, leaderboard: [{ playerId, name, score, rank }] }`

- **Host → Game**:
  - `loadContent`: `{ questions: [...] }`
  - `startGame`
  - `endGame`
