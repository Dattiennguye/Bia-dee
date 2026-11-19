# 07 · Báo cáo kiểm thử & tình trạng nghiệm thu

*Nguyên tắc: không tuyên bố hoàn thành khi chưa kiểm thử. Bảng dưới ghi rõ cái gì đã chạy thật, cái gì chưa.*

## 1. Đã kiểm thử tự động (chạy bằng `npm test`) — 77/77 đạt
| Nhóm | Số test | Nội dung |
|---|---|---|
| Vật lý & xếp bi | 14 | tất định; bi dừng, ở trong bàn; lăn/dừng; **xoáy lùi/tiến** đúng chiều; xoáy ngang đổi hướng sau băng; bi vào lỗ góc; bi cái rơi lỗ; xếp bi không chồng cho 8/9 bi/Rotation |
| Luật chơi | 27 | cấu hình hợp lệ; 8 bi (gán nhóm, chạm sai, bi 8 sớm/đúng/kèm lỗi, phá bi); 9 bi (chạm bi nhỏ nhất, thắng, đặt lại bi 9); Rotation (điểm, phạt, 61 điểm); từ chối đánh sai lượt/dữ liệu hỏng; hết giờ; rời trận; **bot chơi trọn ván ở 6 cấu hình** (2/3/4 người, solo/đội) với kiểm tra bất biến sau mỗi cú đánh |
| Giải đấu | 26 | Single (2–32 người, BYE), Double (có chung kết phụ), Round Robin, Bảng+Knockout (4/8/16/32); mỗi người chỉ thua đúng số lần quy định; BO3; xử thua; không lộ mã quản lý |
| Mạng thật (WebSocket) | 10 | auth/ping; tạo phòng, nhập mã, phòng đầy, sai mã; **2 người chơi trọn trận, cả hai nhận cùng kết quả**; chơi với bot; **4 người đội 2v2 trọn trận, bi đồng bộ**; Rotation 3 người; **mất mạng rồi kết nối lại khôi phục đúng bàn**; không quay lại → xử thua; **giải 4 người từ đăng ký → chia nhánh → hai vòng → vô địch**, sai mã quản lý bị chặn |

## 2. Đã kiểm thử bằng trình duyệt thật (Chromium + WebGL, Playwright)
- Hai trình duyệt (một cỡ màn hình điện thoại ngang): tạo phòng → nhập mã → vào phòng chờ → bắt đầu → đánh → **bi hai bên giống nhau từng toạ độ**.
- Giải đấu qua giao diện: tạo giải, đăng ký, bắt đầu, “Vào trận”, rời trận → đối thủ nhận màn hình kết quả, quay về bảng đấu.
- Chơi với máy **không có máy chủ**: mình đánh, máy đánh lại, luật hoạt động.
- Chụp và xem lại: menu, tạo phòng, phòng chờ, bàn 3D ở các camera Trên/3D/Sau cơ/Tự do/Phim, bảng đấu, kết quả.
- Không có lỗi JavaScript trong các phiên kiểm thử.

Script: `Tests/ui/` (hướng dẫn chạy trong `Tests/ui/README.md`).

## 3. Chưa kiểm thử được trong môi trường phát triển (nói thẳng)
| Hạng mục | Vì sao | Cách nghiệm thu |
|---|---|---|
| Build APK / cài trên điện thoại | môi trường không tải được Android SDK; APK được dựng bởi GitHub Actions | chạy workflow *Build Android APK*, cài APK lên điện thoại |
| 2 điện thoại thật, 2 mạng Internet khác nhau; 4 thiết bị; Android ↔ PC | cần thiết bị/mạng thật của bạn | làm theo Bài kiểm thử 1–3 trong đặc tả, dùng máy chủ ở tài liệu 06 |
| FPS 60/90/120 trên máy thật | cần máy thật (trình duyệt kiểm thử dùng giả lập GPU phần mềm) | bật chất lượng Thấp/TB/Cao, xem độ mượt |
| Bản PC đóng gói Electron | chỉ build được trên máy Windows/Linux runner của GitHub | chạy workflow *Build PC* |
| Tải/độ trễ cao ngoài thực tế | chưa có máy chủ công khai | chơi thử khi đã triển khai |
| Mạng yếu (tắt/bật mạng giữa trận) | đã test bằng cách ngắt/khôi phục kết nối ở mức giao thức; chưa test trên 4G thật | thử thực tế: bật chế độ máy bay vài giây rồi tắt |

