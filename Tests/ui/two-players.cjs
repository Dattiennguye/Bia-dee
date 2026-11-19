const { chromium } = require('playwright');
const S = (process.env.SHOTS || './shots/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const mk = async (name, vp) => {
    const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.errs = [];
    p.on('pageerror', (e) => p.errs.push(e.message));
    await p.addInitScript((n) => { localStorage.setItem('vigo.name', n); }, name);
    await p.goto((process.env.BASE || 'http://localhost:8099') + '/');
    await p.waitForFunction(() => window.__vigo && window.__vigo.net.status === 'online', null, { timeout: 120000 });
    await sleep(1800);
    return p;
  };
  const A = await mk('Anh Ba', { width: 1280, height: 720 });
  const B = await mk('Chi Tu', { width: 844, height: 390 }); // điện thoại ngang
  // A tạo phòng 9 bi
  await A.click('[data-act="create"]');
  await A.click('[data-mode="nineball"]');
  await A.screenshot({ path: S + '10_create.png' });
  await A.click('[data-act="docreate"]');
  await sleep(600);
  const code = await A.evaluate(() => window.__vigo.room.code);
  console.log('room code', code);
  await B.click('[data-act="join"]');
  await B.fill('#code', code);
  await B.click('[data-act="dojoin"]');
  await sleep(800);
  await A.screenshot({ path: S + '11_lobby.png' });
  await A.click('[data-act="start"]');
  await sleep(4500);
  await A.screenshot({ path: S + '12_game_A.png' });
  await B.screenshot({ path: S + '13_game_B.png' });
  // A: kéo đặt bi (đã tự đặt), bấm xong đặt bi, ngắm, đánh
  await sleep(100);
  await sleep(300);
  await A.evaluate(() => window.__vigo.act('shoot'));
  await sleep(1500);
  await B.screenshot({ path: S + '14_shot_B_mid.png' });
  await A.screenshot({ path: S + '15_shot_A_mid.png' });
  await sleep(9000);
  const balls = async (p) => p.evaluate(() => JSON.stringify(window.__vigo.scene.currentBalls().map((b) => [b.id, Math.round(b.x * 1000), Math.round(b.y * 1000), b.pocketed])));
  const ba = await balls(A), bb = await balls(B);
  console.log('balls synced after shot:', ba === bb, ba.length);
  console.log('turn A,B:', await A.evaluate(() => window.__vigo.room.game.currentSeat), await B.evaluate(() => window.__vigo.room.game.message));
  await A.screenshot({ path: S + '16_after_A.png' });
  await B.screenshot({ path: S + '17_after_B.png' });
  console.log('errors', A.errs, B.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
