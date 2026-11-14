// Chụp ảnh bàn ở khung điện thoại ngang + đo số liệu dựng hình.
// Chạy: OUT=./shots W=844 H=390 Q=medium node Tests/ui/shots.cjs  (cần máy chủ ở BASE, mặc định http://localhost:8099)
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const W = +(process.env.W || 844), H = +(process.env.H || 390);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: +(process.env.DSF || 1), hasTouch: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') p.errs.push(m.text()); });
  await p.addInitScript((q) => { localStorage.setItem('vigo.name', 'Thu'); localStorage.setItem('vigo.quality', q); }, process.env.Q || 'medium');
  await p.goto((process.env.BASE || 'http://localhost:8099') + '/');
  await p.waitForFunction(() => window.__vigo && window.__vigo.net.status === 'online', null, { timeout: 60000 });
  await sleep(1500);
  await p.click('[data-act="quick"]');
  await p.waitForFunction(() => window.__vigo.screen === 'game', null, { timeout: 60000 });
  await sleep(4500);
  const S = process.env.OUT || './shots';
  for (const cam of (process.env.CAMS || 'top,persp,shoot').split(',')) {
    await p.evaluate((c) => { window.__vigo.scene.setCamMode(c); }, cam);
    await sleep(2500);
    await p.screenshot({ path: `${S}/t_${cam}.png` });
  }
  console.log(JSON.stringify(await p.evaluate(() => window.__vigo.scene.stats())), p.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
