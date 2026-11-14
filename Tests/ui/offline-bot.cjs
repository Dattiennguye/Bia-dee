const { chromium } = require('playwright');
const S = (process.env.SHOTS || './shots/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 900, height: 520 } });
  const p = await ctx.newPage(); p.setDefaultTimeout(30000);
  p.errs = []; p.on('pageerror', (e) => p.errs.push(e.message));
  await p.addInitScript(() => { localStorage.setItem('vigo.name', 'Offline'); localStorage.setItem('vigo.quality', 'low'); localStorage.setItem('vigo.server', 'ws://127.0.0.1:1'); });
  await p.goto((process.env.BASE || 'http://localhost:8099') + '/');
  await sleep(2500);
  console.log('net', await p.evaluate(() => window.__vigo.net.status));
  await p.click('[data-act="quick"]');
  await p.waitForFunction(() => window.__vigo.screen === 'game', null, { timeout: 30000 });
  await sleep(4500);
  await p.click('#placebtn'); await sleep(200);
  await p.evaluate(() => window.__vigo.act('shoot'));
  // chờ máy đánh và đến lượt mình lại
  await p.waitForFunction(() => { const g = window.__vigo.room && window.__vigo.room.game; return g && g.currentSeat === 0 && !window.__vigo.scene.playing && g.phase === 'playing' && !g.breakShot; }, null, { timeout: 90000, polling: 500 });
  const info = await p.evaluate(() => ({ seat: window.__vigo.room.game.currentSeat, msg: window.__vigo.room.game.message, remaining: window.__vigo.room.game.balls.filter((b) => !b.pocketed).length }));
  console.log('after bot turn', info);
  await p.screenshot({ path: S + '40_offline.png' });
  console.log('errors', p.errs);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
