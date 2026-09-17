# Đập chuột — giao thức classroom.v1, bản bàn giao 2

Frontend public đã có WebSocket client, nối lại, khôi phục phiên và kiểm tra schema. Đội IT triển khai gateway theo hợp đồng dưới đây, cấu hình reverse proxy cùng origin rồi chạy bộ kiểm thử của mình. Không cần sửa UI hoặc SDK nếu giữ hợp đồng này. Chưa có backend production, SSO hoặc cơ sở dữ liệu của Edupia trong gói này.

## Các thư mục

- `dap-chuot-production/`: chỉ thư mục này được đưa lên web public. Không có bộ đáp án, trang admin local, Google Docs ID hoặc authority demo. `runtime-config.js` mặc định server.
- `dap-chuot-server-kit/`: mã chấm điểm thuần JS để tái sử dụng phía server, bộ câu hỏi mẫu có đáp án và hợp đồng này. Lưu ngoài web root.
- `dap-chuot/`: source/demo local, không đưa nguyên thư mục lên CDN.

Tạo lại hai gói bằng `node build-production.mjs` trong thư mục source. Nếu web cũ đã công khai content.json hoặc Google Docs có đáp án, IT cần gỡ bản cũ và thu hồi quyền public của nguồn bằng tài khoản chủ sở hữu. Việc thay frontend không thu hồi các bản đã được tải.

## Kết nối và danh tính

WebSocket cùng origin tại `/classroom/v1/socket`, subprotocol `classroom.v1`, dùng WSS khi HTTPS. IT reverse proxy path này đến server thực. Có thể đổi socketPath trong runtime-config.js; không dùng URL lấy từ query string/localStorage.

Trước khi mở trang, cổng Edupia phải xác thực tài khoản và tạo cookie `Secure; HttpOnly; SameSite=Lax` (hoặc Strict nếu luồng cho phép). WebSocket handshake kiểm tra chính xác Origin, cookie/session còn hiệu lực và quyền truy cập lớp. Frontend không gửi role, senderId, điểm hoặc quyền quản trị để server tin theo. Không đưa bearer token vào query URL. Trường sessionId bên dưới là mã khôi phục gắn với cookie/danh tính đã xác thực; không được dùng nó làm quyền truy cập độc lập.

TeacherRoom cũng là client: không chấm điểm, không điều khiển trạng thái các học sinh qua BroadcastChannel ở production. Trang giáo viên chỉ nhận dữ liệu được server cho phép theo membership. Trang quản trị thật ở dịch vụ riêng có phân quyền owner; không có trang admin public trong gói.

## Request/response

Client gửi đúng cấu trúc:

```json
{"v":1,"type":"request","requestId":"uuid","operation":"answerAttempt","roundId":"uuid","payload":{"questionId":"house-001","answer":"b","timeMs":1250}}
```

Server thành công:

```json
{"v":1,"type":"response","requestId":"uuid","ok":true,"payload":{"snapshot":{}}}
```

`snapshot: {}` ở ví dụ chỉ thể hiện vị trí trường, phải thay bằng snapshot đủ theo schema. Lỗi:

```json
{"v":1,"type":"response","requestId":"uuid","ok":false,"error":{"code":"FORBIDDEN","message":"Bạn không có quyền thực hiện thao tác này."}}
```

Server chủ động gửi `{"v":1,"type":"snapshot","payload":SNAPSHOT}` riêng theo connection. Không broadcast answer key hay toàn bộ teacher snapshot ra mọi socket rồi lọc ở client.

| operation | payload | Quyền và kết quả |
|---|---|---|
| createRoom | `{gameId:"dap-chuot-mcq"}`; roundId null | Giáo viên đã xác thực. Server sinh mã 6 ký tự A–Z/2–9 không trùng, playerId và sessionId; trả session result. |
| joinRoom | `{roomCode,name}`; roundId null | Học sinh đã xác thực/được cấp membership. Server lấy playerId từ principal, giới hạn tên 24 ký tự, tối đa 4 học sinh; trả session result. |
| resumeSession | `{roomCode,sessionId}`; roundId null | Server kiểm tra session thuộc principal/cookie và đúng phòng; không dùng role do client chọn. Trả session result hiện hành. |
| refreshContent | `{}` | Chỉ giáo viên của phòng. Server đọc nguồn đã được owner cấp, validate/hash. Trả `{bank}` có `schemaVersion,title,questions,contentVersion,fetchedAt`. |
| startRound | `{expectedContentVersion}` | Chỉ giáo viên của phòng. Server tải lại nguồn và so sánh version; nguồn lỗi hoặc thay đổi trả lỗi để giáo viên tải lại. Server tạo roundId và khóa snapshot bất biến rồi trả `{snapshot}`. Không chấp nhận questions/answer key từ client. |
| endRound | `{}` | Chỉ giáo viên; giữ câu đã chấm, chặn attempt đến muộn, broadcast summary. Trả `{snapshot}`. |
| prepareRound | `{}` | Chỉ giáo viên; chuyển ended → lobby, trả `{snapshot}`. |
| answerAttempt | `{questionId,answer,timeMs}` | Chỉ principal học sinh của phòng; chấm một lần theo khóa room/round/player/question, trả `{snapshot}` riêng của em đó. Không nhận score/isCorrect/delta/playerId. |
| advance | `{questionId}` | Chỉ học sinh; chỉ chuyển sau kết quả đã xác nhận, trả `{snapshot}`. |

