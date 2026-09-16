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

  const profile = await page.evaluate(() => {
    return new Promise((resolve) => {
      // Trace long tasks or measure RAF intervals
      const frames = [];
      let lastRaf = performance.now();
      let count = 0;

      function step() {
        const t0 = performance.now();
        const delta = t0 - lastRaf;
        lastRaf = t0;

        // Measure how long synchronous work takes in this task
        const startBusy = performance.now();
        // Wait, step() is called by RAF. But animate() was also called by RAF!
        // In what order do the RAF callbacks execute?
        // Let's see: if step was scheduled, it runs in the same RAF batch.

        frames.push(delta);
        count++;
        if (count < 60) {
          requestAnimationFrame(step);
        } else {
          resolve(frames);
        }
      }
      requestAnimationFrame(step);
    });
  });

  const avg = (profile.reduce((a,b)=>a+b,0)/profile.length).toFixed(2);
  console.log('Avg RAF interval:', avg);
  console.log('Sample intervals:', profile.slice(0, 15).map(x=>Number(x.toFixed(1))));

  await browser.close();
}

main().catch(console.error);
