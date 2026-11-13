# Kiểm thử giao diện bằng trình duyệt thật (Playwright + Chromium)

Các script này mở game trong Chromium (WebGL), thao tác như người chơi thật và chụp ảnh màn hình.

```bash
npm run build:client && npm run build        # build client + server
PORT=8099 DATA_DIR= WEB_ROOT=GameClient/dist node dist/server.js &
npm i -D playwright && npx playwright install chromium
BASE=http://localhost:8099 SHOTS=./shots/ node Tests/ui/two-players.cjs   # 2 người chơi qua mạng, đồng bộ bi
BASE=http://localhost:8099 SHOTS=./shots/ node Tests/ui/tournament.cjs    # tạo giải, đăng ký, vào trận, rời trận
BASE=http://localhost:8099 SHOTS=./shots/ node Tests/ui/offline-bot.cjs   # chơi với máy offline
BASE=http://localhost:8099 SHOTS=./shots/ node Tests/ui/cameras.cjs       # chụp 5 camera
```
