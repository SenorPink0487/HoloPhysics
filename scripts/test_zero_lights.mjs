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

  const measureFps = async (label) => {
    await page.waitForTimeout(1000);
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
            console.log(`[${lbl}] FPS: ${fps}, avgMs: ${avg.toFixed(2)}`);
            resolve({ fps, avgMs: Number(avg.toFixed(2)) });
          }
        }
        requestAnimationFrame(step);
      });
    }, label);
  };

  page.on('console', m => console.log(m.text()));

  console.log('--- IDLE ---');
  await measureFps('Idle untouched');

  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isLight && o.intensity <= 0.001) o.visible = false;
    });
  });
  await measureFps('Idle 0-lights hidden');

  // Restore 0-lights
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isLight) o.visible = true;
    });
  });

  console.log('\n--- ELECTRIC FIELD ---');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(2000);

  await measureFps('electric_field untouched');

  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isLight && o.intensity <= 0.001) o.visible = false;
    });
  });
  await measureFps('electric_field 0-lights hidden');

  console.log('\n--- HALL EFFECT ---');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'hall_effect', prewarm: false });
  });
  await page.waitForTimeout(2000);

  await measureFps('hall_effect untouched');

  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isLight && o.intensity <= 0.001) o.visible = false;
    });
  });
  await measureFps('hall_effect 0-lights hidden');

  await browser.close();
}

main().catch(console.error);
