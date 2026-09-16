import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-webgl', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:1420/?measure=1');
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'));
  await page.waitForTimeout(1000);

  const measureFps = async (label) => {
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
            resolve({ fps: Number((1000 / avg).toFixed(1)), avgMs: Number(avg.toFixed(2)) });
          }
        }
        requestAnimationFrame(step);
      });
    }, label);
  };

  console.log('--- Step 1: Baseline Idle ---');
  console.log('Baseline Idle:', await measureFps('Idle'));

  // What if we hide the 4 accent lights and keep only 1 or 2 ceiling lights?
  console.log('\n--- Step 2: Optimizing PointLights ---');
  await page.evaluate(() => {
    // Find all point lights
    let pLights = [];
    window.__labDebug.scene.traverse(o => {
      if (o.isPointLight) pLights.push(o);
    });
    console.log('Found PointLights:', pLights.length);
    // Keep only lights that are close to the camera or hot station
    // Accent lights for other stations are far away
    for (const l of pLights) {
      // If it's an accent light with dist <= 5 and far from electro station (-4.2, 1.65, 4.7)
      const distToElectro = l.position.distanceTo({ x: -4.2, y: 1.65, z: 0 });
      if (distToElectro > 6 && l.intensity < 1.0) {
        l.visible = false;
      }
    }
  });
  console.log('After culling distant PointLights:', await measureFps('Culled PointLights'));

  // What if we hide all PointLights except the hot station terminal?
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isPointLight && o.position.y > 3) {
        // Ceiling lights: keep 2 instead of 5
        if (o.position.x > 1 || o.position.z < 0) o.visible = false;
      }
    });
  });
  console.log('After reducing ceiling lights to 2:', await measureFps('Reduced ceiling'));

  // Now test in electric_field
  console.log('\n--- Step 3: electric_field ---');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);
  console.log('electric_field:', await measureFps('electric_field'));

  // Now test in hall_effect
  console.log('\n--- Step 4: hall_effect ---');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'hall_effect', prewarm: false });
  });
  await page.waitForTimeout(1000);
  console.log('hall_effect:', await measureFps('hall_effect'));

  await browser.close();
}

main().catch(console.error);
