// Chụp các màn hình menu ở khung điện thoại ngang để kiểm tra bố cục.
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const W = +(process.env.W || 844), H = +(process.env.H || 390);
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, hasTouch: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  await p.addInitScript(() => { localStorage.setItem('vigo.name', 'Thu'); localStorage.setItem('vigo.quality', 'low'); });
  await p.goto((process.env.BASE || 'http://localhost:8099') + '/');
  await p.waitForFunction(() => window.__vigo && window.__vigo.net.status === 'online', null, { timeout: 60000 });
  const S = process.env.OUT || './shots';
  for (const s of (process.env.SCREENS || 'main,create,join,settings,help,tcreate,tlist').split(',')) {
    await p.evaluate((x) => window.__vigo.go(x), s); await sleep(1200);
    await p.screenshot({ path: `${S}/m_${s}.png` });
    const over = await p.evaluate(() => { const u = document.querySelector('.screen'); return u ? { sh: u.scrollHeight, ch: u.clientHeight } : null; });
    console.log(s, JSON.stringify(over));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
