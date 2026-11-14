// Kiểm tra góc nhìn: top (không bị chắn), persp gần hơn, vuốt xoay/nghiêng.
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
  const S = process.env.OUT || './shots';
  const snap = async (n) => { await p.evaluate(() => window.__vigo.scene.snapCamera()); await sleep(1200); await p.screenshot({ path: `${S}/v_${n}.png` }); };
  await p.evaluate(() => window.__vigo.scene.setCamMode('top')); await snap('top');
  await p.evaluate(() => window.__vigo.scene.setCamMode('persp')); await snap('persp');
  await p.evaluate(() => { const s = window.__vigo.scene; s.orbitView(-120, -60); s.zoomView(0.85); }); await snap('orbit');
  console.log('errors', errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
