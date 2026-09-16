import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: [
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-gpu-vsync',
      '--disable-frame-rate-limit',
    ],
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

  const measureRawMs = async (label) => {
    await page.waitForTimeout(400);
    const res = await page.evaluate(() => {
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
            resolve({ fps: Number((1000 / avg).toFixed(1)), avgMs: Number(avg.toFixed(2)) });
          }
        }
        requestAnimationFrame(step);
      });
    });
    console.log(`[${label}] RAW Frame Time: ${res.avgMs} ms (FPS: ${res.fps})`);
    return res.avgMs;
  };

  const baseline = await measureRawMs('1. Baseline');

  // Opt A: Turn off the 4 station accent lights (which are for other stations and have dist=5)
  await page.evaluate(() => {
    // In labShell, accents array:
    // [-3.5, 1.5, -2.5], [3.5, 1.5, -2.5], [0, 2, 0.5], [-3.5, 1.4, 2.2]
    // Find point lights with dist === 5 and intensity <= 0.6
    window.__labDebug.scene.traverse(o => {
      if (o.isPointLight && o.distance === 5 && o.intensity <= 0.6) {
        o.visible = false;
      }
    });
  });
  const afterAccents = await measureRawMs('2. Station accent lights hidden');

  // Opt B: Ceiling lights: The 5 ceiling point lights (dist=10).
  // What if we keep 2 ceiling point lights instead of 5? (or 1 central)
  await page.evaluate(() => {
    let count = 0;
    window.__labDebug.scene.traverse(o => {
      if (o.isPointLight && o.distance === 10 && o.position.y > 3) {
        count++;
        // Keep 2 lights, turn off 3
        if (count > 2) o.visible = false;
      }
    });
  });
  const afterCeiling = await measureRawMs('3. Ceiling point lights 5 -> 2');

  // Opt C: Board light (dist=6 on front wall)
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isPointLight && o.distance === 6) o.visible = false;
    });
  });
  const afterBoard = await measureRawMs('4. Board light hidden');

  // Opt D: What about the electric_field apparatus itself?
  // Let's check draw calls and meshes in electric_field
  await page.evaluate(() => {
    // Find what meshes exist in electric_field
    const info = window.__labDebug.renderer.info.render;
    console.log('Current render info:', info.calls, 'calls,', info.triangles, 'tris');
  });

  // Opt E: What if shadowMap is updated only when needed?
  // Let's check shadowMap
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = false;
  });
  const afterShadows = await measureRawMs('5. ShadowMap disabled');
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = true;
  });

  await browser.close();
}

main().catch(console.error);
