// Bộ kiểm thử nghiệm thu VIGO: đo theo Tests/qa-spec.json, in bảng ĐẠT / KHÔNG ĐẠT.
// Chạy: BASE=http://localhost:8099 OUT=./shots/qa node Tests/ui/qa.cjs [low|medium|high ...]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, '../qa-spec.json'), 'utf8'));
const BASE = process.env.BASE || 'http://localhost:8099';
const OUT = process.env.OUT || path.join(__dirname, '../../shots/qa');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qualities = process.argv.slice(2).length ? process.argv.slice(2) : ['low', 'medium', 'high'];
const results = [];
const check = (group, name, value, ok, limit) => { results.push({ group, name, value, ok, limit }); };
const TABLES = ['classic', 'royal', 'crimson', 'luxury', 'cyber', 'candy', 'snooker', 'walnut', 'ocean', 'violet', 'oak'];

async function openGame(browser, q, vp) {
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: true });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  p.errs = [];
  p.on('pageerror', (e) => p.errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/WebSocket|ERR_UNSAFE_PORT|favicon/.test(m.text())) p.errs.push(m.text().slice(0, 140)); });
  await p.addInitScript((q) => { localStorage.setItem('vigo.name', 'QA'); localStorage.setItem('vigo.quality', q); localStorage.setItem('vigo.server', 'ws://127.0.0.1:1'); }, q);
  await p.goto(BASE + '/'); await sleep(2500);
  return { ctx, p };
}
async function startGame(p) {
  await p.click('[data-act="quick"]');
  await p.waitForFunction(() => window.__vigo.screen === 'game', null, { timeout: 60000 });
  await sleep(4000);
}
const meanColor = (p, file) => p.evaluate(async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0);
  const w = img.width, h = img.height; const d = x.getImageData(w * 0.3, h * 0.3, w * 0.4, h * 0.4).data;
  let r = 0, g = 0, b = 0, n = 0, s2 = 0; for (let i = 0; i < d.length; i += 16) { r += d[i]; g += d[i + 1]; b += d[i + 2]; const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; s2 += l * l; n++; }
  r /= n; g /= n; b /= n; const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; return { r, g, b, lum, sd: Math.sqrt(Math.max(0, s2 / n - lum * lum)) };
}, fs.readFileSync(file).toString('base64'));

