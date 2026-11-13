# 03 · Luồng kết nối Multiplayer

## Tạo / vào phòng
```mermaid
sequenceDiagram
  participant A as Người tạo
  participant S as Máy chủ
  participant B as Người vào
  A->>S: auth (name)
  S-->>A: auth.ok (sessionId, playerId)
  A->>S: room.create (mode, teamMode, maxPlayers)
  S-->>A: room.state (mã phòng ABCD2)
  B->>S: auth; room.join ABCD2 (hoặc mở /invite/ABCD2)
  S-->>A: room.state (2 người)
  S-->>B: room.state
  A->>S: room.start
  S-->>A: game.start
  S-->>B: game.start
```

## Một lượt đánh
```mermaid
sequenceDiagram
  participant P as Người đến lượt
  participant S as Máy chủ
  participant O as Người khác
  P->>O: (qua S) game.aim — thấy cơ xoay theo thời gian thực
  P->>S: game.shot {angle, power, spin}
  S->>S: kiểm lượt → mô phỏng → áp luật
  S-->>P: game.shotResult (tracks, events, snapshot, foul)
  S-->>O: game.shotResult (cùng dữ liệu)
  Note over P,O: Mọi máy phát lại cùng một quỹ đạo; xong thì đối chiếu snapshot
  S-->>P: (lượt kế) turnDeadline mới
```
Đồng hồ lượt chỉ chạy **sau khi hoạt ảnh kết thúc**; client dùng độ lệch đồng hồ (`ping/pong`) để hiển thị đếm ngược chính xác.

## Mất kết nối & khôi phục
1. Socket đóng → máy chủ đánh dấu `connected=false`, báo `player.status` cho phòng, **tạm dừng đồng hồ** nếu đang đến lượt người đó, bắt đầu **thời gian chờ** (mặc định 60 s).
2. Client tự thử lại (0,5 s → tối đa 8 s) và khi quay lại ứng dụng/có mạng sẽ kết nối ngay, gửi `auth` kèm `sessionId`.
3. Máy chủ nhận ra phiên cũ → gắn lại vào phòng → `auth.ok` kèm **toàn bộ trạng thái bàn** → client dựng lại đúng vị trí bi, lượt, điểm; đồng hồ chạy tiếp.
4. Quá hạn không quay lại → xử thua (2 người: đối thủ thắng; 3–4 người: ván kết thúc, tính cho đội còn lại).
5. Rời trận chủ động (`room.leave`) = xử thua ngay.

## Phòng của giải đấu
`tour.joinMatch` → máy chủ tạo phòng gắn `{giải, trận}`, xếp ghế theo đội của từng người (đội 0 = ghế chẵn, đội 1 = ghế lẻ) → **tự bắt đầu khi đủ người** → mỗi ván kết thúc cập nhật tỉ số giải, đủ số ván thì tiến vòng và đóng phòng sau 30 s.
