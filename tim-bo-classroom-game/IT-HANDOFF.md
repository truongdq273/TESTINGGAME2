# TÀI LIỆU BÀN GIAO KỸ THUẬT CHO ĐỘI IT (IT HANDOFF)
## Web Game Lớp Học Online: "Tìm Bò - Let's Save the Cows!"

> **Dành cho**: Đội ngũ Kỹ thuật / Backend / DevOps Edupia.  
> **Mục tiêu**: Hướng dẫn cắm máy chủ WebSocket (Production Server) để vận hành nhiều máy học sinh qua Internet thật **mà không cần viết lại bất kỳ dòng code nào ở frontend**.

---

## 1. Trả lời yêu cầu của Đội IT: "Chỉ cần thêm máy chủ vào là xong"

Kiến trúc mã nguồn đã được thiết kế **tách lớp hoàn toàn (Clean Architecture)**:
```
┌────────────────────────────────────────────────────────┐
│  Màn Chơi Trong Iframe: game.html + sdk.js (Giao thức Chuẩn) │
└─────────────────────────▲──────────────────────────────┘
                          │ postMessage (ClassroomGameSDK 1.0.0)
┌─────────────────────────▼──────────────────────────────┐
│  Host Adapter: teacher.html / student.html / room-controller │
└─────────────────────────▲──────────────────────────────┘
                          │ 4 API duy nhất: join(), send(), onEvent(), leave()
┌─────────────────────────▼──────────────────────────────┐
│  Tầng Mạng: js/transport.js (Chế độ Kép: Local / WebSocket)│
└─────────────────────────▲──────────────────────────────┘
                          │ WSS (WebSocket qua Internet)
┌─────────────────────────▼──────────────────────────────┐
│  MÁY CHỦ WEBSOCKET CỦA IT (Node.js / Go / Python)      │
└────────────────────────────────────────────────────────┘
```

### 👉 Để kết nối máy chủ, Đội IT chỉ cần 2 thao tác cực kỳ đơn giản:

#### Bước 1: Khởi động WebSocket Server
Mã nguồn server mẫu đã được viết sẵn trong thư mục `server/`:
* **Bằng Node.js**:
  ```bash
  cd server
  npm install ws
  node ws-server.js
  ```
* **Hoặc bằng Python**:
  ```bash
  cd server
  pip install websockets
  python server.py
  ```
*(Mặc định server lắng nghe tại cổng `3000`, có thể cấu hình qua biến môi trường `PORT`)*.

#### Bước 2: Cấu hình địa chỉ WebSocket cho Frontend
Frontend hỗ trợ cắm WebSocket linh hoạt theo **1 trong 2 cách**:
1. **Cách 1: Khai báo biến toàn cục (Khuyên dùng khi đóng gói/deploy)**:
   Thêm dòng sau vào `<head>` của `index.html`, `teacher.html`, `student.html`:
   ```html
   <script>
     window.GAME_WS_URL = "wss://classroom-game.edupia.vn/ws";
   </script>
   ```
2. **Cách 2: Truyền trực tiếp qua URL param (Dùng khi test nhanh)**:
   * Tab Giáo viên: `http://localhost:8000/teacher.html?ws=ws://localhost:3000`
   * Tab Học sinh: `http://localhost:8000/student.html?ws=ws://localhost:3000`

> 💡 **Cơ chế tự động chuyển đổi (Dual-Mode)**:
> - Nếu **CÓ** `GAME_WS_URL` hoặc tham số `?ws=`: `transport.js` tự động bật chế độ **WebSocket Network**, kết nối tới server IT để đồng bộ học sinh qua Internet thật.
> - Nếu **KHÔNG CÓ**: `transport.js` tự động chạy chế độ **Local BroadcastChannel** để demo offline trên cùng máy mà không đòi hỏi cài đặt server.

---

## 2. Đặc tả giao thức mạng (WebSocket Envelope Protocol)

Mọi bản tin truyền qua WebSocket đều đóng gói dưới dạng JSON Envelope chuẩn:

```json
{
  "eventId": "evt_abc123_1715000000000",
  "roomCode": "COW8",
  "roundId": "rnd_1715000000000",
  "senderId": "stu_x92fa1",
  "recipientId": "all",
  "type": "answerAttempt",
  "payload": { ... },
  "meta": {
    "hostToken": "htk_9f82a1715000000",
    "timestamp": 1715000000000
  }
}
```

### Danh mục sự kiện giữa Giáo viên & Học sinh:

