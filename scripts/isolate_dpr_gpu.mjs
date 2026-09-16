import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  // Default newPage inherits host DPR (2 on Mac Retina)
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://127.0.0.1:1420/?measure=1');
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'));
  await page.waitForTimeout(1000);

  const dpr = await page.evaluate(() => window.devicePixelRatio);
  const rendererDpr = await page.evaluate(() => window.__labDebug.renderer.getPixelRatio());
  const canvasSize = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return { w: c.width, h: c.height, clientW: c.clientWidth, clientH: c.clientHeight };
  });
  console.log(`Host DPR: ${dpr}, Renderer DPR: ${rendererDpr}, Canvas buffer: ${canvasSize.w}x${canvasSize.h} (client: ${canvasSize.clientW}x${canvasSize.clientH})`);

  // Open electric_field
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);

  const measureFps = async (label) => {
    await page.waitForTimeout(500);
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
            });
          }
        }
        requestAnimationFrame(step);
      });
    });
    console.log(`[${label}] FPS: ${res.fps}, avgMs: ${res.avgMs}`);
    return res;
  };

  await measureFps('Baseline DPR=2 electric_field');

  // Test 1: DPR = 1.5
  await page.evaluate(() => {
    window.__labDebug.renderer.setPixelRatio(1.5);
    window.__labDebug.renderer.setSize(1920, 1080, false);
  });
  await measureFps('DPR = 1.5');

  // Test 2: DPR = 1.25
  await page.evaluate(() => {
    window.__labDebug.renderer.setPixelRatio(1.25);
    window.__labDebug.renderer.setSize(1920, 1080, false);
  });
  await measureFps('DPR = 1.25');

  // Test 3: DPR = 1.0
  await page.evaluate(() => {
    window.__labDebug.renderer.setPixelRatio(1.0);
    window.__labDebug.renderer.setSize(1920, 1080, false);
  });
  await measureFps('DPR = 1.0');

  // Restore DPR = 2.0
  await page.evaluate(() => {
    window.__labDebug.renderer.setPixelRatio(2.0);
    window.__labDebug.renderer.setSize(1920, 1080, false);
  });

  // Test 4: At DPR=2, disable shadowMap
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = false;
  });
  await measureFps('DPR=2 with shadowMap disabled');
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = true;
  });

  // Test 5: At DPR=2, disable toneMapping
  await page.evaluate(() => {
    window.__labDebug.renderer.toneMapping = 0;
  });
  await measureFps('DPR=2 with toneMapping=NoToneMapping');
  await page.evaluate(() => {
    window.__labDebug.renderer.toneMapping = 1;
  });

  // Test 6: At DPR=2, hide all inactive/far point lights (or ceiling lights)
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isPointLight) o.visible = false;
    });
  });
  await measureFps('DPR=2 with PointLights hidden');
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isPointLight && o.intensity > 0.001) o.visible = true;
    });
  });

  // Test 7: At DPR=2, what if precision is mediump or antialias?
  // Check renderer info
  const info = await page.evaluate(() => {
    return {
      calls: window.__labDebug.renderer.info.render.calls,
      triangles: window.__labDebug.renderer.info.render.triangles,
      programs: window.__labDebug.renderer.info.programs?.length,
    };
  });
  console.log('Renderer info at DPR=2:', info);

  await browser.close();
}

main().catch(console.error);
