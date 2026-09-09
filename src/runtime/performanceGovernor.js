/**
 * Fixed-quality performance governor for the browser laboratory.
 *
 * This module intentionally does not change render quality at runtime.  It
 * measures the frame budget, exposes a compact snapshot for diagnostics, and
 * reports sustained pressure so the user can make an informed decision on
 * hardware that cannot sustain the selected quality profile.
 */

export const HIGH_QUALITY_PROFILE = Object.freeze({
  shadowMapSize: 2048,
  particleBudget: 20000,
  bloomEnabled: true,
  bloomScale: 0.75,
  fogQuality: 'high',
});

const FRAME_SAMPLE_LIMIT = 240;
const PANEL_UPDATE_MS = 250;
const FRAME_BUDGET_MS = 1000 / 60;
const WARNING_COOLDOWN_MS = 10000;

function nowMs() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index] || 0;
}

function formatMs(value) {
  return `${Number.isFinite(value) ? value.toFixed(1) : '0.0'} ms`;
}

function formatCount(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString() : '0';
}

function createPerformanceHud() {
  if (typeof document === 'undefined') return null;

  let root = document.getElementById('physics-fps-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'physics-fps-root';
    root.className = 'physics-fps-root';
    document.body.appendChild(root);
  }

  root.innerHTML = `
    <div id="physics-fps-badge" class="physics-fps-badge" role="button" tabindex="0" aria-haspopup="dialog" aria-expanded="false" title="实时帧数 · 点击展开性能分析面板 (F3)">
      <span class="physics-fps-dot" data-perf="dot" aria-hidden="true"></span>
      <span class="physics-fps-num" data-perf="fps-val">--</span>
      <span class="physics-fps-unit">FPS</span>
      <span class="physics-fps-divider" aria-hidden="true">·</span>
      <span class="physics-fps-ms" data-perf="frame-val">-- ms</span>
    </div>
    <div id="physics-perf-overlay" class="physics-perf-overlay" hidden role="dialog" aria-label="物理实验室实时性能分析">
      <div class="perf-title">
        <span class="perf-title-text">HOLOPHYSICS 性能监控</span>
        <span class="perf-title-kbd">F3</span>
      </div>
      <div class="perf-rows">
        <div class="perf-row"><span class="perf-label">FPS (实时帧数)</span><span class="perf-value" data-perf="fps">—</span></div>
        <div class="perf-row"><span class="perf-label">Delta (帧间隔)</span><span class="perf-value" data-perf="deltaMs">—</span></div>
        <div class="perf-row"><span class="perf-label">Frame (单帧计算)</span><span class="perf-value" data-perf="frameMs">—</span></div>
        <div class="perf-row"><span class="perf-label">Render (渲染耗时)</span><span class="perf-value" data-perf="renderMs">—</span></div>
        <div class="perf-row"><span class="perf-label">Simulation (仿真耗时)</span><span class="perf-value" data-perf="simulationMs">—</span></div>
        <div class="perf-row"><span class="perf-label">DPR (像素比)</span><span class="perf-value" data-perf="dpr">—</span></div>
        <div class="perf-row"><span class="perf-label">Draw calls (绘制调用)</span><span class="perf-value" data-perf="calls">—</span></div>
        <div class="perf-row"><span class="perf-label">Triangles (三角面)</span><span class="perf-value" data-perf="triangles">—</span></div>
        <div class="perf-row"><span class="perf-label">Textures / Geo</span><span class="perf-value" data-perf="memory">—</span></div>
        <div class="perf-row"><span class="perf-label">Worker / SAB</span><span class="perf-value" data-perf="worker">—</span></div>
      </div>
      <div class="perf-status" data-perf="status">OK · 固定高画质</div>
    </div>
  `;

  const badge = root.querySelector('#physics-fps-badge');
  const overlay = root.querySelector('#physics-perf-overlay');
  const values = Object.fromEntries(
    [...root.querySelectorAll('[data-perf]')].map((node) => [node.dataset.perf, node]),
  );

  const stopProp = (e) => e.stopPropagation();
  badge.addEventListener('pointerdown', stopProp);
  badge.addEventListener('mousedown', stopProp);
  overlay.addEventListener('pointerdown', stopProp);
  overlay.addEventListener('mousedown', stopProp);

  const toggleOverlay = () => {
    overlay.hidden = !overlay.hidden;
    badge.setAttribute('aria-expanded', String(!overlay.hidden));
  };

  badge.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleOverlay();
  });
  badge.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleOverlay();
    }
  });

  return {
    root,
    badge,
    overlay,
    values,
    toggle: toggleOverlay,
    update(snapshot) {
      const fpsVal = Number.isFinite(snapshot.fps) ? Math.round(snapshot.fps) : '--';
      if (values['fps-val']) values['fps-val'].textContent = String(fpsVal);
      if (values['frame-val']) values['frame-val'].textContent = formatMs(snapshot.frameMs);
      const isThrottled = snapshot.status === 'throttled';
      if (values.dot) {
        values.dot.classList.toggle('warn', snapshot.fps < 50 && snapshot.fps >= 30 && !isThrottled);
        values.dot.classList.toggle('error', snapshot.fps < 30 && !isThrottled);
        values.dot.classList.toggle('throttled', isThrottled);
      }

      if (!overlay.hidden) {
        if (values.fps) values.fps.textContent = Number.isFinite(snapshot.fps) ? snapshot.fps.toFixed(1) : '—';
        if (values.deltaMs) values.deltaMs.textContent = Number.isFinite(snapshot.fps) && snapshot.fps > 0 ? `${(1000 / snapshot.fps).toFixed(1)} ms` : '—';
        if (values.frameMs) values.frameMs.textContent = formatMs(snapshot.frameMs);
        if (values.renderMs) values.renderMs.textContent = formatMs(snapshot.renderMs);
        if (values.simulationMs) values.simulationMs.textContent = formatMs(snapshot.simulationMs);
        if (values.dpr) values.dpr.textContent = Number(snapshot.dpr || 0).toFixed(2);
        if (values.calls) values.calls.textContent = formatCount(snapshot.render?.calls);
        if (values.triangles) values.triangles.textContent = formatCount(snapshot.render?.triangles);
        if (values.memory) values.memory.textContent = `${formatCount(snapshot.memory?.textures)} / ${formatCount(snapshot.memory?.geometries)}`;
        if (values.worker) values.worker.textContent = `${snapshot.workerMode} / ${snapshot.sharedArrayBuffer ? 'on' : 'off'}`;
        if (values.status) {
          if (snapshot.status === 'warning') {
            values.status.textContent = `WARN: ${snapshot.warningReason}`;
            values.status.className = 'perf-status warn';
          } else if (snapshot.status === 'throttled') {
            values.status.textContent = `休眠节流 · CPU仅耗时 ${snapshot.frameMs.toFixed(1)}ms · 点击页面激活`;
            values.status.className = 'perf-status throttled';
          } else {
            values.status.textContent = 'OK · 固定高画质';
            values.status.className = 'perf-status';
          }
        }
      }
    },
    dispose() {
      root.remove();
    },
  };
}

