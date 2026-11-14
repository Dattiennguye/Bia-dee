// Chụp từng cặp (bàn, không gian) để kiểm tra giao diện chủ đề.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.addInitScript(() => { localStorage.setItem('vigo.name', 'Thu'); localStorage.setItem('vigo.quality', 'low'); });
  await p.goto((process.env.BASE || 'http://localhost:8099') + '/');
  await p.waitForFunction(() => window.__vigo && window.__vigo.net.status === 'online', null, { timeout: 60000 });
  await p.click('[data-act="quick"]');
  await p.waitForFunction(() => window.__vigo.screen === 'game', null, { timeout: 60000 });
  await sleep(4500);
  const S = process.env.OUT || './shots';
  const pairs = [['classic', 'lounge'], ['royal', 'club'], ['crimson', 'space'], ['luxury', 'sunset'], ['cyber', 'arena'], ['candy', 'sunset']];
  for (const [t, e] of pairs) {
    await p.evaluate(([t, e]) => { window.__vigo.scene.setTable(t); window.__vigo.scene.setEnv(e); window.__vigo.scene.setCamMode('free'); }, [t, e]);
    await sleep(2500);
    await p.screenshot({ path: `${S}/th_${t}_${e}.png` });
  }
  console.log('errors', errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
