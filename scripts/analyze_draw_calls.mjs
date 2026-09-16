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
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);

  const drawCallAnalysis = await page.evaluate(() => {
    const counts = {};
    const visibleObjects = [];
    window.__labDebug.scene.traverse(o => {
      if (o.isMesh || o.isLine || o.isPoints || o.isSprite) {
        if (o.visible) {
          // Check if ancestors are visible
          let p = o.parent;
          let vis = true;
          while (p) {
            if (!p.visible) { vis = false; break; }
            p = p.parent;
          }
          if (vis) {
            const rootName = o.parent?.name || o.parent?.type || 'root';
            const cat = o.isMesh ? 'mesh' : (o.isLine ? 'line' : (o.isPoints ? 'points' : 'sprite'));
            const key = `${rootName} (${cat}:${o.material?.type})`;
            counts[key] = (counts[key] || 0) + 1;
            visibleObjects.push({
              name: o.name,
              type: o.type,
              mat: o.material?.type,
              root: rootName,
              tris: o.geometry?.index ? o.geometry.index.count / 3 : (o.geometry?.attributes?.position?.count || 0) / 3,
            });
          }
        }
      }
    });
    return { counts, totalVisible: visibleObjects.length };
  });

  console.log(`Total visible drawable objects: ${drawCallAnalysis.totalVisible}`);
  const sorted = Object.entries(drawCallAnalysis.counts).sort((a,b) => b[1] - a[1]);
  for (const [k, v] of sorted.slice(0, 30)) {
    console.log(`  ${v}x : ${k}`);
  }

  await browser.close();
}

main().catch(console.error);
