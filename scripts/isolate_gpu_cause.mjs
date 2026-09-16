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
  await page.waitForTimeout(1000);

  const measureFps = async (label) => {
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
    console.log(`[${label}] FPS: ${res.fps}, avgMs: ${res.avgMs}`);
    return res;
  };

  await measureFps('Baseline (electric_field)');

  // 1. What if all lights except DirectionalLight + Ambient are removed/hidden?
  await page.evaluate(() => {
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isPointLight) obj.visible = false;
    });
  });
  await measureFps('1. PointLights visible = false');

  // 2. What if DirectionalLight castShadow = false?
  await page.evaluate(() => {
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isDirectionalLight) obj.castShadow = false;
    });
    window.__labDebug.renderer.shadowMap.enabled = false;
  });
  await measureFps('2. Shadows completely disabled');

  // 3. What if all materials are replaced with MeshBasicMaterial?
  await page.evaluate(() => {
    const THREE = window.THREE || window.__labDebug.THREE; // if available, or just change properties
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          m.__origWireframe = m.wireframe;
          // test basic or simplify
        }
      }
    });
  });

  // 4. What about toneMapping? What if toneMapping = THREE.NoToneMapping?
  await page.evaluate(() => {
    window.__labDebug.renderer.toneMapping = 0; // NoToneMapping
  });
  await measureFps('3. NoToneMapping');

  // 5. What about the room meshes? What if the room (walls, floor, ceiling, props) is hidden and ONLY electro station is visible?
  await page.evaluate(() => {
    const scene = window.__labDebug.scene;
    for (const child of scene.children) {
      if (child.name !== 'electro-station' && !child.name.includes('electro') && !child.isLight && !child.isCamera) {
        child.__prevVis = child.visible;
        child.visible = false;
      }
    }
  });
  await measureFps('4. Only electro station visible (room hidden)');

  // Restore room
  await page.evaluate(() => {
    const scene = window.__labDebug.scene;
    for (const child of scene.children) {
      if (child.__prevVis !== undefined) {
        child.visible = child.__prevVis;
      }
    }
  });

  // 6. What if electro station is HIDDEN (only room visible)?
  await page.evaluate(() => {
    const scene = window.__labDebug.scene;
    scene.traverse((obj) => {
      if (obj.name && obj.name.includes('electro')) {
        obj.visible = false;
      }
    });
  });
  await measureFps('5. Electro station hidden (room only)');

  await browser.close();
}

main().catch(console.error);
