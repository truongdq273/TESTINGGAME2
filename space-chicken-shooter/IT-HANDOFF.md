# TÀI LIỆU BÀN GIAO KỸ THUẬT (IT HANDOFF)
## DỰ ÁN: GAME LỚP HỌC ONLINE "BẮN GÀ VŨ TRỤ" (SPACE CHICKEN SHOOTER)

---

### 1. Tổng Quan Kiến Trúc & Phân Luồng Kênh

Hệ thống được thiết kế tách lớp triệt để thành 2 kênh giao tiếp độc lập:

1. **Kênh Host $\leftrightarrow$ Iframe (Nội bộ Tab):**
   - Sử dụng `Window.postMessage` qua thư viện chuẩn `sdk.js` (`ClassroomGameSDK 1.0.0`).
   - Kết nối giữa trang chứa (`student.html`) và gameplay chạy trong iframe (`game.html`).
   - Tuân thủ nghiêm ngặt Handshake 3 bước: `gameReady` $ightarrow$ `loadContent` (chỉ gửi câu hỏi không có đáp án) $ightarrow$ `contentAccepted` $ightarrow$ `startGame`.

2. **Kênh Đa Tab / Mạng Máy Chủ (Host $\leftrightarrow$ Host / Server):**
   - **Trong bản demo frontend hiện tại:** Được đóng gói trong `transport.js`, mô phỏng phòng học qua `BroadcastChannel` (kèm fallback `localStorage` storage events) trên cùng origin của một trình duyệt.
   - **Khi triển khai production qua Internet:** Đội IT chỉ cần thay thế phần ruột của `transport.js` bằng kết nối WebSocket / Socket.io / SSE mà không phải sửa đổi `sdk.js` hay mã nguồn game trong `game.html`.

```
[ Giáo Viên (teacher.html) ]                 [ Học Sinh (student.html) ]
        |                                                 |
  Authority Chấm Điểm                             Host Adapter
        |                                                 |
 [ transport.js (BroadcastChannel / WebSocket) ] <--------+
                                                          | (postMessage / SDK)
                                                          v
                                                 [ game.html (Iframe) ]
```

---

### 2. Hợp Đồng Sự Kiện SDK (Classroom Game SDK 1.0.0)

File `sdk.js` được sao chép nguyên vẹn từ thư viện chuẩn và không được tự ý sửa schema.

#### Game $ightarrow$ Host (Phát ra từ Iframe):
```js
{ type: 'gameReady', payload: { gameId: 'space-chicken-shooter', version: '1.0.0' } }
{ type: 'submitAnswer', payload: { playerId, questionId, answer, isCorrect, timeMs } }
{ type: 'updateScore', payload: { playerId, score, delta } }
{ type: 'gameEnd', payload: { roomCode, leaderboard: [{ playerId, name, score, rank }] } }
```

#### Host $ightarrow$ Game (Gửi xuống Iframe):
```js
{ type: 'loadContent', payload: { questions: [...] } }
{ type: 'startGame' }
{ type: 'endGame' }
```

---

### 3. Hướng Dẫn Tích Hợp Máy Chủ (Server Authority) Cho Đội IT

Trong bản demo, tab Giáo viên đóng vai trò là "Authority" (nguồn quyết định điểm, lưu trữ đáp án bí mật). Khi đưa lên production nhiều học sinh ở các nhà khác nhau:

1. **Chuyển Authority lên Server:**
   - Server Node.js / Python / Go lưu trữ bí mật `correctOptionId` và `points` của từng câu hỏi.
   - Khi học sinh bấm trả lời, client chỉ gửi `answerAttempt`: `{ questionId, answer, timeMs }`.
   - Server kiểm tra `(roomCode, roundId, playerId, questionId)`:
     - Chống gửi 2 lần (deduplication).
     - So khớp đáp án, tính điểm.
     - Trả về `answerResult` riêng cho học sinh đó: `{ questionId, isCorrect, correctOptionId, pointsAwarded, totalScore, explanation }`.
     - Phát broadcast cập nhật `roomSnapshot` cho toàn phòng.

2. **Thay Thế `transport.js`:**
   Giữ nguyên 4 phương thức public của `transport.js`:
   - `join(roomCode, player)`: Mở kết nối Socket tới server phòng.
   - `send(event)`: Gửi event envelope qua Socket.
   - `onEvent(handler)`: Đăng ký nhận sự kiện từ server (trả về hàm unsubscribe).
   - `leave()`: Ngắt kết nối socket, xóa membership phòng cũ.

---

### 4. Tích Hợp Nguồn Câu Hỏi Ngoài (Google Sheets / Docs)

Chủ nội dung quản lý nguồn tại đường dẫn riêng `admin.html`. Khi IT nối backend:

- **Google Sheets API:** Đề xuất tạo bảng Google Sheets với các cột:
  `id | prompt | optionA | optionB | optionC | optionD | correctOptionId | points | explanation`
- Server định kỳ hoặc qua webhook đọc Google Sheets qua [Google Sheets API v4](https://developers.google.com/workspace/sheets/api/samples/reading).
- Server chuyển đổi sang Schema v1 chuẩn của game:
  ```json
  {
    "schemaVersion": 1,
    "title": "Tên bộ câu hỏi",
    "questions": [
      {
        "id": "q-01",
        "type": "single-choice",
        "prompt": "...",
        "options": [{"id": "a", "text": "..."}, {"id": "b", "text": "..."}],
        "correctOptionId": "b",
        "explanation": "...",
        "points": 10
      }
    ]
  }
  ```
- **Bảo mật:** Client học sinh chỉ nhận `learner-safe payload` (đã loại bỏ `correctOptionId`), không bao giờ để lộ đáp án trước khi nộp.

---

### 5. Phòng Ngừa Bảo Mật & Gian Lận

1. **Chống tiêm công thức CSV (Formula Injection):** Hàm xuất CSV trong `room-controller.js` đã tự động chèn dấu `'` trước các ký tự `=`, `+`, `-`, `@`, `	` nhằm bảo vệ file khi mở bằng Microsoft Excel.
2. **Xác thực vai trò (Role-based access):** Trang `admin.html` tách biệt hoàn toàn khỏi điều hướng của giáo viên và học sinh. Trong bản production, IT cần thêm middleware xác thực JWT / Cookie admin cho endpoint này.
3. **Giới hạn dung lượng & Cache:** Toàn bộ source code frontend và media game được tối ưu $\le$ 5MB. Khi cập nhật nguồn câu hỏi giữa vòng chơi, hệ thống sử dụng snapshot bất biến khóa theo `roundId` để không làm xáo trộn điểm của vòng đang diễn ra.
