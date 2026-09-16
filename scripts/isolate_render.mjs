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
    await page.waitForTimeout(600);
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

  // Hide 0-intensity lights first as standard baseline
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isLight && o.intensity <= 0.001) o.visible = false;
    });
  });
  await measureFps('Baseline (0-intensity lights off)');

  // Let's test hiding each top-level object or groups
  const rootCount = await page.evaluate(() => window.__labDebug.scene.children.length);

  // Test hiding all meshes in electro-station
  await page.evaluate(() => {
    const st = window.__labDebug.scene.children.find(c => c.name === 'electro-station' || c.name.includes('electro'));
    if (st) st.visible = false;
  });
  await measureFps('Electro station hidden');
  await page.evaluate(() => {
    const st = window.__labDebug.scene.children.find(c => c.name === 'electro-station' || c.name.includes('electro'));
    if (st) st.visible = true;
  });

  // Test hiding formulaBoard
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.name && (o.name.includes('formula') || o.name.includes('board'))) o.visible = false;
    });
  });
  await measureFps('Formula board hidden');

  // Test hiding walls/floor/ceiling
  await page.evaluate(() => {
    window.__labDebug.scene.traverse(o => {
      if (o.isMesh && (o.geometry?.type === 'PlaneGeometry' || o.name?.includes('wall') || o.name?.includes('floor') || o.name?.includes('ceiling'))) {
        o.__wasVis = o.visible;
        o.visible = false;
      }
    });
  });
  await measureFps('Walls/floor/ceiling hidden');

  // Test what if renderer.shadowMap is PCFSoft vs Basic vs PCF
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.type = 0; // BasicShadowMap
  });
  await measureFps('BasicShadowMap');

  // Test what if antialias is disabled?
  // Note: WebGLRenderer antialias cannot be toggled at runtime, but we can check compositor / canvas CSS
  const canvasStyle = await page.evaluate(() => {
    const c = document.querySelector('#c');
    return {
      filter: getComputedStyle(c).filter,
      backdropFilter: getComputedStyle(c).backdropFilter,
      transform: getComputedStyle(c).transform,
      willChange: getComputedStyle(c).willChange,
    };
  });
  console.log('Canvas styles:', canvasStyle);

  await browser.close();
}

main().catch(console.error);
