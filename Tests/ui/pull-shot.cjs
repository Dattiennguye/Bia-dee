// Kiểm tra cơ chế kéo cần lực → thả để đánh, và huỷ khi kéo về lại.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('vigo.name', 'Thu'); localStorage.setItem('vigo.quality', 'low'); });
  await p.goto((process.env.BASE || 'http://localhost:8099') + '/');
  await p.waitForFunction(() => window.__vigo && window.__vigo.net.status === 'online', null, { timeout: 60000 });
  await p.click('[data-act="quick"]');
  await p.waitForFunction(() => window.__vigo.screen === 'game', null, { timeout: 60000 });
  await sleep(4500);
  await sleep(100); await sleep(300);
  const box = await p.locator('#gtrack').boundingBox();
  const x = box.x + box.width / 2, y0 = box.y + 20;
  // 1) kéo 50% rồi kéo về lại -> huỷ
  await p.mouse.move(x, y0); await p.mouse.down(); await p.mouse.move(x, y0 + box.height * 0.4, { steps: 6 });
  const mid = await p.evaluate(() => window.__vigo.scene.aim.power);
  await p.mouse.move(x, y0, { steps: 6 }); await p.mouse.up(); await sleep(400);
  const playingAfterCancel = await p.evaluate(() => window.__vigo.scene.playing);
  // 2) kéo 55% rồi thả -> đánh
  await p.mouse.move(x, y0); await p.mouse.down(); await p.mouse.move(x, y0 + box.height * 0.45, { steps: 8 });
  const pw = await p.evaluate(() => window.__vigo.scene.aim.power);
  await p.mouse.up();
  await p.waitForFunction(() => window.__vigo.scene.playing, null, { timeout: 15000 });
  console.log(JSON.stringify({ pullMid: +mid.toFixed(2), playingAfterCancel, pullShot: +pw.toFixed(2), shotStarted: true, errs }));
  await browser.close();
  if (playingAfterCancel || mid < 0.2 || pw < 0.3 || errs.length) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
