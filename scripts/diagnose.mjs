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

  const sampleExperiment = async (stationId, expId) => {
    await page.evaluate(async ({ stationId, expId }) => {
      await window.__labDebug.measureOpen({ stationId, expId, prewarm: false });
    }, { stationId, expId });
    await page.waitForTimeout(1000);

    return await page.evaluate(() => {
      return new Promise((resolve) => {
        let count = 0;
        let startT = performance.now();
        function step() {
          count++;
          if (count < 60) {
            requestAnimationFrame(step);
          } else {
            const totalMs = performance.now() - startT;
            const avgFrameMs = totalMs / count;
            const fps = 1000 / avgFrameMs;
            resolve({
              calls: window.__labDebug.renderer.info.render.calls,
              triangles: window.__labDebug.renderer.info.render.triangles,
              lines: window.__labDebug.renderer.info.render.lines,
              avgFrameMs: Number(avgFrameMs.toFixed(2)),
              fps: Number(fps.toFixed(1)),
            });
          }
        }
        requestAnimationFrame(step);
      });
    });
  };

  const exps = ['electric_field', 'gauss_theorem', 'faraday_induction', 'induced_electric_field', 'hall_effect'];
  for (const expId of exps) {
    const res = await sampleExperiment('electro', expId);
    console.log(`${expId}: FPS=${res.fps}, avgMs=${res.avgFrameMs}, calls=${res.calls}, tris=${res.triangles}`);
  }

  await browser.close();
}

main().catch(console.error);
