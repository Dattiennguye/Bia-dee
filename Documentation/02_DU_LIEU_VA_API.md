# 02 · Mô hình dữ liệu & đặc tả API

## Mô hình dữ liệu (không cần tài khoản)
| Thực thể | Lưu ở đâu | Trường chính |
|---|---|---|
| **Session** | RAM máy chủ | `sessionId` (UUID bí mật, client giữ), `playerId` (id công khai), `name`, `roomCode`, `conn` |
| **Room** | RAM | `code` (5 ký tự), `config{mode, teamMode, maxPlayers, winsNeeded, tournament?}`, `players[]`, `hostId`, `frameWins[]`, `game` |
| **Game** | RAM | `balls[16]{id,x,y,pocketed}`, `RuleState{currentSeat, ballInHand, groups, scores, eliminated}` |
| **Tournament** | RAM + `data/tournaments.json` | `code` (6 ký tự), `name`, `size`, `format`, `gameMode`, `teamMode`, `bestOf`, `isPublic`, `status`, `adminHash` (SHA-256 của mã quản lý), `entries[]`, `matches[]`, `champion` |
| **TEntry** | trong Tournament | `id`, `name`, `memberIds[]`, `memberNames[]` |
| **TMatch** | trong Tournament | `id`, `round`, `bracket(W/L/GF/RR/GS/KO)`, `a`, `b`, `scoreA/B`, `winner`, `status`, `roomCode`, `bye` |

- Phòng/ván chỉ sống trong RAM (mất khi tắt máy chủ — đúng cho MVP). **Giải đấu được lưu ra file JSON** (ghi nguyên tử, debounce 0.5 s) để xem lại khi mở game.
- Mã quản lý giải (`adminToken`) chỉ trả **một lần** cho người tạo, máy chủ chỉ giữ hash; client lưu cục bộ.
- Lịch sử trận/PostgreSQL chưa cần ở MVP; khi cần có thể thêm bảng `matches(id, room_code, mode, started_at, winner_team, frames_json)` và `tournaments` tương ứng — các cấu trúc ở trên ánh xạ 1-1 sang bảng.

## Giao thức WebSocket (`wss://<máy chủ>/ws`)
Thông điệp JSON `{ "t": "<loại>", ... }`. Định nghĩa kiểu đầy đủ: `Shared/src/protocol.ts`.

### Client → Server
| `t` | Trường | Ghi chú |
|---|---|---|
| `auth` | `sessionId?`, `name?` | Bắt buộc đầu tiên; có `sessionId` cũ = kết nối lại |
| `ping` | `c` | Đo độ trễ/đồng hồ |
| `setName` | `name` | Tối đa 16 ký tự |
| `room.create` | `mode`, `teamMode`, `maxPlayers`, `bestOf?` | |
| `room.join` / `room.leave` / `room.addBot` / `room.start` | `code` (join) | Chủ phòng mới thêm bot / bắt đầu |
| `game.place` | `x`,`y` | Đặt bi cái khi được “bi trong tay” |
| `game.shot` | `shot{angle,power,spinX,spinY}`, `cue?` | Chỉ khi đến lượt |
| `game.aim` | `angle`,`power` | Phát hướng ngắm cho người khác xem |
| `game.sync` | | Xin trạng thái phòng |
| `tour.create/join/leave/watch/list/lock/start/forfeit/joinMatch` | xem protocol | `lock/start/forfeit` cần `adminToken` |

### Server → Client
`auth.ok`, `pong`, `error{code,message}`, `room.state`, `room.closed`, `game.start`, `game.shotResult`, `game.state`, `game.aim`, `game.over`, `player.status`, `tour.created`, `tour.state`, `tour.list`, `tour.matchRoom`.

`game.shotResult` mang: `shot`, `cueStart`, `tracks[16]` (quỹ đạo mm, cắt khi bi dừng), `frameCount`, `events[]`, `snapshot`, `foul`, `foulReason`.

### Mã lỗi thường gặp
`unauthenticated`, `room_not_found`, `join_failed` (đầy/đã bắt đầu), `bad_config`, `cannot_start`, `bad_shot` (sai lượt / dữ liệu hỏng / bi đang chạy), `bad_place`, `forbidden` (sai mã quản lý), `registration_closed`, `rate_limited`.

### Giới hạn & bảo mật
- Tối đa 16 KB/thông điệp, 40 thông điệp/giây/kết nối (burst 80).
- Tên được lọc ký tự điều khiển/`<>`; client luôn escape khi hiển thị.
- Giá trị `power/spin` bị kẹp về khoảng hợp lệ; `NaN/Infinity` bị từ chối.
- Hết giờ lượt (mặc định 60 s) = phạm lỗi, đổi lượt.

## REST
| Đường dẫn | Mô tả |
|---|---|
| `GET /health` | Tình trạng máy chủ |
| `GET /api/rooms/:code` | Phòng có tồn tại không, số người |
| `GET /api/tournaments` | Danh sách giải công khai |
| `GET /api/tournaments/:code` | Bảng đấu của một giải |
| `GET /invite/:code` | Đường dẫn mời → mở web game và tự vào phòng |