## 4. Đối chiếu “Tiêu chuẩn hoàn thành” của đặc tả
| Tiêu chuẩn | Tình trạng |
|---|---|
| Game cài đặt được | ⏳ APK do Actions dựng — cần bạn chạy workflow và cài thử |
| Backend chạy thực tế | ✅ (đã chạy server thật, bundle `dist/server.js`, Docker file viết sẵn nhưng **chưa chạy thử Docker**) |
| Tạo phòng / tham gia bằng mã | ✅ |
| Hai người khác mạng chơi được | ⏳ giao thức đã test; cần thử trên 2 mạng thật |
| Bốn người cùng bàn | ✅ test mạng thật (4 kết nối); ⏳ 4 thiết bị thật |
| Android ↔ PC | ⏳ cùng giao thức; cần thử thật |
| Vật lý / luật hoạt động | ✅ |
| Giải đấu chạy được | ✅ |
| Không còn lỗi nghiêm trọng | Không có lỗi đã biết ở các luồng đã test; cần thử thiết bị thật để phát hiện thêm |

## 5. Hạn chế thiết kế đã biết
- Luật đơn giản hoá: không “gọi lỗ”; xử lý lỗi theo bảng ở `GameServer/src/rules.ts` (đối thủ được đặt bi cái tự do). Luật 8 bi cho 4 người dùng **đội 2v2** (8 bi cá nhân chỉ 2 người) — đây là luật riêng cho bàn 4 người, đã ghi trong giao diện.
- Phòng đang chơi mất khi máy chủ khởi động lại (giải đấu thì được lưu).
- Gói Render Free ngủ khi nhàn rỗi.
- APK ký bằng khoá debug (đủ để cài thử; lên Google Play cần khoá phát hành).
- Chế độ **Party** để phiên bản sau, đúng đặc tả.

## 6. Việc còn lại để “đóng” MVP
1. Bật GitHub Actions, đặt biến `SERVER_URL`, chạy *Build Android APK*.
2. Triển khai máy chủ (tài liệu 06, mục A).
3. Thực hiện 5 bài kiểm thử nghiệm thu trên thiết bị thật và báo lại lỗi (nếu có) để sửa tiếp.

## Bổ sung v1.1
- 77 test tự động (vitest) đạt; `tsc` sạch; Tests/ui/pull-shot.cjs (kéo 50% rồi về = huỷ; kéo 56% rồi thả = đánh) đạt; two-players đạt, không lỗi JS.
- **Chưa thể kiểm chứng trong sandbox**: FPS thật trên điện thoại (sandbox chỉ có dựng hình phần mềm), hiển thị tai thỏ thật, bước Gradle của APK. Cần thử trên máy thật.

## Bổ sung v1.2
- Vật lý: ma sát lăn 0.035→0.012 (bi 1 m/s lăn ~4 m, sát thực tế), đường cong lực v = 8.5·p^1.7, thêm "răng lỗ" (mũi băng bao miệng lỗ làm bi nảy) và miệng lỗ mở thật; bot dùng đường cong lực mới. 80 test đạt.
- Âm thanh: dùng mẫu thật từ file người dùng cung cấp (phá bi, đánh bi, rơi lỗ) trong GameClient/public/sfx.
- UI: menu thu nhỏ theo chiều cao màn hình (zoom), thông báo nhỏ/tự mờ, bỏ nút "Đặt bi cái" (chạm vào bi cái để đặt lại), bộ icon SVG, góc nhìn "Sau cơ" thấp hơn và tự lùi lên cao khi bi lăn.

## v1.6
- `npm test` 80/80, `npm run typecheck` sạch, vite build OK. Playwright (swiftshader): cửa hàng, emote (cả phản ứng của máy), đèn tối/chuẩn/sáng, nhìn từ trên, cú đánh với vệt hiệu ứng — không lỗi JS.
- Chưa kiểm chứng: FPS thật trên điện thoại, hiển thị vệt hiệu ứng trên GPU thật, build Gradle.

