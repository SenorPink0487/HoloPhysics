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

  // Hide 0-intensity lights
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isLight && o.intensity <= 0.001) o.visible = false;
    });
  });

  const measureFps = async (label) => {
    await page.waitForTimeout(800);
    return await page.evaluate((lbl) => {
      return new Promise((resolve) => {
        let count = 0;
        let startT = performance.now();
        function step() {
          count++;
          if (count < 90) {
            requestAnimationFrame(step);
          } else {
            const totalMs = performance.now() - startT;
            const avg = totalMs / count;
            const fps = Number((1000 / avg).toFixed(1));
            const calls = window.__labDebug.renderer.info.render.calls;
            const tris = window.__labDebug.renderer.info.render.triangles;
            console.log(`[${lbl}] FPS: ${fps}, avgMs: ${avg.toFixed(2)}, calls: ${calls}, tris: ${tris}`);
            resolve({ fps, avgMs: Number(avg.toFixed(2)), calls, tris });
          }
        }
        requestAnimationFrame(step);
      });
    }, label);
  };

  page.on('console', m => console.log(m.text()));

  await measureFps('Idle');

  const exps = [
    'electric_field',
    'gauss_theorem',
    'faraday_induction',
    'induced_electric_field',
    'hall_effect',
  ];

  for (const expId of exps) {
    await page.evaluate(async (eid) => {
      await window.__labDebug.measureOpen({ stationId: 'electro', expId: eid, prewarm: false });
      // Re-apply 0-light hide in case opening exp added lights
      window.__labDebug.scene.traverse(o => {
        if (o.isLight && o.intensity <= 0.001) o.visible = false;
      });
    }, expId);
    await page.waitForTimeout(1500);
    await measureFps(expId);
  }

  await browser.close();
}

main().catch(console.error);
