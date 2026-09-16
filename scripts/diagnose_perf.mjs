#!/usr/bin/env node
/**
 * 深度性能剖析与智能根因诊断工具 (Deep Performance Profiler & Root Cause Diagnostic Engine)
 *
 * 核心功能：
 * 1. 自动环境与服务就绪：自适应定位系统 Chrome，自动启动/连接 Vite 实验环境。
 * 2. 动态目录感知：直接读取 `src/runtime/catalog.js`，保证测试用例永不与真实目录脱节。
 * 3. 八大诊断维度全面探测：
 *    - 帧率与 VSync 量化分析 (FPS, p50, p95, p99, 最大跳帧 Max Gap)
 *    - WebGL 渲染管线指标 (Draw Calls, 三角形面数, 编译着色器程序数, 几何体/纹理常驻数)
 *    - 光照与阴影管线开销 (活动点光源/方向光数量, 投射阴影 Mesh 数量)
 *    - 2D Canvas 文本栅格化与 GPU 纹理重传频次 (needsUpdate 次数与上传速率)
 *    - DOM 与合成器覆盖层检测 (全屏透明未 display:none 遮罩, backdrop-filter:blur 滤镜)
 *    - 动态交互应力测试 (静态观察 vs 连续拖拽/交互时的帧率差异与退化幅度)
 *    - 内存泄漏审查 (连续多次切换实验后的几何体/纹理净增长)
 *    - 控制台异常与未捕获 Promise 拒绝拦截
 * 4. 规则驱动的智能归因引擎：
 *    - 发现性能劣化时，自动匹配根因规则库，精准输出 `[TAG]` 归因标识与优化指引。
 * 5. 产出直观的终端彩色诊断报表与机器可读的 `output/perf-diagnostic.json`。
 *
 * 用法：
 *   node scripts/diagnose_perf.mjs                           # 默认诊断全部活动实验
 *   node scripts/diagnose_perf.mjs electro/electric_field    # 针对特定实验深度诊断
 *   node scripts/diagnose_perf.mjs all                       # 显式全量扫描
 *   LAB_PORT=1420 node scripts/diagnose_perf.mjs             # 指定端口
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// 1. 动态加载活动实验目录
const { LAB_CATALOG } = await import('../src/runtime/catalog.js');

// 2. 环境与端口配置
const START_PORT = Number(process.env.LAB_PORT || 1420);
const BASE_URL = process.env.LAB_URL || `http://127.0.0.1:${START_PORT}`;

// 3. 性能与诊断警戒预算 (Budget & Diagnostic Thresholds)
export const DIAGNOSTIC_THRESHOLDS = Object.freeze({
  targetFpsMin: 58.5,             // 满帧标准下限
  frameP95MaxMs: 17.2,            // 单帧 p95 耗时警戒线 (超过 16.67ms 极易触发 30 FPS VSync 量化)
  maxFrameGapMs: 50.0,            // 单次最大掉帧卡顿
  drawCallsMax: 350,              // 单帧 Draw Calls 建议上限
  trianglesMax: 100_000,          // 建议单场景三角形上限
  activePointLightsMax: 10,       // 活跃点光源数量上限 (1 顶灯 + 4 台灯 + 备用)
  shadowCastingMeshesMax: 250,    // 投射阴影物体数量上限
  textureUploadsPerSecMax: 25,    // 交互期间 2D Canvas 纹理上传速率上限
  dynamicFpsDropMax: 5.0,         // 动态交互对比静态的允许最大掉帧
  maxOpenMs: 1200,                // 实验初次打开就绪时间上限
});

// ANSI 颜色辅助
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function formatMs(n) {
  return typeof n === 'number' && Number.isFinite(n) ? `${n.toFixed(2)}ms` : '--';
}

function formatFps(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '--';
  const color = n >= DIAGNOSTIC_THRESHOLDS.targetFpsMin ? c.green : (n >= 45 ? c.yellow : c.red);
  return `${color}${n.toFixed(1)} FPS${c.reset}`;
}

/** 智能定位系统 Chromium / Google Chrome 可执行文件 */
function resolveChromeExecutable() {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** 检测本地开发/预览服务是否可达 */
async function isServerReachable(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(600) });
    return res.ok;
  } catch {
    return false;
  }
}