## v1.7 — Vật lý chân thực hơn
- Bước con thích ứng theo tốc độ (≤1,5 mm/bước): điểm chạm bi-bi chính xác kể cả khi phá bi 8,5 m/s (trước đây lệch tới ~1,8 cm).
- Băng mô hình xung lượng 3D: điểm chạm cao hơn tâm 0,27R (băng 63,5% đường kính), ma sát băng + ma sát nỉ => xoáy tiến/lùi/ngang đổi góc và tốc độ bật.
- Ma sát bi-bi phụ thuộc tốc độ trượt (throw ~3° khi đánh nhẹ, ~0° khi đánh mạnh). Đánh lệch tâm mất lực và squirt nhẹ.
- Client: nội suy Hermite bậc 3 quỹ đạo (giữ đoạn thẳng tại điểm gãy).
- Test: 82/82 (thêm: góc cắt/throw theo tốc độ, tốc độ bật băng và khác biệt xoáy tiến/lùi). Test draw/follow đo ngay sau va chạm thay vì vị trí dừng (kết quả cuối hỗn loạn do bi dội lại).
- Chưa kiểm chứng: cảm giác thật trên điện thoại; các hệ số (e băng, μ băng 0,2, muRoll 0,012) là giá trị tham khảo từ tài liệu, có thể cần tinh chỉnh theo phản hồi.

## v1.9 — Bộ tiêu chí nghiệm thu tự động (QA spec)
Hai tệp: `Tests/qa-spec.json` (ngưỡng) và `Tests/ui/qa.cjs` (chạy đo, in ĐẠT / KHÔNG ĐẠT). Chạy: `npm run qa` (cần server đang chạy ở `BASE`, mặc định `http://localhost:8099`).

| Nhóm | Tiêu chí (ngưỡng) |
|---|---|
| Build | Dung lượng JS ≤ 820 KB |
| Hiệu năng dựng hình | Draw calls ≤ 120/140/170 (thấp/vừa/cao); tam giác ≤ 250k/300k/400k; geometry ≤ 260; texture ≤ 90 và ≤ 160 MB (ước lượng); CPU JS mỗi khung ≤ 4 ms (không tính lệnh vẽ) |
| Đồ họa | 11 bàn đều lên hình; độ sáng nỉ 30–200; ảnh không phẳng/trống (độ lệch chuẩn ≥ 12); hai bàn bất kỳ khác nhau về màu ≥ 12 |
| Hoạt ảnh | Tốc độ camera tối đa ≤ 12 m/s (camera bám bi cái nên có thể nhanh ngang bi khi phá bi; ngưỡng cũ 8 m/s hay trượt do ván ngẫu nhiên); tốc độ bi 0,3–14 m/s (đo theo thời gian mô phỏng, không phụ thuộc FPS máy test); tua nhanh đạt ≥ 2,5× (đo thực 4,0×); chấm xoáy về tâm sau mỗi lượt bắn |
| Giao diện | 4 cỡ màn hình ngang (844×390, 667×375, 932×430, 740×360): nút ≥ 32 px, chữ ≥ 10 px, không chồng nhau, không tràn, không cuộn ngang; lượt máy: nút tua hiện và bi chọn xoáy ẩn |
| Ổn định | 0 lỗi JavaScript; chuyển menu thường không dựng lại cảnh; thoát Giao diện/Cửa hàng khôi phục camera phim; heap JS tăng ≤ 40 MB sau một lượt |

Lỗi tìm thấy và sửa nhờ bộ này:
- Thoát màn Giao diện/Cửa hàng về menu: camera nền kẹt ở góc nhìn xem bàn, hết hoạt cảnh nền (do tối ưu chuyển menu ở v1.8 bỏ qua việc khôi phục). Đã sửa, có test hồi quy.
- Nút Tua nhanh/Bỏ qua trùng vị trí bi chọn xoáy ở góc phải dưới: không cùng hiện (bi xoáy ẩn ở lượt máy), nhưng đã thêm kiểm tra bất biến này.
- Phép đo tua nhanh/tốc độ ban đầu phụ thuộc FPS (sandbox dựng hình phần mềm ~1 FPS) nên sai; đã đổi sang đo theo thời gian mô phỏng.

Giới hạn: FPS, nhiệt độ, RAM thật trên điện thoại vẫn chưa đo được trong sandbox; các ngưỡng draw calls/tam giác/texture là ngân sách tự đặt, không phải số đo trên máy thật.
