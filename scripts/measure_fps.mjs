import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[browser error]', msg.text());
  });

  console.log('Navigating to http://127.0.0.1:1420/?measure=1 ...');
  await page.goto('http://127.0.0.1:1420/?measure=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'), null, { timeout: 60000 });
  await page.waitForTimeout(2000);

  const measureFps = async (durationMs = 2500) => {
    return await page.evaluate((ms) => {
      return new Promise((resolve) => {
        let frames = 0;
        const deltas = [];
        let lastT = performance.now();
        const startT = lastT;
        function frame(now) {
          deltas.push(now - lastT);
          lastT = now;
          frames++;
          if (now - startT >= ms) {
            const avgFps = (frames / ((now - startT) / 1000));
            deltas.shift(); // remove first delta
            deltas.sort((a, b) => a - b);
            const p50 = deltas[Math.floor(deltas.length * 0.5)];
            const p95 = deltas[Math.floor(deltas.length * 0.95)];
            resolve({ frames, avgFps: Number(avgFps.toFixed(1)), p50: Number(p50.toFixed(2)), p95: Number(p95.toFixed(2)) });
          } else {
            requestAnimationFrame(frame);
          }
        }
        requestAnimationFrame(frame);
      });
    }, durationMs);
  };

  const idleStats = await measureFps(2000);
  console.log(`Idle: FPS=${idleStats.avgFps}, p50=${idleStats.p50}ms, p95=${idleStats.p95}ms`);

  const experiments = [
    ['electro', 'electric_field'],
    ['electro', 'gauss_theorem'],
    ['electro', 'faraday_induction'],
    ['electro', 'induced_electric_field'],
    ['electro', 'hall_effect'],
  ];

  for (const [stationId, expId] of experiments) {
    console.log(`\nStarting ${stationId}:${expId}...`);
    const openRes = await page.evaluate(async ({ stationId, expId }) => {
      return await window.__labDebug.measureOpen({ stationId, expId, prewarm: false });
    }, { stationId, expId });
    console.log(`Opened ${expId} in ${openRes?.wallMs || 0}ms`);
    await page.waitForTimeout(1000);
    const stats = await measureFps(2500);
    console.log(`${expId}: FPS=${stats.avgFps}, p50=${stats.p50}ms, p95=${stats.p95}ms`);
  }

  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
