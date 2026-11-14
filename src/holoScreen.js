
/**
 * Draw interactive experiment UI onto hologram canvas textures
 * and resolve UV picks like a flat computer screen.
 */

import {
  drawMathFormula,
  formatPhysicsNumber,
} from './physicsFormula.js';

/**
 * Global UI scale for hologram surfaces.
 * Display is only mildly larger than full — prefer density over empty padding.
 */
export function holoUiScale(surface = 'full') {
  if (surface === 'display') return 2.15;
  if (surface === 'selector') return 1.35;
  return 1.12;
}

/** Experiment-card height on the station menu / tabletop selector. */
export const HOLO_MENU_CARD_H = 96;
export const HOLO_MENU_CARD_GAP = 14;

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
  const s = String(text || '');
  if (!s) return [''];
  const lines = [];
  let line = '';
  for (const ch of s) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

const HALL_MU0 = 4 * Math.PI * 1e-7;
const HALL_K = 301; // calibrated representative value, V·A⁻¹·T⁻¹ (301 mV·mA⁻¹·T⁻¹)
const HALL_COIL_RADIUS_M = 0.05;
const HALL_COIL_TURNS = 210;
const HALL_SOLENOID_LENGTH_M = 0.30;
const HALL_SOLENOID_RADIUS_M = 0.014;

/** Magnetic flux density in T from standard on-axis field equations. */
function hallTheoreticalB(data, pos) {
  const rawX = Number(pos || 0);
  const Im = Number(data.Im || 0);
  let bTesla = 0;
  if (data.target === 'solenoid') {
    const rawLen = Number(data.solenoidLength || 0.30);
    const length = (rawLen > 2 ? rawLen / 100 : rawLen) || HALL_SOLENOID_LENGTH_M;
    const halfL = length / 2;
    const rawRad = Number(data.solenoidRadius || HALL_SOLENOID_RADIUS_M);
    const radius = (rawRad > 0.5 ? rawRad / 100 : rawRad) || HALL_SOLENOID_RADIUS_M;
    const n = Number(data.turns || 2340) / length;
    const endCos = (z) => z / Math.sqrt(z * z + radius * radius);
    // 探杆刻度 X (cm)，从 1.0 cm 测到 31.0 cm，中心为 16.0 cm
    const x = (16.0 - rawX) / 100;
    bTesla = HALL_MU0 * n * Im * 0.5
      * (endCos(x + halfL) - endCos(x - halfL));
  } else {
    const rawRad = Number(data.coilRadius || 0.05);
    const radius = (rawRad > 0.5 ? rawRad / 100 : rawRad) || HALL_COIL_RADIUS_M;
    const turns = Number(data.coilTurns || 210) || HALL_COIL_TURNS;
    const x = Math.abs(rawX) > 0.5 ? rawX / 100 : rawX;
    const fixedX = 0;
    const rawMovingX = Number(data.rightCoilPos ?? 0.05);
    const movingX = Math.abs(rawMovingX) > 0.5 ? rawMovingX / 100 : rawMovingX;
    const fieldAt = (centreX) => (
      HALL_MU0 * turns * Im * radius ** 2
      / (2 * Math.pow(radius ** 2 + (x - centreX) ** 2, 1.5))
    );
    const coilMode = data.coilMode || data.wiring?.coilMode || 'both';
    if (coilMode === 'fixed') {
      bTesla = fieldAt(fixedX);
    } else if (coilMode === 'moving') {
      bTesla = fieldAt(movingX);
    } else {
      bTesla = fieldAt(fixedX) + fieldAt(movingX);
    }
  }
  return bTesla * Number(data.direction || 1);
}

function hallRecordedB(record) {
  if (Number.isFinite(Number(record.b))) {
    const bVal = Number(record.b);
    return Math.abs(bVal) > 0.05 ? bVal / 1000 : bVal;
  }
  const rawIs = Math.max(1e-9, Number(record.Is || 0));
  const Is = rawIs > 0.05 ? rawIs / 1000 : rawIs;
  const rawVh = Number(record.vh || 0);
  const vh = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
  const rawOffset = Number(record.zeroOffset || 0);
  const zeroOffset = Math.abs(rawOffset) > 0.05 ? rawOffset / 1000 : rawOffset;
  return (vh - zeroOffset) / (Number(record.hallK || HALL_K) * Is);
}

/** Shared chrome / text palette for dark holo vs light content display. */
function screenPalette(theme = 'dark', accentHex = '#38bdf8', isDisplay = false) {
  if (theme === 'light') {
    return {
      theme: 'light',
      accent: accentHex,
      title: '#0f172a',
      text: '#1e293b',
      muted: '#475569',
      soft: '#334155',
      headerBg: isDisplay ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.88)',
      panel: isDisplay ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.85)',
      panelAlt: isDisplay ? 'rgba(241, 245, 249, 0.92)' : 'rgba(248, 250, 252, 0.85)',
      panelStroke: 'rgba(14, 165, 233, 0.40)',
      card: isDisplay ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.85)',
      cardStroke: 'rgba(14, 165, 233, 0.45)',
      dataBg: isDisplay ? 'rgba(248, 250, 252, 0.95)' : 'rgba(248, 250, 252, 0.88)',
      dataText: '#0f172a',
      hintBg: 'rgba(224, 242, 254, 0.88)',
      hintText: '#0369a1',
      btnFill: 'rgba(14, 165, 233, 0.18)',
      btnFillStrong: 'rgba(14, 165, 233, 0.32)',
      btnText: '#0f172a',
      btnIdle: isDisplay ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.85)',
      btnIdleText: '#0f172a',
      closeFill: 'rgba(239, 68, 68, 0.14)',
      closeStroke: 'rgba(239, 68, 68, 0.50)',
      closeText: '#dc2626',
      maxFill: 'rgba(14, 165, 233, 0.16)',
      maxFillOn: 'rgba(14, 165, 233, 0.32)',
      maxIcon: '#0284c7',
      scanline: 'rgba(14, 165, 233, 0.008)',
      done: '#16a34a',
      theoryBg: 'rgba(224, 242, 254, 0.80)',
      stepBox: isDisplay ? 'rgba(255, 255, 255, 0.92)' : 'rgba(255, 255, 255, 0.85)',
    };
  }
  return {
    theme: 'dark',
    accent: accentHex,
    title: '#ffffff',
    text: '#f8fafc',
    muted: 'rgba(148, 163, 184, 0.92)',
    soft: 'rgba(186, 230, 253, 0.88)',
    headerBg: isDisplay ? 'rgba(6, 16, 36, 0.95)' : 'rgba(6, 16, 32, 0.88)',
    panel: isDisplay ? 'rgba(10, 22, 48, 0.92)' : 'rgba(10, 22, 44, 0.85)',
    panelAlt: isDisplay ? 'rgba(14, 30, 60, 0.92)' : 'rgba(14, 30, 58, 0.85)',
    panelStroke: 'rgba(56, 189, 248, 0.55)',
    card: isDisplay ? 'rgba(15, 30, 58, 0.90)' : 'rgba(15, 30, 56, 0.80)',
    cardStroke: accentHex,
    dataBg: isDisplay ? 'rgba(6, 16, 36, 0.95)' : 'rgba(6, 16, 32, 0.88)',
    dataText: '#f8fafc',
    hintBg: 'rgba(56, 189, 248, 0.22)',
    hintText: '#7dd3fc',
    btnFill: 'rgba(56, 189, 248, 0.28)',
    btnFillStrong: 'rgba(34, 211, 238, 0.45)',
    btnText: '#ffffff',
    btnIdle: isDisplay ? 'rgba(15, 30, 58, 0.90)' : 'rgba(15, 30, 56, 0.80)',
    btnIdleText: '#e0f2fe',
    closeFill: 'rgba(248, 113, 113, 0.28)',
    closeStroke: 'rgba(239, 68, 68, 0.85)',
    closeText: '#fecaca',
    maxFill: 'rgba(56, 189, 248, 0.28)',
    maxFillOn: 'rgba(56, 189, 248, 0.48)',
    maxIcon: '#e0f2fe',
    scanline: 'rgba(56, 189, 248, 0.025)',
    done: '#4ade80',
    theoryBg: 'rgba(34, 211, 238, 0.12)',
    stepBox: isDisplay ? 'rgba(6, 16, 36, 0.90)' : 'rgba(6, 16, 32, 0.80)',
  };
}

let _uiTheme = 'dark';
let _uiPressedAction = null;
let _uiPressedId = null;
let _uiHoverAction = null;
let _uiHoverId = null;

function drawPremiumHoloButton(ctx, hits, x, y, w, h, label, action, meta, accent, active = false, theme = 'dark', pressed = false) {
  const btnOpts = (pressed && typeof pressed === 'object') ? pressed : null;
  const flagPressed = btnOpts ? Boolean(btnOpts.pressed) : Boolean(pressed);
  const isPressed = flagPressed || (action && _uiPressedAction === action) || (meta?.id && _uiPressedId === meta.id);
  const isLight = theme === 'light';
  ctx.save();

  // Physical mechanical press sink (both mouse click and touch tap)
  const bx = isPressed ? x + 1 : x;
  const by = isPressed ? y + 2 : y;
  const bw = isPressed ? w - 2 : w;
  const bh = isPressed ? h - 2 : h;

  // Unified cohesive palette:
  // Idle buttons use clean, uniform neutral glass styling without noisy color borders.
  // Active/pressed buttons cleanly use the unified primary accent (sky-blue/cyan).
  const primaryAccent = isLight ? '#0284c7' : '#38bdf8';

  if (isPressed || active) {
    ctx.fillStyle = isLight ? 'rgba(14, 165, 233, 0.18)' : 'rgba(56, 189, 248, 0.28)';
    ctx.strokeStyle = primaryAccent;
    ctx.lineWidth = 1.4;
  } else {
    ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.70)' : 'rgba(12, 24, 45, 0.55)';
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(56, 189, 248, 0.20)';
    ctx.lineWidth = 1.0;
  }
  roundRect(ctx, bx, by, bw, bh, 8);
  ctx.fill();
  ctx.stroke();

  ctx.restore();

  ctx.save();
  const text = String(label || '');
  const textColor = (isPressed || active)
    ? (isLight ? '#0284c7' : '#ffffff')
    : (isLight ? '#1e293b' : 'rgba(241, 245, 249, 0.90)');

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const customFontSize = Number(btnOpts?.fontPx ?? btnOpts?.fontSize ?? meta?.fontSize);
  let fontSize;
  if (Number.isFinite(customFontSize) && customFontSize > 0) {
    fontSize = customFontSize;
  } else if (/[\\_^{}]/.test(text) && !/[\u4e00-\u9fa5]/.test(text)) {
    fontSize = Math.max(18, Math.min(34, Math.round(bh * 0.68)));
  } else {
    fontSize = Math.max(13, Math.min(22, Math.round(bh * 0.46)));
  }

  if (/[\\_^{}]/.test(text)) {
    drawMathFormula(ctx, text, bx + bw / 2, by + bh / 2, {
      fontSize,
      color: textColor,
      align: 'center',
      textBaseline: 'middle',
      fontWeight: 'bold',
      maxWidth: bw - 12,
    });
  } else {
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "SF Pro Text", "Microsoft YaHei", sans-serif`;
    while (fontSize > 11 && ctx.measureText(text).width > bw - 12) {
      fontSize -= 1;
      ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "PingFang SC", "SF Pro Text", "Microsoft YaHei", sans-serif`;
    }
    ctx.fillStyle = textColor;
    ctx.fillText(text, bx + bw / 2, by + bh / 2);
  }
  ctx.restore();

  hits.push({ x, y, w, h, action, label, ...meta });
}

function drawHallButton(ctx, hits, x, y, w, h, label, action, meta, accent, active = false, hovered = false) {
  drawPremiumHoloButton(ctx, hits, x, y, w, h, label, action, meta, accent, active, _uiTheme, hovered);
}

/**
 * Shared numeric parameter slider for content screens.
 * Replaces − / + steppers with a continuous track + thumb.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object[]} hits
 * @param {object} opts
 * @param {number} opts.x left of full control row
 * @param {number} opts.y top of row
 * @param {number} opts.w row width
 * @param {number} opts.h row height
 * @param {string} opts.label
 * @param {number} opts.value
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {string} opts.setAction experiment uiAction that accepts { key, value, axis? }
 * @param {string} [opts.key]
 * @param {string} [opts.axis]
 * @param {string} [opts.unit]
 * @param {number} [opts.digits=2]
 * @param {string} [opts.accentHex]
 * @param {boolean} [opts.compact] denser layout for twin-column editors
 * @param {string} [opts.id]
 */
