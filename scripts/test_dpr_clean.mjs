import { chromium } from 'playwright';

async function testWithDpr(dpr) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: dpr,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:1420/?measure=1');
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'));
  await page.waitForTimeout(1500);

  const measureFps = async (label, durationMs = 2000) => {
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

  console.log(`\n=== Testing with deviceScaleFactor = ${dpr} ===`);
  const actualDpr = await page.evaluate(() => window.__labDebug.renderer.getPixelRatio());
  const size = await page.evaluate(() => {
    const c = document.querySelector('#c');
    return `${c.width}x${c.height}`;
  });
  console.log(`Renderer PixelRatio: ${actualDpr}, Canvas Buffer: ${size}`);

  const idle = await measureFps('Idle');
  console.log(`Idle: FPS=${idle.avgFps}, p50=${idle.p50}ms, p95=${idle.p95}ms`);

  // Open faraday
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'faraday_induction', prewarm: false });
  });
  await page.waitForTimeout(1000);

  const faradayIdle = await measureFps('Faraday idle');
  console.log(`Faraday idle: FPS=${faradayIdle.avgFps}, p50=${faradayIdle.p50}ms, p95=${faradayIdle.p95}ms`);

  // Animate Faraday
  await page.evaluate(() => {
    const mgr = window.__labDebug.getExpManager();
    window.__loop = true;
    function loop() {
      if (!window.__loop) return;
      if (!mgr.state.data.pendingAnim) {
        const curX = mgr.state.data.x || 4.5;
        mgr.uiAction('faraday-play', { to: curX > 4.5 ? 1.5 : 7.5, duration: 2.5 });
      }
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  });

  const faradayRun = await measureFps('Faraday running');
  console.log(`Faraday running: FPS=${faradayRun.avgFps}, p50=${faradayRun.p50}ms, p95=${faradayRun.p95}ms`);

  await page.evaluate(() => { window.__loop = false; });

  await browser.close();
}

async function main() {
  await testWithDpr(1);
  await testWithDpr(2);
}

main().catch(console.error);
