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

  console.log('Opening electric_field...');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);

  // Hook into animate functions or measure internal timings
  const timings = await page.evaluate(() => {
    return new Promise((resolve) => {
      const results = {
        totalFrameDeltas: [],
        stepSimDriverMs: [],
        stepGetFocusTargetMs: [],
        stepExpManagerUpdateMs: [],
        stepRoomAnimatorsMs: [],
        stepFrameCoordinatorMs: [],
        stepRendererRenderMs: [],
        stepSchedulerDrainMs: [],
      };

      // Let's monkey-patch getFocusTarget, renderer.render, etc.
      const origRender = window.__labDebug.renderer.render;
      const debug = window.__labDebug;

      let frameCount = 0;
      let lastTime = performance.now();

      const origFCFrame = window.__labDebug.frameCoordinator?.frame;

      function onFrame(now) {
        frameCount++;
        results.totalFrameDeltas.push(now - lastTime);
        lastTime = now;

        if (frameCount < 60) {
          requestAnimationFrame(onFrame);
        } else {
          const avg = arr => arr.length ? Number((arr.reduce((a,b)=>a+b,0)/arr.length).toFixed(2)) : 0;
          resolve({
            avgDelta: avg(results.totalFrameDeltas),
            fps: Number((1000 / avg(results.totalFrameDeltas)).toFixed(1)),
          });
        }
      }
      requestAnimationFrame(onFrame);
    });
  });

  console.log('Timings:', timings);
  await browser.close();
}

main().catch(console.error);