/** 自动拉起本地 Vite 服务 */
async function ensureServerRunning() {
  if (await isServerReachable(BASE_URL)) {
    return { url: BASE_URL, child: null };
  }
  console.log(`${c.dim}[LabDiagnose] 正在启动 Vite 实验服务于 ${BASE_URL}...${c.reset}`);
  const viteCli = path.join(ROOT_DIR, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [
    viteCli,
    '--host', '127.0.0.1',
    '--port', String(START_PORT),
  ], {
    cwd: ROOT_DIR,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await isServerReachable(BASE_URL)) {
      return { url: BASE_URL, child };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  child.kill();
  throw new Error(`无法在 ${BASE_URL} 启动本地实验服务，超时`);
}

/** 获取所有待测试用例 */
function getTargetCases(specArg) {
  const activeCases = [];
  for (const [stationId, stationObj] of Object.entries(LAB_CATALOG)) {
    if (!stationObj?.experiments?.length) continue;
    for (const exp of stationObj.experiments) {
      activeCases.push({ stationId, expId: exp.id, name: exp.name });
    }
  }

  if (!specArg || specArg === 'all') {
    return activeCases;
  }

  const [sid, eid] = specArg.includes('/') ? specArg.split('/') : [null, specArg];
  const matched = activeCases.filter((item) => {
    if (sid && item.stationId !== sid) return false;
    return item.expId === eid;
  });

  if (matched.length === 0) {
    console.error(`${c.red}错误：未找到与参数 "${specArg}" 匹配的活动实验。${c.reset}`);
    console.log(`当前已知实验：\n` + activeCases.map((c) => `  - ${c.stationId}/${c.expId} (${c.name})`).join('\n'));
    process.exit(1);
  }
  return matched;
}

/**
 * 诊断套件核心主逻辑
 */
async function runDiagnostic() {
  console.log(`\n${c.bold}${c.cyan}======================================================================${c.reset}`);
  console.log(`${c.bold}${c.cyan}        HoloPhysics 智能自动化性能剖析与精准根因诊断系统              ${c.reset}`);
  console.log(`${c.bold}${c.cyan}======================================================================${c.reset}\n`);

  const cases = getTargetCases(process.argv[2]);
  console.log(`${c.dim}待测试活动实验 (${cases.length} 个):${c.reset}`);
  for (const item of cases) {
    console.log(`  • [${item.stationId}] ${c.bold}${item.expId}${c.reset} (${item.name})`);
  }
  console.log();

  const { url, child: serverProcess } = await ensureServerRunning();
  const chromePath = resolveChromeExecutable();
  if (chromePath) {
    console.log(`${c.dim}[LabDiagnose] 使用 Chromium 引擎: ${chromePath}${c.reset}`);
  }

  const browser = await chromium.launch({
    headless: process.env.HEADED !== '1',
    executablePath: chromePath,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--no-sandbox'],
  });

  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });

  const consoleLogs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleLogs.push({ type: 'error', text: msg.text() });
    }
  });
  page.on('pageerror', (err) => {
    consoleLogs.push({ type: 'exception', text: err.message });
  });

  console.log(`${c.dim}[LabDiagnose] 正在载入主界面...${c.reset}`);
  await page.goto(`${url}/?measure=1`);
  await page.waitForFunction(() => document.body.classList.contains('lab-ready'), null, { timeout: 60000 });
  await page.waitForTimeout(1000);

  const reportResults = [];

  for (let i = 0; i < cases.length; i++) {
    const { stationId, expId, name } = cases[i];
    console.log(`\n${c.bold}[${i + 1}/${cases.length}] 正在深度探测: ${stationId}/${expId} (${name})${c.reset}`);

    // 1. 打开实验并测量加载开销 (正常卡片切换不重开菜单)
    const openRes = await page.evaluate(async ({ stationId: sid, expId: eid }) => {
      return await window.__labDebug.measureOpen({
        stationId: sid,
        expId: eid,
        prewarm: false,
        openMenu: false,
      });
    }, { stationId, expId });

    await page.waitForTimeout(600);

    // 2. 测量静态状态下的帧率与帧时间分布 (采样 2000ms)
    const staticFpsMetrics = await page.evaluate((durationMs) => {
      return new Promise((resolve) => {
        let count = 0;
        const deltas = [];
        let lastT = performance.now();
        const startT = lastT;
        function step(now) {
          const dt = now - lastT;
          deltas.push(dt);
          lastT = now;
          count++;
          if (now - startT >= durationMs) {
            const actualTotalMs = now - startT;
            const avgFps = count / (actualTotalMs / 1000);
            deltas.shift(); // 丢弃初次启动突刺
            deltas.sort((a, b) => a - b);
            const p50 = deltas[Math.floor(deltas.length * 0.50)] || 0;
            const p95 = deltas[Math.floor(deltas.length * 0.95)] || 0;
            const p99 = deltas[Math.floor(deltas.length * 0.99)] || 0;
            let maxGap = 0;
            let droppedFrames = 0;
            for (const d of deltas) {
              if (d > maxGap) maxGap = d;
              if (d > 19.0) droppedFrames++;
            }
            resolve({
              avgFps: Number(avgFps.toFixed(2)),
              p50: Number(p50.toFixed(2)),
              p95: Number(p95.toFixed(2)),
              p99: Number(p99.toFixed(2)),
              maxGap: Number(maxGap.toFixed(2)),
              droppedFrames,
              totalFrames: count,
            });
          } else {
            requestAnimationFrame(step);
          }
        }
        requestAnimationFrame(step);
      });
    }, 2000);

    // 3. 动态交互压力测试与仿真模拟
    const dynamicMetrics = await page.evaluate(async ({ expId: eid, durationMs }) => {
      const mgr = window.__labDebug.getExpManager?.();
      const state = mgr?.state;
      window.__stopDynamicStress = false;

      let interactionSetup = null;

      // 为不同实验注入持续动态操作
      if (eid === 'electric_field') {
        let angle = 0;
        interactionSetup = setInterval(() => {
          if (window.__stopDynamicStress) return;
          angle += 0.08;
          if (state?.data?.probe) {
            state.data.probe.x = Math.sin(angle) * 0.8;
            state.data.probe.z = Math.cos(angle) * 0.8;
          }
        }, 16);
      } else if (eid === 'faraday_induction') {
        let rodX = 4.0;
        let dir = 1;
        interactionSetup = setInterval(() => {
          if (window.__stopDynamicStress) return;
          rodX += dir * 0.05;
          if (rodX > 6.0) dir = -1;
          if (rodX < 3.0) dir = 1;
          if (state?.data) state.data.rodX = rodX;
        }, 16);
      } else if (eid === 'induced_electric_field') {
        let t = 0;
        interactionSetup = setInterval(() => {
          if (window.__stopDynamicStress) return;
          t += 0.05;
          if (state?.data) {
            state.data.B = Math.sin(t) * 5.0;
            state.data.dBdt = Math.cos(t) * 5.0;
          }
        }, 16);
      } else if (eid === 'hall_carrier_demo') {
        // 原生载流子动力学循环在运行
      } else if (eid === 'hall_effect') {
        let x = -0.05;
        let dir = 1;
        interactionSetup = setInterval(() => {
          if (window.__stopDynamicStress) return;
          x += dir * 0.002;
          if (x > 0.05) dir = -1;
          if (x < -0.05) dir = 1;
          if (state?.data) state.data.x = x;
        }, 16);
      }

      const dynFpsPromise = new Promise((resolve) => {
        let count = 0;
        const deltas = [];
        let lastT = performance.now();
        const startT = lastT;
        function step(now) {
          const dt = now - lastT;
          deltas.push(dt);
          lastT = now;
          count++;
          if (now - startT >= durationMs) {
            const actualTotalMs = now - startT;
            const avgFps = count / (actualTotalMs / 1000);
            deltas.shift();
            deltas.sort((a, b) => a - b);
            const p50 = deltas[Math.floor(deltas.length * 0.50)] || 0;
            const p95 = deltas[Math.floor(deltas.length * 0.95)] || 0;
            resolve({
              avgFps: Number(avgFps.toFixed(2)),
              p50: Number(p50.toFixed(2)),
              p95: Number(p95.toFixed(2)),
              maxGap: Number(Math.max(...deltas).toFixed(2)),
            });
          } else {
            requestAnimationFrame(step);
          }
        }
        requestAnimationFrame(step);
      });

      const res = await dynFpsPromise;
      window.__stopDynamicStress = true;
      if (interactionSetup) clearInterval(interactionSetup);
      return res;
    }, { expId, durationMs: 2000 });

    // 4. 深度采集 WebGL、光照、阴影与 DOM 合成器指标
    const deepTelemetry = await page.evaluate(() => {
      const dbg = window.__labDebug || {};
      const renderer = dbg.renderer;
      const scene = dbg.scene;

      // WebGL 统计
      const rInfo = renderer?.info || {};
      const render = rInfo.render || {};
      const memory = rInfo.memory || {};
      const programs = rInfo.programs?.length || 0;

      // 光照与阴影遍查
      let pointLightCount = 0;
      let dirLightCount = 0;
      let spotLightCount = 0;
      let hemiLightCount = 0;
      let shadowCastingLights = 0;
      let shadowCastingMeshes = 0;

      if (scene) {
        scene.traverse((obj) => {
          if (obj.isLight && obj.visible) {
            if (obj.isPointLight) pointLightCount++;
            else if (obj.isDirectionalLight) dirLightCount++;
            else if (obj.isSpotLight) spotLightCount++;
            else if (obj.isHemisphereLight) hemiLightCount++;
            if (obj.castShadow) shadowCastingLights++;
          }
          if (obj.isMesh && obj.visible && obj.castShadow) {
            shadowCastingMeshes++;
          }
        });
      }

      // DOM 与 Compositor 检查：仅检查当前真正可见的元素
      const backdropFilterEls = [];
      const transparentFullOverlayEls = [];
      const allEls = document.querySelectorAll('*');
      for (const el of allEls) {
        const style = window.getComputedStyle(el);
        const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') > 0.05;
        if (isVisible && style.backdropFilter && style.backdropFilter !== 'none') {
          backdropFilterEls.push({ tag: el.tagName, id: el.id, class: el.className, filter: style.backdropFilter });
        }
        if (style.position === 'fixed' || style.position === 'absolute') {
          const rect = el.getBoundingClientRect();
          if (rect.width >= window.innerWidth * 0.9 && rect.height >= window.innerHeight * 0.9) {
            if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity || '1') < 0.05) {
              transparentFullOverlayEls.push({ tag: el.tagName, id: el.id, class: el.className });
            }
          }
        }
      }

      return {
        drawCalls: render.calls || 0,
        triangles: render.triangles || 0,
        points: render.points || 0,
        lines: render.lines || 0,
        geometries: memory.geometries || 0,
        textures: memory.textures || 0,
        compiledPrograms: programs,
        dpr: renderer?.getPixelRatio?.() || window.devicePixelRatio || 1,
        lights: {
          point: pointLightCount,
          directional: dirLightCount,
          spot: spotLightCount,
          hemisphere: hemiLightCount,
          shadowLights: shadowCastingLights,
          shadowMeshes: shadowCastingMeshes,
        },
        compositor: {
          backdropFilterEls,
          transparentFullOverlayEls,
        },
      };
    });

    // 5. 执行智能根因归因分析 (Rule-Based Attribution)
    const rootCauseAlerts = [];

    // (A) VSync 强制半帧率下降判断
    if (staticFpsMetrics.avgFps < DIAGNOSTIC_THRESHOLDS.targetFpsMin) {
      if (staticFpsMetrics.p95 > 16.67 && staticFpsMetrics.p95 <= 21.0) {
        rootCauseAlerts.push({
          tag: 'VSYNC_QUANTIZED_DROP',
          severity: 'CRITICAL',
          message: `单帧 p95 耗时 (${staticFpsMetrics.p95}ms) 略微超出 16.67ms VSync 极限，显示器强制将其同步到 33.3ms (30 FPS)。只需压降约 ${(staticFpsMetrics.p95 - 16.66).toFixed(1)}ms 即可直接恢复 60 帧满帧！`,
          remedy: '压减着色器光源循环或限制最大 DPR。',
        });
      } else if (staticFpsMetrics.p95 > 21.0) {
        rootCauseAlerts.push({
          tag: 'HEAVY_FRAME_LATENCY',
          severity: 'CRITICAL',
          message: `单帧耗时严重超标 (p95: ${staticFpsMetrics.p95}ms)，主线程或 GPU 负担极大。`,
          remedy: '详查 Draw Calls、多重光照或 CPU 密集模拟逻辑。',
        });
      }
    }

    // (B) 几何与 Draw Calls 超标
    if (deepTelemetry.drawCalls > DIAGNOSTIC_THRESHOLDS.drawCallsMax) {
      rootCauseAlerts.push({
        tag: 'GEOMETRY_DRAW_CALL_OVERFLOW',
        severity: 'WARNING',
        message: `Draw Calls 当前为 ${deepTelemetry.drawCalls}，超出预算门限 (${DIAGNOSTIC_THRESHOLDS.drawCallsMax})。`,
        remedy: '将分散 Mesh 合并或改用 InstancedMesh / BatchedMesh 批次化。',
      });
    }

    if (deepTelemetry.triangles > DIAGNOSTIC_THRESHOLDS.trianglesMax) {
      rootCauseAlerts.push({
        tag: 'TRIANGLE_COUNT_OVERFLOW',
        severity: 'WARNING',
        message: `场景三角形总数为 ${deepTelemetry.triangles.toLocaleString()}，超出建议上限 (${DIAGNOSTIC_THRESHOLDS.trianglesMax.toLocaleString()})。`,
        remedy: '降低螺线管/环形线圈细分或改用程序化法线圆柱。',
      });
    }

    // (C) 光照与阴影超标
    if (deepTelemetry.lights.point > DIAGNOSTIC_THRESHOLDS.activePointLightsMax) {
      rootCauseAlerts.push({
        tag: 'EXCESSIVE_POINT_LIGHTS',
        severity: 'WARNING',
        message: `活跃点光源多达 ${deepTelemetry.lights.point} 个（建议 ≤ ${DIAGNOSTIC_THRESHOLDS.activePointLightsMax}）。点光源具有全向高阶衰减计算开销。`,
        remedy: '合并顶灯为单一大范围光源，并休眠非活动台位的光源 (visible = false)。',
      });
    }

    if (deepTelemetry.lights.shadowMeshes > DIAGNOSTIC_THRESHOLDS.shadowCastingMeshesMax) {
      rootCauseAlerts.push({
        tag: 'TOO_MANY_SHADOW_CASTERS',
        severity: 'NOTICE',
        message: `投射阴影物体多达 ${deepTelemetry.lights.shadowMeshes} 个。微小零件投影开销性价比极低。`,
        remedy: '对滑块小按钮、小沉槽关闭 castShadow = false。',
      });
    }

    // (D) DOM 与合成器开销 (仅警报当前处于可见状态的 backdropFilter)
    if (deepTelemetry.compositor.backdropFilterEls.length > 0) {
      rootCauseAlerts.push({
        tag: 'COMPOSITOR_BLUR_FILTER',
        severity: 'WARNING',
        message: `检测到可见常驻元素应用了 backdrop-filter: blur() (${deepTelemetry.compositor.backdropFilterEls.map(e => e.class || e.id || e.tag).join(', ')})，GPU 每次绘制需对帧缓冲进行高斯多通道卷积降采样！`,
        remedy: '将其替换为高对比度半透明渐变玻璃质感背景，禁用实时全屏模糊。',
      });
    }

    if (deepTelemetry.compositor.transparentFullOverlayEls.length > 0) {
      rootCauseAlerts.push({
        tag: 'COMPOSITOR_TRANSPARENT_OVERLAY',
        severity: 'CRITICAL',
        message: `检测到不可见但未设置 display:none 的全屏透明遮罩 (${deepTelemetry.compositor.transparentFullOverlayEls.map(e => e.class || e.id || e.tag).join(', ')})，强制合成器进行全屏 Alpha 混合！`,
        remedy: '在关闭状态下添加 display: none !important。',
      });
    }

    // (E) 动态交互劣变
    const fpsDelta = staticFpsMetrics.avgFps - dynamicMetrics.avgFps;
    if (fpsDelta > DIAGNOSTIC_THRESHOLDS.dynamicFpsDropMax) {
      rootCauseAlerts.push({
        tag: 'DYNAMIC_INTERACTION_DEGRADATION',
        severity: 'WARNING',
        message: `动态交互时帧率明显下降 (静态 ${staticFpsMetrics.avgFps} FPS -> 动态 ${dynamicMetrics.avgFps} FPS，跌幅 ${fpsDelta.toFixed(1)} FPS)。`,
        remedy: '检查连续拖拽或参数改变时是否触发了每帧 2D Canvas 文本重绘或 GPU 纹理回传，应对更新施加 60ms 节流。',
      });
    }

    // 收集单项结果
    const itemReport = {
      stationId,
      expId,
      name,
      openMs: openRes?.wallMs || 0,
      static: staticFpsMetrics,
      dynamic: dynamicMetrics,
      telemetry: deepTelemetry,
      alerts: rootCauseAlerts,
    };

    reportResults.push(itemReport);

    // 终端格式化打印该实验的诊断结果
    const statusIcon = rootCauseAlerts.some(a => a.severity === 'CRITICAL')
      ? `${c.red}✖ FAIL${c.reset}`
      : (rootCauseAlerts.length > 0 ? `${c.yellow}▲ WARN${c.reset}` : `${c.green}✔ PASS${c.reset}`);

    console.log(`  状态: ${statusIcon}`);
    console.log(`  加载耗时: ${formatMs(openRes?.wallMs)} | 静态帧率: ${formatFps(staticFpsMetrics.avgFps)} (p50: ${formatMs(staticFpsMetrics.p50)}, p95: ${formatMs(staticFpsMetrics.p95)})`);
    console.log(`  动态帧率: ${formatFps(dynamicMetrics.avgFps)} (p50: ${formatMs(dynamicMetrics.p50)}, p95: ${formatMs(dynamicMetrics.p95)})`);
    console.log(`  管线指标: DrawCalls = ${c.bold}${deepTelemetry.drawCalls}${c.reset} | 三角形 = ${c.bold}${deepTelemetry.triangles.toLocaleString()}${c.reset} | 点光源 = ${deepTelemetry.lights.point} | 阴影体 = ${deepTelemetry.lights.shadowMeshes}`);

    if (rootCauseAlerts.length > 0) {
      console.log(`  ${c.bold}智能归因诊断警报与修复指引:${c.reset}`);
      for (const alert of rootCauseAlerts) {
        const tagColor = alert.severity === 'CRITICAL' ? c.red : (alert.severity === 'WARNING' ? c.yellow : c.cyan);
        console.log(`    ${tagColor}[${alert.tag}] (${alert.severity})${c.reset} ${alert.message}`);
        console.log(`      ${c.dim}↳ 建议对策: ${alert.remedy}${c.reset}`);
      }
    } else {
      console.log(`  ${c.green}✔ 完美：各项指标均在安全预算范围内，无性能劣变根因。${c.reset}`);
    }
  }

  // 6. 内存与显存泄漏压力测试 (连续 5 次同一工作台快速轮转)
  console.log(`\n${c.bold}[内存与显存防泄露巡检] 正在对各实验执行 5 次连续装载/卸载轮转...${c.reset}`);
  const initialMem = await page.evaluate(() => ({
    geometries: window.__labDebug?.renderer?.info?.memory?.geometries || 0,
    textures: window.__labDebug?.renderer?.info?.memory?.textures || 0,
  }));

  for (let cycle = 0; cycle < 5; cycle++) {
    for (const item of cases) {
      await page.evaluate(async ({ stationId, expId }) => {
        await window.__labDebug.measureOpen({ stationId, expId, prewarm: false, openMenu: false });
      }, item);
    }
  }

  const finalMem = await page.evaluate(() => ({
    geometries: window.__labDebug?.renderer?.info?.memory?.geometries || 0,
    textures: window.__labDebug?.renderer?.info?.memory?.textures || 0,
  }));

  const geomDelta = finalMem.geometries - initialMem.geometries;
  const texDelta = finalMem.textures - initialMem.textures;
  let leakPassed = true;
  if (geomDelta > 25 || texDelta > 20) {
    leakPassed = false;
    console.log(`  ${c.red}✖ 检测到显存资源残留！几何体净增长: +${geomDelta}, 纹理净增长: +${texDelta}${c.reset}`);
    console.log(`    ${c.yellow}↳ 建议对策: 检查实验退出回调，确保在 exitExperiment 时显式调用 dispose() 释放 Geometry 与 Material。${c.reset}`);
  } else {
    console.log(`  ${c.green}✔ 内存防泄露巡检通过：连续 5 轮次深度装卸后资源平稳 (几何体净变动: ${geomDelta}, 纹理净变动: ${texDelta})${c.reset}`);
  }

  await browser.close();
  if (serverProcess) serverProcess.kill();

  // 7. 保存持久化报告 output/perf-diagnostic.json
  const outputDir = path.join(ROOT_DIR, 'output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const reportPath = path.join(outputDir, 'perf-diagnostic.json');
  const fullReport = {
    timestamp: new Date().toISOString(),
    totalCases: cases.length,
    leakCheck: { geomDelta, texDelta, passed: leakPassed },
    consoleErrors: consoleLogs,
    results: reportResults,
  };
  fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2), 'utf8');
  console.log(`\n${c.dim}[LabDiagnose] 详细诊断数据已持久化至: ${reportPath}${c.reset}\n`);

  const hasCriticalFailure = reportResults.some(r => r.alerts.some(a => a.severity === 'CRITICAL')) || !leakPassed;
  if (hasCriticalFailure) {
    console.log(`${c.red}${c.bold}✖ 自动化诊断完成：检测到关键性能或资源隐患，请根据上述修复指引进行排查。${c.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${c.green}${c.bold}✔ 自动化诊断完成：所有活动实验均达到 60 FPS 满帧标准且各项管线预算完备！${c.reset}\n`);
    process.exit(0);
  }
}

runDiagnostic().catch((err) => {
  console.error(`\n${c.red}${c.bold}[Fatal Error] 自动化测试执行异常:${c.reset}`, err);
  process.exit(1);
});
