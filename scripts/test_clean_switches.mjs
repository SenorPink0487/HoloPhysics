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

  // Open electric_field
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(2000);

  const measureFps = async (label) => {
    // Wait for any compilation to settle
    await page.waitForTimeout(1000);
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
            resolve({
              fps: Number((1000 / avg).toFixed(1)),
              avgMs: Number(avg.toFixed(2)),
              calls: window.__labDebug.renderer.info.render.calls,
              tris: window.__labDebug.renderer.info.render.triangles,
            });
          }
        }
        requestAnimationFrame(step);
      });
    });
    console.log(`[${label}] FPS: ${res.fps}, avgMs: ${res.avgMs}, calls: ${res.calls}, tris: ${res.tris}`);
    return res;
  };

  await measureFps('Baseline');

  // Test 1: Only hide point lights with intensity === 0
  await page.evaluate(() => {
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isLight && obj.intensity <= 0.001) obj.visible = false;
    });
  });
  await measureFps('0-intensity lights hidden');

  // Test 2: Hide ALL point lights (keep DirectionalLight + Hemisphere)
  await page.evaluate(() => {
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isPointLight) obj.visible = false;
    });
  });
  await measureFps('All PointLights hidden');

  // Test 3: Disable shadows
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = false;
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isLight) obj.castShadow = false;
    });
  });
  await measureFps('Shadows disabled + All PointLights hidden');

  await browser.close();
}

main().catch(console.error);
