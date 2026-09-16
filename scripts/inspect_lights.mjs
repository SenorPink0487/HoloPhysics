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

  const lightsInfo = await page.evaluate(() => {
    const scene = window.__labDebug.scene;
    const lights = [];
    scene.traverse((obj) => {
      if (obj.isLight) {
        lights.push({
          type: obj.type,
          name: obj.name || obj.constructor.name,
          color: obj.color.getHexString(),
          intensity: obj.intensity,
          visible: obj.visible,
          castShadow: obj.castShadow,
        });
      }
    });
    return lights;
  });

  console.log(`Total lights found: ${lightsInfo.length}`);
  for (const l of lightsInfo) {
    console.log(`- ${l.type}: intensity=${l.intensity}, visible=${l.visible}, shadow=${l.castShadow}`);
  }

  // Now measure baseline FPS
  const measureFps = async () => {
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
            resolve({
              avgFrameMs: Number((totalMs / count).toFixed(2)),
              fps: Number((1000 / (totalMs / count)).toFixed(1)),
            });
          }
        }
        requestAnimationFrame(step);
      });
    });
  };

  const before = await measureFps();
  console.log(`Baseline idle: FPS=${before.fps}, avgMs=${before.avgFrameMs}`);

  // Now set visible=false on all lights with intensity === 0
  await page.evaluate(() => {
    const scene = window.__labDebug.scene;
    scene.traverse((obj) => {
      if (obj.isLight && obj.intensity <= 0.001) {
        obj.visible = false;
      }
    });
  });

  const after = await measureFps();
  console.log(`After hiding 0-intensity lights: FPS=${after.fps}, avgMs=${after.avgFrameMs}`);

  // Now test in electric_field
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);

  const expBefore = await measureFps();
  console.log(`electric_field with 0-intensity lights hidden: FPS=${expBefore.fps}, avgMs=${expBefore.avgFrameMs}`);

  await browser.close();
}

main().catch(console.error);
