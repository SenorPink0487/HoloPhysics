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

  await measureFps('Baseline electric_field');

  // Test A: No-op render
  await page.evaluate(() => {
    window.__origRender = window.__labDebug.renderer.render;
    window.__labDebug.renderer.render = () => {};
  });
  await measureFps('A. No-op renderer.render');
  await page.evaluate(() => {
    window.__labDebug.renderer.render = window.__origRender;
  });

  // Test B: Hide all HTML / DOM elements except canvas
  await page.evaluate(() => {
    const elements = document.body.children;
    for (const el of elements) {
      if (el.tagName !== 'CANVAS' && el.id !== 'c') {
        el.dataset.prevDisplay = el.style.display;
        el.style.display = 'none';
      }
    }
  });
  await measureFps('B. All DOM hidden (only canvas)');
  await page.evaluate(() => {
    const elements = document.body.children;
    for (const el of elements) {
      if (el.tagName !== 'CANVAS' && el.id !== 'c') {
        el.style.display = el.dataset.prevDisplay || '';
      }
    }
  });

  // Test C: Disable backdrop-filter everywhere
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'kill-backdrop';
    style.textContent = '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }';
    document.head.appendChild(style);
  });
  await measureFps('C. Kill all backdrop-filter');
  await page.evaluate(() => {
    document.getElementById('kill-backdrop')?.remove();
  });

  // Test D: Pause simDriver
  await page.evaluate(() => {
    // find simDriver or expManager.state.running = false
    window.__origRunning = window.__labDebug.manager?.state?.running;
    if (window.__labDebug.manager?.state) window.__labDebug.manager.state.running = false;
  });
  await measureFps('D. expManager.state.running = false');
  await page.evaluate(() => {
    if (window.__labDebug.manager?.state) window.__labDebug.manager.state.running = window.__origRunning;
  });

  // Test E: Scene visible = false
  await page.evaluate(() => {
    window.__labDebug.scene.visible = false;
  });
  await measureFps('E. Scene visible = false (clear canvas only)');
  await page.evaluate(() => {
    window.__labDebug.scene.visible = true;
  });

  // Test F: Post-processing disabled (if any)
  const hasPost = await page.evaluate(() => {
    return !!window.__labDebug.postProcessing;
  });
  console.log('Has postProcessing:', hasPost);

  // Test G: ShadowMap disabled
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = false;
  });
  await measureFps('G. ShadowMap disabled');
  await page.evaluate(() => {
    window.__labDebug.renderer.shadowMap.enabled = true;
  });

  // Test H: Canvas 300x150
  await page.evaluate(() => {
    const c = document.querySelector('#c');
    window.__origW = c.width;
    window.__origH = c.height;
    window.__labDebug.renderer.setSize(300, 150, false);
  });
  await measureFps('H. Small resolution (300x150)');
  await page.evaluate(() => {
    window.__labDebug.renderer.setSize(1920, 1080, false);
  });

  await browser.close();
}

main().catch(console.error);
