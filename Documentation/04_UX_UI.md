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

## Cập nhật v1.1 — giao diện điều khiển kiểu game bi-a AAA
- **Đánh bằng kéo–thả**: cần lực ở mép phải; chạm vào, kéo xuống để lấy đà (cần trên bàn lùi theo), thả tay để đánh. Kéo về sát đỉnh rồi thả = huỷ. Không còn nút ĐÁNH (PC vẫn dùng Space/Enter).
- **Ngắm**: vuốt ngang trên bàn để xoay (chậm = tinh, nhanh = xoay nhiều); thanh tinh chỉnh ở giữa dưới; chuột PC vẫn trỏ trực tiếp.
- **Bố cục**: thẻ người chơi nghiêng + đồng hồ (trên trái), khay bi còn lại (giữa trên), góc nhìn/âm thanh (trên phải), menu + bản đồ mini (dưới trái), bi xoáy (dưới phải).
- **Màn hình khuyết/tai thỏ**: app vẽ toàn màn hình (`SHORT_EDGES`), ẩn thanh hệ thống, HUD tự chừa lề an toàn.
- **Đồ họa**: lỗ bàn thật (cắt hình học), khung gỗ có vân, viền đồng, bóng tiếp xúc, đường ngắm nét.
- **Hiệu năng**: ~64 draw call, ~29k tam giác; chế độ "Tự động" hạ/nâng độ phân giải để giữ 60–120 FPS, ưu tiên tần số quét cao nhất của máy.

## v1.3 — Bàn và không gian
- 6 bàn: Cổ điển, Hoàng gia (xanh), Nhung đỏ, Ngọc lục bảo (khung đen/đồng vàng), Cyber, Kẹo ngọt.
- 5 không gian: Lounge neon, Câu lạc bộ, Vũ trụ, Hoàng hôn biển, Đấu trường.
- Chọn ở Cài đặt hoặc menu tạm dừng khi đang chơi, xem trước ngay; lưu trên máy. Chỉ ảnh hưởng giao diện của riêng bạn.

## v1.4
- Góc nhìn: 3D đặt gần bàn hơn; **vuốt 2 ngón** (hoặc giữ chuột phải) để xoay/nghiêng trái-phải-lên-xuống, **chụm 2 ngón / lăn chuột** để zoom, nhấp đúp để về mặc định. Từ góc "trên xuống" vuốt sẽ tự chuyển sang 3D. Đèn trần tự ẩn khi camera ở trên cao nên không còn che bàn.
- Đồ họa sắc nét hơn: luôn bật khử răng cưa, texture nỉ/gỗ/bi độ phân giải cao hơn, bóng đổ nhẹ dưới chân băng.
- Nhạc nền đã tắt hoàn toàn (chờ file nhạc của người dùng). Chỉ còn tiếng hiệu ứng.

## v1.5 — Nhạc nền (6 bài do người dùng cung cấp, GameClient/public/music, nén 80 kbps)
- Menu/phòng chờ/giải đấu: "lovely garden", "play time fun" (xen kẽ).
- Đang chơi: "lofi gaming", "gaming" (Atlas Audio), "game music" (Sub Clair) — âm lượng chỉ 55% để không lấn tiếng bi.
- Màn hình kết quả: "gaming rock".
- Chuyển ngữ cảnh mờ dần ~1 giây, hết bài tự sang bài kế, tạm dừng khi thoát ra màn hình khác của điện thoại. Có thanh chỉnh nhạc nền trong Cài đặt; nút loa tắt/bật cả nhạc và hiệu ứng.

## v1.6 — Camera sau cơ, đèn, cửa hàng
- Camera còn 3 chế độ: Sau cơ (mặc định), Trên, Tự do. Đã bỏ Phim và 3D khỏi nút chọn.
- Sau cơ: vuốt lên/xuống/trái/phải để nhìn quanh; khi đánh camera giữ nguyên theo cơ, không bay sang góc khác. Giữ ngón ở mép để xoay ngắm liên tục.
- Đèn bàn: đèn chiếu (spot) chỉnh độ sáng + tông ấm/lạnh, 5 mức nhanh (Tối…Rất sáng), lưu `vigo.lamp`. Bóng mờ của cơ trên mặt bàn.
- Cửa hàng: 13 gậy, 12 avatar, 9 hiệu ứng đánh (màu đường ngắm + vệt bi cái). Chọn tự do, lưu trên máy, gửi cho đối thủ qua `setProfile`. Chưa có kinh tế xu/mở khoá.
- Emote: 10 biểu cảm, bong bóng cạnh avatar, giới hạn 1,2 giây/lần.