| Tên sự kiện (`type`) | Hướng gửi | `recipientId` | Ý nghĩa |
| :--- | :--- | :--- | :--- |
| `action: "join"` | Client → Server | `server` | Báo danh kết nối socket vào phòng `roomCode` |
| `playerJoin` | Học sinh → Giáo viên | `all` | Gửi thông tin người chơi (tên, avatar) |
| `roomWelcome` | Giáo viên → Học sinh | `[playerId]` | Gửi xác nhận vào phòng, đính kèm đề câu hỏi đã **lược bỏ đáp án** (`correctOptionId`) |
| `rosterUpdate` | Giáo viên → Học sinh | `all` | Đồng bộ danh sách lớp học và bảng điểm live |
| `gameStart` | Giáo viên → Học sinh | `all` | Phát lệnh bắt đầu trò chơi và danh sách câu hỏi an toàn |
| `answerAttempt` | Học sinh → Giáo viên | `all` | Học sinh nộp đáp án thô (`questionId`, `answer`, `timeMs`) |
| `answerResult` | Giáo viên → Học sinh | `[playerId]` | Kết quả chấm điểm gửi riêng cho học sinh vừa nộp |
| `gameEnd` | Giáo viên → Học sinh | `all` | Báo kết thúc trò chơi và bảng vàng xếp hạng |
| `playerLeave` | Server/Client → Room | `all` | Thông báo học sinh rời phòng khi ngắt kết nối |

---

## 3. Báo cáo khắc phục các khuyến nghị bảo mật (Theo reports.html)

Dự án đã được rà soát và khắc phục triệt để theo báo cáo bảo mật `reports.html`:

| STT | Khuyến nghị trong báo cáo | Trạng thái | Giải pháp đã triển khai |
| :---: | :--- | :---: | :--- |
| **01** | XSS lưu trữ qua tên học sinh | **ĐÃ XỬ LÝ** | Sử dụng hàm `escapeHtml()` bọc toàn bộ các điểm render tên; Whitelist avatar hợp lệ; Cắt độ dài tên tối đa 20 ký tự ở tầng xử lý controller. |
| **02** | Lộ đáp án cho học sinh | **ĐÃ XỬ LÝ** | Đáp án (`correctOptionId`) chỉ nằm ở tab Giáo viên. Học sinh chỉ nhận bản câu hỏi an toàn đã loại bỏ hoàn toàn đáp án qua hàm `createLearnerPayload()`. |
| **03** | Trạng thái nằm trong localStorage | **ĐÃ XỬ LÝ** | Chuyển toàn bộ dữ liệu nhạy cảm của phòng sang `sessionStorage` riêng biệt của tab Giáo viên. |
| **04** | XSS từ nguồn nội dung câu hỏi | **ĐÃ XỬ LÝ** | Toàn bộ các thông tin ngân hàng câu hỏi, phiên bản, lỗi đọc dữ liệu trong `admin.html` đều được escape HTML trước khi đưa vào DOM. |
| **05** | URL nguồn nội dung không kiểm tra | **ĐÃ XỬ LÝ** | Trong `content-loader.js`: Bắt buộc giao thức HTTPS; Whitelist danh sách tên miền (`edupia.vn`, `google.com`...); Giới hạn kích thước phản hồi tối đa 1 MB; Timeout 10 giây qua `AbortController`. |
| **06** | Transport không xác thực người gửi | **ĐÃ XỬ LÝ** | Sinh `hostToken` ngẫu nhiên cho giáo viên khi tạo phòng; Đính kèm token vào mọi lệnh điều phối; Học sinh tự động từ chối các lệnh sai token. |
| **07** | Trang quản trị không có xác thực | **ĐÃ XỬ LÝ** | Đã tách riêng `admin.html`, gỡ bỏ mọi liên kết trên giao diện người dùng thường; Hướng dẫn IT thiết lập HTTP Basic Auth trên Nginx. |
| **08** | Thiếu CSP và sandbox cho iframe | **ĐÃ XỬ LÝ** | Thêm thẻ meta `Content-Security-Policy` vào tất cả các trang HTML; Thêm thuộc tính `sandbox="allow-scripts allow-same-origin"` cho `iframe` game. |
| **09** | Giới hạn dữ liệu ở phía giao diện | **ĐÃ XỬ LÝ** | Bổ sung giới hạn ở tầng dữ liệu: Tối đa 100 câu hỏi; Prompt tối đa 500 ký tự; Option tối đa 200 ký tự; Tên học sinh tối đa 20 ký tự; Thời gian làm bài kẹp trong khoảng [0, 300000ms]. |

---

## 4. Hướng dẫn Triển khai Production (Production Checklist)

1. **Cấu hình Nginx Reverse Proxy cho WebSocket**:
   ```nginx
   location /ws {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_read_timeout 3600s;
   }
   ```
2. **Bảo vệ trang `admin.html` bằng Basic Auth**:
   ```nginx
   location = /admin.html {
       auth_basic "Khu Vuc Quan Tri Edupia";
       auth_basic_user_file /etc/nginx/.htpasswd;
   }
   ```
3. **Chuyển quyền Authority lên Server (Tùy chọn nâng cao)**:
   Nếu muốn bảo mật tuyệt đối chống gian lận trong các kỳ thi lớn, đội IT có thể chuyển logic chấm điểm trong `room-controller.js` sang chạy trực tiếp trên WebSocket server Node.js.