function drawParamSlider(ctx, hits, opts) {
  const {
    x, y, w, h,
    label,
    value,
    min,
    max,
    setAction,
    key = null,
    axis = null,
    target = null,
    unit = '',
    digits = 2,
    accentHex = '#38bdf8',
    compact = false,
    /** Bigger label/value type for content screens that prioritize readability. */
    largeType = false,
    /** Hide min/max ticks under the track (cleaner when largeType). */
    hideRange = false,
    step = null,
    id = null,
  } = opts;
  const P = screenPalette(_uiTheme, accentHex, false);
  const v = Number(value || 0);
  const lo = Number(min);
  const hi = Number(max);
  const range = Math.max(1e-9, hi - lo);
  const norm = Math.max(0, Math.min(1, (v - lo) / range));
  const padX = largeType
    ? Math.round(h * 0.12)
    : compact ? Math.round(h * 0.18) : Math.round(h * 0.22);
  const labelH = largeType
    ? Math.round(h * 0.46)
    : compact ? Math.round(h * 0.38) : Math.round(h * 0.42);

  const labelPx = largeType
    ? Math.min(26, Math.max(15, Math.round(h * 0.34)))
    : Math.min(20, Math.max(11, Math.round(h * 0.22)));
  const valuePx = largeType
    ? Math.min(28, Math.max(17, Math.round(h * 0.38)))
    : Math.min(22, Math.max(12, Math.round(h * 0.28)));
  const rangePx = largeType
    ? Math.min(16, Math.max(13, Math.round(h * 0.18)))
    : Math.min(13, Math.max(9, Math.round(h * 0.14)));

  const labelStr = String(label || '');
  const labelY = y + Math.round(h * (largeType ? 0.06 : 0.08));
  const innerSpan = Math.max(40, w - padX * 2);
  const labelMaxW = Math.max(36, Math.floor(innerSpan * 0.56));
  const valueMaxW = Math.max(36, innerSpan - labelMaxW - 10);
  if (/[\\_^{}]|[A-Za-z]/.test(labelStr)) {
    drawMathFormula(ctx, labelStr, x + padX, labelY, {
      fontSize: labelPx,
      color: P.muted,
      align: 'left',
      textBaseline: 'top',
      maxWidth: labelMaxW,
    });
  } else {
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${labelPx}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(labelStr, x + padX, labelY, labelMaxW);
  }

  ctx.fillStyle = P.text;
  let fitValPx = valuePx;
  ctx.font = `bold ${fitValPx}px "Microsoft YaHei", sans-serif`;
  const valueText = `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
  while (fitValPx > 12 && ctx.measureText(valueText).width > valueMaxW) {
    fitValPx -= 1;
    ctx.font = `bold ${fitValPx}px "Microsoft YaHei", sans-serif`;
  }
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(valueText, x + w - padX, y + Math.round(h * (largeType ? 0.04 : 0.06)));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const trackX = x + padX;
  const trackW = Math.max(8, w - padX * 2);
  const trackH = Math.max(largeType ? 10 : 8, Math.round(h * (largeType ? 0.16 : compact ? 0.18 : 0.2)));
  const trackY = y + labelH + Math.round((h - labelH - trackH) * (largeType ? 0.2 : 0.35));
  const thumbR = Math.max(largeType ? 9 : 7, Math.round(trackH * (largeType ? 1.05 : 0.95)));

  ctx.fillStyle = _uiTheme === 'light' ? 'rgba(148,163,184,.45)' : 'rgba(148,163,184,.34)';
  roundRect(ctx, trackX, trackY, trackW, trackH, trackH / 2);
  ctx.fill();
  ctx.fillStyle = accentHex;
  roundRect(ctx, trackX, trackY, trackW * norm, trackH, trackH / 2);
  ctx.fill();

  if (!hideRange) {
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${rangePx}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(lo.toFixed(Math.min(2, digits)), trackX, trackY + trackH + Math.round(h * 0.04));
    ctx.textAlign = 'right';
    ctx.fillText(hi.toFixed(Math.min(2, digits)), trackX + trackW, trackY + trackH + Math.round(h * 0.04));
    ctx.textAlign = 'left';
  }

  const thumbCx = trackX + trackW * norm;
  const thumbCy = trackY + trackH / 2;
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, thumbCx - thumbR, thumbCy - thumbR, thumbR * 2, thumbR * 2, thumbR);
  ctx.fill();
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = Math.max(2, Math.round(h * 0.05));
  ctx.stroke();

  hits.push({
    id: id || `param-slider-${setAction}-${key || axis || 'v'}`,
    role: 'param-slider',
    action: 'param-slider',
    setAction,
    key,
    axis,
    target,
    x: trackX - Math.round(padX * 0.6),
    y: y + Math.round(h * (largeType ? 0.22 : 0.28)),
    w: trackW + Math.round(padX * 1.2),
    h: Math.max(trackH + thumbR * 2, Math.round(h * (largeType ? 0.7 : 0.62))),
    trackX,
    trackW,
    min: lo,
    max: hi,
    step: Number.isFinite(Number(step)) && Number(step) > 0 ? Number(step) : null,
    dragAxis: 'x',
  });
}

/** True for any continuous content-screen slider hit. */
export function isParamSliderAction(action) {
  return action === 'param-slider'
    || action === 'faraday-b-slider'
    || action === 'induced-e-slider';
}

/**
 * Map a slider hit (with optional px / value) → absolute numeric value.
 * Prefer trackX/trackW when present so padded hit boxes stay accurate.
 */
export function valueFromParamSliderPick(pick) {
  if (!pick || !isParamSliderAction(pick.action)) return null;
  const min = Number(pick.min);
  const max = Number(pick.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (Number.isFinite(pick.value)) {
    return Math.max(min, Math.min(max, Number(pick.value)));
  }
  if (!Number.isFinite(pick.px)) return null;
  const trackX = Number.isFinite(pick.trackX) ? Number(pick.trackX) : Number(pick.x || 0);
  const trackW = Math.max(1, Number.isFinite(pick.trackW) ? Number(pick.trackW) : Number(pick.w || 1));
  const u = Math.max(0, Math.min(1, (Number(pick.px) - trackX) / trackW));
  let val = min + u * (max - min);
  const step = Number(pick.step);
  if (Number.isFinite(step) && step > 0) {
    val = Math.round((val - min) / step) * step + min;
    val = Math.max(min, Math.min(max, Number(val.toFixed(6))));
  }
  return val;
}

/**
 * Faraday content screen: set target B/x + duration, play a smooth change,
 * watch live E / Lenz sense, then review motion vs induction results.
 */
function drawFaradayExperiment(ctx, _W, _H, cfg) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const { hits, innerX, innerW, contentTop, contentH, hud } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isDisplay = cfg.surface === 'display';
  const isLight = _uiTheme === 'light';
  const primaryBlue = isLight ? '#0284c7' : '#38bdf8';
  const softFill = isLight ? 'rgba(14, 165, 233, 0.10)' : 'rgba(56, 189, 248, 0.14)';
  const softStroke = isLight ? 'rgba(14, 165, 233, 0.34)' : 'rgba(56, 189, 248, 0.32)';
  const dividerStroke = isLight ? 'rgba(148, 163, 184, 0.28)' : 'rgba(56, 189, 248, 0.22)';
  const P = screenPalette(_uiTheme, primaryBlue, isDisplay);
  const d = hud?.data || {};
  const fmt = (v, n = 3) => Number(v || 0).toFixed(n);
  const uiScale = Math.max(0.78, Math.min(innerW / 1080, contentH / 640));

  const x = innerX;
  const w = innerW;
  const pad = Math.round(14 * uiScale);
  const gap = Math.round(12 * uiScale);

  const bVal = Number(d.B || 0);
  const xVal = Number(d.x ?? 0.45);
  const fluxVal = Number(d.flux || 0);
  const liveEmf = Number(d.liveEmf || 0);
  const animating = !!d.pendingAnim;
  const channelX = d.animChannel === 'x';
  const showField = d.showField !== false;
  const motion = d.lastMotion;
  const induction = d.lastInduction;

  const targetChanged = channelX
    ? (motion && Math.abs(motion.x1 - (d.targetX ?? xVal)) > 1e-4)
    : (induction && Math.abs(induction.B1 - (d.targetB ?? bVal)) > 1e-4);
  const hasPlayed = channelX ? !!(motion && !targetChanged) : !!(induction && !targetChanged);
  const playLabel = animating ? '停止' : (hasPlayed ? '重复变化' : '自动演示');

  // —— 1. Top Live Telemetry Strip (4 equal cells, large crisp numerals) ——
  const statY = contentTop + Math.round(2 * uiScale);
  const statH = Math.round(74 * uiScale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, statY, w, statH, 12);
  ctx.fill();
  ctx.stroke();

  const rodLen = Number(d.rodLength ?? 0.4);
  const emfActive = animating || Math.abs(liveEmf) > 1e-6;
  const senseTag = d.currentSense === 'ccw' ? ' · 逆时针' : d.currentSense === 'cw' ? ' · 顺时针' : '';
  const stats = [
    { label: '实时磁场 B', value: `${bVal >= 0 ? '+' : ''}${fmt(bVal, 2)} T`, color: Math.abs(bVal) >= 0.02 ? primaryBlue : P.title },
    { label: '铜棒位置 x', value: `${fmt(xVal, 2)} m`, color: P.title },
    { label: '导体棒长 L', value: `${fmt(rodLen, 2)} m`, color: P.title },
    { label: '磁通量 \\Phi_B', value: `${fluxVal >= 0 ? '+' : ''}${fmt(fluxVal, 2)} Wb`, color: P.title },
    { label: '感应电动势 \\mathcal{E}_i', value: `${liveEmf >= 0 ? '+' : ''}${fmt(liveEmf, 3)} V${senseTag}`, color: emfActive ? primaryBlue : P.title },
  ];

  stats.forEach((st, i) => {
    const colW = w / stats.length;
    const colX = x + i * colW;
    const cx = colX + colW / 2;
    if (i > 0) {
      ctx.strokeStyle = dividerStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX, statY + Math.round(12 * uiScale));
      ctx.lineTo(colX, statY + statH - Math.round(12 * uiScale));
      ctx.stroke();
    }
    drawMathFormula(ctx, st.label, cx, statY + Math.round(10 * uiScale), {
      fontSize: Math.round(17 * uiScale),
      color: P.muted,
      align: 'center',
      textBaseline: 'top',
      maxWidth: colW - Math.round(14 * uiScale),
    });
    ctx.fillStyle = st.color;
    let valPx = Math.round(25 * uiScale);
    ctx.font = `bold ${valPx}px "Microsoft YaHei", sans-serif`;
    while (valPx > 14 && ctx.measureText(st.value).width > colW - Math.round(18 * uiScale)) {
      valPx -= 1;
      ctx.font = `bold ${valPx}px "Microsoft YaHei", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(st.value, cx, statY + Math.round(35 * uiScale));
  });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // —— 2. Two-column Workspace (Left: Dual Control Sub-cards, Right: Structured Result Cards) ——
  const bodyY = statY + statH + gap;
  const bodyH = Math.max(240, contentTop + contentH - bodyY);
  const ctrlW = Math.round((w - gap) * 0.53);
  const resX = x + ctrlW + gap;
  const resW = w - ctrlW - gap;

  const btnGap = Math.round(10 * uiScale);
  const sliderGap = Math.round(8 * uiScale);
  const sliderInset = Math.round(6 * uiScale);
  const subHeadH = Math.round(28 * uiScale);
  const modeBtnH = Math.round(42 * uiScale);
  const actBtnH = Math.round(44 * uiScale);
  const utilH = Math.round(40 * uiScale);
  const subGap = Math.round(10 * uiScale);
  const subPad = Math.round(13 * uiScale);

  // Compute exact slider height so Group A + Group B cards fill 100% of bodyH with zero dead gap
  const fixedCtrlH = (
    subPad * 4
    + subHeadH * 2
    + modeBtnH
    + actBtnH
    + utilH
    + subGap
    + Math.round(8 * uiScale) * 4
    + sliderGap * 2
  );
  const sliderH = Math.max(
    Math.round(52 * uiScale),
    Math.floor((bodyH - fixedCtrlH) / 4),
  );
  const groupAH = (
    subPad * 2
    + subHeadH
    + Math.round(8 * uiScale)
    + modeBtnH
    + Math.round(8 * uiScale)
    + sliderH * 2
    + sliderGap
    + Math.round(8 * uiScale)
    + actBtnH
  );
  const groupBY = bodyY + groupAH + subGap;
  const groupBH = Math.max(120, bodyY + bodyH - groupBY);

  const cx = x + pad;
  const cw = ctrlW - pad * 2;
  const halfBtnW = (cw - btnGap) / 2;
  const btnFontPx = Math.round(19 * uiScale);

  const drawSliderBox = (opts) => {
    ctx.fillStyle = P.panelAlt;
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.26)' : 'rgba(56, 189, 248, 0.20)';
    ctx.lineWidth = 1;
    roundRect(ctx, cx, opts.y, cw, opts.h, 10);
    ctx.fill();
    ctx.stroke();
    drawParamSlider(ctx, hits, {
      ...opts,
      x: cx + sliderInset,
      w: cw - sliderInset * 2,
      accentHex: primaryBlue,
      largeType: true,
      hideRange: true,
    });
  };

  // Sub-card A: Dynamic Animation Controls
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, bodyY, ctrlW, groupAH, 12);
  ctx.fill();
  ctx.stroke();

  let cyA = bodyY + subPad;
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(19 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('动态变化演示', cx, cyA);

  ctx.fillStyle = primaryBlue;
  ctx.font = `bold ${Math.round(14 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(animating ? '● 演示进行中' : (channelX ? '当前：动生电动势' : '当前：感生电动势'), cx + cw, cyA + Math.round(3 * uiScale));
  ctx.textAlign = 'left';
  cyA += subHeadH + Math.round(8 * uiScale);

  drawHallButton(ctx, hits, cx, cyA, halfBtnW, modeBtnH, '动生（移动 x）', 'faraday-channel', { channel: 'x', fontSize: btnFontPx }, primaryBlue, channelX);
  drawHallButton(ctx, hits, cx + halfBtnW + btnGap, cyA, halfBtnW, modeBtnH, '感生（改变 B）', 'faraday-channel', { channel: 'B', fontSize: btnFontPx }, primaryBlue, !channelX);
  cyA += modeBtnH + Math.round(8 * uiScale);

  drawSliderBox({
    y: cyA,
    h: sliderH,
    label: channelX ? '目标 x' : '目标 B',
    value: channelX ? Number(d.targetX ?? xVal) : Number(d.targetB ?? 1.5),
    min: channelX ? 0.10 : -3,
    max: channelX ? 0.80 : 3,
    step: channelX ? 0.01 : 0.05,
    unit: channelX ? 'm' : 'T',
    digits: 2,
    setAction: 'faraday-set',
    key: channelX ? 'targetX' : 'targetB',
    id: channelX ? 'faraday-target-x' : 'faraday-target-b',
  });
  cyA += sliderH + sliderGap;

  drawSliderBox({
    y: cyA,
    h: sliderH,
    label: '时长 Δt',
    value: Number(d.animDuration ?? 1.5),
    min: 0.3,
    max: 6,
    unit: 's',
    digits: 2,
    setAction: 'faraday-set',
    key: 'animDuration',
    id: 'faraday-anim-duration',
  });
  cyA += sliderH + Math.round(8 * uiScale);

  drawHallButton(ctx, hits, cx, cyA, halfBtnW, actBtnH, playLabel, animating ? 'faraday-stop' : 'faraday-play', { fontSize: btnFontPx }, primaryBlue, animating);
  drawHallButton(ctx, hits, cx + halfBtnW + btnGap, cyA, halfBtnW, actBtnH, '反向变化', 'faraday-reverse', { fontSize: btnFontPx }, primaryBlue, false);

  // Sub-card B: Real-time Manual Controls + Utilities
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, groupBY, ctrlW, groupBH, 12);
  ctx.fill();
  ctx.stroke();

  let cyB = groupBY + subPad;
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(19 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('实时手动调节', cx, cyB);

  ctx.fillStyle = P.muted;
  ctx.font = `600 ${Math.round(14 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('可拖动 3D 铜棒或滑块', cx + cw, cyB + Math.round(3 * uiScale));
  ctx.textAlign = 'left';
  cyB += subHeadH + Math.round(8 * uiScale);

  drawSliderBox({
    y: cyB,
    h: sliderH,
    label: '实时 B',
    value: bVal,
    min: -3,
    max: 3,
    unit: 'T',
    digits: 2,
    setAction: 'faraday-set',
    key: 'B',
    id: 'faraday-live-b',
  });
  cyB += sliderH + sliderGap;

  drawSliderBox({
    y: cyB,
    h: sliderH,
    label: '实时 x',
    value: xVal,
    min: 0.10,
    max: 0.80,
    step: 0.01,
    unit: 'm',
    digits: 2,
    setAction: 'faraday-set',
    key: 'x',
    id: 'faraday-live-x',
  });

  const utilY = groupBY + groupBH - subPad - utilH;
  drawHallButton(ctx, hits, cx, utilY, halfBtnW, utilH, showField ? '磁感线：显示' : '磁感线：隐藏', 'faraday-toggle-field', { fontSize: Math.round(18 * uiScale) }, primaryBlue, showField);
  drawHallButton(ctx, hits, cx + halfBtnW + btnGap, utilY, halfBtnW, utilH, '重置实验', 'faraday-reset', { fontSize: Math.round(18 * uiScale) }, primaryBlue, false);

  // —— 3. Right Column: Structured 2×2 Data Grid + Prominent EMF Banner Cards ——
  const cardH = Math.floor((bodyH - gap) / 2);
  const cards = [
    {
      title: '动生 · x 变化',
      data: motion,
      activeChannel: channelX,
      formula: '\\mathcal{E}_i = B L v',
      cells: motion ? [
        { label: '位置区间', value: `${fmt(motion.x0, 2)} \\rightarrow ${fmt(motion.x1, 2)} \\mathrm{m}` },
        { label: '位移 \\Delta x', value: `${motion.dx >= 0 ? '+' : ''}${fmt(motion.dx, 3)} \\mathrm{m}` },
        { label: '磁感应强度 B', value: `${fmt(motion.B, 2)} \\mathrm{T}` },
        { label: '耗时 \\Delta t', value: `${fmt(motion.dt, 3)} \\mathrm{s}` },
      ] : null,
      emptyTitle: '尚未记录动生测量',
      hints: ['在左侧切换「动生」，设目标 x 后点击「自动演示」', '或直接拖动桌面铜棒 / 左下「实时 x」滑块'],
    },
    {
      title: '感生 · B 变化',
      data: induction,
      activeChannel: !channelX,
      formula: '\\mathcal{E}_i = -S \\frac{\\Delta B}{\\Delta t}',
      cells: induction ? [
        { label: '磁场区间', value: `${fmt(induction.B0, 2)} \\rightarrow ${fmt(induction.B1, 2)} \\mathrm{T}` },
        { label: '变化量 \\Delta B', value: `${induction.dB >= 0 ? '+' : ''}${fmt(induction.dB, 3)} \\mathrm{T}` },
        { label: '回路面积 S', value: `${fmt(induction.area, 3)} \\mathrm{m}^2` },
        { label: '耗时 \\Delta t', value: `${fmt(induction.dt, 3)} \\mathrm{s}` },
      ] : null,
      emptyTitle: '尚未记录感生测量',
      hints: ['在左侧切换「感生」，设目标 B 后点击「自动演示」', '或点击「反向变化」/ 拖动「实时 B」滑块'],
    },
  ];

  cards.forEach((card, i) => {
    const cyCard = bodyY + i * (cardH + gap);
    const cardPad = Math.round(15 * uiScale);
    const innerCardW = resW - cardPad * 2;
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = card.activeChannel ? primaryBlue : P.panelStroke;
    ctx.lineWidth = card.activeChannel ? (isDisplay ? 2.0 : 1.6) : (isDisplay ? 1.6 : 1.2);
    roundRect(ctx, resX, cyCard, resW, cardH, 12);
    ctx.fill();
    ctx.stroke();

    // Header row
    drawMathFormula(ctx, card.title, resX + cardPad, cyCard + Math.round(13 * uiScale), {
      fontSize: Math.round(22 * uiScale),
      color: card.activeChannel ? primaryBlue : P.title,
      align: 'left',
      textBaseline: 'top',
    });

    const badgeLabel = (animating && card.activeChannel)
      ? '演示中'
      : card.data ? '最近测量' : '待测量';
    const badgeW = Math.round(86 * uiScale);
    const badgeH = Math.round(28 * uiScale);
    const badgeX = resX + resW - cardPad - badgeW;
    const badgeY = cyCard + Math.round(12 * uiScale);
    ctx.fillStyle = (card.data || (animating && card.activeChannel)) ? softFill : P.panelAlt;
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
    ctx.fill();
    ctx.fillStyle = (card.data || (animating && card.activeChannel)) ? primaryBlue : P.muted;
    ctx.font = `bold ${Math.round(14 * uiScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeLabel, badgeX + badgeW / 2, badgeY + badgeH / 2);

    const gridTop = cyCard + Math.round(48 * uiScale);
    const cardBottom = cyCard + cardH - cardPad;

    if (card.data && card.cells) {
      const emfBannerH = Math.round(64 * uiScale);
      const cellGap = Math.round(8 * uiScale);
      const gridH = Math.max(88, cardBottom - emfBannerH - cellGap - gridTop);
      const cellW = (innerCardW - cellGap) / 2;
      const cellH = (gridH - cellGap) / 2;

      card.cells.forEach((cell, ci) => {
        const col = ci % 2;
        const row = Math.floor(ci / 2);
        const cellX = resX + cardPad + col * (cellW + cellGap);
        const cellY = gridTop + row * (cellH + cellGap);
        ctx.fillStyle = P.panelAlt;
        roundRect(ctx, cellX, cellY, cellW, cellH, 9);
        ctx.fill();

        drawMathFormula(ctx, cell.label, cellX + Math.round(12 * uiScale), cellY + Math.round(7 * uiScale), {
          fontSize: Math.round(14 * uiScale),
          color: P.muted,
          align: 'left',
          textBaseline: 'top',
        });
        drawMathFormula(ctx, cell.value, cellX + Math.round(12 * uiScale), cellY + cellH - Math.round(10 * uiScale), {
          fontSize: Math.round(20 * uiScale),
          color: P.title,
          align: 'left',
          textBaseline: 'bottom',
        });
      });

      const emfBoxY = cardBottom - emfBannerH;
      ctx.fillStyle = softFill;
      ctx.strokeStyle = softStroke;
      ctx.lineWidth = 1.2;
      roundRect(ctx, resX + cardPad, emfBoxY, innerCardW, emfBannerH, 10);
      ctx.fill();
      ctx.stroke();

      drawMathFormula(
        ctx,
        `\\mathcal{E}_i = ${fmt(card.data.emf, 4)} \\mathrm{V}`,
        resX + cardPad + Math.round(14 * uiScale),
        emfBoxY + emfBannerH / 2,
        {
          fontSize: Math.round(25 * uiScale),
          color: primaryBlue,
          align: 'left',
          textBaseline: 'middle',
        },
      );

      ctx.fillStyle = P.title;
      ctx.font = `bold ${Math.round(19 * uiScale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(card.data.senseLabel || '', resX + resW - cardPad - Math.round(14 * uiScale), emfBoxY + emfBannerH / 2);
    } else {
      const emptyH = Math.max(90, cardBottom - gridTop);
      ctx.fillStyle = P.panelAlt;
      roundRect(ctx, resX + cardPad, gridTop, innerCardW, emptyH, 10);
      ctx.fill();

      const midX = resX + resW / 2;
      const midY = gridTop + emptyH / 2;
      ctx.fillStyle = P.title;
      ctx.font = `bold ${Math.round(18 * uiScale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(card.emptyTitle, midX, midY - Math.round(38 * uiScale));

      ctx.fillStyle = P.muted;
      ctx.font = `600 ${Math.round(15 * uiScale)}px "Microsoft YaHei", sans-serif`;
      ctx.fillText(card.hints[0], midX, midY - Math.round(8 * uiScale));
      ctx.fillText(card.hints[1], midX, midY + Math.round(16 * uiScale));

      drawMathFormula(ctx, card.formula, midX, midY + Math.round(48 * uiScale), {
        fontSize: Math.round(20 * uiScale),
        color: primaryBlue,
        align: 'center',
        textBaseline: 'middle',
      });
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  });
}

/**
 * Induced electric field workstation:
 * top 4-cell telemetry strip -> left dual control sub-cards (B/R + probe controls)
 * -> right live force/field analysis + E_k–r textbook curve in unified blue palette.
 */
function drawInducedElectricExperiment(ctx, _W, _H, cfg) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const { hits, innerX, innerW, contentTop, contentH, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isLight = _uiTheme === 'light';
  const isDisplay = cfg.surface === 'display';
  const uiScale = Math.max(0.70, Math.min(innerW / 1080, contentH / 640));
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const fmt = (value, digits = 2) => Number(value || 0).toFixed(digits);

  const primaryBlue = isLight ? '#0284c7' : '#38bdf8';
  const deepBlue = isLight ? '#0369a1' : '#7dd3fc';
  const probeBlue = isLight ? '#1e40af' : '#bae6fd';
  const softFill = isLight ? 'rgba(14, 165, 233, 0.10)' : 'rgba(56, 189, 248, 0.14)';
  const softStroke = isLight ? 'rgba(2, 132, 199, 0.45)' : 'rgba(56, 189, 248, 0.42)';
  const dividerStroke = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.22)';

  const x = innerX;
  const w = innerW;
  const gap = Math.round(12 * uiScale);
  const pad = Math.round(13 * uiScale);

  const currR = Math.max(0.05, Number(d.R ?? 0.50));
  const valB = Number(d.B || 0);
  const dBdt = Number(d.dBdt || 0);
  const absD = Math.abs(dBdt);
  const isAuto = d.auto === true;
  const showB = d.showB !== false;
  const senseText = d.sense === 'cw' ? '顺时针' : d.sense === 'ccw' ? '逆时针' : '无感生';
  const probeQ0 = Number(d.probe?.q0 ?? 1);
  const q0Pos = probeQ0 >= 0;
  const pr = Number(d.probeR ?? 0.35);
  const pe = Number(d.magnitudeE || 0);
  const forceE = Math.abs(probeQ0) * pe;

  // —— 1. Top Telemetry Strip ——
  const statY = contentTop;
  const statH = Math.round(72 * uiScale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, statY, w, statH, 12);
  ctx.fill();
  ctx.stroke();

  const stats = [
    { label: '磁场半径 R', value: `${fmt(currR, 2)} m`, color: P.text },
    { label: '实时磁场 B', value: `${valB >= 0 ? '+' : ''}${fmt(valB, 2)} T`, color: primaryBlue },
    { label: '变化率 dB/dt', value: `${dBdt >= 0 ? '+' : ''}${fmt(dBdt, 2)} T/s`, color: primaryBlue },
    { label: '感生场强 E_k', value: `${fmt(pe, 2)} V/m`, color: primaryBlue },
  ];
  const colW = w / stats.length;
  stats.forEach((st, i) => {
    const colX = x + i * colW;
    const cx = colX + colW / 2;
    if (i > 0) {
      ctx.strokeStyle = dividerStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX, statY + Math.round(12 * uiScale));
      ctx.lineTo(colX, statY + statH - Math.round(12 * uiScale));
      ctx.stroke();
    }
    drawMathFormula(ctx, st.label, cx, statY + Math.round(10 * uiScale), {
      fontSize: Math.round(16 * uiScale),
      color: P.muted,
      align: 'center',
      textBaseline: 'top',
    });
    ctx.fillStyle = st.color;
    let valPx = Math.round(24 * uiScale);
    ctx.font = `bold ${valPx}px "Microsoft YaHei", sans-serif`;
    while (valPx > 14 && ctx.measureText(st.value).width > colW - Math.round(16 * uiScale)) {
      valPx -= 1;
      ctx.font = `bold ${valPx}px "Microsoft YaHei", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(st.value, cx, statY + Math.round(35 * uiScale));
  });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // —— 2. Two-column Workspace ——
  const bodyY = statY + statH + gap;
  const bodyH = Math.max(260, contentTop + contentH - bodyY);
  const ctrlW = Math.round((w - gap) * 0.47);
  const resX = x + ctrlW + gap;
  const resW = w - ctrlW - gap;

  const btnGap = Math.round(8 * uiScale);
  const sliderGap = Math.round(8 * uiScale);
  const sliderInset = Math.round(6 * uiScale);
  const subHeadH = Math.round(26 * uiScale);
  const actBtnH = Math.round(42 * uiScale);
  const utilH = Math.round(40 * uiScale);
  const subGap = Math.round(10 * uiScale);
  const subPad = Math.round(12 * uiScale);

  const fixedCtrlH = (
    subPad * 4
    + subHeadH * 2
    + actBtnH
    + utilH
    + subGap
    + Math.round(8 * uiScale) * 4
    + sliderGap * 2
  );
  const sliderH = Math.max(
    Math.round(52 * uiScale),
    Math.floor((bodyH - fixedCtrlH) / 4),
  );
  const groupAH = (
    subPad * 2
    + subHeadH
    + Math.round(8 * uiScale)
    + actBtnH
    + Math.round(8 * uiScale)
    + sliderH * 2
    + sliderGap
  );
  const groupBY = bodyY + groupAH + subGap;
  const groupBH = Math.max(120, bodyY + bodyH - groupBY);

  const cx = x + pad;
  const cw = ctrlW - pad * 2;
  const halfBtnW = (cw - btnGap) / 2;
  const btnFontPx = Math.round(18 * uiScale);

  const drawSliderBox = (opts) => {
    ctx.fillStyle = P.panelAlt;
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.26)' : 'rgba(56, 189, 248, 0.20)';
    ctx.lineWidth = 1;
    roundRect(ctx, cx, opts.y, cw, opts.h, 10);
    ctx.fill();
    ctx.stroke();
    drawParamSlider(ctx, hits, {
      ...opts,
      x: cx + sliderInset,
      w: cw - sliderInset * 2,
      accentHex: primaryBlue,
      largeType: true,
      hideRange: true,
    });
  };

  // Sub-card A: Field parameters & mode
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, bodyY, ctrlW, groupAH, 12);
  ctx.fill();
  ctx.stroke();

  let gy = bodyY + subPad;
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(19 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('磁场参数与变化', cx, gy);
  ctx.fillStyle = primaryBlue;
  ctx.font = `bold ${Math.round(14 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(isAuto ? '模式: 自动变化' : '模式: 静态调节', cx + cw, gy + Math.round(3 * uiScale));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  gy += subHeadH + Math.round(8 * uiScale);

  drawHallButton(ctx, hits, cx, gy, halfBtnW, actBtnH, isAuto ? '停止变化' : '自动变化', 'induced-e-mode', { auto: !isAuto }, primaryBlue, isAuto, {
    fontPx: btnFontPx,
  });
  drawHallButton(ctx, hits, cx + halfBtnW + btnGap, gy, halfBtnW, actBtnH, '反向 dB/dt', 'induced-e-flip', {}, primaryBlue, false, {
    fontPx: btnFontPx,
  });
  gy += actBtnH + Math.round(8 * uiScale);

  drawSliderBox({
    y: gy,
    h: sliderH,
    label: '磁场半径 R',
    value: currR,
    min: 0.10,
    max: 0.80,
    step: 0.01,
    setAction: 'induced-e-set',
    key: 'R',
    unit: 'm',
    digits: 2,
  });
  gy += sliderH + sliderGap;

  drawSliderBox({
    y: gy,
    h: sliderH,
    label: '变化率 dB/dt',
    value: dBdt,
    min: -6.25,
    max: 6.25,
    step: 0.05,
    setAction: 'induced-e-set',
    key: 'dBdt',
    unit: 'T/s',
    digits: 2,
  });

  // Sub-card B: Probe & system toggles
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, groupBY, ctrlW, groupBH, 12);
  ctx.fill();
  ctx.stroke();

  let gyB = groupBY + subPad;
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(19 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('试探电荷与辅助', cx, gyB);
  drawMathFormula(
    ctx,
    `q_{0} = ${q0Pos ? '+' : '-'}${fmt(Math.abs(probeQ0), 1)} \\text{μC}`,
    cx + cw,
    gyB + Math.round(3 * uiScale),
    {
      fontSize: Math.round(14 * uiScale),
      color: P.muted,
      align: 'right',
      textBaseline: 'top',
      fontWeight: 'bold',
    }
  );
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  gyB += subHeadH + Math.round(8 * uiScale);

  drawSliderBox({
    y: gyB,
    h: sliderH,
    label: '试探距离 r',
    value: pr,
    min: 0.05,
    max: 1.15,
    step: 0.01,
    setAction: 'induced-e-set',
    key: 'probeR',
    unit: 'm',
    digits: 2,
  });
  gyB += sliderH + sliderGap;

  drawSliderBox({
    y: gyB,
    h: sliderH,
    label: '试探电量 |q_0|',
    value: Math.abs(probeQ0),
    min: 0.2,
    max: 3.0,
    step: 0.1,
    setAction: 'induced-e-set',
    key: 'q0',
    unit: 'μC',
    digits: 1,
  });

  const utilY = groupBY + groupBH - subPad - utilH;
  const triW = (cw - btnGap * 2) / 3;
  const utilPx = Math.round(16 * uiScale);
  drawHallButton(ctx, hits, cx, utilY, triW, utilH, `q₀: ${q0Pos ? '正(+)' : '负(−)'}`, 'induced-e-probe-sign', { sign: q0Pos ? -1 : 1 }, primaryBlue, q0Pos, {
    fontPx: utilPx,
  });
  drawHallButton(ctx, hits, cx + triW + btnGap, utilY, triW, utilH, `磁场: ${showB ? '显示' : '隐藏'}`, 'induced-e-toggle', { key: 'B' }, primaryBlue, showB, {
    fontPx: utilPx,
  });
  drawHallButton(ctx, hits, cx + (triW + btnGap) * 2, utilY, triW, utilH, '重置实验', 'induced-e-reset', {}, primaryBlue, false, {
    fontPx: utilPx,
  });

  // —— Right Column Top: Live Field & Force Analysis Card ——
  const topCardH = Math.round(112 * uiScale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, resX, bodyY, resW, topCardH, 12);
  ctx.fill();
  ctx.stroke();

  const rx = resX + pad;
  const rw = resW - pad * 2;
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(19 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('涡旋电场分布与受力', rx, bodyY + subPad);

  const badgeW = Math.round(126 * uiScale);
  const badgeH = Math.round(26 * uiScale);
  const badgeY = bodyY + Math.round(10 * uiScale);
  ctx.fillStyle = softFill;
  ctx.strokeStyle = softStroke;
  ctx.lineWidth = 1;
  roundRect(ctx, rx + rw - badgeW, badgeY, badgeW, badgeH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = deepBlue;
  ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`绕向: ${senseText}`, rx + rw - badgeW / 2, badgeY + badgeH / 2);
  ctx.textAlign = 'left';

  const miniY = bodyY + Math.round(44 * uiScale);
  const miniH = topCardH - Math.round(44 * uiScale) - subPad;
  const miniW = (rw - btnGap) / 2;
  const boxes = [
    {
      k: pr <= currR ? '位置 r\\leq R (内区)' : '位置 r > R (外区)',
      v: `r = ${fmt(pr, 2)} \\text{m}\\cdotE_{k} = ${fmt(pe, 2)}`,
      c: P.text,
    },
    {
      k: `试探受力 |F_{e}| (${q0Pos ? '同向' : '反向'})`,
      v: `${fmt(forceE, 3)} \\text{μN}`,
      c: primaryBlue,
    },
  ];
  boxes.forEach((bx, idx) => {
    const bxX = rx + idx * (miniW + btnGap);
    ctx.fillStyle = P.panelAlt;
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.24)' : 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 1;
    roundRect(ctx, bxX, miniY, miniW, miniH, 9);
    ctx.fill();
    ctx.stroke();

    drawMathFormula(ctx, bx.k, bxX + Math.round(10 * uiScale), miniY + Math.round(7 * uiScale), {
      fontSize: Math.round(13 * uiScale),
      color: P.muted,
      align: 'left',
      textBaseline: 'top',
      fontWeight: 'bold',
      maxWidth: miniW - Math.round(18 * uiScale),
    });

    drawMathFormula(ctx, bx.v, bxX + Math.round(10 * uiScale), miniY + Math.round(miniH * 0.68), {
      fontSize: Math.round(18 * uiScale),
      color: bx.c,
      align: 'left',
      textBaseline: 'middle',
      fontWeight: 'bold',
      maxWidth: miniW - Math.round(18 * uiScale),
    });
  });
  ctx.textBaseline = 'alphabetic';

  // —— Right Column Bottom: E_k–r Textbook Curve ——
  const chartY = bodyY + topCardH + gap;
  const chartH = Math.max(180, bodyY + bodyH - chartY);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, resX, chartY, resW, chartH, 12);
  ctx.fill();
  ctx.stroke();

  const profile = Array.isArray(d.profile) ? d.profile : [];
  const theoreticalPeak = 0.5 * currR * absD;
  const E_SCALE_MAX = Math.max(2.6, Math.max(theoreticalPeak, pe) * 1.05);

  drawMathFormula(
    ctx,
    `峰值 E_{\\mathrm{max}} = ${fmt(theoreticalPeak, 2)} \\text{ V/m}`,
    rx + rw,
    chartY + subPad + Math.round(3 * uiScale),
    {
      fontSize: Math.round(14 * uiScale),
      color: deepBlue,
      align: 'right',
      textBaseline: 'top',
      fontWeight: 'bold',
    },
  );

  const plotX = resX + Math.round(72 * uiScale);
  const plotY = chartY + Math.round(46 * uiScale);
  const plotW = resW - Math.round(106 * uiScale);
  const plotH = chartH - Math.round(116 * uiScale);

  drawMathFormula(
    ctx,
    'E_{k} – r 径向分布曲线',
    resX + resW / 2,
    chartY + chartH - Math.round(18 * uiScale),
    {
      fontSize: Math.round(17 * uiScale),
      color: P.title,
      align: 'center',
      textBaseline: 'middle',
      fontWeight: 'bold',
    },
  );

  // Subtle horizontal gridlines
  ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.20)' : 'rgba(148, 163, 184, 0.14)';
  ctx.lineWidth = 1;
  for (let g = 1; g <= 3; g++) {
    const gyLine = plotY + plotH - (g / 3) * (plotH * 0.88);
    ctx.beginPath();
    ctx.moveTo(plotX, gyLine);
    ctx.lineTo(plotX + plotW, gyLine);
    ctx.stroke();
  }

  const axisColor = isLight ? 'rgba(71, 85, 105, 0.82)' : 'rgba(148, 163, 184, 0.72)';
  ctx.strokeStyle = axisColor;
  ctx.fillStyle = axisColor;
  ctx.lineWidth = 1.6;

  // Y-axis + Arrow
  ctx.beginPath();
  ctx.moveTo(plotX, plotY + plotH);
  ctx.lineTo(plotX, plotY - Math.round(8 * uiScale));
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(plotX - Math.round(4.5 * uiScale), plotY - Math.round(6 * uiScale));
  ctx.lineTo(plotX, plotY - Math.round(15 * uiScale));
  ctx.lineTo(plotX + Math.round(4.5 * uiScale), plotY - Math.round(6 * uiScale));
  ctx.closePath();
  ctx.fill();

  // X-axis + Arrow
  ctx.beginPath();
  ctx.moveTo(plotX, plotY + plotH);
  ctx.lineTo(plotX + plotW + Math.round(10 * uiScale), plotY + plotH);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(plotX + plotW + Math.round(6 * uiScale), plotY + plotH - Math.round(4.5 * uiScale));
  ctx.lineTo(plotX + plotW + Math.round(15 * uiScale), plotY + plotH);
  ctx.lineTo(plotX + plotW + Math.round(6 * uiScale), plotY + plotH + Math.round(4.5 * uiScale));
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText('0', plotX - Math.round(14 * uiScale), plotY + plotH + Math.round(15 * uiScale));

  drawMathFormula(ctx, 'E_k', plotX - Math.round(30 * uiScale), plotY - Math.round(20 * uiScale), {
    fontSize: Math.round(15 * uiScale),
    color: P.text,
    align: 'left',
    textBaseline: 'top',
  });
  drawMathFormula(ctx, 'r', plotX + plotW + Math.round(18 * uiScale), plotY + plotH, {
    fontSize: Math.round(15 * uiScale),
    color: P.text,
    align: 'left',
    textBaseline: 'middle',
  });

  const rMax = 1.25;
  const rLineX = plotX + (currR / rMax) * plotW;
  const peakPy = plotY + plotH - (theoreticalPeak / E_SCALE_MAX) * (plotH * 0.88);
  const prx = plotX + (Math.min(rMax, pr) / rMax) * plotW;
  const pry = plotY + plotH - (pe / E_SCALE_MAX) * (plotH * 0.88);

  // Soft area fill under E_k-r curve + unified blue curve
  if (profile.length > 1) {
    ctx.beginPath();
    profile.forEach((pt, i) => {
      const px = plotX + (Math.min(rMax, pt.r) / rMax) * plotW;
      const py = plotY + plotH - (pt.E / E_SCALE_MAX) * (plotH * 0.88);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    const lastPt = profile[profile.length - 1];
    const lastX = plotX + (Math.min(rMax, lastPt.r) / rMax) * plotW;
    ctx.lineTo(lastX, plotY + plotH);
    ctx.lineTo(plotX, plotY + plotH);
    ctx.closePath();
    ctx.fillStyle = isLight ? 'rgba(2, 132, 199, 0.10)' : 'rgba(56, 189, 248, 0.12)';
    ctx.fill();

    ctx.strokeStyle = primaryBlue;
    ctx.lineWidth = Math.max(2.4, Math.round(3.0 * uiScale));
    ctx.beginPath();
    profile.forEach((pt, i) => {
      const px = plotX + (Math.min(rMax, pt.r) / rMax) * plotW;
      const py = plotY + plotH - (pt.E / E_SCALE_MAX) * (plotH * 0.88);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // Proportionality labels
  if (rLineX > plotX + Math.round(28 * uiScale) && absD > 0.01) {
    const midR = currR * 0.52;
    const midX = plotX + (midR / rMax) * plotW;
    const midE = 0.5 * midR * absD;
    const midY = plotY + plotH - (midE / E_SCALE_MAX) * (plotH * 0.88);
    const closeProbe = Math.hypot(prx - midX, pry - midY) < Math.round(42 * uiScale);
    drawMathFormula(
      ctx,
      'E_k \\propto r',
      midX + (closeProbe ? Math.round(-22 * uiScale) : 0),
      midY - Math.round((closeProbe ? 20 : 14) * uiScale),
      {
        fontSize: Math.round(14 * uiScale),
        color: deepBlue,
        align: 'center',
        textBaseline: 'bottom',
      },
    );
  }
  if (rLineX < plotX + plotW - Math.round(36 * uiScale) && absD > 0.01) {
    const outR = Math.min(rMax * 0.84, currR * 1.65);
    const outX = plotX + (outR / rMax) * plotW;
    const outE = (0.5 * currR * currR * absD) / outR;
    const outY = plotY + plotH - (outE / E_SCALE_MAX) * (plotH * 0.88);
    drawMathFormula(
      ctx,
      'E_k \\propto \\frac{1}{r}',
      outX + Math.round(10 * uiScale),
      outY - Math.round(14 * uiScale),
      {
        fontSize: Math.round(14 * uiScale),
        color: deepBlue,
        align: 'center',
        textBaseline: 'bottom',
      },
    );
  }

  // Peak (R, E_max) dashed guide & ticks
  if (theoreticalPeak > 0.01) {
    ctx.save();
    ctx.strokeStyle = primaryBlue;
    ctx.lineWidth = Math.round(1.8 * uiScale);
    ctx.setLineDash([Math.round(6 * uiScale), Math.round(4 * uiScale)]);
    ctx.beginPath();
    ctx.moveTo(plotX, peakPy);
    ctx.lineTo(rLineX, peakPy);
    ctx.moveTo(rLineX, plotY + plotH);
    ctx.lineTo(rLineX, peakPy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    ctx.fillStyle = primaryBlue;
    ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${fmt(theoreticalPeak, 2)}`, plotX - Math.round(7 * uiScale), peakPy);

    drawMathFormula(
      ctx,
      `R=${fmt(currR, 2)}`,
      rLineX,
      plotY + plotH + Math.round(7 * uiScale),
      {
        fontSize: Math.round(13 * uiScale),
        color: primaryBlue,
        align: 'center',
        textBaseline: 'top',
      },
    );

    ctx.fillStyle = primaryBlue;
    ctx.beginPath();
    ctx.arc(rLineX, peakPy, Math.round(5.5 * uiScale), 0, Math.PI * 2);
    ctx.fill();
  }

  // Probe (r, E_k) dashed guide & dot (deep indigo/slate blue so distinct from R without gaudy hues)
  if (pr > 0.01) {
    ctx.save();
    ctx.strokeStyle = probeBlue;
    ctx.lineWidth = Math.round(1.8 * uiScale);
    ctx.setLineDash([Math.round(5 * uiScale), Math.round(4 * uiScale)]);
    ctx.beginPath();
    ctx.moveTo(prx, pry);
    ctx.lineTo(prx, plotY + plotH);
    ctx.moveTo(prx, pry);
    ctx.lineTo(plotX, pry);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    const isYTooClose = Math.abs(pry - peakPy) < Math.round(16 * uiScale);
    const yOff = isYTooClose ? (pry >= peakPy ? Math.round(13 * uiScale) : Math.round(-13 * uiScale)) : 0;
    ctx.fillStyle = probeBlue;
    ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${fmt(pe, 2)}`, plotX - Math.round(7 * uiScale), pry + yOff);

    const isXTooClose = Math.abs(prx - rLineX) < Math.round(58 * uiScale);
    drawMathFormula(
      ctx,
      `r=${fmt(pr, 2)}`,
      prx,
      plotY + plotH + Math.round(7 * uiScale) + (isXTooClose ? Math.round(16 * uiScale) : 0),
      {
        fontSize: Math.round(13 * uiScale),
        color: probeBlue,
        align: 'center',
        textBaseline: 'top',
      },
    );

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(prx, pry, Math.round(6 * uiScale), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = probeBlue;
    ctx.lineWidth = Math.max(2, Math.round(2.4 * uiScale));
    ctx.stroke();
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

function drawGaussExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isDisplay = cfg.surface === 'display';
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const charges = Array.isArray(d.charges) ? d.charges : [];
  const selected = charges.find((charge) => charge.id === d.selectedId) || null;
  const fmt = (value, digits = 2) => Number(value || 0).toFixed(digits);

  const scale = holoUiScale(cfg.surface || (isDisplay ? 'display' : 'full'));

  // 1. 4 个核心物理量指标卡片 (Metrics Grid)
  const statY = contentTop;
  const statH = Math.round(72 * scale);
  const statGap = Math.round(10 * scale);
  const statW = (innerW - statGap * 3) / 4;
  const qEnclosedVal = Number(d.qEnclosed || 0);

  const stats = [
    {
      label: '面内净电荷 Q内',
      value: `${qEnclosedVal > 0 ? '+' : ''}${fmt(qEnclosedVal)} μC`,
      color: qEnclosedVal > 0 ? '#ef4444' : (qEnclosedVal < 0 ? '#3b82f6' : P.title),
    },
    {
      label: '总电通量 \\Phi_E',
      value: formatPhysicsNumber(d.flux, { digits: 2, unit: 'N·m²/C' }),
      color: P.title,
    },
    {
      label: '高斯面半径 R',
      value: `${fmt(d.radius ?? 0.24, 2)} m`,
      color: P.title,
    },
    {
      label: '面平均 E',
      value: formatPhysicsNumber(d.meanField, { digits: 2, unit: 'N/C' }),
      color: P.title,
    },
  ];

  stats.forEach((st, index) => {
    const x = innerX + index * (statW + statGap);
    ctx.fillStyle = P.card;
    ctx.strokeStyle = P.panelStroke;
    ctx.lineWidth = 1.2;
    roundRect(ctx, x, statY, statW, statH, 9);
    ctx.fill();
    ctx.stroke();

    // 指标名称 Label
    drawMathFormula(ctx, st.label, x + Math.round(10 * scale), statY + Math.round(7 * scale), {
      fontSize: Math.round(13 * scale),
      color: P.muted,
      align: 'left',
      textBaseline: 'top',
      maxWidth: statW - Math.round(16 * scale),
    });

    // 指标数值 Value（防重叠/溢出的智能字体自适应）
    ctx.fillStyle = st.color;
    let valFontSize = Math.round(19 * scale);
    const maxValW = statW - Math.round(16 * scale);
    ctx.font = `bold ${valFontSize}px "Microsoft YaHei", sans-serif`;

    while (valFontSize > Math.round(11 * scale) && ctx.measureText(st.value).width > maxValW) {
      valFontSize -= 1;
      ctx.font = `bold ${valFontSize}px "Microsoft YaHei", sans-serif`;
    }
    ctx.fillText(st.value, x + Math.round(10 * scale), statY + Math.round(33 * scale));
  });

  // 3. 下半部分主操作与编辑控制双栏 (bodyY, bodyH)
  const bodyY = statY + statH + Math.round(10 * scale);
  const bodyH = _H - bodyY - Math.round(20 * scale);
  const gap = Math.round(14 * scale);
  const leftW = Math.round((innerW - gap) * 0.49);
  const rightX = innerX + leftW + gap;
  const rightW = innerW - leftW - gap;

  // 左右两栏高科技底板
  [
    [innerX, leftW],
    [rightX, rightW],
  ].forEach(([x, w]) => {
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = P.panelStroke;
    ctx.lineWidth = 1.2;
    roundRect(ctx, x, bodyY, w, bodyH, 11);
    ctx.fill();
    ctx.stroke();
  });

  const padIn = Math.round(14 * scale);

  // ====================================================
  // 左栏: 高斯面与可视层控制 + 电荷列表
  // ====================================================
  const innerLeftW = leftW - padIn * 2;

  // 标题
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(18 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('高斯面与可视层', innerX + padIn, bodyY + Math.round(12 * scale));

  // 缩放与操作提示 Badge
  drawMathFormula(
    ctx,
    `高斯面半径 R = ${fmt(d.radius ?? 0.24, 2)} \\text{m}`,
    innerX + padIn,
    bodyY + Math.round(36 * scale),
    {
      fontSize: Math.round(13 * scale),
      color: P.muted,
      align: 'left',
      textBaseline: 'top',
    }
  );

  // 视效 Switch 按钮 (表面 / 场线)
  const btnY1 = bodyY + Math.round(60 * scale);
  const btnH = Math.round(40 * scale);
  const tWidth = Math.round((innerLeftW - Math.round(8 * scale)) / 2);
  const tx1 = innerX + padIn;
  const tx2 = tx1 + tWidth + Math.round(8 * scale);

  drawHallButton(ctx, hits, tx1, btnY1, tWidth, btnH, '表面', 'gauss-toggle', { key: 'surface' }, accentHex, d.showSurface !== false);
  drawHallButton(ctx, hits, tx2, btnY1, tWidth, btnH, '场线', 'gauss-toggle', { key: 'lines' }, accentHex, d.showLines !== false);

  // 电荷列表 Header
  const listTitleY = btnY1 + btnH + Math.round(14 * scale);
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(`电荷列表（${charges.length}/6）`, innerX + padIn, listTitleY);

  // 电荷 Chips 区域
  const chipY0 = listTitleY + Math.round(24 * scale);
  const chipH = Math.round(36 * scale);
  const chipW = Math.round((innerLeftW - Math.round(12 * scale)) / 3);

  charges.forEach((charge, index) => {
    const row = Math.floor(index / 3);
    const col = index % 3;
    const cx = innerX + padIn + col * (chipW + Math.round(6 * scale));
    const cy = chipY0 + row * (chipH + Math.round(6 * scale));
    const isSel = charge.id === d.selectedId;
    const qColor = charge.q >= 0 ? '#ef4444' : '#3b82f6';
    const labelStr = `Q_{${index + 1}} ${charge.q > 0 ? '+' : ''}${fmt(charge.q, 1)}μC`;

    drawHallButton(
      ctx, hits,
      cx, cy, chipW, chipH,
      labelStr,
      'gauss-select', { id: charge.id },
      qColor, isSel,
    );
  });

  // 底部控制按钮 (+正电荷 / +负电荷 / 重置)
  const bottomBtnH = Math.round(40 * scale);
  const bottomBtnW = Math.round((innerLeftW - Math.round(10 * scale)) / 2);
  const bottomY2 = bodyY + bodyH - padIn - bottomBtnH;
  const bottomY1 = bottomY2 - bottomBtnH - Math.round(8 * scale);

  drawHallButton(ctx, hits, innerX + padIn, bottomY1, bottomBtnW, bottomBtnH, '+ 正电荷', 'gauss-add', { sign: 1 }, '#ef4444');
  drawHallButton(ctx, hits, innerX + padIn + bottomBtnW + Math.round(10 * scale), bottomY1, bottomBtnW, bottomBtnH, '+ 负电荷', 'gauss-add', { sign: -1 }, '#3b82f6');
  drawHallButton(ctx, hits, innerX + padIn, bottomY2, innerLeftW, bottomBtnH, '重置实验', 'gauss-reset', {}, accentHex);


  // ====================================================
  // 右栏: 选中电荷属性编辑面板
  // ====================================================
  const innerRightW = rightW - padIn * 2;

  if (!selected) {
    // 1) 未选中电荷时的空状态 (Empty State)
    ctx.fillStyle = P.title;
    ctx.font = `bold ${Math.round(18 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('电荷属性控制', rightX + padIn, bodyY + Math.round(12 * scale));

    const emptyBoxY = bodyY + Math.round(52 * scale);
    const emptyBoxH = bodyH - Math.round(70 * scale);
    ctx.fillStyle = P.card;
    ctx.strokeStyle = P.panelStroke;
    ctx.lineWidth = 1;
    roundRect(ctx, rightX + padIn, emptyBoxY, innerRightW, emptyBoxH, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.muted;
    ctx.font = `${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('请选择或添加电荷进行配置', rightX + padIn + innerRightW / 2, emptyBoxY + emptyBoxH / 2 - Math.round(12 * scale));
    ctx.font = `${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText('支持 3D 界面拖动与极性切换', rightX + padIn + innerRightW / 2, emptyBoxY + emptyBoxH / 2 + Math.round(14 * scale));

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    return;
  }

  // 2) 选中电荷时的控制界面
  const selIndex = charges.indexOf(selected) + 1;
  const distFromCenter = Math.hypot(selected.x, selected.y, selected.z);
  const inside = distFromCenter < Number(d.radius) - 1e-4;

  // 标题
  drawMathFormula(
    ctx,
    `编辑 Q_{${selIndex}}`,
    rightX + padIn,
    bodyY + Math.round(12 * scale),
    { fontSize: Math.round(18 * scale), color: P.title, align: 'left', textBaseline: 'top' },
  );

  // 高斯面内 / 高斯面外 Badge
  const badgeText = inside ? '● 高斯面内' : '○ 高斯面外';
  const badgeColor = inside ? '#10b981' : '#f59e0b';
  ctx.fillStyle = badgeColor;
  ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(badgeText, rightX + rightW - padIn, bodyY + Math.round(14 * scale));

  // 极性切换 & 移到中心 按钮
  const editBtnY = bodyY + Math.round(44 * scale);
  const editBtnW = Math.round((innerRightW - Math.round(12 * scale)) / 3);
  drawHallButton(ctx, hits, rightX + padIn, editBtnY, editBtnW, btnH, '正 (+)', 'gauss-sign', { sign: 1 }, '#ef4444', selected.q >= 0);
  drawHallButton(ctx, hits, rightX + padIn + editBtnW + Math.round(6 * scale), editBtnY, editBtnW, btnH, '负 (−)', 'gauss-sign', { sign: -1 }, '#3b82f6', selected.q < 0);
  drawHallButton(ctx, hits, rightX + padIn + (editBtnW + Math.round(6 * scale)) * 2, editBtnY, editBtnW, btnH, '移至中心', 'gauss-center', {}, accentHex);

  // 参数属性 Card 2列3行 网格 (Property Grid) - 完美自适应且绝不重叠！
  const deleteBtnY = bodyY + bodyH - padIn - bottomBtnH;
  const gridY0 = editBtnY + btnH + Math.round(10 * scale);
  const gridAvailH = deleteBtnY - gridY0 - Math.round(10 * scale);

  const props = [
    { label: '电量 |Q|', val: `${Math.abs(selected.q).toFixed(1)} μC` },
    { label: '距中心 r', val: `${distFromCenter.toFixed(2)} m` },
    { label: '坐标 X', val: `${Number(selected.x).toFixed(2)}` },
    { label: '坐标 Y', val: `${Number(selected.y).toFixed(2)}` },
    { label: '坐标 Z', val: `${Number(selected.z).toFixed(2)}` },
    { label: '移动控制', val: '拖动 / 滚轮' },
  ];

  const propCardW = Math.round((innerRightW - Math.round(8 * scale)) / 2);
  const propCardH = Math.max(Math.round(28 * scale), Math.round((gridAvailH - Math.round(6 * scale) * 2) / 3));

  props.forEach((pr, i) => {
    const r = Math.floor(i / 2);
    const c = i % 2;
    const px = rightX + padIn + c * (propCardW + Math.round(8 * scale));
    const py = gridY0 + r * (propCardH + Math.round(6 * scale));

    ctx.fillStyle = P.card;
    ctx.strokeStyle = P.panelStroke;
    ctx.lineWidth = 1;
    roundRect(ctx, px, py, propCardW, propCardH, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = P.muted;
    ctx.font = `${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(pr.label, px + Math.round(8 * scale), py + Math.round(4 * scale));

    ctx.fillStyle = P.title;
    ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(pr.val, px + Math.round(8 * scale), py + propCardH - Math.round(16 * scale));
  });

  // 最底部删除按钮（完美避开 Property Grid 碰撞）
  drawHallButton(ctx, hits, rightX + padIn, deleteBtnY, innerRightW, bottomBtnH, '删除选中电荷', 'gauss-delete', {}, '#ef4444');

  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
}

/**
 * Electric-field workstation HUD:
 * unified blue palette with stitched Gauss shape/radius, source charge |q_i|, and probe |q_0| sliders.
 */
function drawElectricFieldExperiment(ctx, _W, _H, cfg) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const { hits, innerX, innerW, contentTop, contentH, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isLight = _uiTheme === 'light';
  const isDisplay = cfg.surface === 'display';
  const uiScale = Math.max(0.70, Math.min(innerW / 1080, contentH / 640));
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const charges = Array.isArray(d.charges) ? d.charges : [];
  const selected = charges.find((charge) => charge.id === d.selectedId) || null;
  const probe = d.probe || { x: 0, y: 0, z: 0, q0: 1 };
  const fmt = (value, digits = 2) => Number(value || 0).toFixed(digits);

  const primaryBlue = isLight ? '#0284c7' : '#38bdf8';
  const deepBlue = isLight ? '#0369a1' : '#7dd3fc';
  const softFill = isLight ? 'rgba(14, 165, 233, 0.10)' : 'rgba(56, 189, 248, 0.14)';
  const softStroke = isLight ? 'rgba(2, 132, 199, 0.45)' : 'rgba(56, 189, 248, 0.42)';
  const dividerStroke = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.22)';

  const x = innerX;
  const w = innerW;
  const gap = Math.round(12 * uiScale);
  const pad = Math.round(13 * uiScale);

  const radius = Number(d.radius || 0.24);
  const qEnc = Number.isFinite(Number(d.qEnclosed))
    ? Number(d.qEnclosed)
    : charges.reduce((sum, c) => (Math.hypot(c?.x || 0, c?.y || 0, c?.z || 0) < radius ? sum + Number(c?.q || 0) : sum), 0);
  const qEncVal = Math.abs(qEnc) < 1e-6 ? 0 : qEnc;
  const fluxVal = Number.isFinite(Number(d.flux))
    ? Number(d.flux)
    : (qEncVal * 1e-6) / (1 / (4 * Math.PI * 9.0e9));

  const formatFluxFormula = (f) => {
    const v = Number(f || 0);
    if (!Number.isFinite(v) || Math.abs(v) < 1e-4) {
      return '\\Phi_{E} = 0 \\text{ N}\\cdot\\text{m}^{2}/\\text{C}';
    }
    const abs = Math.abs(v);
    const exp = Math.floor(Math.log10(abs));
    const mant = v / 10 ** exp;
    const sign = v > 0 ? '+' : '';
    if (exp >= -1 && exp <= 2) {
      return `\\Phi_{E} = ${sign}${v.toFixed(2)} \\text{ N}\\cdot\\text{m}^{2}/\\text{C}`;
    }
    return `\\Phi_{E} = ${sign}${mant.toFixed(2)}\\times 10^{${exp}} \\text{ N}\\cdot\\text{m}^{2}/\\text{C}`;
  };

  // —— 1. Top 3-column Summary Strip (keeps ε₀, Σq_i, Φ_E contract) ——
  const statY = contentTop;
  const statH = Math.round(62 * uiScale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, statY, w, statH, 12);
  ctx.fill();
  ctx.stroke();

  const hasGauss = Boolean(d.showGauss);
  const headItems = [
    '\\varepsilon_{0} = 8.85\\times 10^{-12} \\text{ F/m}',
    `\\Sigma q_{i} = ${qEncVal >= 0 ? '+' : ''}${fmt(qEncVal, 1)} \\mu\\text{C}`,
    ...(hasGauss ? [formatFluxFormula(fluxVal)] : []),
  ];
  const colW = w / headItems.length;
  headItems.forEach((formula, i) => {
    const colX = x + i * colW;
    if (i > 0) {
      ctx.strokeStyle = dividerStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX, statY + Math.round(12 * uiScale));
      ctx.lineTo(colX, statY + statH - Math.round(12 * uiScale));
      ctx.stroke();
    }
    drawMathFormula(ctx, formula, colX + colW / 2, statY + statH / 2, {
      fontSize: Math.round(19 * uiScale),
      color: P.title,
      align: 'center',
      textBaseline: 'middle',
      fontWeight: 'bold',
    });
  });

  // —— 2. Two-column Workspace ——
  const bodyY = statY + statH + gap;
  const bodyH = Math.max(260, contentTop + contentH - bodyY);
  const leftW = Math.round((w - gap) * 0.52);
  const rightX = x + leftW + gap;
  const rightW = w - leftW - gap;
  const btnGap = Math.round(8 * uiScale);
  const subGap = Math.round(10 * uiScale);
  const btnFontPx = Math.round(17 * uiScale);

  const probeQ0 = Number(probe.q0 ?? 1);
  const probeQ0Num = Math.abs(probeQ0) < 1e-6 ? 0 : probeQ0;
  const isProbeVisible = d.showProbe !== false;
  const probeLabel = !isProbeVisible
    ? '试探电荷 (已隐藏)'
    : `试探电荷 q₀(${probeQ0Num > 0 ? '+' : ''}${fmt(probeQ0Num, 1)}μC)`;

  // Left Upper Sub-card: Charge management, Toggles, Chip Grid & Axis Locks
  const maxChips = 12;
  const chipFontPx = Math.max(30, Math.round(30 * uiScale));
  const chipItems = charges.slice(0, maxChips).map((charge, i) => ({
    label: `q_{${i + 1}}`,
    action: 'electric-select',
    meta: { id: charge.id, fontSize: chipFontPx },
    active: charge.id === d.selectedId,
  }));
  const matrixCols = Math.max(4, Math.min(6, chipItems.length || 1));
  const matrixRows = Math.min(2, Math.ceil(chipItems.length / matrixCols) || 1);
  const rowBtnH = Math.round(38 * uiScale);
  const chipH = Math.max(46, Math.round(46 * uiScale));
  const leftTopH = (
    pad * 2
    + Math.round(24 * uiScale)
    + Math.round(6 * uiScale)
    + rowBtnH * 3
    + btnGap * 3
    + matrixRows * chipH
    + Math.max(0, matrixRows - 1) * Math.round(6 * uiScale)
  );
  const leftBotY = bodyY + leftTopH + subGap;
  const leftBotH = Math.max(120, bodyY + bodyH - leftBotY);

  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, bodyY, leftW, leftTopH, 12);
  ctx.fill();
  ctx.stroke();

  const lx = x + pad;
  const lw = leftW - pad * 2;
  let ly = bodyY + pad;
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(19 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('场源电荷与视图控制', lx, ly);
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(14 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(`当前场源: ${charges.length} 个`, lx + lw, ly + Math.round(3 * uiScale));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ly += Math.round(24 * uiScale) + Math.round(6 * uiScale);

  const triW = (lw - btnGap * 2) / 3;
  // Row A: +正电荷 / +负电荷 / 重置
  drawHallButton(ctx, hits, lx, ly, triW, rowBtnH, '+ 正电荷', 'electric-add', { sign: 1 }, primaryBlue, false, { fontPx: btnFontPx });
  drawHallButton(ctx, hits, lx + triW + btnGap, ly, triW, rowBtnH, '+ 负电荷', 'electric-add', { sign: -1 }, primaryBlue, false, { fontPx: btnFontPx });
  drawHallButton(ctx, hits, lx + (triW + btnGap) * 2, ly, triW, rowBtnH, '重置实验', 'electric-reset', {}, primaryBlue, false, { fontPx: btnFontPx });
  ly += rowBtnH + btnGap;

  // Row B: 等势线 / 高斯面 / 试探电荷 cycle
  drawHallButton(ctx, hits, lx, ly, triW, rowBtnH, '等势线', 'electric-toggle', { key: 'equipot' }, primaryBlue, Boolean(d.showEquipot), { fontPx: btnFontPx });
  drawHallButton(ctx, hits, lx + triW + btnGap, ly, triW, rowBtnH, '高斯面', 'electric-toggle', { key: 'gauss' }, primaryBlue, Boolean(d.showGauss), { fontPx: btnFontPx });
  drawHallButton(ctx, hits, lx + (triW + btnGap) * 2, ly, triW, rowBtnH, probeLabel, 'electric-probe-sign', { mode: 'cycle', sign: isProbeVisible ? (probeQ0Num >= 0 ? -1 : 1) : 1 }, primaryBlue, isProbeVisible, { fontPx: Math.round(14 * uiScale) });
  ly += rowBtnH + btnGap;

  // Row C: Charge Matrix
  const chipGap = Math.round(6 * uiScale);
  const chipW = (lw - chipGap * (matrixCols - 1)) / matrixCols;
  chipItems.forEach((item, i) => {
    const col = i % matrixCols;
    const row = Math.floor(i / matrixCols);
    if (row >= matrixRows) return;
    drawHallButton(ctx, hits, lx + col * (chipW + chipGap), ly + row * (chipH + chipGap), chipW, chipH, item.label, item.action, item.meta, primaryBlue, item.active);
  });
  ly += matrixRows * chipH + Math.max(0, matrixRows - 1) * chipGap + btnGap;

  // Row D: Axis Locks
  const axisLock = d.axisLock || {};
  drawHallButton(ctx, hits, lx, ly, triW, rowBtnH, axisLock.x ? 'X · 已锁' : '锁 X 轴', 'electric-axis-lock', { axis: 'x' }, primaryBlue, axisLock.x === true, { fontPx: btnFontPx });
  drawHallButton(ctx, hits, lx + triW + btnGap, ly, triW, rowBtnH, axisLock.y ? 'Y · 已锁' : '锁 Y 轴', 'electric-axis-lock', { axis: 'y' }, primaryBlue, axisLock.y === true, { fontPx: btnFontPx });
  drawHallButton(ctx, hits, lx + (triW + btnGap) * 2, ly, triW, rowBtnH, axisLock.z ? 'Z · 已锁' : '锁 Z 轴', 'electric-axis-lock', { axis: 'z' }, primaryBlue, axisLock.z === true, { fontPx: btnFontPx });

  // Left Lower Sub-card: Gauss surface shape & radius (stitched desk controls)
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, leftBotY, leftW, leftBotH, 12);
  ctx.fill();
  ctx.stroke();

  const shapeNames = { sphere: '球形', cube: '正方体', cylinder: '圆柱体', irregular: '不规则' };
  const currShape = d.gaussShape || 'sphere';
  let gsy = leftBotY + pad;
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(19 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('高斯面设置 (Gauss)', lx, gsy);
  ctx.fillStyle = d.showGauss ? primaryBlue : P.muted;
  ctx.font = `bold ${Math.round(14 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(d.showGauss ? `形状: ${shapeNames[currShape] || '球形'}` : '当前未开启', lx + lw, gsy + Math.round(3 * uiScale));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  gsy += Math.round(28 * uiScale);

  const drawBoxSlider = (bx, bw, opts) => {
    ctx.fillStyle = P.panelAlt;
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.26)' : 'rgba(56, 189, 248, 0.20)';
    ctx.lineWidth = 1;
    roundRect(ctx, bx, opts.y, bw, opts.h, 10);
    ctx.fill();
    ctx.stroke();
    drawParamSlider(ctx, hits, {
      ...opts,
      x: bx + Math.round(6 * uiScale),
      w: bw - Math.round(12 * uiScale),
      accentHex: primaryBlue,
      largeType: true,
      hideRange: true,
    });
  };

  if (d.showGauss) {
    const shapes = [
      { key: 'sphere', label: '球形' },
      { key: 'cube', label: '正方体' },
      { key: 'cylinder', label: '圆柱体' },
      { key: 'irregular', label: '不规则' },
    ];
    const quadW = (lw - btnGap * 3) / 4;
    const sBtnH = Math.round(36 * uiScale);
    shapes.forEach((sh, idx) => {
      drawHallButton(ctx, hits, lx + idx * (quadW + btnGap), gsy, quadW, sBtnH, sh.label, 'electric-gauss-shape', { shape: sh.key }, primaryBlue, currShape === sh.key, {
        fontPx: Math.round(16 * uiScale),
      });
    });
    const slY = gsy + sBtnH + Math.round(8 * uiScale);
    const slH = Math.min(Math.round(68 * uiScale), Math.max(Math.round(52 * uiScale), leftBotY + leftBotH - pad - slY));
    drawBoxSlider(lx, lw, {
      y: slY,
      h: slH,
      label: '高斯面半径 R',
      value: radius,
      min: 0.12,
      max: 0.42,
      step: 0.01,
      setAction: 'electric-set',
      key: 'radius',
      unit: 'm',
      digits: 2,
    });
    const footY = slY + slH + Math.round(8 * uiScale);
    const footH = leftBotY + leftBotH - pad - footY;
    if (footH >= Math.round(28 * uiScale)) {
      ctx.fillStyle = softFill;
      ctx.strokeStyle = softStroke;
      ctx.lineWidth = 1;
      roundRect(ctx, lx, footY, lw, footH, 8);
      ctx.fill();
      ctx.stroke();
      drawMathFormula(
        ctx,
        `高斯定理：\\Phi_{E} = \\Sigma q_{i} / \\varepsilon_{0} \\cdot 当前半径 R = ${fmt(radius, 2)} \\text{ m}`,
        lx + Math.round(10 * uiScale),
        footY + footH / 2,
        {
          fontSize: Math.round(14 * uiScale),
          color: deepBlue,
          align: 'left',
          textBaseline: 'middle',
          fontWeight: 'bold',
          maxWidth: lw - Math.round(20 * uiScale),
        },
      );
    }
  } else {
    drawMathFormula(
      ctx,
      '开启高斯面可观测闭合曲面电通量 \\Phi_{E} 变化',
      lx,
      gsy + Math.round(22 * uiScale),
      {
        fontSize: Math.round(15 * uiScale),
        color: P.muted,
        align: 'left',
        textBaseline: 'alphabetic',
        fontWeight: 'bold',
        maxWidth: lw,
      },
    );
    const openH = Math.round(42 * uiScale);
    drawHallButton(ctx, hits, lx, leftBotY + leftBotH - pad - openH, lw, openH, '开启高斯面并选择几何形状', 'electric-toggle', { key: 'gauss' }, primaryBlue, false, {
      fontPx: btnFontPx,
    });
  }

  // —— Right Upper Sub-card: Selected Source Charge q_i (with stitched |q_i| slider) ——
  const rightTopH = Math.round(bodyH * 0.56);
  const rightBotY = bodyY + rightTopH + subGap;
  const rightBotH = Math.max(120, bodyY + bodyH - rightBotY);
  const rx = rightX + pad;
  const rw = rightW - pad * 2;

  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, rightX, bodyY, rightW, rightTopH, 12);
  ctx.fill();
  ctx.stroke();

  if (selected) {
    const idx = charges.findIndex((c) => c.id === selected.id) + 1;
    let ry = bodyY + pad;
    drawMathFormula(ctx, `选中场源 q_{${idx}}`, rx, ry, {
      fontSize: Math.round(19 * uiScale),
      color: P.title,
      align: 'left',
      textBaseline: 'top',
      fontWeight: 'bold',
    });
    const pillW = Math.round(96 * uiScale);
    const pillH = Math.round(25 * uiScale);
    const pillY = ry - Math.round(1 * uiScale);
    ctx.fillStyle = softFill;
    ctx.strokeStyle = softStroke;
    ctx.lineWidth = 1;
    roundRect(ctx, rx + rw - pillW, pillY, pillW, pillH, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = deepBlue;
    ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(selected.q >= 0 ? '正电荷 (+)' : '负电荷 (−)', rx + rw - pillW / 2, pillY + pillH / 2);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ry += Math.round(32 * uiScale);

    // 4-cell compact readout for q and (x, y, z)
    const coordH = Math.round(50 * uiScale);
    const cellW = (rw - btnGap * 3) / 4;
    const cells = [
      { k: `q_{${idx}}`, v: `${selected.q >= 0 ? '+' : ''}${fmt(selected.q, 1)} μC`, c: primaryBlue },
      { k: 'x', v: `${fmt(selected.x, 2)} m`, c: P.text },
      { k: 'y', v: `${fmt(selected.y, 2)} m`, c: P.text },
      { k: 'z', v: `${fmt(selected.z, 2)} m`, c: P.text },
    ];
    cells.forEach((cell, i) => {
      const cxCell = rx + i * (cellW + btnGap);
      ctx.fillStyle = P.panelAlt;
      ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.24)' : 'rgba(56, 189, 248, 0.18)';
      roundRect(ctx, cxCell, ry, cellW, coordH, 8);
      ctx.fill();
      ctx.stroke();
      if (/[_{}]/.test(cell.k)) {
        drawMathFormula(ctx, cell.k, cxCell + Math.round(9 * uiScale), ry + Math.round(6 * uiScale), {
          fontSize: Math.round(13 * uiScale),
          color: P.muted,
          align: 'left',
          textBaseline: 'top',
        });
      } else {
        ctx.fillStyle = P.muted;
        ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(cell.k, cxCell + Math.round(9 * uiScale), ry + Math.round(6 * uiScale));
      }
      ctx.fillStyle = cell.c;
      let cPx = Math.round(16 * uiScale);
      ctx.font = `bold ${cPx}px "Microsoft YaHei", sans-serif`;
      while (cPx > 11 && ctx.measureText(cell.v).width > cellW - Math.round(16 * uiScale)) {
        cPx -= 1;
        ctx.font = `bold ${cPx}px "Microsoft YaHei", sans-serif`;
      }
      ctx.textBaseline = 'bottom';
      ctx.fillText(cell.v, cxCell + Math.round(9 * uiScale), ry + coordH - Math.round(7 * uiScale));
    });
    ctx.textBaseline = 'alphabetic';
    ry += coordH + Math.round(8 * uiScale);

    const toolBtnH = Math.round(38 * uiScale);
    const availSlH = bodyY + rightTopH - pad - toolBtnH - Math.round(8 * uiScale) - ry;
    const slH = Math.min(Math.round(70 * uiScale), Math.max(Math.round(52 * uiScale), availSlH));
    ry += Math.max(0, Math.floor((availSlH - slH) * 0.45));
    drawBoxSlider(rx, rw, {
      y: ry,
      h: slH,
      label: `电荷量 |q_{${idx}}|`,
      value: Math.abs(Number(selected.q || 1)),
      min: 0.2,
      max: 3.0,
      step: 0.1,
      setAction: 'electric-set',
      key: 'q',
      unit: 'μC',
      digits: 1,
    });

    const toolY = bodyY + rightTopH - pad - toolBtnH;
    const tBtnW = (rw - btnGap * 2) / 3;
    drawHallButton(ctx, hits, rx, toolY, tBtnW, toolBtnH, '设为正(+)', 'electric-sign', { sign: 1 }, primaryBlue, selected.q >= 0, { fontPx: btnFontPx });
    drawHallButton(ctx, hits, rx + tBtnW + btnGap, toolY, tBtnW, toolBtnH, '设为负(−)', 'electric-sign', { sign: -1 }, primaryBlue, selected.q < 0, { fontPx: btnFontPx });
    drawHallButton(ctx, hits, rx + (tBtnW + btnGap) * 2, toolY, tBtnW, toolBtnH, '删除选中', 'electric-delete', {}, primaryBlue, false, { fontPx: btnFontPx });
  } else {
    drawMathFormula(ctx, '场源电荷 q 编辑', rx, bodyY + pad, {
      fontSize: Math.round(19 * uiScale),
      color: P.title,
      align: 'left',
      textBaseline: 'top',
      fontWeight: 'bold',
    });
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(16 * uiScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('未选中场源电荷', rightX + rightW / 2, bodyY + rightTopH / 2 - Math.round(6 * uiScale));
    drawMathFormula(ctx, '点击左侧 q_{i} 芯片或 3D 电荷球以调节电荷量与极性', rightX + rightW / 2, bodyY + rightTopH / 2 + Math.round(20 * uiScale), { fontSize: Math.round(14 * uiScale), color: P.muted, align: 'center' });
    ctx.textAlign = 'left';
  }

  // —— Right Lower Sub-card: Probe Charge q_0 Control ——
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, rightX, rightBotY, rightW, rightBotH, 12);
  ctx.fill();
  ctx.stroke();

  let pby = rightBotY + pad;
  drawMathFormula(ctx, '电荷 q_{0} 控制', rx, pby, {
    fontSize: Math.round(19 * uiScale),
    color: P.title,
    align: 'left',
    textBaseline: 'top',
    fontWeight: 'bold',
  });
  ctx.fillStyle = isProbeVisible ? primaryBlue : P.muted;
  ctx.font = `bold ${Math.round(14 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(
    isProbeVisible ? `当前: ${probeQ0Num >= 0 ? '+' : ''}${fmt(probeQ0Num, 1)} μC` : '当前: 已隐藏',
    rx + rw,
    pby + Math.round(3 * uiScale),
  );
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  pby += Math.round(30 * uiScale);

  const pPosRowH = Math.round(30 * uiScale);
  const pBtnH = Math.round(38 * uiScale);
  const remAfterHead = rightBotY + rightBotH - pad - pBtnH - Math.round(8 * uiScale) - pby;
  if (remAfterHead >= Math.round(92 * uiScale)) {
    ctx.fillStyle = P.panelAlt;
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.22)' : 'rgba(56, 189, 248, 0.16)';
    ctx.lineWidth = 1;
    roundRect(ctx, rx, pby, rw, pPosRowH, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`试探电荷位置: (${fmt(probe.x, 2)}, ${fmt(probe.y, 2)}, ${fmt(probe.z, 2)}) m`, rx + Math.round(10 * uiScale), pby + pPosRowH / 2);
    ctx.textBaseline = 'alphabetic';
    pby += pPosRowH + Math.round(8 * uiScale);
  }
  const pSlH = Math.min(Math.round(68 * uiScale), Math.max(Math.round(50 * uiScale), rightBotY + rightBotH - pad - pBtnH - Math.round(8 * uiScale) - pby));
  drawBoxSlider(rx, rw, {
    y: pby,
    h: pSlH,
    label: '电量 |q_0|',
    value: Math.abs(probeQ0Num || 1),
    min: 0.2,
    max: 3.0,
    step: 0.1,
    setAction: 'electric-set',
    key: 'q0',
    target: 'probe',
    unit: 'μC',
    digits: 1,
  });

  drawHallButton(
    ctx,
    hits,
    rx,
    rightBotY + rightBotH - pad - pBtnH,
    rw,
    pBtnH,
    isProbeVisible ? '切换状态: 正 / 负 / 隐藏' : '重新显示试探电荷 q₀',
    'electric-probe-sign',
    { mode: 'cycle', sign: isProbeVisible ? (probeQ0Num >= 0 ? -1 : 1) : 1 },
    primaryBlue,
    isProbeVisible,
    { fontPx: btnFontPx },
  );
}

/**
 * Hall-effect B–X bench (霍尔效应测磁): dual panel with reserved footer.
 * Display scale is capped so fixed chrome + dense rows never stack/collide
 * (same lesson as geometric optics / hall carrier demo).
 */
function drawHallExperiment(ctx, W, _H, cfg) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const { hits, innerX, innerW, contentTop, contentH, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isLight = _uiTheme === 'light';
  const isDisplay = cfg.surface === 'display';
  const scale = Math.max(0.70, Math.min(innerW / 1080, contentH / 640));
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const target = d.target || 'solenoid';
  const isHelmholtz = target === 'helmholtz';
  const records = Array.isArray(d.records) ? d.records : [];

  const primaryBlue = isLight ? '#0284c7' : '#38bdf8';
  const deepBlue = isLight ? '#0369a1' : '#7dd3fc';
  const softFill = isLight ? 'rgba(14, 165, 233, 0.10)' : 'rgba(56, 189, 248, 0.14)';
  const softStroke = isLight ? 'rgba(2, 132, 199, 0.45)' : 'rgba(56, 189, 248, 0.42)';
  const dividerStroke = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.22)';

  const gap = Math.round(12 * scale);
  const pad = Math.round(14 * scale);

  const fillSoftText = (color, draw) => {
    ctx.save();
    ctx.fillStyle = color;
    if (isLight) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.96)';
      ctx.shadowBlur = 3;
    }
    draw();
    ctx.restore();
  };

  // —— Measurement Mode ——
  const rawIs = Number(d.Is || 0);
  const isVal = rawIs > 0.05 ? rawIs / 1000 : rawIs;
  const rawCoilPos = Number(d.rightCoilPos ?? 0.05);
  const coilPosVal = Math.abs(rawCoilPos) > 0.5 ? rawCoilPos / 100 : rawCoilPos;
  const rawLen = Number(d.solenoidLength || 0.30);
  const lenVal = rawLen > 1.0 ? rawLen / 100 : rawLen;
  const rawPos = Number(d.probePos ?? (isHelmholtz ? 0 : 16));
  const posVal = isHelmholtz ? (Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos) : rawPos;
  const cleanPosVal = Math.abs(posVal) < 1e-6 ? 0 : posVal;
  const posStr = isHelmholtz ? `${cleanPosVal.toFixed(3)} m` : `${cleanPosVal.toFixed(1)} cm`;
  const rawVh = Number(d.vh || 0);
  const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
  const vhMvStr = `${(vhV * 1000).toFixed(2)} mV`;
  const liveB = (d.wiring && d.wiring.energized === false) ? 0 : hallTheoreticalB(d, cleanPosVal);
  const liveBStr = `${liveB.toFixed(4)} T`;

  // 1. Top Bar: Mode selector tabs (Left) + Live 3-metric strip (Right)
  const topH = Math.round(62 * scale);
  const leftW = Math.round(innerW * 0.45);
  const colGap = gap;
  const rightX = innerX + leftW + colGap;
  const rightW = innerW - leftW - colGap;

  const targetW = (leftW - Math.round(8 * scale)) / 2;
  drawHallButton(ctx, hits, innerX, contentTop, targetW, topH, '亥姆霍兹线圈', 'hall-target', { target: 'helmholtz' }, primaryBlue, isHelmholtz, {
    fontPx: Math.round(17 * scale),
  });
  drawHallButton(ctx, hits, innerX + targetW + Math.round(8 * scale), contentTop, targetW, topH, '长螺线管', 'hall-target', { target: 'solenoid' }, primaryBlue, !isHelmholtz, {
    fontPx: Math.round(17 * scale),
  });

  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, rightX, contentTop, rightW, topH, 12);
  ctx.fill();
  ctx.stroke();

  const tele = [
    { k: isHelmholtz ? '探头位置 X' : '探杆刻度 X', v: posStr, c: P.text },
    { k: '霍尔电压 U_H', v: vhMvStr, c: primaryBlue },
    { k: '磁感应强度 B', v: liveBStr, c: primaryBlue },
  ];
  const teleColW = rightW / tele.length;
  tele.forEach((t, i) => {
    const tx = rightX + i * teleColW;
    const tcx = tx + teleColW / 2;
    if (i > 0) {
      ctx.strokeStyle = dividerStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, contentTop + Math.round(10 * scale));
      ctx.lineTo(tx, contentTop + topH - Math.round(10 * scale));
      ctx.stroke();
    }
    drawMathFormula(ctx, t.k, tcx, contentTop + Math.round(9 * scale), {
      fontSize: Math.round(13 * scale),
      color: P.muted,
      align: 'center',
      textBaseline: 'top',
    });
    ctx.fillStyle = t.c;
    let vPx = Math.round(20 * scale);
    ctx.font = `bold ${vPx}px "Microsoft YaHei", sans-serif`;
    while (vPx > 12 && ctx.measureText(t.v).width > teleColW - Math.round(12 * scale)) {
      vPx -= 1;
      ctx.font = `bold ${vPx}px "Microsoft YaHei", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(t.v, tcx, contentTop + Math.round(31 * scale));
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 2. Main Body + Bottom Action Bar geometry
  const contentBottom = contentTop + contentH;
  const footBtnH = Math.round(42 * scale);
  const btnY = contentBottom - footBtnH;
  const bodyY = contentTop + topH + gap;
  const bodyH = Math.max(Math.round(180 * scale), btnY - gap - bodyY);

  // —— Left Panel: Stitched Sliders + Setup Constant Pill + Record CTA ——
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, innerX, bodyY, leftW, bodyH, 12);
  ctx.fill();
  ctx.stroke();

  const lx = innerX + pad;
  const lw = leftW - pad * 2;
  let ly = bodyY + Math.round(13 * scale);

  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(19 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('实验参数与采样控制', lx, ly);
  ctx.fillStyle = deepBlue;
  ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(`K = ${Number(d.hallK || HALL_K)} V/(A·T)`, lx + lw, ly + Math.round(3 * scale));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ly += Math.round(30 * scale);

  const recBtnH = Math.round(44 * scale);
  const infoH = Math.round(30 * scale);
  const baseSlGap = Math.round(7 * scale);
  const totalZone = bodyY + bodyH - Math.round(12 * scale) - recBtnH - Math.round(9 * scale) - infoH - Math.round(9 * scale) - ly;
  const slH = Math.min(Math.round(72 * scale), Math.max(Math.round(48 * scale), Math.floor((totalZone - baseSlGap * 3) / 4)));
  const slGap = Math.max(baseSlGap, Math.floor((totalZone - slH * 4) / 3));

  const drawBoxSlider = (opts) => {
    ctx.fillStyle = P.panelAlt;
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.26)' : 'rgba(56, 189, 248, 0.20)';
    ctx.lineWidth = 1;
    roundRect(ctx, lx, opts.y, lw, opts.h, 10);
    ctx.fill();
    ctx.stroke();
    drawParamSlider(ctx, hits, {
      ...opts,
      x: lx + Math.round(6 * scale),
      w: lw - Math.round(12 * scale),
      accentHex: primaryBlue,
      largeType: true,
      hideRange: true,
    });
  };

  const sliderSpecs = [
    { label: '励磁电流 I_{m}', key: 'Im', value: Number(d.Im || 0), min: 0, max: 1, step: 0.01, unit: 'A', digits: 2 },
    { label: '霍尔电流 I_{s}', key: 'Is', value: isVal, min: 0, max: 0.010, step: 0.0005, unit: 'A', digits: 3 },
    ...(isHelmholtz
      ? [
          { label: '探头 X', key: 'probePos', value: cleanPosVal, min: -0.25, max: 0.25, step: 0.01, unit: 'm', digits: 3 },
          { label: '右线圈位置', key: 'rightCoilPos', value: coilPosVal, min: 0.02, max: 0.155, step: 0.01, unit: 'm', digits: 3 },
        ]
      : [
          { label: '探杆刻度 X', key: 'probePos', value: cleanPosVal, min: 1, max: 31, step: 0.5, unit: 'cm', digits: 1 },
          { label: '螺线管匝数 N', key: 'turns', value: Number(d.turns || 2340), min: 10, max: 5000, step: 10, unit: '匝', digits: 0 },
        ]),
  ];

  sliderSpecs.forEach((sp, i) => {
    drawBoxSlider({
      y: ly + i * (slH + slGap),
      h: slH,
      label: sp.label,
      value: sp.value,
      min: sp.min,
      max: sp.max,
      step: sp.step,
      setAction: 'hall-set',
      key: sp.key,
      unit: sp.unit,
      digits: sp.digits,
    });
  });

  const infoY = bodyY + bodyH - Math.round(12 * scale) - recBtnH - Math.round(8 * scale) - infoH;
  ctx.fillStyle = softFill;
  ctx.strokeStyle = softStroke;
  ctx.lineWidth = 1;
  roundRect(ctx, lx, infoY, lw, infoH, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = deepBlue;
  ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textBaseline = 'middle';
  const infoStr = isHelmholtz
    ? `左线圈位置: 0.000 m · 线圈模式: ${(d.wiring?.coilMode || d.coilMode || 'both') === 'fixed' ? '单左(B₁)' : (d.wiring?.coilMode || d.coilMode || 'both') === 'moving' ? '单右(B₂)' : '双线圈(B总)'}`
    : `螺线管长度 L = ${lenVal.toFixed(2)} m · 匝数密度 n = ${Math.round(Number(d.turns || 2340) / (lenVal || 0.3))} 匝/m`;
  ctx.fillText(infoStr, lx + Math.round(10 * scale), infoY + infoH / 2);
  ctx.textBaseline = 'alphabetic';

  drawHallButton(
    ctx, hits,
    lx, bodyY + bodyH - Math.round(12 * scale) - recBtnH,
    lw, recBtnH,
    '记录当前读数',
    'hall-record',
    {},
    primaryBlue,
    true,
    { fontPx: Math.round(18 * scale) },
  );

  // —— Right Panel: Data Table or B–X Curve ——
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, rightX, bodyY, rightW, bodyH, 12);
  ctx.fill();
  ctx.stroke();

  const rightHeadH = Math.round(42 * scale);
  const titleText = d.showCurve ? 'B–X 磁场分布曲线' : `实验数据记录 (共 ${records.length} 组)`;
  fillSoftText(primaryBlue, () => {
    ctx.font = `bold ${Math.round(17 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(titleText, rightX + pad, bodyY + rightHeadH / 2);
  });

  const chartX = rightX + pad;
  const chartY = bodyY + rightHeadH;
  const chartW = rightW - pad * 2;
  const chartH = Math.max(Math.round(110 * scale), bodyH - rightHeadH - Math.round(12 * scale));
  ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.88)' : 'rgba(15, 23, 42, 0.78)';
  ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.25)' : 'rgba(56, 189, 248, 0.16)';
  ctx.lineWidth = 1;
  roundRect(ctx, chartX, chartY, chartW, chartH, 9);
  ctx.fill();
  ctx.stroke();

  if (d.showCurve) {
    const same = (a, b, eps = 1e-6) => {
      if (a == null && b == null) return true;
      return Math.abs(Number(a) - Number(b)) <= eps;
    };
    const currentDirection = Number(d.direction || 0);
    const shown = records.filter((r) => r.target === target
      && (isHelmholtz || same(r.turns ?? d.turns, d.turns))
      && (target !== 'helmholtz' || same(r.rightCoilPos ?? d.rightCoilPos, d.rightCoilPos))
      && same(r.Im ?? d.Im, d.Im)
      && Number(r.direction || 0) === currentDirection);
    const xMin = isHelmholtz ? -0.05 : 1;
    const xMax = isHelmholtz ? 0.15 : 31;

    const measured = shown.map((r) => {
      const rawP = Number(r.pos || 0);
      return {
        x: isHelmholtz ? (Math.abs(rawP) > 0.5 ? rawP / 100 : rawP) : rawP,
        b: hallRecordedB(r),
        coilMode: r.coilMode || 'both',
      };
    });

    const curvesToDraw = [];
    const fixedColor = isLight ? '#1d4ed8' : '#93c5fd';
    const movingColor = isLight ? '#0d9488' : '#5eead4';
    const bothColor = primaryBlue;

    if (isHelmholtz) {
      if (measured.some((p) => p.coilMode === 'fixed')) {
        curvesToDraw.push({
          key: 'fixed',
          label: 'B₁',
          color: fixedColor,
          data: Array.from({ length: 161 }, (_, i) => {
            const x = xMin + ((xMax - xMin) * i) / 160;
            return { x, b: hallTheoreticalB({ ...d, coilMode: 'fixed' }, x) };
          }),
        });
      }
      if (measured.some((p) => p.coilMode === 'moving')) {
        curvesToDraw.push({
          key: 'moving',
          label: 'B₂',
          color: movingColor,
          data: Array.from({ length: 161 }, (_, i) => {
            const x = xMin + ((xMax - xMin) * i) / 160;
            return { x, b: hallTheoreticalB({ ...d, coilMode: 'moving' }, x) };
          }),
        });
      }
      if (measured.some((p) => p.coilMode === 'both')) {
        curvesToDraw.push({
          key: 'both',
          label: 'B总',
          color: bothColor,
          data: Array.from({ length: 161 }, (_, i) => {
            const x = xMin + ((xMax - xMin) * i) / 160;
            return { x, b: hallTheoreticalB({ ...d, coilMode: 'both' }, x) };
          }),
        });
      }
    } else if (measured.length > 0) {
      curvesToDraw.push({
        key: 'solenoid',
        label: '拟合曲线',
        color: bothColor,
        data: Array.from({ length: 161 }, (_, i) => {
          const x = xMin + ((xMax - xMin) * i) / 160;
          return { x, b: hallTheoreticalB(d, x) };
        }),
      });
    }

    const allCurveValues = curvesToDraw.flatMap((c) => c.data.map((p) => p.b));
    const allB = allCurveValues.concat(measured.map((p) => p.b), [0]);
    const rawMin = Math.min(...allB);
    const rawMax = Math.max(...allB);
    let yMin;
    let yMax;
    if (rawMin >= 0) {
      yMin = 0;
      yMax = Math.max(0.0002, rawMax * 1.12);
    } else if (rawMax <= 0) {
      yMin = Math.min(-0.0002, rawMin * 1.12);
      yMax = 0;
    } else {
      const yPad = Math.max(0.0002, (rawMax - rawMin) * 0.1);
      yMin = rawMin - yPad;
      yMax = rawMax + yPad;
    }

    const plotL = chartX + Math.round(58 * scale);
    const plotR = chartX + chartW - Math.round(14 * scale);
    const plotT = chartY + Math.round(28 * scale);
    const plotB = chartY + chartH - Math.round(32 * scale);
    const px = (xv) => plotL + ((xv - xMin) / (xMax - xMin)) * (plotR - plotL);
    const py = (bv) => plotB - ((bv - yMin) / Math.max(1e-9, yMax - yMin)) * (plotB - plotT);

    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const gx = plotL + (plotR - plotL) * t;
      ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.16)';
      ctx.beginPath(); ctx.moveTo(gx, plotT); ctx.lineTo(gx, plotB); ctx.stroke();
      fillSoftText(P.muted, () => {
        ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText((xMin + (xMax - xMin) * t).toFixed(isHelmholtz ? 2 : 1), gx, plotB + Math.round(4 * scale));
      });
    }
    for (let j = 0; j <= 4; j++) {
      const t = j / 4;
      const gy = plotB - (plotB - plotT) * t;
      ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.16)';
      ctx.beginPath(); ctx.moveTo(plotL, gy); ctx.lineTo(plotR, gy); ctx.stroke();
      fillSoftText(P.muted, () => {
        ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText((yMin + (yMax - yMin) * t).toFixed(4), plotL - Math.round(5 * scale), gy);
      });
    }
    ctx.strokeStyle = isLight ? '#64748b' : 'rgba(226, 232, 240, 0.5)';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(plotL, plotT); ctx.lineTo(plotL, plotB); ctx.lineTo(plotR, plotB); ctx.stroke();

    fillSoftText(P.text, () => {
      ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('B / T', chartX + Math.round(6 * scale), chartY + Math.round(6 * scale));
      ctx.textAlign = 'right';
      ctx.fillText(isHelmholtz ? 'X / m' : 'X / cm', plotR, plotB + Math.round(16 * scale));
    });

    if (d.showFit) {
      curvesToDraw.forEach((c) => {
        ctx.save();
        ctx.beginPath();
        let first = true;
        c.data.forEach((p) => {
          if (p.x < xMin || p.x > xMax) return;
          const cx = px(p.x);
          const cy = py(p.b);
          if (first) { ctx.moveTo(cx, cy); first = false; }
          else ctx.lineTo(cx, cy);
        });
        ctx.strokeStyle = c.color;
        ctx.lineWidth = Math.max(2, Math.round(2.5 * scale));
        ctx.stroke();
        ctx.restore();
      });
    }

    measured.forEach((p) => {
      if (p.x < xMin || p.x > xMax) return;
      const cx = px(p.x);
      const cy = py(p.b);
      const pointColor = isHelmholtz
        ? (p.coilMode === 'fixed' ? fixedColor : p.coilMode === 'moving' ? movingColor : bothColor)
        : bothColor;
      const arm = Math.max(3.2, Math.round(4.2 * scale));
      ctx.save();
      ctx.strokeStyle = pointColor;
      ctx.lineWidth = Math.max(1.4, 1.6 * scale);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
      ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
      ctx.stroke();
      ctx.restore();
    });

    fillSoftText(P.muted, () => {
      ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      let curX = plotR;
      if (isHelmholtz) {
        for (let idx = curvesToDraw.length - 1; idx >= 0; idx -= 1) {
          const item = curvesToDraw[idx];
          const text = `— ${item.label}`;
          ctx.fillStyle = item.color;
          ctx.fillText(text, curX, chartY + Math.round(13 * scale));
          curX -= ctx.measureText(text).width + Math.round(10 * scale);
        }
      } else {
        const fitLabel = (d.showFit && curvesToDraw.length > 0) ? '— 拟合曲线   ' : '';
        ctx.fillStyle = primaryBlue;
        ctx.fillText(`${fitLabel}+ 实测 ${shown.length} 组`, plotR, chartY + Math.round(13 * scale));
      }
    });
  } else {
    const cols = [
      { label: '#', x: 0.05, align: 'left' },
      { label: isHelmholtz ? 'X (m)' : 'X (cm)', x: 0.35, align: 'right' },
      { label: 'VH (mV)', x: 0.68, align: 'right' },
      { label: 'B (T)', x: 0.96, align: 'right' },
    ];
    const headRowH = Math.round(30 * scale);
    ctx.fillStyle = softFill;
    roundRect(ctx, chartX, chartY, chartW, headRowH, 6);
    ctx.fill();
    fillSoftText(deepBlue, () => {
      ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textBaseline = 'middle';
      cols.forEach((col) => {
        ctx.textAlign = col.align || 'left';
        ctx.fillText(col.label, chartX + chartW * col.x, chartY + headRowH / 2);
      });
    });

    const dataRowH = Math.round(28 * scale);
    const maxRows = Math.max(1, Math.floor((chartH - headRowH - Math.round(4 * scale)) / dataRowH));
    const maxStart = Math.max(0, records.length - maxRows);
    let start = maxStart;
    if (Number.isFinite(d.tableScrollTop) && d.tableScrollTop >= 0 && !d.tableScrollAuto) {
      start = Math.max(0, Math.min(maxStart, Math.round(d.tableScrollTop)));
    } else {
      d.tableScrollTop = maxStart;
      d.tableScrollAuto = true;
    }
    const visibleRows = records.slice(start, start + maxRows);

    hits.push({
      x: chartX,
      y: chartY,
      w: chartW,
      h: chartH,
      action: 'hall-scroll-table',
      role: 'scrollable_table',
      maxRows,
      maxStart,
      rowH: dataRowH,
      scrollable: maxStart > 0,
    });

    visibleRows.forEach((r, i) => {
      const y = chartY + headRowH + i * dataRowH;
      if (i % 2 === 0) {
        ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.03)';
        ctx.fillRect(chartX, y, chartW, dataRowH);
      }
      fillSoftText(isLight ? '#0f172a' : '#dbeafe', () => {
        ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
        ctx.textBaseline = 'middle';
        const rPos = Number(r.pos || 0);
        const rPosVal = isHelmholtz
          ? (Math.abs(rPos) > 0.5 ? rPos / 100 : rPos)
          : (Math.abs(rPos) <= 0.5 ? rPos * 100 : rPos);
        const cleanRPos = Math.abs(rPosVal) < 1e-6 ? 0 : rPosVal;
        const posXStr = cleanRPos.toFixed(isHelmholtz ? 3 : 1);
        const rVh = Number(r.vh || 0);
        const rVhV = Math.abs(rVh) > 0.05 ? rVh / 1000 : rVh;
        const values = [
          String(start + i + 1),
          posXStr,
          (rVhV * 1000).toFixed(2),
          hallRecordedB(r).toFixed(4),
        ];
        cols.forEach((col, ci) => {
          ctx.textAlign = col.align || 'left';
          ctx.fillText(values[ci], chartX + chartW * col.x, y + dataRowH / 2);
        });
      });
    });

    if (!records.length) {
      ctx.fillStyle = P.muted;
      ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('点击左侧「记录当前读数」采集实验数据', chartX + chartW / 2, chartY + headRowH + (chartH - headRowH) / 2);
    }

    if (records.length > maxRows) {
      const trackW = Math.round(6 * scale);
      const trackX = chartX + chartW - trackW - Math.round(4 * scale);
      const trackY = chartY + headRowH + Math.round(2 * scale);
      const trackH = chartH - headRowH - Math.round(6 * scale);
      ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.1)';
      roundRect(ctx, trackX, trackY, trackW, trackH, Math.round(3 * scale));
      ctx.fill();

      const thumbH = Math.max(Math.round(24 * scale), trackH * (maxRows / records.length));
      const thumbY = trackY + (start / Math.max(1, maxStart)) * (trackH - thumbH);
      ctx.fillStyle = primaryBlue;
      roundRect(ctx, trackX, thumbY, trackW, thumbH, Math.round(3 * scale));
      ctx.fill();
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // 3. Bottom Action Bar (4 buttons preserved)
  const btnGap = Math.round(10 * scale);
  const isFitting = d.showCurve && !!d.showFit;
  const labels = [
    { label: d.showCurve ? '返回记录' : '生成曲线', action: 'hall-chart' },
    { label: isFitting ? '隐藏拟合' : '拟合曲线', action: 'hall-fit', active: isFitting },
    { label: '导出数据', action: 'hall-export' },
    { label: '清空数据', action: 'hall-clear' },
  ];
  const bw = (innerW - btnGap * (labels.length - 1)) / labels.length;
  labels.forEach((b, i) => {
    drawHallButton(
      ctx, hits,
      innerX + i * (bw + btnGap), btnY, bw, footBtnH,
      b.label, b.action, {}, primaryBlue, !!b.active,
      { fontPx: Math.round(17 * scale) },
    );
  });
}

// ── Optics experiment screens ──────────────────────────────────────
// 设计原则：
// 1) 字号够大（全息/全屏可读）  2) 按步骤渐进展示，不堆满  3) 用布局计算而非 clip 裁切

/**
 * Hall carrier demo (霍尔效应原理): compact single-column flow.
 * Formula strip → live metrics → 2×2 sliders → type chips → action bar.
 * Avoids the old dual-panel layout that let status text collide with hints.
 */
function drawHallDemoExperiment(ctx, _W, _H, cfg) {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const { hits, innerX, innerW, contentTop, contentH, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isLight = _uiTheme === 'light';
  const isDisplay = cfg.surface === 'display';
  const uiScale = Math.max(0.66, Math.min(innerW / 1080, contentH / 640));
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};

  const primaryBlue = isLight ? '#0284c7' : '#38bdf8';
  const deepBlue = isLight ? '#0369a1' : '#7dd3fc';
  const softFill = isLight ? 'rgba(14, 165, 233, 0.10)' : 'rgba(56, 189, 248, 0.14)';
  const softStroke = isLight ? 'rgba(2, 132, 199, 0.45)' : 'rgba(56, 189, 248, 0.42)';
  const dividerStroke = isLight ? 'rgba(148, 163, 184, 0.35)' : 'rgba(148, 163, 184, 0.22)';

  const x = innerX;
  const w = innerW;
  const gap = Math.round(10 * uiScale);
  const pad = Math.round(12 * uiScale);

  const valI = Number(d.I ?? 1.0);
  const valB = Number(d.B ?? 1.0);
  const nVal = Math.max(0.01, Number(d.n ?? 1.0));
  const dVal = Math.max(0.01, Number(d.d ?? 0.5));
  const vh = Number(d.vh || 0);
  const isNType = d.nType !== false;
  const sign = isNType ? -1 : 1;
  const kVal = sign / (nVal * (dVal / 0.5));
  const kFormatted = `${kVal >= 0 ? '+' : ''}${kVal.toFixed(3)}`;
  const vhFormatted = `${vh >= 0 ? '+' : ''}${vh.toFixed(3)}`;
  const showField = d.showField !== false;

  // —— 1. Top 4-cell Telemetry Strip ——
  const statY = contentTop;
  const statH = Math.min(Math.round(82 * uiScale), Math.round(contentH * 0.15));
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, statY, w, statH, 12);
  ctx.fill();
  ctx.stroke();

  const stats = [
    { label: '工作电流 I', value: `${valI.toFixed(2)} A`, color: P.text },
    { label: '磁感应强度 B', value: `${valB >= 0 ? '+' : ''}${valB.toFixed(2)} T`, color: primaryBlue },
    { label: '霍尔电压 U_H', value: `${vhFormatted} V`, color: primaryBlue },
    { label: '灵敏度 K_H', value: `${kFormatted}`, color: P.text },
  ];
  const colW = w / stats.length;
  stats.forEach((st, i) => {
    const colX = x + i * colW;
    const cx = colX + colW / 2;
    if (i > 0) {
      ctx.strokeStyle = dividerStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(colX, statY + Math.round(10 * uiScale));
      ctx.lineTo(colX, statY + statH - Math.round(10 * uiScale));
      ctx.stroke();
    }
    drawMathFormula(ctx, st.label, cx, statY + Math.round(8 * uiScale), {
      fontSize: Math.round(15 * uiScale),
      color: P.muted,
      align: 'center',
      textBaseline: 'top',
    });
    ctx.fillStyle = st.color;
    let vPx = Math.round(22 * uiScale);
    ctx.font = `bold ${vPx}px "Microsoft YaHei", sans-serif`;
    while (vPx > 13 && ctx.measureText(st.value).width > colW - Math.round(14 * uiScale)) {
      vPx -= 1;
      ctx.font = `bold ${vPx}px "Microsoft YaHei", sans-serif`;
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(st.value, cx, statY + Math.round(32 * uiScale));
  });
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  // —— 2. Two-column Body: Left (4 Parameter Sliders) + Right (Carrier Type) ——
  const bodyY = statY + statH + gap;
  const bodyH = Math.max(200, contentTop + contentH - bodyY);
  const ctrlW = Math.round((w - gap) * 0.66);
  const resX = x + ctrlW + gap;
  const resW = w - ctrlW - gap;
  const subPad = Math.min(Math.round(14 * uiScale), Math.max(8, Math.round(bodyH * 0.028)));
  const subHeadH = Math.round(24 * uiScale);
  const btnGap = Math.round(14 * uiScale);

  // Left Card: 4 Stacked Continuous Parameter Sliders
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, bodyY, ctrlW, bodyH, 12);
  ctx.fill();
  ctx.stroke();

  const cx = x + pad;
  const cw = ctrlW - pad * 2;
  let gy = bodyY + subPad;
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(18 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('实验参数连续调节', cx, gy);
  ctx.fillStyle = primaryBlue;
  ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(d.paused ? '状态: 已暂停' : '状态: 载流子运动', cx + cw, gy + Math.round(3 * uiScale));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  gy += subHeadH + Math.round(8 * uiScale);

  const slZoneH = Math.max(100, bodyY + bodyH - subPad - gy);
  const baseSlGap = Math.round(8 * uiScale);
  const slH = Math.min(Math.round(112 * uiScale), Math.max(Math.round(36 * uiScale), Math.floor((slZoneH - baseSlGap * 3) / 4)));
  const slGap = Math.max(baseSlGap, Math.floor((slZoneH - slH * 4) / 3));

  const drawBoxSlider = (opts) => {
    ctx.fillStyle = P.panelAlt;
    ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.26)' : 'rgba(56, 189, 248, 0.20)';
    ctx.lineWidth = 1;
    roundRect(ctx, opts.x, opts.y, opts.w, opts.h, 9);
    ctx.fill();
    ctx.stroke();
    drawParamSlider(ctx, hits, {
      ...opts,
      x: opts.x + Math.round(8 * uiScale),
      w: opts.w - Math.round(16 * uiScale),
      accentHex: primaryBlue,
      largeType: true,
      hideRange: true,
    });
  };

  const demoSliders = [
    { label: '电流 I', key: 'I', value: valI, min: 0, max: 2, step: 0.05, unit: 'A', digits: 2 },
    { label: '磁场 B', key: 'B', value: valB, min: -2, max: 2, step: 0.05, unit: 'T', digits: 2 },
    { label: '载流子浓度 n', key: 'n', value: nVal, min: 0.3, max: 2.5, step: 0.05, unit: 'm⁻³', digits: 2 },
    { label: '元件厚度 d', key: 'd', value: dVal, min: 0.1, max: 1.2, step: 0.05, unit: 'm', digits: 2 },
  ];
  demoSliders.forEach((sp, i) => {
    drawBoxSlider({
      x: cx,
      y: gy + i * (slH + slGap),
      w: cw,
      h: slH,
      label: sp.label,
      value: sp.value,
      min: sp.min,
      max: sp.max,
      step: sp.step,
      setAction: 'hall-demo-set',
      key: sp.key,
      unit: sp.unit,
      digits: sp.digits,
    });
  });

  // Right Card: Carrier Type selector
  const rx = resX + pad;
  const rw = resW - pad * 2;
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, resX, bodyY, resW, bodyH, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(18 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('载流子类型', rx, bodyY + subPad);
  ctx.fillStyle = deepBlue;
  ctx.font = `bold ${Math.round(13 * uiScale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(isNType ? '多数载流子: 电子' : '多数载流子: 空穴', rx + rw, bodyY + subPad + Math.round(3 * uiScale));
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const typeZoneTop = bodyY + subPad + subHeadH + Math.round(10 * uiScale);
  const typeZoneH = Math.max(76, bodyY + bodyH - subPad - typeZoneTop);
  const typeBtnH = Math.max(34, Math.min(Math.round(112 * uiScale), Math.floor((typeZoneH - btnGap) / 2)));
  const typeStackH = typeBtnH * 2 + btnGap;
  const typeStartY = typeZoneTop + Math.max(0, Math.floor((typeZoneH - typeStackH) / 2));
  const typeFontPx = Math.round(18 * uiScale);
  drawHallButton(ctx, hits, rx, typeStartY, rw, typeBtnH, 'n型·电子 (e⁻)', 'hall-demo-type', { nType: true }, primaryBlue, isNType, { fontPx: typeFontPx });
  drawHallButton(ctx, hits, rx, typeStartY + typeBtnH + btnGap, rw, typeBtnH, 'p型·空穴 (h⁺)', 'hall-demo-type', { nType: false }, primaryBlue, !isNType, { fontPx: typeFontPx });
}

export function getHoloScreenLayoutSize(opts = {}) {
  const { active = false, hud = null, surface = 'full' } = opts;
  // Tabletop selector maintains stable 960x720 canvas (4:3 balanced tactical ratio)
  if (surface === 'selector') {
    return { width: 960, height: 720 };
  }

  const experiment = hud?.experiment;
  const running = !!(hud?.running && experiment);

  const width = 1024;
  if (!active) return { width, height: 640 };

  // Content display idles compact until an experiment is running.
  if (surface === 'display' && !running) {
    return { width: 1280, height: 780 };
  }

  if (surface === 'display' && running) {
    // Compact canvases: fill with controls, not empty glass.
    const denseDisplayHeights = {
      // Electromagnetism content panels: keep shorter so the bench stays visible.
      hall_carrier_demo: 760,
      hall_effect: 880,
      gauss_theorem: 880,
      electric_field: 920,
      faraday_induction: 820,
      induced_electric_field: 820,
      multi_slit_diffraction: 1040,
      reflection: 980,
      refraction: 1000,
      dispersion: 960,
      lens: 940,
      calorimetry: 880,
      convection: 840,
      'heat-conduction': 840,
      'ideal-gas': 800,
      'thermal-expansion': 880,
      'free-fall': 940,
      'inclined-plane': 900,
      pendulum: 940,
      collision: 1020,
      projectile: 1020,
      viscosity: 1120,
    };
    const denseHeight = denseDisplayHeights[experiment?.id];
    if (denseHeight) return { width: 1280, height: denseHeight };

    const stepCount = experiment?.steps?.length || 0;
    const dataLines = String(opts.dataHtml || '').split(/<br\s*\/?\s*>|\n/i).filter(Boolean).length;
    const contentHeight = Math.round((300 + stepCount * 54 + Math.min(dataLines, 6) * 30) * 1.2);
    return { width: 1280, height: Math.max(780, Math.min(1450, contentHeight)) };
  }

  if (!running) {
    const experiments = hud?.station?.experiments || [];
    const count = experiments.length;
    const cardH = HOLO_MENU_CARD_H;
    const gap = HOLO_MENU_CARD_GAP;
    const minH = 460;
    const menuH = Math.max(minH, 180 + count * (cardH + gap));
    return { width: 1024, height: Math.min(840, menuH) };
  }

  const denseExperimentHeights = {
    hall_carrier_demo: 540,
    hall_effect: 600,
    gauss_theorem: 600,
    electric_field: 620,
    faraday_induction: 660,
    induced_electric_field: 600,
  };
  const denseHeight = denseExperimentHeights[experiment.id];
  if (denseHeight) return { width: 1024, height: denseHeight };

  const stepCount = experiment.steps?.length || 0;
  const dataLines = String(opts.dataHtml || '').split(/<br\s*\/?\s*>|\n/i).filter(Boolean).length;
  const contentHeight = 300 + stepCount * 54 + Math.min(dataLines, 6) * 30;
  return { width: 1024, height: Math.max(680, Math.min(900, contentHeight)) };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} W
 * @param {number} H
 * @param {object} opts
 * @returns {{ hits: Array<{id:string,x:number,y:number,w:number,h:number,action:string,expId?:string}> }}
 */
export function drawHoloScreen(ctx, W, H, opts) {
  const {
    accentHex = '#38bdf8',
    fullTitle = '实验台',
    enTitle = 'STATION',
    active = false,
    hud = null,
    maximized = false,
    surface = 'full',
    theme: themeOpt,
  } = opts;

  const pressedPick = opts?.pressedPick || opts?.hoverPick || null;
  _uiPressedAction = pressedPick?.action || opts?.pressedAction || null;
  _uiPressedId = pressedPick?.id || opts?.pressedId || null;
  _uiHoverAction = _uiPressedAction;
  _uiHoverId = _uiPressedId;

  const hits = [];
  const isSelector = surface === 'selector';
  const isDisplay = surface === 'display';
  const pad = isSelector ? 24 : 28;
  const innerX = pad;
  const innerY = pad;
  const innerW = W - pad * 2;
  const innerH = H - pad * 2;
  const theme = themeOpt || (isDisplay ? 'light' : 'dark');
  _uiTheme = theme;
  const P = screenPalette(theme, accentHex, isDisplay);

  // Shared type scale (large for readability + easy UV/AR clicks)
  const scaleF = holoUiScale(surface);
  // Keep the layout scale available to the compact content-display chrome.
  // The display path evaluates this value before entering each experiment
  // drawer; leaving it undefined makes the whole canvas draw abort with a
  // ReferenceError while the glass shell remains visible.
  const scale = scaleF;
  const F = {
    headerMeta: Math.round(28 * scaleF),
    headerTitle: Math.round(40 * scaleF),
    idleTitle: Math.round(isSelector ? 54 : 76 * scaleF),
    idleSub: Math.round(isSelector ? 16 : 32 * scaleF),
    idleCta: Math.round(isSelector ? 24 : 40 * scaleF),
    idleHint: Math.round(isSelector ? 16 : 28 * scaleF),
    listHint: Math.round(28 * scaleF),
    cardNum: Math.round(28 * scaleF),
    cardName: Math.round(40 * scaleF),
    cardGoal: Math.round(28 * scaleF),
    expName: Math.round(40 * scaleF),
    theory: Math.round(36 * scaleF),
    section: Math.round(26 * scaleF),
    step: Math.round(28 * scaleF),
    stepActive: Math.round(30 * scaleF),
    hint: Math.round(26 * scaleF),
    data: Math.round(26 * scaleF),
    btn: Math.round(30 * scaleF),
    close: Math.round(40 * scaleF),
  };

  ctx.clearRect(0, 0, W, H);

  // High-Tech Holographic Cyber Glass Body
  ctx.save();
  if (isSelector) {
    // Spatial frosted glass backdrop
    const selBg = ctx.createLinearGradient(0, 0, 0, H);
    selBg.addColorStop(0, 'rgba(10, 18, 36, 0.76)');
    selBg.addColorStop(0.55, 'rgba(8, 14, 28, 0.82)');
    selBg.addColorStop(1, 'rgba(5, 10, 22, 0.88)');
    ctx.fillStyle = selBg;
    roundRect(ctx, 12, 12, W - 24, H - 24, 20);
    ctx.fill();

    // Top-edge subtle glass reflection
    const sheen = ctx.createLinearGradient(0, 12, 0, 90);
    sheen.addColorStop(0, 'rgba(255, 255, 255, 0.09)');
    sheen.addColorStop(0.6, 'rgba(255, 255, 255, 0.02)');
    sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = sheen;
    roundRect(ctx, 12, 12, W - 24, 80, 20);
    ctx.fill();

    // Dual-rim subtle border
    ctx.strokeStyle = active
      ? (accentHex ? `${accentHex}66` : 'rgba(56, 189, 248, 0.45)')
      : 'rgba(255, 255, 255, 0.12)';
    ctx.lineWidth = 1.2;
    if (active) {
      ctx.shadowColor = accentHex || '#38bdf8';
      ctx.shadowBlur = 8;
    }
    roundRect(ctx, 12, 12, W - 24, H - 24, 20);
    ctx.stroke();
    ctx.shadowBlur = 0;
  } else if (isDisplay && theme === 'light') {
    // Solid frosted alabaster cyber-glass with reduced transparency for crisp legibility against 3D room
    const dispBg = ctx.createLinearGradient(0, 12, 0, H - 12);
    if (active) {
      dispBg.addColorStop(0, 'rgba(255, 255, 255, 0.96)');
      dispBg.addColorStop(0.45, 'rgba(248, 250, 252, 0.94)');
      dispBg.addColorStop(1, 'rgba(241, 245, 249, 0.95)');
    } else {
      dispBg.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
      dispBg.addColorStop(1, 'rgba(241, 245, 249, 0.90)');
    }
    ctx.fillStyle = dispBg;
    roundRect(ctx, 12, 12, W - 24, H - 24, 18);
    ctx.fill();
  } else {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    if (theme === 'light') {
      if (active) {
        bg.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
        bg.addColorStop(0.45, 'rgba(248, 250, 252, 0.93)');
        bg.addColorStop(1, 'rgba(241, 245, 249, 0.95)');
      } else {
        bg.addColorStop(0, 'rgba(248, 250, 252, 0.90)');
        bg.addColorStop(0.5, 'rgba(241, 245, 249, 0.88)');
        bg.addColorStop(1, 'rgba(226, 232, 240, 0.90)');
      }
    } else if (active) {
      bg.addColorStop(0, isDisplay ? 'rgba(8, 20, 42, 0.96)' : 'rgba(8, 20, 42, 0.88)');
      bg.addColorStop(0.5, isDisplay ? 'rgba(12, 28, 54, 0.94)' : 'rgba(12, 28, 54, 0.85)');
      bg.addColorStop(1, isDisplay ? 'rgba(6, 16, 36, 0.96)' : 'rgba(6, 16, 32, 0.90)');
    } else {
      bg.addColorStop(0, isDisplay ? 'rgba(10, 22, 42, 0.94)' : 'rgba(10, 22, 42, 0.85)');
      bg.addColorStop(0.5, isDisplay ? 'rgba(14, 30, 56, 0.92)' : 'rgba(14, 30, 56, 0.82)');
      bg.addColorStop(1, isDisplay ? 'rgba(8, 18, 38, 0.94)' : 'rgba(8, 18, 38, 0.88)');
    }
    ctx.fillStyle = bg;
    roundRect(ctx, 12, 12, W - 24, H - 24, 18);
    ctx.fill();
  }

  // Bottom Projector Uplight Glow (only for non-selector dark panels)
  if (theme !== 'light' && !isDisplay && !isSelector) {
    if (typeof ctx.createRadialGradient === 'function') {
      const bottomGlow = ctx.createRadialGradient(W / 2, H - 10, 20, W / 2, H - 10, W * 0.65);
      bottomGlow.addColorStop(0, accentHex ? `${accentHex}30` : 'rgba(56, 189, 248, 0.18)');
      bottomGlow.addColorStop(0.55, accentHex ? `${accentHex}0c` : 'rgba(56, 189, 248, 0.05)');
      bottomGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = bottomGlow;
      roundRect(ctx, 12, 12, W - 24, H - 24, 18);
      ctx.fill();
    } else if (typeof ctx.createLinearGradient === 'function') {
      const bottomGlow = ctx.createLinearGradient(0, H - 120, 0, H);
      bottomGlow.addColorStop(0, 'rgba(0, 0, 0, 0)');
      bottomGlow.addColorStop(1, accentHex ? `${accentHex}1a` : 'rgba(56, 189, 248, 0.12)');
      ctx.fillStyle = bottomGlow;
      roundRect(ctx, 12, 12, W - 24, H - 24, 18);
      ctx.fill();
    }
  }

  // Outer Display Cyber Frame
  if (!isSelector) {
    ctx.strokeStyle = theme === 'light' ? (accentHex ? `${accentHex}66` : 'rgba(14, 165, 233, 0.45)') : accentHex;
    ctx.lineWidth = 1.6;
    ctx.globalAlpha = active ? 0.95 : 0.65;
    if (isDisplay && active) {
      ctx.shadowColor = theme === 'light' ? 'rgba(14, 165, 233, 0.35)' : accentHex;
      ctx.shadowBlur = theme === 'light' ? 10 : 12;
    }
    roundRect(ctx, 12, 12, W - 24, H - 24, 18);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Content display with a running experiment: no station header bar — experiment UI owns the title.
  const compactChrome = isDisplay && active && !!(hud?.running && hud?.experiment);
  // Tabletop selector hides separate top header bar when idle (single clean hero card layout).
  const hideSelectorHeader = isSelector && !active;
  const headerH = compactChrome ? 0 : (isDisplay ? 96 : (isSelector ? 80 : 64));

  if (!compactChrome && !hideSelectorHeader) {
    if (isDisplay && active) {
      ctx.font = `bold ${isDisplay ? 22 : 12}px "Microsoft YaHei", sans-serif`;
      ctx.fillStyle = theme === 'light' ? '#0369a1' : 'rgba(56, 189, 248, 0.65)';
      ctx.textAlign = 'left';
      ctx.fillText('// ' + (hud?.experiment?.name || 'EXPERIMENT') + '.HUD • OPTICAL', 38, 26);
      ctx.textAlign = 'right';
      ctx.fillText('[ONLINE • STREAM OK]', W - 38, 26);
      ctx.textAlign = 'left';
    }

    // Header Bar — clean glass header
    if (theme === 'light') {
      ctx.fillStyle = isDisplay ? 'rgba(255, 255, 255, 0.95)' : 'rgba(255, 255, 255, 0.88)';
    } else if (isDisplay) {
      const hBg = ctx.createLinearGradient(innerX, innerY, innerX + innerW, innerY);
      hBg.addColorStop(0, 'rgba(8, 20, 42, 0.96)');
      hBg.addColorStop(0.5, 'rgba(12, 28, 56, 0.94)');
      hBg.addColorStop(1, 'rgba(8, 20, 42, 0.96)');
      ctx.fillStyle = hBg;
    } else if (isSelector) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
    } else {
      const hBg = ctx.createLinearGradient(innerX, innerY, innerX, innerY + headerH);
      hBg.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
      hBg.addColorStop(1, 'rgba(255, 255, 255, 0.02)');
      ctx.fillStyle = hBg;
    }
    roundRect(ctx, innerX, innerY, innerW, headerH, isSelector ? 16 : 14);
    ctx.fill();

    ctx.strokeStyle = isSelector
      ? 'rgba(255, 255, 255, 0.08)'
      : (isDisplay ? (theme === 'light' ? 'rgba(14, 165, 233, 0.35)' : 'rgba(56, 189, 248, 0.35)') : 'transparent');
    ctx.lineWidth = 1;
    roundRect(ctx, innerX, innerY, innerW, headerH, isSelector ? 16 : 14);
    ctx.stroke();

    // Header Tag / Badge (for large front display only)
    if (isDisplay) {
      const headerTag = `[ ${hud?.experiment?.name || 'EXPERIMENT'} • HUD ]`;
      ctx.save();
      if (theme !== 'light') {
        ctx.fillStyle = accentHex;
        ctx.font = `bold 30px "Segoe UI", monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.shadowColor = accentHex;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(innerX + 26, innerY + headerH / 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillText(headerTag, innerX + 42, innerY + headerH / 2);
      } else {
        ctx.fillStyle = '#0369a1';
        ctx.font = `bold 28px "Segoe UI", monospace`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.beginPath();
        ctx.arc(innerX + 26, innerY + headerH / 2, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowColor = 'rgba(255, 255, 255, 0.98)';
        ctx.shadowBlur = 6;
        ctx.fillText(headerTag, innerX + 42, innerY + headerH / 2);
      }
      ctx.restore();
    }

    // Header Title
    ctx.save();
    ctx.textBaseline = 'middle';
    if (isDisplay && theme !== 'light') {
      ctx.fillStyle = P.title;
      ctx.textAlign = 'center';
      ctx.shadowColor = accentHex;
      ctx.shadowBlur = 10;
      ctx.font = `bold 52px "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`;
      const headerTitle = hud?.running && hud?.experiment?.name
        ? `${fullTitle} · ${hud.experiment.name}`
        : fullTitle;
      ctx.fillText(headerTitle, W / 2, innerY + headerH / 2);
    } else if (isSelector) {
      // Station pulse indicator dot
      ctx.fillStyle = accentHex || '#38bdf8';
      ctx.shadowColor = accentHex || '#38bdf8';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(innerX + 30, innerY + headerH / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;

      // Station title
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(fullTitle, innerX + 50, innerY + headerH / 2);

      // Station experiment count pill / hint
      const expCount = hud?.station?.experiments?.length || 0;
      const titleW = (typeof ctx.measureText === 'function') ? (ctx.measureText(fullTitle)?.width || 210) : 210;
      ctx.fillStyle = 'rgba(226, 232, 240, 0.90)';
      ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif';
      ctx.fillText(expCount > 0 ? `· ${expCount} 个实验项目` : '· 控制终端', innerX + 68 + titleW, innerY + headerH / 2);
    } else {
      ctx.fillStyle = P.title;
      ctx.textAlign = 'center';
      ctx.font = `bold 28px "PingFang SC", "Microsoft YaHei", "Segoe UI", sans-serif`;
      ctx.fillText(fullTitle, W / 2, innerY + headerH / 2);
    }
    ctx.restore();
  }

  // window chrome: maximize + close (active only; floating when compact)
  if (active) {
    const isSel = isSelector;
    const cw = isSel ? 48 : (compactChrome ? 44 : (isDisplay ? 68 : 48));
    const ch = isSel ? 48 : (compactChrome ? 40 : (isDisplay ? 60 : 40));
    const cy = isSel ? (innerY + (headerH - ch) / 2) : (compactChrome ? (innerY + 4) : (innerY + (isDisplay ? 18 : 12)));
    const gap = compactChrome ? 8 : 10;
    const closeX = innerX + innerW - cw - (isSel ? 16 : (compactChrome ? 6 : 12));
    const maxX = closeX - cw - gap;

    if (!isSelector) {
      const isHoverMax = _uiHoverAction === 'maximize' || _uiHoverId === 'maximize';
      ctx.save();
      ctx.fillStyle = maximized ? P.maxFillOn : (isHoverMax ? (theme === 'light' ? 'rgba(14, 165, 233, 0.28)' : 'rgba(56, 189, 248, 0.35)') : P.maxFill);
      roundRect(ctx, maxX, cy, cw, ch, 8);
      ctx.fill();
      ctx.strokeStyle = isHoverMax ? '#0284c7' : (theme === 'light' ? '#0284c7' : accentHex);
      ctx.lineWidth = isHoverMax ? 2.0 : 1.5;
      if (isHoverMax) {
        ctx.shadowColor = accentHex || '#38bdf8';
        ctx.shadowBlur = 8;
      }
      roundRect(ctx, maxX, cy, cw, ch, 8);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = P.maxIcon;
      ctx.lineWidth = 2.0;
      if (maximized) {
        ctx.strokeRect(maxX + cw * 0.22, cy + ch * 0.28, cw * 0.28, ch * 0.32);
        ctx.strokeRect(maxX + cw * 0.34, cy + ch * 0.2, cw * 0.28, ch * 0.32);
      } else {
        ctx.strokeRect(maxX + cw * 0.28, cy + ch * 0.26, cw * 0.36, ch * 0.4);
      }
      ctx.restore();
      hits.push({
        id: 'maximize',
        x: maxX - 4,
        y: cy - 4,
        w: cw + 8,
        h: ch + 8,
        action: 'maximize',
        chrome: true,
      });
    }

    const isHoverClose = _uiHoverAction === 'close' || _uiHoverId === 'close';
    ctx.save();
    ctx.fillStyle = isHoverClose
      ? 'rgba(239, 68, 68, 0.28)'
      : (isSel ? 'rgba(255, 255, 255, 0.06)' : P.closeFill);
    roundRect(ctx, closeX, cy, cw, ch, isSel ? 12 : 8);
    ctx.fill();
    ctx.strokeStyle = isHoverClose
      ? '#ef4444'
      : (isSel ? 'rgba(255, 255, 255, 0.12)' : P.closeStroke);
    ctx.lineWidth = isHoverClose ? 1.5 : 1.0;
    if (isHoverClose) {
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
    }
    roundRect(ctx, closeX, cy, cw, ch, isSel ? 12 : 8);
    ctx.stroke();
    ctx.fillStyle = isHoverClose
      ? '#ef4444'
      : (isSel ? '#f1f5f9' : P.closeText);
    ctx.font = `500 ${isSel ? 32 : (compactChrome ? 28 : (isDisplay ? 48 : 32))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('×', closeX + cw / 2, cy + ch / 2 - 2);
    ctx.restore();
    hits.push({
      id: 'close',
      x: closeX - 6,
      y: cy - 6,
      w: cw + 12,
      h: ch + 12,
      action: 'close',
      chrome: true,
    });
  }

  // scanlines
  if (isDisplay) {
    ctx.fillStyle = theme === 'light' ? 'rgba(14, 165, 233, 0.012)' : 'rgba(56, 189, 248, 0.015)';
    for (let y = 20; y < H - 20; y += 4) ctx.fillRect(20, y, W - 40, 1);
  } else if (!isSelector) {
    ctx.fillStyle = P.scanline;
    for (let y = 20; y < H - 20; y += 4) ctx.fillRect(20, y, W - 40, 1);
  }
  ctx.restore();

  if (!active) {
    // Display panels stay hidden until an experiment is chosen — idle art is for tabletop only.
    if (isDisplay) return { hits };

    const isHoverAct = _uiHoverAction === 'activate' || _uiHoverId === 'activate';

    // ── 1. Top Status Pill ──
    const pillText = '物理实验室 · 控制终端就绪';
    ctx.save();
    ctx.font = '600 18px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';
    const pillTextW = (typeof ctx.measureText === 'function') ? (ctx.measureText(pillText)?.width || 210) : 210;
    const pillW = pillTextW + 40;
    const pillH = isSelector ? 38 : 26;
    const pillX = (W - pillW) / 2;
    const pillY = isSelector ? 100 : 96;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(226, 232, 240, 0.90)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(pillText, W / 2, pillY + pillH / 2);
    ctx.restore();

    // ── 2. Station Main Hero Title ──
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${Math.round(isSelector ? 62 : 44 * scaleF)}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = accentHex || '#38bdf8';
    ctx.shadowBlur = 16;
    const titleY = isSelector ? 215 : 175;
    ctx.fillText(fullTitle, W / 2, titleY);
    ctx.shadowBlur = 0;

    // ── 3. Tech Subtitle ──
    const enLabel = (enTitle ? `${enTitle} WORKSTATION` : 'HOLOGRAPHIC WORKSTATION').split('').join(' ');
    ctx.fillStyle = accentHex || '#38bdf8';
    ctx.font = 'bold 18px "Segoe UI", -apple-system, monospace';
    ctx.globalAlpha = 0.85;
    ctx.fillText(enLabel, W / 2, titleY + (isSelector ? 52 : 38));
    ctx.globalAlpha = 1.0;
    ctx.restore();

    // ── 4. Minimalist Glass Capsule Action Button ──
    const ctaW = Math.min(560, W * (isSelector ? 0.72 : 0.65));
    const ctaH = isSelector ? 80 : 58;
    const ctaX = (W - ctaW) / 2;
    const ctaY = isSelector ? 355 : 280;

    ctx.save();
    const ctaGrad = ctx.createLinearGradient(ctaX, ctaY, ctaX, ctaY + ctaH);
    if (isHoverAct) {
      ctaGrad.addColorStop(0, accentHex ? `${accentHex}44` : 'rgba(56, 189, 248, 0.35)');
      ctaGrad.addColorStop(1, accentHex ? `${accentHex}20` : 'rgba(56, 189, 248, 0.16)');
    } else {
      ctaGrad.addColorStop(0, 'rgba(255, 255, 255, 0.08)');
      ctaGrad.addColorStop(1, accentHex ? `${accentHex}18` : 'rgba(56, 189, 248, 0.12)');
    }
    ctx.fillStyle = ctaGrad;
    roundRect(ctx, ctaX, ctaY, ctaW, ctaH, ctaH / 2);
    ctx.fill();

    ctx.strokeStyle = isHoverAct
      ? (accentHex || '#38bdf8')
      : (accentHex ? `${accentHex}55` : 'rgba(255, 255, 255, 0.18)');
    ctx.lineWidth = isHoverAct ? 1.6 : 1.1;
    if (isHoverAct) {
      ctx.shadowColor = accentHex || '#38bdf8';
      ctx.shadowBlur = 12;
    }
    roundRect(ctx, ctaX, ctaY, ctaW, ctaH, ctaH / 2);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Button label (clean and centered)
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${isSelector ? 26 : 18}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('瞄准桌面终端 · 点击激活', W / 2, ctaY + ctaH / 2);
    ctx.restore();

    // ── 5. Bottom Subtle Footnote ──
    ctx.save();
    ctx.fillStyle = 'rgba(148, 163, 184, 0.75)';
    ctx.font = `${isSelector ? 18 : 13}px "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✦ 选择实验后，内容将无缝投射到前方悬浮大屏', W / 2, isSelector ? 530 : 420);
    ctx.restore();

    hits.push({
      id: 'activate',
      x: 0,
      y: 0,
      w: W,
      h: H,
      action: 'activate',
      role: 'holo_activate',
      chrome: false,
    });
    return { hits };
  }

  // ── Active menu / experiment ──
  const station = hud?.station;
  const experiment = hud?.experiment;
  const running = !!(hud?.running && experiment);
  // Compact display: reserve top margin for window controls (close / maximize)
  const contentTop = compactChrome ? (innerY + Math.round(20 * scale)) : (innerY + headerH + 16);
  const contentH = compactChrome ? (innerH - Math.round(24 * scale)) : (innerH - headerH - 20);

  // Large front display only hosts running experiment content (hidden when idle).
  if (isDisplay && !running) {
    return { hits };
  }

  // Tabletop selector always shows experiment cards (never dense experiment UI).
  if (isSelector || !running) {
    const experiments = station?.experiments || [];
    const cardH = HOLO_MENU_CARD_H;
    const gap = HOLO_MENU_CARD_GAP;
    const totalCardsH = experiments.length > 0
      ? (experiments.length * cardH + (experiments.length - 1) * gap)
      : 0;
    const startY = contentTop + Math.max(4, Math.round((contentH - totalCardsH) * 0.5));
    let y = startY;

    // Comfortable card width padding
    const padX = isSelector ? 6 : 0;
    const x = innerX + padX;
    const w = innerW - padX * 2;

    if (experiments.length === 0) {
      ctx.save();
      ctx.fillStyle = "rgba(148, 163, 184, 0.65)";
      ctx.font = `500 ${isSelector ? 24 : 18}px "PingFang SC", "Microsoft YaHei", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("暂无实验内容", innerX + innerW / 2, contentTop + contentH / 2);
      ctx.restore();
      return { hits };
    }

    experiments.forEach((ex, i) => {
      if (y + cardH > contentTop + contentH) return;
      const selected = running && experiment?.id === ex.id;
      const isPressed = _uiPressedId === `exp-${ex.id}` || _uiPressedAction === `start-${ex.id}` || (pressedPick?.expId === ex.id);

      // Tactile physical displacement on press (down 2px, inset 1px)
      const cardX = isPressed ? x + 2 : x;
      const cardY = isPressed ? y + 2 : y;
      const cardW = isPressed ? w - 4 : w;
      const cardActualH = isPressed ? cardH - 2 : cardH;

      ctx.save();
      // Steady translucent dark frosted glass body
      if (selected) {
        ctx.fillStyle = accentHex ? `${accentHex}24` : 'rgba(56, 189, 248, 0.20)';
      } else if (isPressed) {
        ctx.fillStyle = accentHex ? `${accentHex}1a` : 'rgba(56, 189, 248, 0.15)';
      } else {
        ctx.fillStyle = 'rgba(14, 22, 40, 0.58)';
      }
      roundRect(ctx, cardX, cardY, cardW, cardActualH, 16);
      ctx.fill();

      // Border
      ctx.lineWidth = (selected || isPressed) ? 1.4 : 1.0;
      if (selected || isPressed) {
        ctx.strokeStyle = accentHex || '#38bdf8';
        if (selected) {
          ctx.shadowColor = accentHex || '#38bdf8';
          ctx.shadowBlur = 8;
        }
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
      }
      roundRect(ctx, cardX, cardY, cardW, cardActualH, 16);
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Active state left indicator pill
      if (selected) {
        ctx.fillStyle = accentHex || '#38bdf8';
        roundRect(ctx, cardX + 8, cardY + (cardActualH - 46) / 2, 4.5, 46, 2.5);
        ctx.fill();
      }

      // Left Number Badge (Refined Capsule)
      const numW = 68;
      const numH = 50;
      const numX = cardX + 22;
      const numY = cardY + (cardActualH - numH) / 2;
      ctx.fillStyle = (selected || isPressed)
        ? (accentHex ? `${accentHex}33` : 'rgba(56, 189, 248, 0.28)')
        : 'rgba(255, 255, 255, 0.05)';
      roundRect(ctx, numX, numY, numW, numH, 12);
      ctx.fill();
      ctx.strokeStyle = (selected || isPressed)
        ? (accentHex || '#38bdf8')
        : 'rgba(255, 255, 255, 0.09)';
      ctx.lineWidth = 1.0;
      roundRect(ctx, numX, numY, numW, numH, 12);
      ctx.stroke();

      ctx.fillStyle = (selected || isPressed) ? '#ffffff' : (accentHex || '#38bdf8');
      ctx.font = 'bold 28px -apple-system, BlinkMacSystemFont, "SF Pro Display", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1).padStart(2, '0'), numX + numW / 2, numY + numH / 2);

      // Card Title
      ctx.fillStyle = (selected || isPressed) ? '#ffffff' : '#f8fafc';
      ctx.font = 'bold 38px -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ex.name, cardX + 114, cardY + cardActualH / 2);

      // Right status / action indicator
      if (selected) {
        const tagW = 124;
        const tagH = 40;
        const tagX = cardX + cardW - tagW - 22;
        const tagY = cardY + (cardActualH - tagH) / 2;
        ctx.fillStyle = 'rgba(34, 197, 94, 0.15)';
        roundRect(ctx, tagX, tagY, tagW, tagH, 8);
        ctx.fill();
        ctx.strokeStyle = 'rgba(34, 197, 94, 0.40)';
        ctx.lineWidth = 1.0;
        roundRect(ctx, tagX, tagY, tagW, tagH, 8);
        ctx.stroke();

        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('● 进行中', tagX + tagW / 2, tagY + tagH / 2);
      } else {
        const arrowCircleR = 22;
        const arrowX = cardX + cardW - 38;
        const arrowY = cardY + cardActualH / 2;

        ctx.fillStyle = isPressed ? (accentHex ? `${accentHex}33` : 'rgba(56, 189, 248, 0.25)') : 'rgba(255, 255, 255, 0.05)';
        ctx.beginPath();
        ctx.arc(arrowX, arrowY, arrowCircleR, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = isPressed ? (accentHex || '#38bdf8') : 'rgba(226, 232, 240, 0.70)';
        ctx.font = '600 30px -apple-system, BlinkMacSystemFont, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('›', arrowX, arrowY - 2);
      }
      ctx.restore();

      hits.push({
        id: `exp-${ex.id}`,
        x, y, w, h: cardH,
        action: 'start',
        expId: ex.id,
      });
      y += cardH + gap;
    });
  } else {
    const stepIndex = hud.stepIndex || 0;
    const steps = experiment.steps || [];
    const dataText = stripHtml(opts.dataHtml || '');

    if (experiment.id === 'hall_effect') {
      drawHallExperiment(ctx, W, H, {
        hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
      });
      return { hits };
    }
    if (experiment.id === 'hall_carrier_demo') {
      drawHallDemoExperiment(ctx, W, H, {
        hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
      });
      return { hits };
    }
    if (experiment.id === 'electric_field') {
      drawElectricFieldExperiment(ctx, W, H, {
        hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
      });
      return { hits };
    }
    if (experiment.id === 'faraday_induction') {
      drawFaradayExperiment(ctx, W, H, {
        hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
      });
      return { hits };
    }
    if (experiment.id === 'induced_electric_field') {
      drawInducedElectricExperiment(ctx, W, H, {
        hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
      });
      return { hits };
    }

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    let y = contentTop;

    ctx.fillStyle = P.muted;
    ctx.font = `${F.section}px "Microsoft YaHei", sans-serif`;
    ctx.fillText('实验步骤', innerX + 4, y);
    y += 32;
    const stepLineH = 38;
    const stepMaxH = Math.min(steps.length * stepLineH + 16, contentTop + contentH - y - 200);
    const stepBoxH = Math.max(110, stepMaxH);
    ctx.fillStyle = P.stepBox;
    roundRect(ctx, innerX, y, innerW, stepBoxH, 8);
    ctx.fill();

    let sy = y + 14;
    steps.forEach((s, i) => {
      if (sy > y + stepBoxH - 32) return;
      const done = i < stepIndex;
      const cur = i === stepIndex;
      ctx.fillStyle = done ? P.done : cur ? accentHex : P.muted;
      ctx.font = cur
        ? `bold ${F.stepActive}px "Microsoft YaHei", sans-serif`
        : `${F.step}px "Microsoft YaHei", sans-serif`;
      const mark = done ? '✓' : String(i + 1);
      ctx.fillText(`${mark}  ${s.text}`, innerX + 14, sy);
      sy += stepLineH;
    });
    y += stepBoxH + 12;

    const hint = hud.step?.hint || '点击交互';
    const hintH = 58;
    ctx.fillStyle = P.hintBg;
    roundRect(ctx, innerX, y, innerW, hintH, 8);
    ctx.fill();
    ctx.fillStyle = P.hintText;
    ctx.font = `${F.hint}px "Microsoft YaHei", sans-serif`;
    const hints = wrapText(ctx, hint, innerW - 24);
    hints.slice(0, 2).forEach((ln, i) => {
      ctx.fillText(ln, innerX + 12, y + 12 + i * 28);
    });
    y += hintH + 12;

    const dataLineH = 28;
    const dataH = Math.min(150, contentTop + contentH - y - 68);
    if (dataH > 52) {
      ctx.fillStyle = P.dataBg;
      roundRect(ctx, innerX, y, innerW, dataH, 8);
      ctx.fill();
      ctx.fillStyle = P.dataText;
      ctx.font = `${F.data}px "Microsoft YaHei", sans-serif`;
      const dlines = dataText.split('\n').filter(Boolean);
      dlines.slice(0, Math.floor((dataH - 16) / dataLineH)).forEach((ln, i) => {
        ctx.fillText(ln.slice(0, 48), innerX + 12, y + 14 + i * dataLineH);
      });
      y += dataH + 10;
    }

    const btnY = Math.min(y, contentTop + contentH - (isDisplay ? 66 : 60));
    const btnH = isDisplay ? 64 : 56;
    const gap = isDisplay ? 16 : 12;
    const btns = [
      { label: '返回列表', action: 'back', active: false },
      { label: '执行 (E)', action: 'action', active: true },
    ];

    const btnW = (innerW - gap * (btns.length - 1)) / btns.length;
    btns.forEach((b, i) => {
      const bx = innerX + i * (btnW + gap);
      drawPremiumHoloButton(ctx, hits, bx, btnY, btnW, btnH, b.label, b.action, {}, accentHex, b.active, theme);
    });
  }

  return { hits };
}

function hitTestPoint(px, py, hits, pad = 0) {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (
      px >= h.x - pad
      && px <= h.x + h.w + pad
      && py >= h.y - pad
      && py <= h.y + h.h + pad
    ) {
      return h;
    }
  }
  return null;
}

/**
 * Map UV → canvas and resolve button. Tries several UV conventions so
 * front/back faces and Three.js UV orientation never “dead-click” chrome.
 */
/**
 * Attach the matched canvas pixel so continuous controls (e.g. Faraday B slider)
 * can map aim position → absolute value without a second UV conversion.
 */
function withPickPoint(hit, px, py) {
  if (!hit) return null;
  return { ...hit, px, py };
}

export function pickHoloScreen(u, v, W, H, hits, _facingSide = 1) {
  if (!hits?.length || u == null || v == null || !Number.isFinite(u) || !Number.isFinite(v)) {
    return null;
  }

  const facingSide = Number.isFinite(_facingSide) ? _facingSide : 1;
  const candidates = facingSide < 0
    ? [[(1 - u) * W, (1 - v) * H], [u * W, (1 - v) * H]]
    : [[u * W, (1 - v) * H], [(1 - u) * W, (1 - v) * H]];

  for (const [px, py] of candidates) {
    const exact = hitTestPoint(px, py, hits, 0);
    if (exact) return withPickPoint(exact, px, py);
    // Generous pad: free-aim / AR UV picks are much noisier than mouse on 2D UI.
    const hit = hitTestPoint(px, py, hits, 22);
    if (hit) return withPickPoint(hit, px, py);
  }

  for (const [px, py] of candidates) {
    if (px < W * 0.62 || py > H * 0.18) continue;
    let best = null;
    let bestD = Infinity;
    for (const h of hits) {
      if (!h.chrome) continue;
      const cx = h.x + h.w / 2;
      const cy = h.y + h.h / 2;
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = h;
      }
    }
    if (best) return withPickPoint(best, px, py);
  }

  return null;
}

/** Map a faraday-b-slider hit (desk value or canvas px) to B ∈ [min, max]. */
export function faradayBFromSliderPick(pick) {
  if (!pick || pick.action !== 'faraday-b-slider') return null;
  const min = Number(pick.min ?? -3);
  const max = Number(pick.max ?? 3);
  if (Number.isFinite(pick.value)) {
    return Math.max(min, Math.min(max, Number(pick.value)));
  }
  if (!Number.isFinite(pick.px)) return null;
  const trackX = Number.isFinite(pick.trackX) ? Number(pick.trackX) : Number(pick.x || 0);
  const trackW = Math.max(1, Number.isFinite(pick.trackW) ? Number(pick.trackW) : Number(pick.w || 1));
  const u = Math.max(0, Math.min(1, (Number(pick.px) - trackX) / trackW));
  return min + u * (max - min);
}

/**
 * Map an induced-e / param slider hit (with optional px) → { key, value }.
 * Prefer trackX/trackW when present so padded hit boxes stay accurate.
 */
export function inducedEFromSliderPick(pick) {
  if (!pick || (pick.action !== 'induced-e-slider' && !(pick.action === 'param-slider' && pick.setAction === 'induced-e-set'))) {
    return null;
  }
  if (!pick.key) return null;
  const value = valueFromParamSliderPick(pick);
  if (!Number.isFinite(value)) return null;
  return { key: pick.key, value };
}

export function uvFromRayAndMesh(raycaster, mesh) {
  if (!raycaster || !mesh) return null;
  const hits = raycaster.intersectObject(mesh, false);
  if (!hits.length) return null;
  const h = hits[0];
  if (h.uv) return { u: h.uv.x, v: h.uv.y, distance: h.distance, point: h.point };
  if (!h.point) return null;
  const local = mesh.worldToLocal(h.point.clone());
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (!bb) return null;
  const u = (local.x - bb.min.x) / Math.max(1e-6, bb.max.x - bb.min.x);
  const v = (local.y - bb.min.y) / Math.max(1e-6, bb.max.y - bb.min.y);
  return { u, v, distance: h.distance, point: h.point };
}
