import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { startServer } from './server.js';

const env = process.env;
const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

const webRoot = env.WEB_ROOT ? resolve(env.WEB_ROOT) : existsSync(resolve('GameClient/dist')) ? resolve('GameClient/dist') : null;

const port = num(env.PORT, 8080);
const server = await startServer({
  port,
  webRoot,
  publicUrl: env.PUBLIC_URL ?? `http://localhost:${port}`,
  dataDir: env.DATA_DIR === undefined ? './data' : env.DATA_DIR || null,
  turnTimeMs: num(env.TURN_TIME_MS, 60000),
  graceMs: num(env.RECONNECT_GRACE_MS, 60000),
  botDelayMs: num(env.BOT_DELAY_MS, 1200),
  animScale: num(env.ANIM_SCALE, 1),
  nextFrameDelayMs: num(env.NEXT_FRAME_DELAY_MS, 4000),
});
console.log(`VIGO BILLIARDS PARTY server chạy tại cổng ${server.port}${webRoot ? ` (client: ${webRoot})` : ' (không có client web)'}`);

const stop = async () => {
  console.log('Đang tắt máy chủ...');
  await server.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
