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
  await page.waitForTimeout(2000);

  const measureFps = async (label) => {
    return await page.evaluate((lbl) => {
      return new Promise((resolve) => {
        let count = 0;
        let startT = performance.now();
        function step() {
          count++;
          if (count < 100) {
            requestAnimationFrame(step);
          } else {
            const totalMs = performance.now() - startT;
            const avg = totalMs / count;
            const fps = Number((1000 / avg).toFixed(1));
            const calls = window.__labDebug?.renderer?.info?.render?.calls ?? 0;
            const tris = window.__labDebug?.renderer?.info?.render?.triangles ?? 0;
            console.log(`[${lbl}] FPS: ${fps}, avgMs: ${avg.toFixed(2)}, calls: ${calls}, tris: ${tris}`);
            resolve({ fps, avgMs: Number(avg.toFixed(2)), calls, tris });
          }
        }
        requestAnimationFrame(step);
      });
    }, label);
  };

  console.log('=== Verifying Final Performance (1080p WebGL) ===');
  await measureFps('Idle');

  const exps = [
    'electric_field',
    'gauss_theorem',
    'faraday_induction',
    'induced_electric_field',
    'hall_effect',
  ];

  const results = [];
  for (const expId of exps) {
    await page.evaluate(async (eid) => {
      await window.__labDebug.measureOpen({ stationId: 'electro', expId: eid, prewarm: false });
    }, expId);
    await page.waitForTimeout(1800);
    const res = await measureFps(expId);
    console.log(`-> [${expId}]: FPS=${res.fps}, avgMs=${res.avgMs}, tris=${res.tris}, calls=${res.calls}`);
    results.push({ expId, ...res });
  }

  console.log('\n=== Summary Table ===');
  console.table(results);

  await browser.close();
}

main().catch(console.error);
