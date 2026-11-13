# 06 · Hướng dẫn triển khai từng bước (không cần biết lập trình)

Bạn cần 3 thứ: **(A) máy chủ game chạy trên Internet**, **(B) file APK**, **(C) gửi mã phòng cho bạn bè**.

## A. Đưa máy chủ lên Internet (miễn phí với Render)
1. Vào https://render.com → đăng ký bằng tài khoản GitHub.
2. Bấm **New → Blueprint** → chọn repo **Bia-dee** → **Apply**. (Render đọc file `render.yaml` và tự dựng máy chủ.)
3. Chờ vài phút đến khi trạng thái **Live**. Bạn nhận được địa chỉ dạng `https://vigo-billiards-party-xxxx.onrender.com`.
4. Mở địa chỉ đó trên máy tính/điện thoại: **game chạy ngay trên trình duyệt** (đây cũng là bản PC). Thêm `/health` phía sau để kiểm tra máy chủ.

> Gói Free của Render ngủ khi không ai chơi; lần đầu mở có thể chờ ~1 phút. Muốn luôn bật: dùng gói trả phí hoặc VPS (mục D).

## B. Tạo file APK để cài lên Android
1. Trên GitHub, vào repo → **Settings → Secrets and variables → Actions → tab Variables → New repository variable**.
   Tên: `SERVER_URL` — Giá trị: địa chỉ ở bước A (ví dụ `wss://vigo-billiards-party-xxxx.onrender.com`; viết `https://…` cũng được).
2. Vào tab **Actions → “Build Android APK” → Run workflow** (hoặc đẩy code mới lên nhánh `main`, workflow tự chạy).
3. Chờ khoảng 5–10 phút. Xong, vào **Releases → apk-latest** (cột phải của trang repo) → tải **VIGO-Billiards-Party.apk**. (Cũng có trong mục Artifacts của lần chạy.)
4. Chép APK vào điện thoại → mở file → cho phép “cài từ nguồn không xác định” → Cài đặt.
5. Mở game: nếu bạn quên đặt `SERVER_URL`, vào **Cài đặt → Máy chủ game** nhập địa chỉ rồi Lưu. Chơi với máy (offline) không cần máy chủ.

APK này ký bằng khoá debug nên cài được ngay để thử. Khi muốn đăng lên Google Play cần ký bằng khoá phát hành riêng (xem `Documentation/07_BAO_CAO_KIEM_THU.md`, mục “Việc còn lại”).

## Bản PC
- **Cách nhanh nhất:** mở địa chỉ máy chủ bằng Chrome/Edge (chơi bằng chuột, phím tắt như trong Hướng dẫn).
- **Bản cài riêng:** Actions → **Build PC (Windows / Linux)** → Run workflow → tải file `.exe` (portable) hoặc `.AppImage` ở Artifacts.

## Cách mời bạn bè
Người tạo phòng thấy **mã phòng 5 ký tự** → bạn bè mở game → **Tham gia phòng** → nhập mã. Hoặc bấm **Gửi lời mời** để gửi đường dẫn; mở đường dẫn sẽ vào web game và tự vào phòng.

## D. Tự thuê VPS (luôn bật, có tên miền riêng)
```bash
# Trên VPS Ubuntu có Docker; trỏ tên miền (bản ghi A) về IP VPS trước
git clone https://github.com/Dattiennguye/Bia-dee.git && cd Bia-dee
cp Deployment/.env.example Deployment/.env        # sửa DOMAIN=ten-mien-cua-ban.com
docker compose -f Deployment/docker-compose.yml --env-file Deployment/.env up -d --build
```
Caddy tự cấp HTTPS (wss). Dữ liệu giải đấu lưu ở volume `gamedata`.

## Biến môi trường máy chủ (`.env.example`)
`PORT`, `PUBLIC_URL`, `DATA_DIR` (để trống = chỉ RAM), `TURN_TIME_MS`, `RECONNECT_GRACE_MS`, `WEB_ROOT`, `BOT_DELAY_MS`.
**Không** đưa mật khẩu/khoá bí mật lên GitHub (`.env` đã nằm trong `.gitignore`; dự án hiện không dùng khoá bí mật nào).

## Chạy trên máy tính của bạn
```bash
npm ci && npm --prefix GameClient ci
npm run build:client && npm run build && npm start     # http://localhost:8080
```
