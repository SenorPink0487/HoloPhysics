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
  await page.waitForTimeout(1000);
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'hall_effect', prewarm: false });
  });
  await page.waitForTimeout(1500);

  const meshes = await page.evaluate(() => {
    const list = [];
    window.__labDebug.scene.traverse(o => {
      if (o.isMesh && o.visible) {
        const tris = o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3;
        list.push({
          name: o.name || '(unnamed)',
          type: o.type,
          parent: o.parent?.name || o.parent?.type,
          tris: Math.round(tris),
          castShadow: o.castShadow,
          receiveShadow: o.receiveShadow,
          mat: o.material?.type,
        });
      }
    });
    return list.sort((a,b) => b.tris - a.tris).slice(0, 35);
  });

  console.log('TOP 35 MESHES BY TRIANGLES:');
  for (const m of meshes) {
    console.log(m.tris + ' tris | ' + m.name + ' (parent: ' + m.parent + ', mat: ' + m.mat + ', shadow: ' + m.castShadow + ')');
  }

  // Also count meshes by parent or group
  const groupStats = await page.evaluate(() => {
    const stats = {};
    window.__labDebug.scene.traverse(o => {
      if (o.isMesh && o.visible) {
        const p = o.parent?.name || o.parent?.type || 'root';
        stats[p] = (stats[p] || 0) + 1;
      }
    });
    return stats;
  });
  console.log('\nMesh count by parent:');
  for (const [k, v] of Object.entries(groupStats).sort((a,b) => b[1] - a[1]).slice(0, 20)) {
    console.log(v + ' meshes in ' + k);
  }

  await browser.close();
}

main().catch(console.error);
