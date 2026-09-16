import { chromium } from 'playwright';

async function testWithArgs(name, rendererOptions = {}) {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://127.0.0.1:1420/?measure=1');
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'));
  await page.waitForTimeout(2000);

  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(2000);

  // Apply custom tweaks
  await page.evaluate((opts) => {
    if (opts.hideAllPointLights) {
      window.__labDebug.scene.traverse(o => {
        if (o.isPointLight) o.visible = false;
      });
    }
    if (opts.hideZeroLights) {
      window.__labDebug.scene.traverse(o => {
        if (o.isLight && o.intensity <= 0.001) o.visible = false;
      });
    }
    if (opts.noShadows) {
      window.__labDebug.renderer.shadowMap.enabled = false;
      window.__labDebug.scene.traverse(o => { if (o.isLight) o.castShadow = false; });
    }
    if (opts.dpr) {
      window.__labDebug.renderer.setPixelRatio(opts.dpr);
    }
  }, rendererOptions);

  await page.waitForTimeout(1000);

  const res = await page.evaluate(() => {
    return new Promise(resolve => {
      let count = 0;
      let startT = performance.now();
      function step() {
        count++;
        if (count < 90) requestAnimationFrame(step);
        else {
          const avg = (performance.now() - startT) / count;
          resolve({ fps: Number((1000 / avg).toFixed(1)), avgMs: Number(avg.toFixed(2)) });
        }
      }
      requestAnimationFrame(step);
    });
  });

  console.log(`[${name}] FPS: ${res.fps}, avgMs: ${res.avgMs}`);
  await browser.close();
}

async function main() {
  await testWithArgs('Baseline', {});
  await testWithArgs('DPR 0.75', { dpr: 0.75 });
  await testWithArgs('Hide All PointLights', { hideAllPointLights: true });
  await testWithArgs('Hide All PointLights + DPR 0.8', { hideAllPointLights: true, dpr: 0.8 });
  await testWithArgs('Hide All PointLights + DPR 0.75', { hideAllPointLights: true, dpr: 0.75 });
}

main().catch(console.error);
