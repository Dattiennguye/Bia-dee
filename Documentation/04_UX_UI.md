# 04 · Thiết kế UX/UI — “Premium Casual Gaming”

## Phong cách
- Nền tím đêm + điểm nhấn **hồng neon, vàng, xanh ngọc**; nút “mọng” có chiều sâu, nhấn có hiệu ứng lún; tiêu đề chạy gradient.
- Menu đặt **trên nền bàn bida 3D đang xoay** (mờ nhẹ) thay vì nền tĩnh.
- Bàn: gỗ nâu, nỉ xanh, lỗ viền đồng, bi có số/sọc, đèn treo, các quả cầu màu lơ lửng cho cá tính vui nhộn.
- Design tokens ở đầu `GameClient/src/styles.css` (`--pink`, `--cyan`, `--gold`, `--violet`…).

## 15 màn hình theo đặc tả
| # | Màn hình | Hiện thực |
|---|---|---|
| 1 | Splash | logo + bi 9 nổi, bấm để bỏ qua |
| 2 | Main Menu | Chơi với máy / Tạo phòng / Tham gia / Giải đấu / Hướng dẫn / Cài đặt |
| 3 | Chọn chế độ chơi | thẻ 8 bi / 9 bi / Rotation / Party (sắp ra mắt) |
| 4 | Tạo phòng | số người, cá nhân/đội 2v2, BO1/3/5 |
| 5 | Tham gia phòng | ô nhập mã 5 ký tự (hoặc mở link mời) |
| 6 | Phòng chờ | mã phòng lớn, sao chép/chia sẻ lời mời, ghế người chơi, thêm máy, bắt đầu |
| 7 | Bàn bida 3D | HUD đầy đủ (bên dưới) |
| 8 | Kết quả trận | cúp, pháo giấy, bảng ván thắng, chơi lại/thoát |
| 9 | Tạo giải đấu | tên, số người, thể thức, chế độ, cá nhân/đội, BO, công khai/riêng tư |
| 10 | Danh sách giải | giải công khai + nhập mã giải riêng |
| 11 | Bảng đấu | nhánh thắng/thua, vòng bảng, knockout, xếp hạng, nhà vô địch |
| 12 | Phòng thi đấu giải | nút **Vào trận** trên thẻ trận; phòng tự bắt đầu |
| 13 | Cài đặt | biệt danh, nhạc, hiệu ứng, chất lượng đồ họa, địa chỉ máy chủ |
| 14 | Hướng dẫn | cách chơi, điều khiển, luật |
| 15 | Kết nối/lỗi mạng | banner trạng thái (đang kết nối / mất kết nối / ngoại tuyến / không có Internet) |

Trạng thái giao diện: Loading (vòng xoay), Empty (“Chưa có giải công khai”), Error (toast đỏ), Offline & Reconnect (banner), nút có hover/pressed/disabled.

## HUD trong trận (ưu tiên màn hình ngang, không che vùng chơi)
- Trên giữa: thẻ người chơi (lượt sáng viền vàng), nhóm bi / điểm, đồng hồ lượt.
- Trái: **thanh lực**. Phải trên: **quả bi trắng chọn điểm chạm/xoáy**. Dưới giữa: 5 nút camera. Phải dưới: nút **ĐÁNH**.
- Giữa dưới: thanh **tinh chỉnh** góc ngắm cho cảm ứng.

## Điều khiển
| | Điện thoại | PC |
|---|---|---|
| Ngắm | kéo ngón tay (xoay như vặn núm quanh bi cái) + thanh tinh chỉnh | trỏ chuột / nhấn giữ kéo |
| Lực | kéo thanh lực | kéo thanh lực hoặc ↑/↓ |
| Xoáy | chạm/kéo trên bi trắng, nhấp đúp = về giữa | như vậy |
| Đánh | nút ĐÁNH | nút ĐÁNH hoặc Space/Enter |
| Camera | nút 5 góc | phím 1–5, C |
| Tinh chỉnh | thanh trượt | ←/→ (Shift = bước lớn) |

Hỗ trợ ngắm: vạch trắng đường đi bi cái, “bi ma” tại điểm va chạm, vạch vàng hướng bi bị đánh; người khác thấy cơ của bạn xoay theo thời gian thực.

## Camera
Trên (top-down) · 3D (nghiêng, nhìn từ phía ghế của bạn) · Sau cơ · Tự do (kéo xoay, cuộn/chụm zoom) · **Phim** (cú quay mở đầu trận, bám theo cú đánh, cận cảnh khi bi vào lỗ, quỹ đạo vòng quanh bàn khi chiến thắng). Camera chỉ là hiển thị, không đổi tọa độ/kết quả.

## Tối ưu
Chất lượng thấp/trung bình/cao (độ phân giải, bóng đổ); menu hạn chế ~20 FPS và tạm dừng khi ẩn ứng dụng để tiết kiệm pin; hỗ trợ safe-area (tai thỏ), Full HD và nhiều tỉ lệ màn hình.
