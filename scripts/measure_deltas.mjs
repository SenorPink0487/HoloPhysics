import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:1420/?measure=1');
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'));
  await page.waitForTimeout(1000);

  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);

  // We can measure performance using window.performance.getEntriesByType('measure')
  // or we can profile inside page.evaluate
  const timings = await page.evaluate(() => {
    return new Promise((resolve) => {
      // Monkey patch window.requestAnimationFrame
      const records = [];
      let count = 0;
      let inAnimate = false;
      let animStart = 0;
      let animDuration = 0;

      // Observe performance
      const observer = new PerformanceObserver((list) => {
        // ...
      });

      let lastRaf = performance.now();
      function tick(now) {
        const delta = now - lastRaf;
        lastRaf = now;

        // Find how long the event loop was busy during this frame
        const perf = window.__labDebug.performance || {};
        records.push({
          delta,
        });

        count++;
        if (count < 60) {
          requestAnimationFrame(tick);
        } else {
          resolve(records);
        }
      }
      requestAnimationFrame(tick);
    });
  });

  console.log('Recorded deltas:', timings.map(t=>Number(t.delta.toFixed(1))));
  await browser.close();
}

main().catch(console.error);
