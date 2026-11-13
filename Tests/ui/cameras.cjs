const { chromium } = require('playwright');
const S = (process.env.SHOTS || './shots/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000);
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('vigo.name', 'Thu'); localStorage.setItem('vigo.quality', 'medium'); });
  await p.goto((process.env.BASE || 'http://localhost:8099') + '/');
  await p.waitForFunction(() => window.__vigo && window.__vigo.net.status === 'online', null, { timeout: 40000 });
  await sleep(1800);
  await p.click('[data-act="quick"]');
  await p.waitForFunction(() => window.__vigo.screen === 'game', null, { timeout: 30000 });
  await sleep(4500);
  await p.click('#placebtn'); await sleep(200);
  // kéo chuột để ngắm
  await p.mouse.move(500, 300); await p.mouse.down(); await p.mouse.move(640, 280); await p.mouse.up();
  for (const cam of ['top', 'shoot', 'free']) {
    await p.click(`[data-cam="${cam}"]`); await sleep(2500);
    await p.screenshot({ path: S + `30_cam_${cam}.png` });
  }
  await p.click('[data-cam="cinema"]'); await sleep(500);
  await p.click('[data-cam="persp"]'); await sleep(1500);
  await p.click('#shootbtn'); await sleep(900);
  await p.click('[data-cam="cinema"]'); await sleep(1800);
  await p.screenshot({ path: S + '31_cinema_shot.png' });
  console.log('errors', p.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
