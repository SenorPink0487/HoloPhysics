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

  console.log('Opening electric_field...');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'electric_field', prewarm: false });
  });
  await page.waitForTimeout(1000);

  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable');
  await session.send('Profiler.setSamplingInterval', { interval: 100 });
  await session.send('Profiler.start');

  await page.waitForTimeout(2000);

  const { profile } = await session.send('Profiler.stop');
  await browser.close();

  const nodeMap = new Map();
  for (const node of profile.nodes) {
    nodeMap.set(node.id, node);
    node.selfTime = 0;
  }

  if (profile.samples && profile.timeDeltas) {
    for (let i = 0; i < profile.samples.length; i++) {
      const nodeId = profile.samples[i];
      const delta = profile.timeDeltas[i];
      const node = nodeMap.get(nodeId);
      if (node) {
        node.selfTime += delta;
      }
    }
  }

  const sorted = [...nodeMap.values()].sort((a, b) => b.selfTime - a.selfTime);
  console.log('\nTop 25 functions by Self Time:');
  for (const n of sorted.slice(0, 25)) {
    const fn = n.callFrame.functionName || '(anonymous)';
    const url = n.callFrame.url ? n.callFrame.url.split('/').pop() : '';
    const line = n.callFrame.lineNumber;
    const ms = (n.selfTime / 1000).toFixed(2);
    console.log(`${ms.padStart(8)} ms | ${fn} (${url}:${line})`);
  }
}

main().catch(console.error);