/**
 * @param {{
 *   renderer?: object,
 *   quality?: object,
 *   onStatusChange?: (status: string, snapshot: object) => void,
 * }} [options]
 */
export function createPerformanceGovernor(options = {}) {
  const renderer = options.renderer || null;
  const quality = Object.freeze({ ...HIGH_QUALITY_PROFILE, ...(options.quality || {}) });
  const panel = createPerformanceHud();
  const frameSamples = [];
  let frameStart = 0;
  let frameMs = 0;
  let renderMs = 0;
  let simulationMs = 0;
  let lastPanelUpdate = -Infinity;
  let lastFrameAt = 0;
  let fps = 0;
  let windowFrames = 0;
  let windowStartTime = 0;
  let windowFrameMsSum = 0;
  let avgFrameMs = 16.7;
  let slowFrameStreak = 0;
  let lowFpsSince = 0;
  let mainFrameOver25 = false;
  let status = 'ok';
  let warningReason = '';
  let lastWarningAt = -Infinity;
  let longTaskCount = 0;
  let longTaskMax = 0;
  let runtimeInfo = {
    workerMode: 'auto',
    sharedArrayBuffer: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true,
    workerPending: 0,
  };

  let longTaskObserver = null;
  try {
    if (typeof PerformanceObserver !== 'undefined') {
      longTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTaskCount += 1;
          longTaskMax = Math.max(longTaskMax, entry.duration);
        }
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
    }
  } catch { /* unsupported browser / WebView */ }

  function getRendererStats() {
    return {
      render: renderer?.info?.render ? { ...renderer.info.render } : {},
      memory: renderer?.info?.memory ? { ...renderer.info.memory } : {},
      programs: renderer?.info?.programs?.length || 0,
    };
  }

  function getSnapshot() {
    const stats = getRendererStats();
    return {
      status,
      warningReason,
      quality,
      fps,
      frameMs: avgFrameMs || frameMs,
      frameP95: percentile(frameSamples, 95),
      renderMs,
      simulationMs,
      dpr: renderer?.getPixelRatio?.() || 1,
      render: stats.render,
      memory: stats.memory,
      programs: stats.programs,
      workerMode: runtimeInfo.workerMode,
      sharedArrayBuffer: runtimeInfo.sharedArrayBuffer,
      workerPending: runtimeInfo.workerPending,
      longTaskCount,
      longTaskMax,
      frameSamples: frameSamples.length,
    };
  }

  function publishStatus(nextStatus, reason, timestamp) {
    if (nextStatus === status && reason === warningReason) return;
    status = nextStatus;
    warningReason = reason || '';
    if (nextStatus === 'warning' && timestamp - lastWarningAt >= WARNING_COOLDOWN_MS) {
      lastWarningAt = timestamp;
      options.onStatusChange?.(nextStatus, getSnapshot());
    } else if (nextStatus === 'ok') {
      options.onStatusChange?.(nextStatus, getSnapshot());
    }
  }

  function checkWindowFocused() {
    if (typeof document === 'undefined') return true;
    if (document.visibilityState === 'hidden') return false;
    let focused = false;
    try {
      focused = document.hasFocus();
    } catch {}
    if (!focused) {
      try {
        if (typeof window !== 'undefined' && window.top && window.top !== window) {
          focused = !!window.top.document?.hasFocus?.();
        }
      } catch {}
    }
    return focused;
  }

  function updatePressure(timestamp) {
    if (frameMs > FRAME_BUDGET_MS) slowFrameStreak += 1;
    else slowFrameStreak = 0;

    const isVisible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
    // Only flag as throttled if the page is truly hidden in the background, or
    // browser energy saver / ProMotion has throttled rAF below 40 FPS while CPU frame time is healthy.
    const isThrottled = !isVisible || (fps > 0 && fps <= 40 && frameMs <= 14);

    if (fps > 0 && fps < 45 && !isThrottled) {
      if (!lowFpsSince) lowFpsSince = timestamp;
    } else {
      lowFpsSince = 0;
    }

    mainFrameOver25 = frameMs > 25;
    let reason = '';
    let nextStatus = 'ok';
    if (slowFrameStreak >= 3) {
      reason = '连续 3 帧超过 16.7ms';
      nextStatus = 'warning';
    } else if (mainFrameOver25) {
      reason = '主线程单帧超过 25ms';
      nextStatus = 'warning';
    } else if (lowFpsSince && timestamp - lowFpsSince >= 2000) {
      reason = 'FPS 持续低于 50';
      nextStatus = 'warning';
    } else if (runtimeInfo.workerPending > 3) {
      reason = 'Worker 计算积压超过 3 个结果';
      nextStatus = 'warning';
    } else if (isThrottled && fps > 0 && fps < 55) {
      reason = '窗口失焦/后台节能节流中';
      nextStatus = 'throttled';
    }

    publishStatus(nextStatus, reason, timestamp);
  }

  function beginFrame(timestamp = nowMs()) {
    frameStart = timestamp;
    renderMs = 0;
    simulationMs = 0;
  }

  function recordSimulation(ms) {
    if (Number.isFinite(ms)) simulationMs += Math.max(0, ms);
  }

  function recordRender(ms) {
    if (Number.isFinite(ms)) renderMs = Math.max(0, ms);
  }

  function endFrame(timestamp = nowMs()) {
    if (!frameStart) frameStart = timestamp;
    frameMs = Math.max(0, timestamp - frameStart);
    frameSamples.push(frameMs);
    if (frameSamples.length > FRAME_SAMPLE_LIMIT) frameSamples.shift();

    windowFrames += 1;
    windowFrameMsSum += frameMs;
    if (!windowStartTime) {
      windowStartTime = timestamp;
    }

    const windowElapsed = timestamp - windowStartTime;
    if (windowElapsed >= PANEL_UPDATE_MS) {
      if (windowElapsed > 0) {
        fps = (windowFrames * 1000) / windowElapsed;
        avgFrameMs = windowFrameMsSum / windowFrames;
      }
      windowFrames = 0;
      windowFrameMsSum = 0;
      windowStartTime = timestamp;
    } else if (fps === 0 && lastFrameAt > 0) {
      const delta = timestamp - lastFrameAt;
      if (delta > 0) fps = 1000 / delta;
    }

    lastFrameAt = timestamp;
    updatePressure(timestamp);
    if (panel && timestamp - lastPanelUpdate >= PANEL_UPDATE_MS) {
      panel.update(getSnapshot());
      lastPanelUpdate = timestamp;
    }
    return status;
  }

  function setRuntimeInfo(info = {}) {
    runtimeInfo = { ...runtimeInfo, ...info };
  }

  const keyHandler = (event) => {
    if (event.code === 'F3' && panel) {
      event.preventDefault();
      panel.toggle();
    }
  };
  if (panel) window.addEventListener('keydown', keyHandler);

  return {
    quality,
    beginFrame,
    recordSimulation,
    recordRender,
    endFrame,
    setRuntimeInfo,
    getSnapshot,
    getStatus: () => status,
    dispose() {
      if (typeof window !== 'undefined') window.removeEventListener?.('keydown', keyHandler);
      longTaskObserver?.disconnect?.();
      panel?.dispose?.();
    },
  };
}