(async () => {
  // ---- Build
  const dist = path.join(__dirname, '../../GameClient/dist/assets');
  const js = fs.readdirSync(dist).filter((f) => f.endsWith('.js')).map((f) => fs.statSync(path.join(dist, f)).size).reduce((a, b) => a + b, 0) / 1024;
  check('Build', 'Dung lượng JS (KB)', Math.round(js), js <= spec.build.bundleKB_max, '≤ ' + spec.build.bundleKB_max);

  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const q of qualities) {
    const { ctx, p } = await openGame(browser, q, [844, 390]);
    // ---- Menu: điều hướng không dựng lại cảnh
    await p.evaluate(() => { let n = 0; const sc = window.__vigo.scene; const o = sc.setBalls.bind(sc); sc.setBalls = (...a) => { n++; return o(...a); }; window.__cnt = () => n; });
    for (const a of ['settings', 'main', 'help', 'main', 'tlist', 'main', 'join', 'main']) { await p.evaluate((a) => window.__vigo.go(a), a); await sleep(150); }
    if (q === qualities[0]) { const n = await p.evaluate(() => window.__cnt()); check('Ổn định', 'Dựng lại cảnh khi chuyển 8 màn menu thường', n, n <= spec.stability.menuNavSetBalls_max, '≤ ' + spec.stability.menuNavSetBalls_max); }
    // quay về từ Giao diện/Cửa hàng phải khôi phục camera phim
    for (const a of ['themes', 'main', 'shop', 'main']) { await p.evaluate((a) => window.__vigo.go(a), a); await sleep(200); }
    if (q === qualities[0]) { const cm = await p.evaluate(() => window.__vigo.scene.camMode); check('Ổn định', 'Camera nền menu sau khi thoát Giao diện/Cửa hàng', cm, cm === 'cinema', 'cinema'); }
    await startGame(p);
    const heap0 = await p.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0));
    // ---- Render budget
    const rb = await p.evaluate(() => {
      const sc = window.__vigo.scene; const info = sc.renderer.info; const seen = new Set(); let bytes = 0;
      sc.scene.traverse((o) => { const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; for (const m of ms) for (const k in m) { const t = m[k]; if (t && t.isTexture && !seen.has(t.uuid)) { seen.add(t.uuid); const im = t.image; if (im && im.width) bytes += im.width * im.height * 4 * (t.generateMipmaps ? 1.33 : 1); } } });
      const s = sc.stats();
      return { calls: s.calls, tris: s.triangles, geo: info.memory.geometries, tex: info.memory.textures, texMB: bytes / 1048576 };
    });
    check(q, 'Draw calls', rb.calls, rb.calls <= spec.render.drawCalls_max[q], '≤ ' + spec.render.drawCalls_max[q]);
    check(q, 'Tam giác', rb.tris, rb.tris <= spec.render.triangles_max[q], '≤ ' + spec.render.triangles_max[q]);
    check(q, 'Geometry', rb.geo, rb.geo <= spec.render.geometries_max, '≤ ' + spec.render.geometries_max);
    check(q, 'Texture (số)', rb.tex, rb.tex <= spec.render.textures_max, '≤ ' + spec.render.textures_max);
    check(q, 'Texture (MB, ước lượng)', +rb.texMB.toFixed(1), rb.texMB <= spec.render.textureMB_max, '≤ ' + spec.render.textureMB_max);

    // ---- CPU JS mỗi khung hình (không tính lệnh vẽ)
    const js2 = await p.evaluate(async () => {
      const sc = window.__vigo.scene; const r0 = sc.renderer.render.bind(sc.renderer); let tr = 0; sc.renderer.render = (...a) => { const t = performance.now(); r0(...a); tr += performance.now() - t; };
      const f0 = sc.frame.bind(sc); let tf = 0, n = 0; sc.frame = (ts) => { const t = performance.now(); f0(ts); tf += performance.now() - t; n++; };
      await new Promise((r) => setTimeout(r, 5000)); sc.renderer.render = r0; sc.frame = f0;
      return { n, js: n ? (tf - tr) / n : 0 };
    });
    check(q, 'CPU JS mỗi khung (ms, không tính vẽ)', +js2.js.toFixed(2), js2.n > 0 && js2.js <= spec.render.jsFrameMs_max, '≤ ' + spec.render.jsFrameMs_max + ' (' + js2.n + ' khung)');
    // ---- Đồ họa: 11 bàn, camera trên xuống
    const colors = {};
    const list = q === 'medium' ? TABLES : ['classic', 'snooker'];
    for (const t of list) {
      await p.evaluate((t) => { const sc = window.__vigo.scene; sc.setTable(t); sc.setCamMode('top'); sc.snapCamera(); }, t);
      await sleep(900);
      const f = path.join(OUT, `${q}_${t}.png`); await p.screenshot({ path: f });
      colors[t] = await meanColor(p, f);
      const c = colors[t];
      check('Đồ họa/' + q, `Bàn ${t}: độ sáng nỉ`, Math.round(c.lum), c.lum >= spec.graphics.feltBrightness[0] && c.lum <= spec.graphics.feltBrightness[1], spec.graphics.feltBrightness.join('–'));
      check('Đồ họa/' + q, `Bàn ${t}: không trống/phẳng (độ lệch chuẩn)`, Math.round(c.sd), c.sd >= spec.graphics.frameNotBlankStdDev_min, '≥ ' + spec.graphics.frameNotBlankStdDev_min);
    }
    if (q === 'medium') {
      let minD = 1e9, pair = '';
      for (let i = 0; i < TABLES.length; i++) for (let j = i + 1; j < TABLES.length; j++) { const a = colors[TABLES[i]], b = colors[TABLES[j]]; const d = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b); if (d < minD) { minD = d; pair = TABLES[i] + '/' + TABLES[j]; } }
      check('Đồ họa', 'Hai bàn giống nhau nhất (khoảng cách màu) ' + pair, Math.round(minD), minD >= spec.graphics.tablesDistinct_minColorDelta, '≥ ' + spec.graphics.tablesDistinct_minColorDelta);
    }
    await p.evaluate(() => { const sc = window.__vigo.scene; sc.setTable('classic'); sc.setCamMode('shoot'); });

    // ---- Hoạt ảnh: lượt của mình -> spin reset -> lượt máy, đo tốc độ camera/bi, tua nhanh
    const box = await p.evaluate(() => { const r = document.querySelector('#spinball').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    await p.mouse.click(box.x + box.w * 0.7, box.y + box.h * 0.3); await sleep(200);
    await p.evaluate(() => {
      // đo theo thời gian mô phỏng (không phụ thuộc FPS của máy chạy test)
      const sc = window.__vigo.scene; const W = { cam: 0, ball: 0, ffClock: 0, ffRt: 0, calls: 0 };
      window.__W = W;
      const pos = () => sc.balls.map((b) => [b.mesh.position.x, b.mesh.position.z, b.mesh.visible]);
      // quy về 60 FPS: chia mỗi lần cập nhật camera thành các bước 1/60 s (máy test dựng hình chậm nên dt thật bị kéo giãn)
      const uc = sc.updateCamera.bind(sc);
      sc.updateCamera = (dt, now) => { const n = Math.max(1, Math.round(Math.min(dt, 0.1) * 60)); for (let k = 0; k < n; k++) { const a = sc.camera.position.clone(); uc(1 / 60, now); const v = sc.camera.position.distanceTo(a) * 60; if (v > W.cam) { W.cam = v; W.camInfo = { mode: sc.camMode, y: +sc.camera.position.y.toFixed(2) }; } } W.calls++; };
      const up = sc.updatePlayback.bind(sc);
      sc.updatePlayback = (now) => {
        const p0 = sc.play, c0 = p0 ? p0.clock : 0, r0 = p0 ? p0.lastRt : 0, b0 = pos();
        up(now);
        const p1 = sc.play; if (p0 && p1 === p0) {
          const dc = p1.clock - c0, dr = p1.lastRt - r0;
          if (dc > 0.001) { const b1 = pos(); for (let i = 0; i < b0.length; i++) if (b0[i][2] && b1[i][2]) { const d = Math.hypot(b1[i][0] - b0[i][0], b1[i][1] - b0[i][1]) / dc; if (d < 40) W.ball = Math.max(W.ball, d); } }
          if (sc.playSpeed > 1 && r0 > 0 && dr > 0.001) { W.ffClock += dc; W.ffRt += dr; }
        }
      };
      sc.aim.power = 0.55; sc.aim.angle = 0;
      window.__vigo.act('shoot');
    });
    await sleep(600);
    const sp = await p.evaluate(() => { const s = window.__vigo.scene.spin; return [s.x, s.y]; });
    if (q === qualities[0]) check('Hoạt ảnh', 'Điểm chấm đỏ tự về tâm sau khi bắn', sp.join(','), sp[0] === 0 && sp[1] === 0, '0,0');
    // chờ lượt máy, đo tua nhanh
    let ffRatio = null;
    for (let i = 0; i < 160; i++) {
      await sleep(250);
      const st = await p.evaluate(() => { const sc = window.__vigo.scene; return { playing: !!sc.play, hidden: document.querySelector('#botctl').hidden }; });
      if (st.playing && !st.hidden) { await p.evaluate(() => document.querySelector('#ffbtn').click()); break; }
    }
    await p.waitForFunction(() => { const g = window.__vigo.room.game; return g && g.currentSeat === 0 && !window.__vigo.scene.playing; }, null, { timeout: 120000, polling: 300 }).catch(() => {});
    { const w = await p.evaluate(() => window.__W); ffRatio = w.ffRt > 0.05 ? w.ffClock / w.ffRt : null; }
    if (q === qualities[0]) check('Hoạt ảnh', 'Tua nhanh: tốc độ phát lại / thời gian thật', ffRatio === null ? 'không bắt được' : +ffRatio.toFixed(2), ffRatio !== null && ffRatio >= spec.animation.playbackFastForward_speedup_min, '≥ ' + spec.animation.playbackFastForward_speedup_min);
    await sleep(1500);
    const W = await p.evaluate(() => window.__W);
    if (W.cam > spec.animation.cameraMaxSpeed_mps) console.log('camera spike', JSON.stringify(W.camInfo));
    check('Hoạt ảnh/' + q, 'Tốc độ camera tối đa (m/s, quy về 60 FPS)', +W.cam.toFixed(2), W.cam <= spec.animation.cameraMaxSpeed_mps, '≤ ' + spec.animation.cameraMaxSpeed_mps);
    check('Hoạt ảnh/' + q, 'Bi có chuyển động khi bắn & tốc độ tối đa (m/s)', +W.ball.toFixed(2), W.ball > 0.3 && W.ball <= spec.animation.ballMaxSpeed_mps, '0.3 < v ≤ ' + spec.animation.ballMaxSpeed_mps);
    const hidden = await p.evaluate(() => document.querySelector('#botctl').hidden);
    if (q === qualities[0]) check('Hoạt ảnh', 'Nút tua/bỏ qua ẩn khi tới lượt mình', hidden, hidden === true, 'true');
    const heap1 = await p.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0));
    check('Ổn định/' + q, 'Heap JS tăng sau 1 lượt (MB)', +(heap1 - heap0).toFixed(1), heap1 - heap0 <= spec.stability.heapGrowthMB_max, '≤ ' + spec.stability.heapGrowthMB_max);
    check('Ổn định/' + q, 'Lỗi JavaScript', p.errs.length, p.errs.length <= spec.stability.jsErrors_max, '≤ ' + spec.stability.jsErrors_max);
    if (p.errs.length) console.log(q, 'lỗi:', p.errs.slice(0, 4));
    await ctx.close();
  }

  // ---- UI: nhiều kích thước màn hình
  for (const vp of spec.ui.viewports) {
    const { ctx, p } = await openGame(browser, 'low', vp);
    await startGame(p);
    await p.evaluate(() => window.__vigo.act('shoot'));
    let bs = false; for (let i = 0; i < 120 && !bs; i++) { await sleep(300); bs = await p.evaluate(() => !document.querySelector('#botctl').hidden); }
    const spinHidden = await p.evaluate(() => { const e = document.querySelector('#spinbox'); return !e || e.hidden || getComputedStyle(e).display === 'none' || e.offsetParent === null; });
    check('Giao diện ' + `${vp[0]}×${vp[1]}`, 'Lượt máy: nút tua hiện & bi chọn xoáy đã ẩn', bs + '/' + spinHidden, bs && spinHidden, 'true/true');
    const r = await p.evaluate((ui) => {
      const vis = (e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !e.closest('[hidden]'); };
      const small = []; for (const e of document.querySelectorAll('button, .rbtn, [data-act]')) { if (!vis(e)) continue; const b = e.getBoundingClientRect(); if (Math.min(b.width, b.height) < ui.minTouchTargetPx) small.push((e.id || e.className || e.tagName) + ':' + Math.round(b.width) + 'x' + Math.round(b.height)); }
      let minFont = 99; const tiny = []; for (const e of document.querySelectorAll('#app *')) { if (!vis(e) || !e.childNodes.length) continue; const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) continue; const fs = parseFloat(getComputedStyle(e).fontSize) * (parseFloat(getComputedStyle(e).zoom) || 1); if (fs < minFont) minFont = fs; if (fs < ui.minFontPx) tiny.push((e.className || e.tagName) + ':' + fs.toFixed(1)); }
      const ov = []; for (const [a, b] of ui.noOverlapPairs) { const A = document.querySelector(a), B = document.querySelector(b); if (!A || !B || !vis(A) || !vis(B)) continue; const x = A.getBoundingClientRect(), y = B.getBoundingClientRect(); if (x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top) ov.push(a + '∩' + b); }
      const off = []; for (const e of document.querySelectorAll('#botctl, #spinbox, #gauge, #mini, .bl, .msgbar')) { if (!vis(e)) continue; const b = e.getBoundingClientRect(); if (b.left < -1 || b.top < -1 || b.right > innerWidth + 1 || b.bottom > innerHeight + 1) off.push((e.id || e.className) + ':' + [b.left, b.top, b.right, b.bottom].map(Math.round).join(',')); }
      return { small, minFont, tiny: tiny.slice(0, 4), ov, off, overflowX: document.documentElement.scrollWidth - innerWidth };
    }, spec.ui);
    const tag = `${vp[0]}×${vp[1]}`;
    check('Giao diện ' + tag, 'Nút nhỏ hơn ngưỡng chạm', r.small.length ? r.small.slice(0, 4).join(' ') : 0, r.small.length === 0, `≥ ${spec.ui.minTouchTargetPx}px`);
    check('Giao diện ' + tag, 'Cỡ chữ nhỏ nhất (px)', +r.minFont.toFixed(1), r.minFont >= spec.ui.minFontPx, '≥ ' + spec.ui.minFontPx);
    check('Giao diện ' + tag, 'Các khối bị chồng nhau', r.ov.length ? r.ov.join(' ') : 0, r.ov.length === 0, '0');
    check('Giao diện ' + tag, 'Khối tràn ra ngoài màn hình', r.off.length ? r.off.join(' ') : 0, r.off.length === 0, '0');
    check('Giao diện ' + tag, 'Cuộn ngang thừa (px)', r.overflowX, r.overflowX <= 0, '≤ 0');
    await p.screenshot({ path: path.join(OUT, `ui_${vp[0]}x${vp[1]}.png`) });
    await ctx.close();
  }
  await browser.close();

  // ---- Báo cáo
  const w = Math.max(...results.map((r) => r.name.length));
  let fail = 0; let grp = '';
  for (const r of results) { if (r.group !== grp) { grp = r.group; console.log('\n## ' + grp); } if (!r.ok) fail++; console.log(`${r.ok ? '✅' : '❌'} ${r.name.padEnd(w)}  ${String(r.value).padEnd(14)} (${r.limit})`); }
  console.log(`\nTỔNG: ${results.length - fail}/${results.length} đạt, ${fail} không đạt`);
  fs.writeFileSync(path.join(OUT, 'qa-result.json'), JSON.stringify(results, null, 1));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
