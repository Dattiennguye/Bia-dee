# 05 · Lộ trình phát triển & chi phí hạ tầng

## Lộ trình (P0–P9) — trạng thái
| Giai đoạn | Nội dung | Trạng thái |
|---|---|---|
| P0 | Kiến trúc + UX/UI | ✅ xong (tài liệu 01–04) |
| P1 | Bàn bida 3D + vật lý | ✅ xong, có test vật lý tự động |
| P2 | Bida 8 bi offline | ✅ xong (chơi với máy ngay trong app) |
| P3 | Backend + tạo phòng | ✅ xong |
| P4 | Multiplayer Internet 2 người | ✅ xong ở mức giao thức + test mạng thật (WebSocket). ⏳ Chưa thử trên 2 điện thoại thật khác mạng |
| P5 | Multiplayer 4 người | ✅ xong (solo 4 người 9 bi/Rotation, đội 2v2); ⏳ chưa thử 4 thiết bị thật |
| P6 | Giải đấu tự tạo | ✅ xong (4 thể thức, BO1/3/5, mã quản lý); ✅ test giải 4 người end-to-end |
| P7 | UX/UI, âm thanh, hiệu ứng | ✅ xong bản đầu; sẽ tinh chỉnh khi có phản hồi |
| P8 | Tối ưu & kiểm thử | 🔶 một phần: test tự động đầy đủ; ⏳ đo FPS trên máy thật |
| P9 | Build APK/PC + triển khai | 🔶 workflow + Docker đã viết; ⏳ chờ bạn bật GitHub Actions và triển khai máy chủ (xem tài liệu 06) |

## Chi phí hạ tầng (tham khảo — kiểm tra lại giá hiện hành)
| Hạng mục | Phương án miễn phí | Phương án ổn định |
|---|---|---|
| Máy chủ game | Render.com gói Free: **miễn phí**, nhưng ngủ sau ~15 phút không dùng (lần đầu vào chờ ~30–60 s) | VPS 1 vCPU/1 GB (~5–6 USD/tháng) hoặc Render gói trả phí (~7 USD/tháng) — luôn bật |
| Tên miền + HTTPS | Dùng tên miền miễn phí của Render (`xxx.onrender.com`, đã có HTTPS) | Tên miền riêng ~10–15 USD/năm; HTTPS qua Caddy miễn phí |
| GitHub + Actions | Miễn phí (repo công khai) | — |
| Build APK/PC | Miễn phí | — |
| Cơ sở dữ liệu | Không cần (lưu file JSON) | PostgreSQL khi cần lịch sử/xếp hạng |
| Google Play | Không cần để chơi thử (cài APK trực tiếp) | Phí đăng ký nhà phát triển một lần ~25 USD khi muốn lên cửa hàng |

**Ước tính cho MVP chơi với bạn bè: 0 đồng** (gói Free). Một phòng 2 người tốn rất ít tài nguyên (mỗi cú đánh ≈ vài chục KB), một VPS nhỏ phục vụ được hàng trăm phòng đồng thời.

## Việc nên làm tiếp (phiên bản sau)
Chế độ Party, tài khoản/hồ sơ, xếp hạng ELO, cửa hàng, bạn bè, bản đồ hạ tầng nhiều máy chủ (Redis), tinh chỉnh vật lý theo phản hồi người chơi, lên Google Play/App Store.
