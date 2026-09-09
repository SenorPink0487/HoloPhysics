/**
 * Fullscreen hologram surface controller.
 *
 * Owns DOM canvas sizing, paint state and hit testing. The lab shell supplies
 * scene objects and experiment-specific callbacks, keeping this controller
 * independent of Three.js and of any station implementation.
 */
export function createHoloFullscreenController({
  element,
  canvas,
  drawScreen,
  pickScreen,
  getHolo,
  getDisplay,
  getHud,
  getDataHtml,
  scheduler,
  unlockControls = () => {},
  onToast = () => {},
} = {}) {
  const context = canvas?.getContext?.('2d') || null;
  const state = {
    open: false,
    stationId: null,
    hits: [],
    canvasW: 1600,
    canvasH: 1000,
  };

  function resize() {
    if (!canvas || !element) return;
    const frame = element.querySelector('.holo-fs-frame');
    const rect = frame?.getBoundingClientRect() || { width: window.innerWidth, height: window.innerHeight };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = Math.max(320, rect.width);
    const cssH = Math.max(240, rect.height);
    // Keep the dense experiment UI readable on short viewports.
    const logicalScale = Math.max(1, 820 / (cssH * dpr));
    const bufW = Math.round(cssW * dpr * logicalScale);
    const bufH = Math.round(cssH * dpr * logicalScale);
    state.canvasW = bufW;
    state.canvasH = bufH;
    canvas.width = bufW;
    canvas.height = bufH;
  }

  function paint() {
    if (!state.open || !context || !canvas) return;
    const holo = getHolo?.(state.stationId);
    if (!holo?.userData) return;
    const source = getDisplay?.(state.stationId)?.userData || holo.userData;
    const result = drawScreen(context, canvas.width, canvas.height, {
      accentHex: source.accentHex || holo.userData.accentHex || '#38bdf8',
      fullTitle: source.fullTitle || holo.userData.fullTitle || '实验台',
      enTitle: source.enTitle || holo.userData.enTitle || 'STATION',
      active: true,
      hud: getHud?.() || null,
      dataHtml: getDataHtml?.() || '',
      maximized: true,
      surface: 'display',
      theme: 'light',
      pressedPick: state.pressedPick || null,
    });
    state.hits = result?.hits || [];
  }

  function open(stationId) {
    if (!element || !canvas) return false;
    state.open = true;
    state.stationId = stationId;
    element.classList.add('open');
    element.setAttribute('aria-hidden', 'false');
    document.body.classList.add('holo-fs-open');
    unlockControls();
    getHolo?.(stationId)?.userData?.setMaximized?.(true);
    getDisplay?.(stationId)?.userData?.setMaximized?.(true);
    resize();
    paint();
    onToast('已全屏显示实验内容屏 · Esc 退出全屏');
    return true;
  }

  function close({ keepMaximizedFlag = false } = {}) {
    if (!element) return false;
    const stationId = state.stationId;
    state.open = false;
    state.hits = [];
    element.classList.remove('open');
    element.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('holo-fs-open');
    if (stationId) {
      scheduler?.cancel?.(`hud:display-full:${stationId}`);
      scheduler?.cancel?.(`hud:display-shell:${stationId}`);
      scheduler?.cancel?.(`hud:selector:${stationId}`);
      scheduler?.cancel?.('hud:fs-paint');
      scheduler?.cancel?.('hud:close-fs');
      if (!keepMaximizedFlag) {
        const holo = getHolo?.(stationId);
        const display = getDisplay?.(stationId);
        if (holo?.userData) holo.userData.maximized = false;
        if (display?.userData) display.userData.maximized = false;
      }
    }
    state.stationId = null;
    scheduler?.schedule?.('hud:fs-free', () => {
      if (state.open || !canvas || (canvas.width <= 4 && canvas.height <= 4)) return;
      canvas.width = 1;
      canvas.height = 1;
      state.canvasW = 1;
      state.canvasH = 1;
    }, { priority: 20 });
    return true;
  }

  function toggle(stationId) {
    if (state.open && state.stationId === stationId) {
      close();
      onToast('已退出全屏');
      return false;
    }
    return open(stationId);
  }

  function pointFromClient(clientX, clientY) {
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    return {
      px: ((clientX - rect.left) / rect.width) * canvas.width,
      py: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function pickAt(clientX, clientY) {
    const point = pointFromClient(clientX, clientY);
    if (!point || !canvas) return null;
    const hits = state.hits || [];
    const picked = pickScreen?.(
      point.px / canvas.width,
      1 - point.py / canvas.height,
      canvas.width,
      canvas.height,
      hits,
      1,
    );
    if (picked) return picked;
    for (let i = hits.length - 1; i >= 0; i -= 1) {
      const hit = hits[i];
      if (point.px >= hit.x && point.px <= hit.x + hit.w && point.py >= hit.y && point.py <= hit.y + hit.h) return hit;
    }
    if (point.px <= canvas.width * 0.7 || point.py >= canvas.height * 0.14) return null;
    let nearest = null;
    let distance = Infinity;
    for (const hit of hits) {
      if (!hit.chrome) continue;
      const d = (point.px - (hit.x + hit.w / 2)) ** 2 + (point.py - (hit.y + hit.h / 2)) ** 2;
      if (d < distance) { distance = d; nearest = hit; }
    }
    return nearest;
  }

  return { state, resize, paint, open, close, toggle, pointFromClient, pickAt };
}
