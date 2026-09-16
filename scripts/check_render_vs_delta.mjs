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

  const breakdown = await page.evaluate(() => {
    return new Promise((resolve) => {
      const records = [];
      let count = 0;

      // Wrap requestAnimationFrame to measure entire callback time
      const origRaf = window.requestAnimationFrame;
      let frameT0 = performance.now();
      let lastFrameEnd = performance.now();

      const origRender = window.__labDebug.renderer.render.bind(window.__labDebug.renderer);
      let renderDuration = 0;
      window.__labDebug.renderer.render = function(...args) {
        const r0 = performance.now();
        origRender(...args);
        renderDuration = performance.now() - r0;
      };

      function step() {
        const now = performance.now();
        const delta = now - frameT0;
        frameT0 = now;

        records.push({
          delta,
          renderDuration,
        });

        count++;
        if (count < 90) {
          origRaf(step);
        } else {
          resolve(records);
        }
      }
      origRaf(step);
    });
  });

  const avg = (arr, k) => (arr.reduce((s, x) => s + x[k], 0) / arr.length).toFixed(2);
  console.log('Avg delta:', avg(breakdown, 'delta'));
  console.log('Avg renderDuration:', avg(breakdown, 'renderDuration'));

  await browser.close();
}

main().catch(console.error);
