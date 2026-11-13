# 🎱 VIGO BILLIARDS PARTY

Game bida 3D trực tuyến 2–4 người — không cần tài khoản, vào phòng bằng **mã phòng**.
Bản MVP 1.0 · Android + PC (trình duyệt/Electron) · Backend & Game Server thật.

| Thành phần | Thư mục | Công nghệ |
|---|---|---|
| Client 3D (Android APK, PC, web) | `GameClient/` | Three.js + TypeScript + Vite, đóng gói APK bằng Capacitor, PC bằng Electron |
| Game Server (vật lý + luật, có thẩm quyền) | `GameServer/` | TypeScript thuần |
| Backend (phòng, WebSocket, giải đấu, REST) | `Backend/` | Node.js + `ws` |
| Giao thức dùng chung | `Shared/` | TypeScript |
| Tài liệu | `Documentation/` | Markdown |
| Triển khai | `Deployment/`, `render.yaml` | Docker, Caddy (HTTPS) |
| Kiểm thử | `Tests/` | Vitest + Playwright |
| CI/CD | `.github/workflows/` | GitHub Actions |

> **Thay đổi công nghệ so với đặc tả (đã báo cáo):** client dùng **Three.js** thay vì Unity. Lý do và lợi ích: xem [Documentation/01_KIEN_TRUC.md](Documentation/01_KIEN_TRUC.md#quyết-định-đổi-unity--threejs).

## Chơi thử ngay (1 phút)

```bash
npm ci && npm --prefix GameClient ci
npm run build:client && npm run build
npm start            # mở http://localhost:8080
```

Mở `http://localhost:8080` bằng 2 tab/2 máy → một người **Tạo phòng**, người kia **Tham gia phòng** bằng mã. Hoặc bấm **Chơi với máy (offline)**.

## Tải APK
Sau khi đẩy code lên GitHub, workflow **Build Android APK** tự chạy. File `VIGO-Billiards-Party.apk` xuất hiện ở mục **Releases → “apk-latest”**.
Hướng dẫn chi tiết từng bước: [Documentation/06_HUONG_DAN_TRIEN_KHAI.md](Documentation/06_HUONG_DAN_TRIEN_KHAI.md).

## Lệnh thường dùng
| Lệnh | Việc |
|---|---|
| `npm test` | Chạy 77 bài test (vật lý, luật, giải đấu, mạng thật qua WebSocket) |
| `npm run typecheck` | Kiểm tra kiểu |
| `npm run dev` | Chạy server chế độ phát triển |
| `npm --prefix GameClient run dev` | Client chế độ phát triển (cổng 5173, proxy sang 8080) |

## Tính năng
- Bida **8 bi**, **9 bi**, **Rotation 61**; 2–4 người cùng một bàn; **Cá nhân** hoặc **Đội 2v2**; BO1/BO3/BO5.
- Vật lý bida riêng (lăn/trượt, xoáy tiến-lùi-ngang, va chạm bi-bi và băng, lỗ), mô phỏng tất định trên máy chủ.
- Phòng bằng mã + đường dẫn mời; phòng chờ; nickname tạm; thêm máy (bot).
- Mất mạng → tự kết nối lại và khôi phục đúng bàn; hết giờ lượt → đổi lượt; không quay lại → xử thua.
- Giải đấu tự tạo: 4/8/16/32; Single/Double Elimination, Round Robin, Bảng + Knockout; BO1/3/5; công khai/riêng tư; mã quản lý.
- Camera: Trên, 3D, Sau cơ, Tự do, Phim (tự động). Âm thanh tạo bằng WebAudio (không vướng bản quyền).

## Giới hạn hiện tại (nói thẳng)
Xem [Documentation/07_BAO_CAO_KIEM_THU.md](Documentation/07_BAO_CAO_KIEM_THU.md): chưa kiểm thử trên nhiều điện thoại thật khác mạng; chế độ **Party**, đăng nhập, cửa hàng… đúng đặc tả là để phiên bản sau.