Session result: `{roomCode,sessionId,playerId,snapshot}`. Sau resume, snapshot là của cùng vai trò được server xác thực. Giáo viên được nhận teacher snapshot; học sinh chỉ learner snapshot. ID dùng `[A-Za-z0-9_-]{1,100}`, loại `__proto__`, `constructor`, `prototype`. Revision tăng đơn điệu qua vòng mới; không reset revision khi roundId đổi.

## Schema snapshot và engine

`security.js` cung cấp `validSnapshot(snapshot, 'teacher'|'student')`, `validAttempt`, `validAdvance`, `validQuestion`, `validResult`. Đây là kiểm tra bổ sung phía frontend; server vẫn phải validate request độc lập.

`authority-core.js` không dùng DOM, localStorage hoặc BroadcastChannel. Server có thể import:

```js
import {createRoom, applyCommand, learnerSnapshot} from './authority-core.js';
const room = createRoom(roomCode, roundId);
applyCommand(room, authenticatedPrincipal, 'joinRoom', {name});
applyCommand(room, authenticatedPrincipal, 'startRound', {}, {bank:validatedBank, roundId:newRoundId});
applyCommand(room, authenticatedPrincipal, 'answerAttempt', payload, {roundId:request.roundId});
const studentPayload = learnerSnapshot(room, authenticatedPrincipal.playerId);
```

Engine mutates state in memory. IT must execute it within a room transaction/serialized room worker and persist committed state. `authenticatedPrincipal` is `{role,playerId}` produced by authentication/membership middleware, never copied from the request. The engine checks the role and rules, but cannot authenticate a cookie or know which teacher owns a room. Check ownership before calling it. Teacher snapshot is the full room state, sent only to the owning teacher. Learner snapshot contains only current prompt/options plus that student's confirmed results; it must never contain the full bank.

Server lưu requestId theo principal + operation trong transaction trước khi trả ACK; replay cùng requestId/cùng nội dung trả lại kết quả cũ, khác nội dung bị từ chối. Client gửi lại requestId đang chờ sau reconnect. Ngoài requestId, cần unique constraint cho room/round/player/question để chống bấm kép và restart. Không gửi success trước khi commit. Quá 15 giây client báo lỗi; yêu cầu có thể đã được server chấm nên resume phải trả snapshot đúng, không cho chấm lại.

## Nguồn nội dung và quyền

Nguồn Google Docs hiện tại và bộ 8 câu dự phòng nằm trong server-kit/content.json. IT chọn nguồn riêng tư, cấp quyền đọc tối thiểu cho danh tính server. Owner sửa tại nguồn; vòng mới tải/version/khóa snapshot một lần. Không đặt credentials hoặc URL đáp án public trong frontend. Server giữ whitelist nhà cung cấp, giới hạn redirect/host/IP để tránh SSRF, timeout và 1 MB trước khi parse, tối đa 100 câu. Tài liệu Google không theo schema cần adapter hoặc chuyển Google Sheets/JSON theo hợp đồng trước khi dùng.

## Giới hạn và nghiệm thu bắt buộc trên backend IT

Giới hạn WebSocket message 1 MB, request rate theo user/IP, phòng tối đa 4 học sinh; khóa theo membership, hết hạn session/phòng, ghi audit không chứa cookie/token. Chỉ cho HTTP GET static allowlist, không directory listing. Áp headers theo nginx.example.conf. Sandbox iframe cùng origin hạn chế popup/form/navigation nhưng không phải ranh giới cô lập mã JS độc hại; muốn cô lập mạnh, IT cần origin riêng và cấu hình handshake phù hợp.

Trước production: 1 giáo viên + 4 học sinh trên 5 profile/thiết bị; từ chối cookie thiếu/hết hạn, role giả, room khác, session của bạn khác; answer key không nằm trong learner request/response/assets; server restart giữ điểm, mất mạng/replay không cộng hai lần; nguồn đổi giữa vòng không đổi đáp án; CSP, XSS tên/nội dung và admin trái quyền; TLS/cookie/origin kiểm tra thật. Kiểm thử của gói dùng gateway giả cục bộ, không thay thế các bước này.
