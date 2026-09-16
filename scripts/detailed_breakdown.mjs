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
  await page.goto('http://127.0.0.1:1420/?measure=1');
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'));
  await page.waitForTimeout(1000);

  // Open electric_field
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);

  // Now profile 120 frames in detail
  const report = await page.evaluate(() => {
    return new Promise((resolve) => {
      const records = [];
      let count = 0;
      let lastT = performance.now();

      function step() {
        const now = performance.now();
        const delta = now - lastT;
        lastT = now;

        const perf = window.__labDebug.performance || {};
        records.push({
          delta,
          frameMs: perf.frameMs || 0,
          renderMs: perf.renderMs || 0,
          simMs: perf.simulationMs || 0,
        });

        count++;
        if (count < 120) {
          requestAnimationFrame(step);
        } else {
          resolve(records);
        }
      }
      requestAnimationFrame(step);
    });
  });

  const avg = (arr, k) => (arr.reduce((s, x) => s + x[k], 0) / arr.length).toFixed(2);
  const p95 = (arr, k) => {
    const s = arr.map(x => x[k]).sort((a, b) => a - b);
    return s[Math.floor(s.length * 0.95)].toFixed(2);
  };

  console.log('--- Profiling electric_field Idle (120 frames) ---');
  console.log(`RAF Delta : avg = ${avg(report, 'delta')} ms, p95 = ${p95(report, 'delta')} ms`);
  console.log(`frameMs   : avg = ${avg(report, 'frameMs')} ms, p95 = ${p95(report, 'frameMs')} ms`);
  console.log(`renderMs  : avg = ${avg(report, 'renderMs')} ms, p95 = ${p95(report, 'renderMs')} ms`);
  console.log(`simMs     : avg = ${avg(report, 'simMs')} ms, p95 = ${p95(report, 'simMs')} ms`);

  // Count how many deltas were > 20ms
  const over20 = report.filter(r => r.delta > 20).length;
  console.log(`Frames taking > 20ms: ${over20} / ${report.length} (${(over20/report.length*100).toFixed(1)}%)`);

  await browser.close();
}

main().catch(console.error);
