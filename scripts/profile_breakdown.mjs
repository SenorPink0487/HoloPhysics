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

  const profileExp = async (stationId, expId) => {
    console.log(`\nProfiling ${expId}...`);
    await page.evaluate(async ({ stationId, expId }) => {
      await window.__labDebug.measureOpen({ stationId, expId, prewarm: false });
    }, { stationId, expId });
    await page.waitForTimeout(1000);

    return await page.evaluate(() => {
      return new Promise((resolve) => {
        const samples = {
          frameDeltas: [],
          focusTargetMs: [],
          renderMs: [],
          fixedUpdateMs: [],
          expUpdateMs: [],
        };

        const origGetFocusTarget = window.getFocusTarget; // if accessible, or we can check performance
        const perf = window.__labDebug.performance;
        let count = 0;
        let lastRaf = performance.now();

        function step() {
          const now = performance.now();
          samples.frameDeltas.push(now - lastRaf);
          lastRaf = now;
          const snap = window.__labDebug.performance;
          samples.renderMs.push(snap.renderMs || 0);
          samples.fixedUpdateMs.push(snap.simulationMs || 0);
          count++;
          if (count < 60) {
            requestAnimationFrame(step);
          } else {
            const avg = arr => Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(2));
            resolve({
              avgDelta: avg(samples.frameDeltas),
              avgRenderMs: avg(samples.renderMs),
              avgSimMs: avg(samples.fixedUpdateMs),
              fps: Number((1000 / avg(samples.frameDeltas)).toFixed(1)),
              calls: window.__labDebug.renderer.info.render.calls,
              triangles: window.__labDebug.renderer.info.render.triangles,
            });
          }
        }
        requestAnimationFrame(step);
      });
    });
  };

  for (const id of ['electric_field', 'hall_effect']) {
    const res = await profileExp('electro', id);
    console.log(`${id} breakdown:`, res);
  }

  await browser.close();
}

main().catch(console.error);
