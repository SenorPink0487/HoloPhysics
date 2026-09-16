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
    return await page.evaluate((label) => {
      return new Promise((resolve) => {
        let count = 0;
        let startT = performance.now();
        function step() {
          count++;
          if (count < 60) {
            requestAnimationFrame(step);
          } else {
            const totalMs = performance.now() - startT;
            const avg = Number((totalMs / count).toFixed(2));
            const fps = Number((1000 / avg).toFixed(1));
            console.log(`[PERF] ${label}: FPS=${fps}, avgMs=${avg}`);
            resolve({ fps, avgMs: avg });
          }
        }
        requestAnimationFrame(step);
      });
    }, label);
  };

  page.on('console', msg => console.log(msg.text()));

  console.log('--- Testing idle configurations ---');
  await measureFps('Default idle');

  // Test 1: disable shadows
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = false;
  });
  await measureFps('ShadowMap disabled');
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = true;
  });

  // Test 2: hide 0-intensity lights
  await page.evaluate(() => {
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isLight && obj.intensity <= 0.001) obj.visible = false;
    });
  });
  await measureFps('0-intensity lights hidden');

  // Test 3: What about point lights? What if point lights are reduced or ceiling lights?
  // Let's see all point lights
  const pointLightCount = await page.evaluate(() => {
    let count = 0;
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isPointLight && obj.visible) count++;
    });
    return count;
  });
  console.log('Active point lights count:', pointLightCount);

  // Test 4: What if all point lights are hidden (only DirectionalLight + Hemisphere)?
  await page.evaluate(() => {
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isPointLight) obj.visible = false;
    });
  });
  await measureFps('No point lights (only dir + hemi)');

  // Restore point lights
  await page.evaluate(() => {
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isPointLight && obj.intensity > 0.001) obj.visible = true;
    });
  });

  // Test 5: What if antialias or DPR or something?
  // What are the objects taking draw calls?
  const sceneStats = await page.evaluate(() => {
    let meshes = 0;
    let materials = new Set();
    let geometries = new Set();
    let instancedMeshes = 0;
    let transparentMeshes = 0;
    let physicalMeshes = 0;
    window.__labDebug.scene.traverse((obj) => {
      if (obj.isMesh) {
        meshes++;
        if (obj.isInstancedMesh) instancedMeshes++;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          materials.add(m);
          if (m.transparent) transparentMeshes++;
          if (m.type === 'MeshPhysicalMaterial') physicalMeshes++;
        }
      }
    });
    return {
      meshes,
      instancedMeshes,
      materials: materials.size,
      transparentMeshes,
      physicalMeshes,
    };
  });
  console.log('Scene stats:', sceneStats);

  // Open hall_effect and test
  console.log('\n--- Testing hall_effect ---');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'hall_effect', prewarm: false });
  });
  await page.waitForTimeout(1500);
  await measureFps('hall_effect baseline');

  // Check hall_effect object counts & triangle counts
  const hallStats = await page.evaluate(() => {
    const info = window.__labDebug.renderer.info.render;
    return {
      calls: info.calls,
      triangles: info.triangles,
      lines: info.lines,
      points: info.points,
    };
  });
  console.log('hall_effect render info:', hallStats);

  // Test disabling specific hall_effect meshes
  await page.evaluate(() => {
    const scene = window.__labDebug.scene;
    // find apparatus
    scene.traverse((obj) => {
      if (obj.name && (obj.name.includes('hall') || obj.name.includes('solenoid') || obj.name.includes('Coil'))) {
        console.log('Found hall object:', obj.name, obj.type, obj.geometry?.attributes?.position?.count);
      }
    });
  });

  await browser.close();
}

main().catch(console.error);
