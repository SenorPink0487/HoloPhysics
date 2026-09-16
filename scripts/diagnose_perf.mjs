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

  const getPerf = async () => {
    return await page.evaluate(() => {
      const p = window.__labDebug.getPerf();
      return {
        fps: p.fps,
        deltaMs: p.deltaMs,
        frameMs: p.frameMs,
        renderMs: p.renderMs,
        simulationMs: p.simulationMs,
        frameP95: p.frameP95,
        renderP95: p.renderP95,
      };
    });
  };

  console.log('Idle Perf:', await getPerf());

  console.log('Opening hall_effect...');
  await page.evaluate(async () => {
    await window.__labDebug.measureOpen({ stationId: 'electro', expId: 'hall_effect', prewarm: false });
  });
  await page.waitForTimeout(3000);

  console.log('Hall Effect Perf:', await getPerf());

  await browser.close();
}

main().catch(console.error);
