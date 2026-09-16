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

  const breakdown = await page.evaluate(() => {
    const scene = window.__labDebug.scene;
    const directChildren = {};
    for (const child of scene.children) {
      let count = 0;
      child.traverse(o => { if (o.isMesh && o.visible) count++; });
      if (count > 0) {
        const name = child.name || (child.type + ' at ' + child.position.toArray().map(n=>n.toFixed(1)).join(','));
        directChildren[name] = count;
      }
    }
    return directChildren;
  });

  console.log('Visible meshes by direct scene child:');
  const sorted = Object.entries(breakdown).sort((a,b) => b[1] - a[1]);
  for (const [k, v] of sorted) {
    console.log(`  ${v} meshes : ${k}`);
  }
  await browser.close();
}

main().catch(console.error);
