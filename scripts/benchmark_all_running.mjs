import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://127.0.0.1:1420/?measure=1');
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'));
  await page.waitForTimeout(1000);

  const measureFps = async (label, durationMs = 2500) => {
    return await page.evaluate((ms) => {
      return new Promise((resolve) => {
        let count = 0;
        const deltas = [];
        let lastT = performance.now();
        const startT = lastT;
        function step(now) {
          deltas.push(now - lastT);
          lastT = now;
          count++;
          if (now - startT >= ms) {
            const avgFps = count / ((now - startT) / 1000);
            deltas.shift();
            deltas.sort((a, b) => a - b);
            const p50 = deltas[Math.floor(deltas.length * 0.5)];
            const p95 = deltas[Math.floor(deltas.length * 0.95)];
            resolve({ avgFps: Number(avgFps.toFixed(1)), p50: Number(p50.toFixed(2)), p95: Number(p95.toFixed(2)) });
          } else {
            requestAnimationFrame(step);
          }
        }
        requestAnimationFrame(step);
      });
    }, durationMs);
  };

  console.log('--- Benchmarking All Experiments in RUNNING state ---');

  // 1. electric_field
  console.log('\n[1] electric_field (static vs moving charge)');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(800);
  let res = await measureFps('electric_field static');
  console.log('  Static: FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);

  // Animate probe charge continuously
  await page.evaluate(() => {
    const mgr = window.__labDebug.getExpManager();
    window.__animProbe = true;
    let t = 0;
    function loop() {
      if (!window.__animProbe) return;
      t += 0.03;
      if (mgr?.state?.data?.charges?.[0]) {
        mgr.state.data.charges[0].x = Math.sin(t) * 1.5;
        mgr.state.data.charges[0].y = Math.cos(t) * 1.5;
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });
  res = await measureFps('electric_field moving');
  console.log('  Moving charge: FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);
  await page.evaluate(() => { window.__animProbe = false; });

  // 2. gauss_theorem
  console.log('\n[2] gauss_theorem');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'gauss_theorem', prewarm: false });
  });
  await page.waitForTimeout(800);
  res = await measureFps('gauss_theorem static');
  console.log('  Static: FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);

  // 3. faraday_induction
  console.log('\n[3] faraday_induction');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'faraday_induction', prewarm: false });
  });
  await page.waitForTimeout(800);
  res = await measureFps('faraday_induction static');
  console.log('  Static: FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);

  // Start continuous Faraday animation
  await page.evaluate(() => {
    const mgr = window.__labDebug.getExpManager();
    window.__loopFaraday = true;
    function loop() {
      if (!window.__loopFaraday) return;
      if (!mgr.state.data.pendingAnim) {
        const curX = mgr.state.data.x || 4.5;
        const to = curX > 4.5 ? 1.5 : 7.5;
        mgr.uiAction('faraday-play', { to, duration: 2.0 });
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });
  res = await measureFps('faraday_induction animating x');
  console.log('  Animating x (auto-demo): FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);

  // Now test B animation
  await page.evaluate(() => {
    const mgr = window.__labDebug.getExpManager();
    mgr.uiAction('faraday-channel', { channel: 'B' });
    function loop() {
      if (!window.__loopFaraday) return;
      if (!mgr.state.data.pendingAnim) {
        const curB = mgr.state.data.B || 0;
        const to = curB > 0 ? -2.5 : 2.5;
        mgr.uiAction('faraday-play', { to, duration: 2.0 });
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });
  res = await measureFps('faraday_induction animating B');
  console.log('  Animating B (auto-demo): FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);
  await page.evaluate(() => { window.__loopFaraday = false; });

  // 4. induced_electric_field
  console.log('\n[4] induced_electric_field');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'induced_electric_field', prewarm: false });
  });
  await page.waitForTimeout(800);
  res = await measureFps('induced_electric_field static');
  console.log('  Static: FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);

  // Turn on oscillation
  await page.evaluate(() => {
    const mgr = window.__labDebug.getExpManager();
    mgr.uiAction('induced-e-set', { key: 'auto', value: true });
    mgr.uiAction('induced-e-set', { key: 'paused', value: false });
  });
  res = await measureFps('induced_electric_field oscillating');
  console.log('  Oscillating (auto): FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);

  // 5. hall_carrier_demo
  console.log('\n[5] hall_carrier_demo');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'hall_carrier_demo', prewarm: false });
  });
  await page.waitForTimeout(800);
  res = await measureFps('hall_carrier_demo running');
  console.log('  Carrier sim running: FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);

  // 6. hall_effect
  console.log('\n[6] hall_effect');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'hall_effect', prewarm: false });
  });
  await page.waitForTimeout(800);
  res = await measureFps('hall_effect static');
  console.log('  Static: FPS =', res.avgFps, 'p50 =', res.p50, 'p95 =', res.p95);

  await browser.close();
}

main().catch(console.error);
