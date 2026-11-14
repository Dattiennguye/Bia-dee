// Kiểm tra nhạc: menu -> vào trận đổi nhóm bài; không lỗi.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const p = await (await browser.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true })).newPage(); p.setDefaultTimeout(60000);
  const errs = [], reqs = []; p.on('pageerror', (e) => errs.push(e.message));
  p.on('response', (r) => { if (r.url().includes('/music/')) reqs.push(r.status() + ' ' + r.url().split('/music/')[1]); });
  await p.addInitScript(() => { localStorage.setItem('vigo.name', 'Thu'); localStorage.setItem('vigo.quality', 'low'); });
  await p.goto((process.env.BASE || 'http://localhost:8099') + '/');
  await p.waitForFunction(() => window.__vigo && window.__vigo.net.status === 'online');
  await p.mouse.click(2, 2); await sleep(2500);
  const menuReqs = reqs.slice();
  await p.click('[data-act="quick"]');
  await p.waitForFunction(() => window.__vigo.screen === 'game'); await sleep(3000);
  console.log(JSON.stringify({ menuReqs, all: reqs, errs }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
