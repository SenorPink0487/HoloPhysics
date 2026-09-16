import { chromium } from 'playwright';

async function testConfig(name, opts = {}) {
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

  // If initScript is provided, run before scripts load
  if (opts.init) {
    await page.addInitScript(opts.init);
  }

  await page.goto('http://127.0.0.1:1420/?measure=1');
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'));
  await page.waitForTimeout(1500);

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

  const idle = await measureFps('Idle');
  console.log(`[${name}] Idle: FPS=${idle.fps}, avgMs=${idle.avgMs}`);

  // Open electric_field
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);
  const ef = await measureFps('electric_field');
  console.log(`[${name}] electric_field: FPS=${ef.fps}, avgMs=${ef.avgMs}`);

  // Open hall_effect
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'hall_effect', prewarm: false });
  });
  await page.waitForTimeout(1000);
  const hall = await measureFps('hall_effect');
  console.log(`[${name}] hall_effect: FPS=${hall.fps}, avgMs=${hall.avgMs}`);

  await browser.close();
}

async function main() {
  console.log('=== Testing Fixed Light Budget ===');

  // Baseline
  await testConfig('Baseline');

  // Config A: Intercept PointLight creation at boot so total PointLights <= 6
  await testConfig('PointLight Capped at 6', {
    init: `
      // Intercept THREE.PointLight to only keep essential ones
      const origPL = window.THREE?.PointLight;
      // We can also let the page load and check
    `
  });
}

main().catch(console.error);
