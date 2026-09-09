
/**
 * Draw interactive experiment UI onto hologram canvas textures
 * and resolve UV picks like a flat computer screen.
 */

import {
  diffractionEnvelopeZeros,
  diffractionHalfSpan,
  diffractionIntensity,
  diffractionPrincipalMaxima,
  formatOpticsRecordCell,
  geoOpticsRecordColumns,
  getModulesForExperiment,
  isGeometricOpticsExp,
  isReflectionExp,
  opticsRecordColumns,
  SHAPE_LABELS,
} from './experiments/optics.js';
import { MEDIUM_PRESETS } from './guangxue/catalog.js';
import {
  buildThermoRecordRow,
  computeThermoMetrics,
  formatThermoRecordCell,
  thermoCanRecord,
  thermoRecordCaption,
  thermoRecordColumns,
} from './experiments/thermo.js';
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
const HALL_SOLENOID_RADIUS_M = 0.005;

/** Magnetic flux density in T from standard on-axis field equations. */
function hallTheoreticalB(data, pos) {
  const rawX = Number(pos || 0);
  const x = Math.abs(rawX) > 0.5 ? rawX / 100 : rawX;
  const Im = Number(data.Im || 0);
  let bTesla = 0;
  if (data.target === 'solenoid') {
    const rawLen = Number(data.solenoidLength || 0.30);
    const length = (rawLen > 2 ? rawLen / 100 : rawLen) || HALL_SOLENOID_LENGTH_M;
    const halfL = length / 2;
    const rawRad = Number(data.solenoidRadius || 0.014);
    const radius = (rawRad > 0.5 ? rawRad / 100 : rawRad) || HALL_SOLENOID_RADIUS_M;
    const n = Number(data.turns || 2340) / length;
    const endCos = (z) => z / Math.sqrt(z * z + radius * radius);
    bTesla = HALL_MU0 * n * Im * 0.5
      * (endCos(x + halfL) - endCos(x - halfL));
  } else {
    const rawRad = Number(data.coilRadius || 0.05);
    const radius = (rawRad > 0.5 ? rawRad / 100 : rawRad) || HALL_COIL_RADIUS_M;
    const turns = Number(data.coilTurns || 210) || HALL_COIL_TURNS;
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
  const isPressed = pressed || (action && _uiPressedAction === action) || (meta?.id && _uiPressedId === meta.id);
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
  const customFontSize = Number(meta?.fontSize);
  let fontSize;
  if (Number.isFinite(customFontSize) && customFontSize > 0) {
    fontSize = customFontSize;
  } else if (/[\\_^{}]/.test(text) && !/[\u4e00-\u9fa5]/.test(text)) {
    fontSize = Math.max(18, Math.min(34, Math.round(bh * 0.68)));
  } else {
    fontSize = Math.max(13, Math.min(22, Math.round(bh * 0.46)));
  }

  if (/[\\_^{}]/.test(text) && !/[\u4e00-\u9fa5]/.test(text)) {
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
    ? Math.max(20, Math.round(h * 0.36))
    : Math.max(11, Math.round(h * 0.22));
  const valuePx = largeType
    ? Math.max(22, Math.round(h * 0.40))
    : Math.max(12, Math.round(h * 0.28));
  const rangePx = largeType
    ? Math.max(13, Math.round(h * 0.18))
    : Math.max(9, Math.round(h * 0.14));

  const labelStr = String(label || '');
  const labelY = y + Math.round(h * (largeType ? 0.06 : 0.08));
  if (/[\\_^{}]|[A-Za-z]/.test(labelStr)) {
    drawMathFormula(ctx, labelStr, x + padX, labelY, {
      fontSize: labelPx,
      color: P.muted,
      align: 'left',
      textBaseline: 'top',
    });
  } else {
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${labelPx}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(labelStr, x + padX, labelY);
  }

  ctx.fillStyle = P.text;
  ctx.font = `bold ${valuePx}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  const valueText = `${v.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
  ctx.fillText(valueText, x + w - padX, y + Math.round(h * (largeType ? 0.04 : 0.06)));
  ctx.textAlign = 'left';

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

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(trackX + trackW * norm, trackY + trackH / 2, thumbR, 0, Math.PI * 2);
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
  return min + u * (max - min);
}

/**
 * Faraday content screen: set target B/x + duration, play a smooth change,
 * watch live E / Lenz sense, then review motion vs induction results.
 */
function drawFaradayExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isDisplay = cfg.surface === 'display';
  const scale = holoUiScale(cfg.surface || (isDisplay ? 'display' : 'full'));
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const fmt = (v, n = 3) => Number(v || 0).toFixed(n);
  const motion = d.lastMotion;
  const induction = d.lastInduction;
  const gap = Math.round(10 * scale);
  const x = innerX;
  const w = innerW;
  const animating = !!d.pendingAnim;
  const channelX = d.animChannel === 'x';
  const liveEmf = Number(d.liveEmf || 0);

  // —— Compact metric strip ——
  const statY = contentTop;
  const statH = Math.round(66 * scale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, statY, w, statH, 10);
  ctx.fill();
  ctx.stroke();
  const stats = [
    ['\\Phi_B', `${fmt(d.flux)} Wb`],
    ['\\varepsilon_i', `${liveEmf >= 0 ? '+' : ''}${fmt(liveEmf, 2)} V`],
  ];
  stats.forEach(([label, value], i) => {
    const colW = w / stats.length;
    const cx = x + i * colW + colW / 2;
    const labelY = statY + Math.round(statH * 0.12);
    const valY = statY + Math.round(statH * 0.48);
    if (/[\\_^{}]/.test(label)) {
      drawMathFormula(ctx, label, cx, labelY, {
        fontSize: Math.round(16 * scale),
        color: P.muted,
        align: 'center',
        textBaseline: 'top',
      });
    } else {
      ctx.fillStyle = P.muted;
      ctx.font = `italic bold ${Math.round(16 * scale)}px "Times New Roman", "Cambria Math", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, cx, labelY);
    }
    if (i === 1 && (animating || Math.abs(liveEmf) > 1e-6)) {
      ctx.fillStyle = _uiTheme === 'light' ? '#0284c7' : '#38bdf8';
    } else {
      ctx.fillStyle = P.text;
    }
    ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(value, cx, valY);
  });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  let cy = statY + statH + gap;

  // —— Dual result cards fill remaining height ——
  const cardBottom = contentTop + contentH;
  const cardW = (w - gap) / 2;
  const cardH = Math.max(80, cardBottom - cy);
  const cards = [
    {
      title: '动生 · x 变化',
      data: motion,
      lines: motion
        ? [`x: ${fmt(motion.x0)} \\rightarrow ${fmt(motion.x1)} \\mathrm{m}`, `\\Delta x = ${fmt(motion.dx)} \\mathrm{m} \\quad \\Delta t = ${fmt(motion.dt, 3)} \\mathrm{s}`, `\\varepsilon_i = ${fmt(motion.emf, 4)} \\mathrm{V}`, motion.senseLabel]
        : ['设目标 x 后播放', '或手拖铜棒'],
    },
    {
      title: '感生 · B 变化',
      data: induction,
      lines: induction
        ? [`B: ${fmt(induction.B0, 2)} \\rightarrow ${fmt(induction.B1, 2)} \\mathrm{T}`, `\\Delta B = ${fmt(induction.dB, 3)} \\quad \\Delta t = ${fmt(induction.dt, 3)} \\mathrm{s}`, `\\varepsilon_i = ${fmt(induction.emf, 4)} \\mathrm{V}`, induction.senseLabel]
        : ['设目标 B 后播放', '或点「反向变化」'],
    },
  ];
  cards.forEach((card, i) => {
    const cx = x + i * (cardW + gap);
    const cardAccent = i === 0 ? '#f472b6' : '#38bdf8';
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = P.panelStroke;
    ctx.lineWidth = isDisplay ? 1.6 : 1.2;
    roundRect(ctx, cx, cy, cardW, cardH, 12);
    ctx.fill();
    ctx.stroke();
    drawMathFormula(ctx, card.title, cx + Math.round(12 * scale), cy + Math.round(12 * scale), {
      fontSize: Math.round(17 * scale),
      color: cardAccent,
      align: 'left',
      textBaseline: 'top',
    });
    const lineH = Math.round(26 * scale);
    card.lines.forEach((line, li) => {
      const lineX = cx + Math.round(12 * scale);
      const lineY = cy + Math.round(42 * scale) + li * lineH;
      const color = (li === 2 && card.data)
        ? (_uiTheme === 'light' ? '#0284c7' : '#38bdf8')
        : P.text;
      const fontSize = (li === 2 && card.data)
        ? Math.round(17 * scale)
        : Math.round(15 * scale);

      if (/[\\_^{}]|[A-Za-z]/.test(line)) {
        drawMathFormula(ctx, line, lineX, lineY, {
          fontSize,
          color,
          align: 'left',
          textBaseline: 'top',
        });
      } else {
        ctx.fillStyle = color;
        ctx.font = `bold ${fontSize}px "Microsoft YaHei", sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillText(line, lineX, lineY);
      }
    });
    ctx.textBaseline = 'alphabetic';
  });
}

/**
 * Compact induced-E content screen (thermo-style density):
 * header + metric strip → 2×2 sliders → chip toolbar → E–r chart → actions.
 */
function drawInducedElectricExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isDisplay = cfg.surface === 'display';
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const scale = holoUiScale(cfg.surface);
  const fmt = (value, digits = 3) => Number(value || 0).toFixed(digits);
  const gap = Math.round(10 * scale);
  const x = innerX;
  const w = innerW;
  const isAuto = d.auto === true;
  const senseText = d.sense === 'cw' ? '顺时针' : d.sense === 'ccw' ? '逆时针' : '无';
  const q0Pos = Number(d.probe?.q0 || 0) >= 0;

  // —— Compact metric strip ——
  const statY = contentTop;
  const statH = Math.round(66 * scale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, statY, w, statH, 10);
  ctx.fill();
  ctx.stroke();
  const probeQ0 = Number(d.probe?.q0 ?? 1);
  const stats = [
    ['q_0', `${probeQ0 >= 0 ? '+' : ''}${fmt(probeQ0, 1)} \\mu\\mathrm{C}`],
    ['R', `${fmt(d.R, 2)} \\mathrm{m}`],
    ['B', `${fmt(d.B, 2)} \\mathrm{T}`],
    ['\\frac{\\mathrm{d}B}{\\mathrm{d}t}', `${fmt(d.dBdt, 2)} \\mathrm{T/s}`],
  ];
  stats.forEach(([label, value], i) => {
    const colW = w / stats.length;
    const cx = x + i * colW + colW / 2;
    const labelY = statY + Math.round(statH * 0.12);
    const valY = statY + Math.round(statH * 0.48);
    drawMathFormula(ctx, label, cx, labelY, {
      fontSize: Math.round(16 * scale),
      color: P.muted,
      align: 'center',
      textBaseline: 'top',
    });
    drawMathFormula(ctx, value, cx, valY, {
      fontSize: Math.round(15 * scale),
      color: P.text,
      align: 'center',
      textBaseline: 'top',
    });
  });
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';

  // —— Params live on the tabletop desk panel; screen keeps chart ——
  let cy = statY + statH + gap;

  // —— E–r textbook chart fills remaining space ——
  const chartH = Math.max(100, contentTop + contentH - cy);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  roundRect(ctx, x, cy, w, chartH, 12);
  ctx.fill();
  ctx.stroke();

  const profile = Array.isArray(d.profile) ? d.profile : [];
  const currR = Math.max(0.2, Number(d.R || 2));
  const absD = Math.abs(Number(d.dBdt || 0));

  // Theoretical peak height E_max = 0.5 * R * |dBdt|
  const theoreticalPeak = 0.5 * currR * absD;

  // Probe charge position & value
  const pr = Number(d.probeR || 0);
  const pe = Number(d.magnitudeE || 0);

  // 全量程基准（R_max=3.2, |dB/dt|_max=6.25 对应 E_max=10.0 V/m）：
  // 基准量程定为 10.5 V/m，确保滑块拉到绝对最大值时图像也完整容纳且留有清晰顶部余量，同时保证改变 R 绝不影响内区直线斜率
  const E_SCALE_MAX = Math.max(10.5, Math.max(theoreticalPeak, pe) * 1.05);

  const plotX = x + Math.round(58 * scale);
  const plotY = cy + Math.round(18 * scale);
  const plotW = w - Math.round(84 * scale);
  const plotH = chartH - Math.round(64 * scale);

  const axisColor = _uiTheme === 'light' ? 'rgba(100,116,139,.75)' : 'rgba(148,163,184,.65)';
  ctx.strokeStyle = axisColor;
  ctx.fillStyle = axisColor;
  ctx.lineWidth = 1.4;

  // Y-axis line + Arrow ▲
  ctx.beginPath();
  ctx.moveTo(plotX, plotY + plotH);
  ctx.lineTo(plotX, plotY - Math.round(8 * scale));
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(plotX - Math.round(4.5 * scale), plotY - Math.round(6 * scale));
  ctx.lineTo(plotX, plotY - Math.round(15 * scale));
  ctx.lineTo(plotX + Math.round(4.5 * scale), plotY - Math.round(6 * scale));
  ctx.closePath();
  ctx.fill();

  // X-axis line + Arrow ►
  ctx.beginPath();
  ctx.moveTo(plotX, plotY + plotH);
  ctx.lineTo(plotX + plotW + Math.round(10 * scale), plotY + plotH);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(plotX + plotW + Math.round(6 * scale), plotY + plotH - Math.round(4.5 * scale));
  ctx.lineTo(plotX + plotW + Math.round(15 * scale), plotY + plotH);
  ctx.lineTo(plotX + plotW + Math.round(6 * scale), plotY + plotH + Math.round(4.5 * scale));
  ctx.closePath();
  ctx.fill();

  // Axis labels (E_k at Y-top, r at X-right, 0 at origin)
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText('0', plotX - Math.round(12 * scale), plotY + plotH + Math.round(12 * scale));

  drawMathFormula(
    ctx,
    'E_k',
    plotX - Math.round(24 * scale),
    plotY - Math.round(18 * scale),
    {
      fontSize: Math.round(13 * scale),
      color: P.text,
      align: 'left',
      textBaseline: 'top',
    }
  );

  drawMathFormula(
    ctx,
    'r',
    plotX + plotW + Math.round(18 * scale),
    plotY + plotH,
    {
      fontSize: Math.round(13 * scale),
      color: P.text,
      align: 'left',
      textBaseline: 'middle',
    }
  );

  const rMax = 4.8;
  const rLineX = plotX + (currR / rMax) * plotW;
  const peakPy = plotY + plotH - (theoreticalPeak / E_SCALE_MAX) * (plotH * 0.88);
  const prx = plotX + (pr / rMax) * plotW;
  const pry = plotY + plotH - (pe / E_SCALE_MAX) * (plotH * 0.88);

  // 1. Plot E-r Curve
  if (profile.length > 1) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = Math.max(2, Math.round(2.6 * scale));
    ctx.beginPath();
    profile.forEach((pt, i) => {
      const px = plotX + (pt.r / rMax) * plotW;
      const py = plotY + plotH - (pt.E / E_SCALE_MAX) * (plotH * 0.88);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  }

  // 3. Formula annotations along curve (clean & borderless, collision-free)
  if (rLineX > plotX + Math.round(20 * scale) && absD > 0.01) {
    const midR = currR * 0.5;
    const midX = plotX + (midR / rMax) * plotW;
    const midE = 0.5 * midR * absD;
    const midY = plotY + plotH - (midE / E_SCALE_MAX) * (plotH * 0.88);

    // Collision check with probe dot
    const isProbeCloseToFormula = Math.hypot(prx - midX, pry - midY) < Math.round(36 * scale);
    const labelOffsetX = isProbeCloseToFormula ? Math.round(-24 * scale) : 0;
    const labelOffsetY = isProbeCloseToFormula ? Math.round(-18 * scale) : Math.round(-14 * scale);

    drawMathFormula(
      ctx,
      'E_k \\propto r',
      midX + labelOffsetX,
      midY + labelOffsetY,
      {
        fontSize: Math.round(12 * scale),
        color: '#ef4444',
        align: 'center',
        textBaseline: 'bottom',
      }
    );
  }

  if (rLineX < plotX + plotW - Math.round(30 * scale) && absD > 0.01) {
    const outR = Math.min(rMax * 0.88, currR * 1.8);
    const outX = plotX + (outR / rMax) * plotW;
    const outE = (0.5 * currR * currR * absD) / outR;
    const outY = plotY + plotH - (outE / E_SCALE_MAX) * (plotH * 0.88);
    drawMathFormula(
      ctx,
      'E_k \\propto \\frac{1}{r}',
      outX + Math.round(10 * scale),
      outY - Math.round(14 * scale),
      {
        fontSize: Math.round(12 * scale),
        color: '#ef4444',
        align: 'center',
        textBaseline: 'bottom',
      }
    );
  }

  // 4. PEAK POINT GUIDELINES & AXIS LABELS
  if (theoreticalPeak > 0.01) {
    ctx.save();
    const dashPattern = [Math.round(6 * scale), Math.round(4 * scale)];

    // Background dark contrast line for peak guidelines
    ctx.strokeStyle = _uiTheme === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.85)';
    ctx.lineWidth = Math.round(3.6 * scale);
    ctx.setLineDash(dashPattern);
    ctx.beginPath();
    ctx.moveTo(plotX, peakPy);
    ctx.lineTo(rLineX, peakPy);
    ctx.moveTo(rLineX, plotY + plotH);
    ctx.lineTo(rLineX, peakPy);
    ctx.stroke();

    // Solid bright red dashed line for peak guidelines
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = Math.round(2.2 * scale);
    ctx.beginPath();
    ctx.moveTo(plotX, peakPy);
    ctx.lineTo(rLineX, peakPy);
    ctx.moveTo(rLineX, plotY + plotH);
    ctx.lineTo(rLineX, peakPy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Y-axis tick & label for Peak (strictly on the left of Y-axis)
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(plotX - Math.round(4 * scale), peakPy);
    ctx.lineTo(plotX, peakPy);
    ctx.stroke();

    ctx.fillStyle = '#ef4444';
    ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${fmt(theoreticalPeak, 2)} V/m`, plotX - Math.round(6 * scale), peakPy);

    // X-axis tick & label for R (strictly below X-axis)
    ctx.beginPath();
    ctx.moveTo(rLineX, plotY + plotH);
    ctx.lineTo(rLineX, plotY + plotH + Math.round(4 * scale));
    ctx.stroke();

    drawMathFormula(
      ctx,
      `R = ${fmt(currR, 2)}\\mathrm{m}`,
      rLineX,
      plotY + plotH + Math.round(6 * scale),
      {
        fontSize: Math.round(11 * scale),
        color: accentHex,
        align: 'center',
        textBaseline: 'top',
      }
    );

    // Peak Dot on curve (no floating text box!)
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.arc(rLineX, peakPy, Math.round(5 * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. PROBE POINT GUIDELINES & AXIS LABELS
  if (pr > 0.01) {
    ctx.save();
    const dashPattern = [Math.round(6 * scale), Math.round(4 * scale)];

    // Background dark contrast line for probe guidelines
    ctx.strokeStyle = _uiTheme === 'light' ? 'rgba(255, 255, 255, 0.9)' : 'rgba(15, 23, 42, 0.85)';
    ctx.lineWidth = Math.round(3.6 * scale);
    ctx.setLineDash(dashPattern);
    ctx.beginPath();
    ctx.moveTo(prx, pry);
    ctx.lineTo(prx, plotY + plotH);
    ctx.moveTo(prx, pry);
    ctx.lineTo(plotX, pry);
    ctx.stroke();

    // Solid bright amber dashed line for probe guidelines
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = Math.round(2.2 * scale);
    ctx.beginPath();
    ctx.moveTo(prx, pry);
    ctx.lineTo(prx, plotY + plotH);
    ctx.moveTo(prx, pry);
    ctx.lineTo(plotX, pry);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Y-axis Probe Tick & Label (strictly on the left of Y-axis)
    ctx.strokeStyle = '#d97706';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(plotX - Math.round(4 * scale), pry);
    ctx.lineTo(plotX, pry);
    ctx.stroke();

    // Check collision with Peak Y label
    const isYTooClose = Math.abs(pry - peakPy) < Math.round(14 * scale);
    const yLabelOffsetY = isYTooClose ? (pry > peakPy ? Math.round(10 * scale) : Math.round(-10 * scale)) : 0;

    ctx.fillStyle = '#d97706';
    ctx.font = `bold ${Math.round(10.5 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${fmt(pe, 2)} V/m`, plotX - Math.round(6 * scale), pry + yLabelOffsetY);

    // X-axis Probe Tick & Label (strictly below X-axis)
    ctx.beginPath();
    ctx.moveTo(prx, plotY + plotH);
    ctx.lineTo(prx, plotY + plotH + Math.round(4 * scale));
    ctx.stroke();

    const isXTooClose = Math.abs(prx - rLineX) < Math.round(48 * scale);
    const xLabelOffsetY = isXTooClose ? Math.round(16 * scale) : 0;

    drawMathFormula(
      ctx,
      `r = ${fmt(pr, 2)}\\mathrm{m}`,
      prx,
      plotY + plotH + Math.round(6 * scale) + xLabelOffsetY,
      {
        fontSize: Math.round(11 * scale),
        color: '#d97706',
        align: 'center',
        textBaseline: 'top',
      }
    );

    // Probe Dot on curve (no floating text box!)
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(prx, pry, Math.round(5 * scale), 0, Math.PI * 2);
    ctx.fill();
  }

  // Title positioned at bottom-center with clean vertical clearance from X-axis ticks
  drawMathFormula(
    ctx,
    'E_k-r \\text{ 关系曲线}',
    x + w / 2,
    cy + chartH - Math.round(6 * scale),
    {
      fontSize: Math.round(13 * scale),
      color: P.title || P.text,
      align: 'center',
      textBaseline: 'bottom',
    }
  );
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
      label: '高斯面缩放',
      value: `${fmt(d.radius * 10, 1)}`,
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
    ctx.fillStyle = P.muted;
    ctx.font = `${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(st.label, x + Math.round(10 * scale), statY + Math.round(7 * scale));

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
  ctx.fillStyle = P.muted;
  ctx.font = `${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(
    `高斯面缩放 = ${fmt(d.radius * 10, 1)}`,
    innerX + padIn,
    bodyY + Math.round(36 * scale),
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
 * Compact electric-field HUD: formula + source tools.
 * Probe charge (q₀ / r / E / F) is drawn as a live 3D label above the sphere —
 * not duplicated on this content screen.
 */
function drawElectricFieldExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isDisplay = cfg.surface === 'display';
  const rawScale = holoUiScale(cfg.surface || (isDisplay ? 'display' : 'full'));
  const scale = isDisplay ? Math.min(rawScale, 1.30) : rawScale;
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const charges = Array.isArray(d.charges) ? d.charges : [];
  const selected = charges.find((charge) => charge.id === d.selectedId) || null;
  const probe = d.probe || { x: 0, y: 0, z: 0, q0: 1 };
  const fmt = (value, digits = 2) => Number(value || 0).toFixed(digits);
  const pad = Math.round(14 * scale);
  const gap = Math.round(10 * scale);
  const btnH = Math.round(36 * scale);
  const chipH = Math.round(36 * scale);
  const bottom = contentTop + contentH;

  // 高斯面所包围的净电荷与电通量 (Φ_E = Σq_i / ε_0)
  const radius = Number(d.radius || 2.4);
  const qEnc = Number.isFinite(Number(d.qEnclosed))
    ? Number(d.qEnclosed)
    : charges.reduce((sum, c) => (Math.hypot(c?.x || 0, c?.y || 0, c?.z || 0) < radius ? sum + Number(c?.q || 0) : sum), 0);
  const qEncVal = Math.abs(qEnc) < 1e-6 ? 0 : qEnc;
  const fluxVal = Number.isFinite(Number(d.flux))
    ? Number(d.flux)
    : (qEncVal * 1e-6) / (1 / (4 * Math.PI * 9.0e9));

  // ── Row 0: 3 等距分布常数与总结栏 ──
  const headH = Math.round(52 * scale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 2.0 : 1.2;
  roundRect(ctx, innerX, contentTop, innerW, headH, 10);
  ctx.fill();
  ctx.stroke();

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

  const headItems = [
    `\\varepsilon_{0} = 8.85\\times 10^{-12} \\text{ F/m}`,
    `\\Sigma q_{i} = ${qEncVal >= 0 ? '+' : ''}${fmt(qEncVal, 1)} \\mu\\text{C}`,
    formatFluxFormula(fluxVal),
  ];

  const secW = (innerW - pad * 2) / headItems.length;
  const headFontSize = Math.round(18 * scale);

  headItems.forEach((text, i) => {
    const cx = innerX + pad + (i + 0.5) * secW;
    drawMathFormula(
      ctx,
      text,
      cx,
      contentTop + headH / 2,
      { fontSize: headFontSize, color: P.title, align: 'center', textBaseline: 'middle', fontWeight: 'bold' },
    );
  });

  // ── Box 1: Action Buttons + Toggles + Charge Matrix (Outer container) ──
  let y = contentTop + headH + gap;
  const chipGap = Math.round(6 * scale);
  const maxChips = 12;

  // Row A: +正电荷 / +负电荷 / 重置
  const actionItems = [
    { label: '+ 正电荷', action: 'electric-add', meta: { sign: 1 }, color: accentHex },
    { label: '+ 负电荷', action: 'electric-add', meta: { sign: -1 }, color: accentHex },
    { label: '重置', action: 'electric-reset', meta: {}, color: accentHex },
  ];

  // Row B: 等势线 / 高斯面 / 试探电荷（3态切换：正电荷 / 负电荷 / 隐藏）
  const probeQ0 = Number(probe.q0 ?? 1);
  const probeQ0Num = Math.abs(probeQ0) < 1e-6 ? 0 : probeQ0;
  const isProbeVisible = d.showProbe !== false;
  let probeLabel = '';
  if (!isProbeVisible) {
    probeLabel = '试探电荷 (已隐藏)';
  } else {
    const probeQ0Sign = probeQ0Num > 0 ? '+' : '';
    probeLabel = `试探电荷 q₀(${probeQ0Sign}${fmt(probeQ0Num, 1)}μC)`;
  }
  const toggleItems = [
    { label: '等势线', action: 'electric-toggle', meta: { key: 'equipot' }, color: accentHex, active: Boolean(d.showEquipot) },
    { label: '高斯面', action: 'electric-toggle', meta: { key: 'gauss' }, color: accentHex, active: Boolean(d.showGauss) },
    { label: probeLabel, action: 'electric-probe-sign', meta: { mode: 'cycle', sign: isProbeVisible ? (probeQ0Num >= 0 ? -1 : 1) : 1 }, color: accentHex, active: isProbeVisible },
  ];

  // Row C & D: Charges list (up to 12)
  const chipItems = charges.slice(0, maxChips).map((charge, i) => ({
    label: `q_{${i + 1}}`,
    action: 'electric-select',
    meta: { id: charge.id, fontSize: Math.round(26 * scale) },
    color: accentHex,
    active: charge.id === d.selectedId,
  }));

  const itemsPerRow = 3;
  const topBtnW = (innerW - (itemsPerRow - 1) * gap) / itemsPerRow;

  // Box 1 Outer Container Height calculation
  const matrixItemsPerRow = Math.max(4, Math.min(6, chipItems.length || 1));
  const matrixRows = Math.ceil(chipItems.length / matrixItemsPerRow) || 1;
  const itemH = Math.round(42 * scale);
  const box1InnerPad = Math.round(10 * scale);
  const box1Height = box1InnerPad * 2 + btnH * 2 + gap * 2 + matrixRows * (itemH + chipGap);

  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 2.0 : 1.2;
  roundRect(ctx, innerX, y, innerW, box1Height, 14);
  ctx.fill();
  ctx.stroke();

  let innerY = y + box1InnerPad;

  // Draw Row A (Actions)
  actionItems.forEach((item, i) => {
    drawHallButton(
      ctx, hits,
      innerX + box1InnerPad + i * (topBtnW + gap - (box1InnerPad * 2 / itemsPerRow)),
      innerY,
      topBtnW - box1InnerPad, btnH,
      item.label, item.action, item.meta, item.color, false,
    );
  });
  innerY += btnH + gap;

  // Draw Row B (Toggles with merged Probe)
  toggleItems.forEach((item, i) => {
    drawHallButton(
      ctx, hits,
      innerX + box1InnerPad + i * (topBtnW + gap - (box1InnerPad * 2 / itemsPerRow)),
      innerY,
      topBtnW - box1InnerPad, btnH,
      item.label, item.action, item.meta, item.color, !!item.active,
    );
  });
  innerY += btnH + gap;

  // Draw Charge Chips Matrix
  const chipW = (innerW - box1InnerPad * 2 - (matrixItemsPerRow - 1) * chipGap) / matrixItemsPerRow;
  chipItems.forEach((item, i) => {
    const col = i % matrixItemsPerRow;
    const row = Math.floor(i / matrixItemsPerRow);
    drawHallButton(
      ctx, hits,
      innerX + box1InnerPad + col * (chipW + chipGap),
      innerY + row * (itemH + chipGap),
      chipW, itemH,
      item.label, item.action, item.meta, item.color, !!item.active,
    );
  });

  y += box1Height + gap;

  // ── Row 3: Axis Locks Only (3 equal-width controls per draft) ──
  const axisLock = d.axisLock || {};
  const lockControls = [
    { label: axisLock.x ? 'X · 锁' : '锁 X', action: 'electric-axis-lock', meta: { axis: 'x' }, color: accentHex, active: axisLock.x === true },
    { label: axisLock.y ? 'Y · 锁' : '锁 Y', action: 'electric-axis-lock', meta: { axis: 'y' }, color: accentHex, active: axisLock.y === true },
    { label: axisLock.z ? 'Z · 锁' : '锁 Z', action: 'electric-axis-lock', meta: { axis: 'z' }, color: accentHex, active: axisLock.z === true },
  ];
  const lockGap = Math.round(8 * scale);
  const lockBtnW = (innerW - lockGap * (lockControls.length - 1)) / lockControls.length;
  const lockH = Math.round(38 * scale);
  lockControls.forEach((item, i) => {
    drawHallButton(
      ctx, hits,
      innerX + i * (lockBtnW + lockGap),
      y,
      lockBtnW, lockH,
      item.label,
      item.action, item.meta,
      item.color,
      !!item.active,
    );
  });
  y += lockH + gap;

  // ── Box 2: Source-charge editor panel (Bottom container) ──
  const editorH = Math.max(Math.round(124 * scale), bottom - y - pad);
  const leftX = innerX;
  const colW = innerW;

  function drawEditorPanel(x, w, title, subtitle) {
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = P.panelStroke;
    ctx.lineWidth = isDisplay ? 2.0 : 1.2;
    roundRect(ctx, x, y, w, editorH, 14);
    ctx.fill();
    ctx.stroke();
    if (/[\\_^{}]|[A-Za-z]/.test(title)) {
      drawMathFormula(ctx, title, x + pad, y + Math.round(14 * scale), { fontSize: Math.round(22 * scale), color: P.title, align: 'left', textBaseline: 'top', fontWeight: 'bold' });
    } else {
      ctx.fillStyle = P.title;
      ctx.font = `bold ${Math.round(22 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(title, x + pad, y + Math.round(14 * scale));
    }
    if (subtitle) {
      if (/[\\_^{}]|[A-Za-z]/.test(subtitle)) {
        drawMathFormula(ctx, subtitle, x + pad, y + Math.round(48 * scale), { fontSize: Math.round(16 * scale), color: P.muted, align: 'left', textBaseline: 'top' });
      } else {
        ctx.fillStyle = P.muted;
        ctx.font = `bold ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(subtitle, x + pad, y + Math.round(48 * scale));
      }
    }
  }

  if (selected) {
    const idx = charges.findIndex((c) => c.id === selected.id) + 1;
    drawEditorPanel(
      leftX, colW,
      `场源电荷 q_{${idx}}`,
      `q_{${idx}} = ${selected.q >= 0 ? '+' : ''}${fmt(selected.q, 1)}\\mu\\text{C} \\quad x = ${fmt(selected.x)}\\text{m} \\quad y = ${fmt(selected.y)}\\text{m} \\quad z = ${fmt(selected.z)}\\text{m}`,
    );
    const toolsY = y + Math.round(78 * scale);
    const btnW = (colW - 2 * pad - 2 * gap) / 3;
    const toolBtnH = Math.round(36 * scale);
    drawHallButton(ctx, hits, leftX + pad, toolsY, btnW, toolBtnH, '正(+)', 'electric-sign', { sign: 1 }, accentHex, selected.q >= 0);
    drawHallButton(ctx, hits, leftX + pad + btnW + gap, toolsY, btnW, toolBtnH, '负(−)', 'electric-sign', { sign: -1 }, accentHex, selected.q < 0);
    drawHallButton(ctx, hits, leftX + pad + (btnW + gap) * 2, toolsY, btnW, toolBtnH, '删除选中', 'electric-delete', {}, accentHex);
  } else {
    drawEditorPanel(leftX, colW, '场源电荷 q', '点击上方列表或 3D 电荷以选中 · 试探电荷读数在球体上方');
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('未选中场源电荷（试探电荷信息见 3D 头顶标签）', leftX + colW / 2, y + editorH / 2 + Math.round(18 * scale));
  }
}

/**
 * Hall-effect B–X bench (霍尔效应测磁): dual panel with reserved footer.
 * Display scale is capped so fixed chrome + dense rows never stack/collide
 * (same lesson as geometric optics / hall carrier demo).
 */
function drawHallExperiment(ctx, W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isDisplay = cfg.surface === 'display';
  const scale = holoUiScale(cfg.surface || (isDisplay ? 'display' : 'full'));
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const isLight = _uiTheme === 'light';
  const identified = d.identified || {};
  const allIdentified = !!(identified.hall_helmholtz && identified.hall_solenoid && identified.hall_probe && identified.hall_console);
  const target = d.target || 'solenoid';
  const stepIndex = Number(d.stepIndex || 0);
  const records = Array.isArray(d.records) ? d.records : [];
  const gap = Math.round(10 * scale);
  const pad = Math.round(14 * scale);

  const fillSoftText = (color, draw) => {
    ctx.save();
    ctx.fillStyle = color;
    if (isLight) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.98)';
      ctx.shadowBlur = 4;
    }
    draw();
    ctx.restore();
  };

  // Step indicator (no experiment title)
  const totalSteps = experiment.steps?.length || 6;
  const stepText = `步骤 ${Math.min(stepIndex + 1, totalSteps)}/${totalSteps} · ${experiment.steps?.[stepIndex]?.text || '自由测量'}`;
  ctx.fillStyle = isLight ? 'rgba(14, 165, 233, 0.16)' : 'rgba(56, 189, 248, 0.14)';
  ctx.strokeStyle = isLight ? 'rgba(14, 165, 233, 0.45)' : 'rgba(56, 189, 248, 0.38)';
  ctx.lineWidth = 1.2;
  ctx.font = `bold ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`;
  const badgeW = Math.min(innerW - Math.round(20 * scale), ctx.measureText(stepText).width + Math.round(40 * scale));
  const badgeH = 0;
  // roundRect(ctx, innerX, contentTop, badgeW, badgeH, badgeH / 2);
  // ctx.fill();
  // ctx.stroke();
  fillSoftText(isLight ? '#0369a1' : '#7dd3fc', () => {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = `bold ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`;
    // ctx.fillText(stepText, innerX + Math.round(16 * scale), contentTop + badgeH / 2);
  });

  if (stepIndex === 0 && !allIdentified) {
    // Identify step: list the four apparatus (name + status). Compact vertical layout (no bottom overflow).
    const panelY = contentTop + Math.round(4 * scale);
    const availH = contentH - Math.round(8 * scale);
    
    // Exactly four recognition targets (order 01→04).
    const items = [
      { role: 'hall_helmholtz', n: '01', name: '亥姆霍兹线圈' },
      { role: 'hall_solenoid', n: '02', name: '长螺线管' },
      { role: 'hall_probe', n: '03', name: '霍尔探头与标尺' },
      { role: 'hall_console', n: '04', name: 'HCC-2 测磁仪' },
    ];
    const nextRole = items.find((item) => !identified[item.role])?.role || null;
    const nextItem = items.find((item) => item.role === nextRole) || null;
    const feedback = d.identifyFeedback || null;

    const headH = Math.round(36 * scale);
    const cardGap = Math.round(10 * scale);
    const cardTop = panelY + headH + Math.round(8 * scale);
    const cardW = (innerW - pad * 2 - cardGap) / 2;
    const cardH = Math.round(52 * scale);
    
    const gridH = cardH * 2 + cardGap;
    const btnH = Math.round(38 * scale);
    const btnY = cardTop + gridH + Math.round(10 * scale);
    const calculatedPanelH = (btnY + btnH + Math.round(10 * scale)) - panelY;
    const panelH = Math.min(availH, calculatedPanelH);

    // Draw main panel background
    ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(10, 22, 44, 0.75)';
    ctx.strokeStyle = isLight ? 'rgba(14, 165, 233, 0.45)' : 'rgba(56, 189, 248, 0.35)';
    ctx.lineWidth = 1.6;
    roundRect(ctx, innerX, panelY, innerW, panelH, 14);
    ctx.fill();
    ctx.stroke();

    // Panel Header Title
    fillSoftText(isLight ? '#0284c7' : accentHex, () => {
      ctx.font = `bold ${Math.round(22 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textBaseline = 'top';
      ctx.textAlign = 'left';
      ctx.fillText('实验器材识别', innerX + pad, panelY + Math.round(14 * scale));
    });

    // 2×2 Cards Grid
    items.forEach((item, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = innerX + pad + col * (cardW + cardGap);
      const y = cardTop + row * (cardH + cardGap);
      const done = !!identified[item.role];
      const current = !done && item.role === nextRole;

      ctx.save();
      if (current && !isLight) {
        ctx.shadowColor = accentHex;
        ctx.shadowBlur = 16;
      }
      ctx.fillStyle = done
        ? (isLight ? 'rgba(255, 255, 255, 0.88)' : 'rgba(34, 197, 94, 0.14)')
        : current
          ? (isLight ? 'rgba(240, 249, 255, 0.98)' : 'rgba(56, 189, 248, 0.20)')
          : (isLight ? 'rgba(255, 255, 255, 0.75)' : 'rgba(15, 30, 56, 0.45)');
      ctx.strokeStyle = done
        ? (isLight ? '#16a34a' : '#4ade80')
        : current
          ? (isLight ? '#0284c7' : accentHex)
          : (isLight ? 'rgba(14, 165, 233, 0.35)' : 'rgba(148, 163, 184, 0.24)');
      ctx.lineWidth = current ? 2.4 : 1.2;
      roundRect(ctx, x, y, cardW, cardH, 12);
      ctx.fill();
      ctx.stroke();
      ctx.restore();

      if (current) {
        ctx.fillStyle = isLight ? '#0284c7' : accentHex;
        roundRect(ctx, x + Math.round(14 * scale), y + 2, cardW - Math.round(28 * scale), 4, 2);
        ctx.fill();
      }

      ctx.save();
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const cy = y + cardH / 2;

      // Status Tag Pill layout calculations
      const statusTag = done ? '已识别' : current ? '当前' : '待识别';
      const pillW = Math.round(done ? 64 : 56) * scale;
      const pillH = Math.round(26 * scale);
      const pillX = x + cardW - pillW - Math.round(10 * scale);
      const pillY = y + (cardH - pillH) / 2;

      // Number tag [01] / ✓
      ctx.fillStyle = done
        ? (isLight ? '#15803d' : '#4ade80')
        : current
          ? (isLight ? '#0284c7' : accentHex)
          : (isLight ? '#64748b' : '#94a3b8');
      if (isLight) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.98)';
        ctx.shadowBlur = 4;
      }
      const numPx = Math.max(14, Math.min(20, Math.round(cardH * 0.28)));
      ctx.font = `bold ${numPx}px "Microsoft YaHei", sans-serif`;
      const numLabel = done ? '✓' : `[${item.n}]`;
      const numW = ctx.measureText(numLabel).width;
      const numX = x + Math.round(12 * scale);
      ctx.fillText(numLabel, numX, cy);

      // Device Name text with dynamic width protection (prevents overlap with status pill)
      const nameX = numX + numW + Math.round(8 * scale);
      const maxNameW = pillX - nameX - Math.round(6 * scale);
      ctx.fillStyle = isLight ? '#0f172a' : '#f8fafc';
      let namePx = Math.max(12, Math.min(18, Math.round(cardH * 0.28)));
      ctx.font = `bold ${namePx}px "Microsoft YaHei", sans-serif`;
      const actualNameW = ctx.measureText(item.name).width;
      if (actualNameW > maxNameW && maxNameW > 10) {
        namePx = Math.max(10, Math.floor(namePx * (maxNameW / actualNameW)));
        ctx.font = `bold ${namePx}px "Microsoft YaHei", sans-serif`;
      }
      ctx.fillText(item.name, nameX, cy, Math.max(10, maxNameW));
      ctx.restore();

      // Right status pill badge
      ctx.fillStyle = done
        ? (isLight ? 'rgba(34,197,94,0.18)' : 'rgba(34,197,94,0.22)')
        : current
          ? (isLight ? 'rgba(14,165,233,0.22)' : 'rgba(56,189,248,0.28)')
          : (isLight ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.14)');
      roundRect(ctx, pillX, pillY, pillW, pillH, pillH / 2);
      ctx.fill();
      ctx.fillStyle = done
        ? (isLight ? '#15803d' : '#86efac')
        : current
          ? (isLight ? '#0369a1' : '#7dd3fc')
          : (isLight ? '#64748b' : '#94a3b8');
      ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(statusTag, pillX + pillW / 2, pillY + pillH / 2);
    });

    drawHallButton(
      ctx, hits,
      innerX + innerW * 0.2,
      btnY,
      innerW * 0.6,
      btnH,
      nextItem ? `确认瞄准：${nextItem.n} ${nextItem.name}` : '✓ 全部器材识别完成',
      'hall-identify', {}, accentHex, true,
    );
    return;
  }

  // ── Measurement UI: bottom-up bands so footer never collides with panels ──
  const contentBottom = contentTop + contentH;
  const btnH = Math.round(36 * scale);
  const btnBottomPad = Math.round(12 * scale);
  const btnY = contentBottom - btnH - btnBottomPad;
  const targetH = Math.round(34 * scale);
  const targetY = contentTop + badgeH + (badgeH ? gap : 0);
  const bodyY = targetY + targetH + gap;
  const bodyH = Math.max(Math.round(160 * scale), btnY - gap - bodyY);
  const colGap = Math.round(12 * scale);
  const leftW = Math.round(innerW * 0.42);
  const rightX = innerX + leftW + colGap;
  const rightW = innerW - leftW - colGap;

  // Target mode chips (Helmholtz vs Solenoid selector)
  const targetW = (innerW - colGap) / 2;
  drawHallButton(
    ctx, hits,
    innerX, targetY, targetW, targetH,
    '亥姆霍兹线圈', 'hall-target', { target: 'helmholtz' }, accentHex, target === 'helmholtz',
  );
  drawHallButton(
    ctx, hits,
    innerX + targetW + colGap, targetY, targetW, targetH,
    '长螺线管', 'hall-target', { target: 'solenoid' }, accentHex, target === 'solenoid',
  );

  // ── Left: live parameter readout card ──
  ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.88)' : 'rgba(2, 12, 27, 0.72)';
  ctx.strokeStyle = isLight ? 'rgba(14, 165, 233, 0.45)' : 'rgba(56, 189, 248, 0.28)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, innerX, bodyY, leftW, bodyH, 12);
  ctx.fill();
  ctx.stroke();

  const leftHeadH = Math.round(38 * scale);
  const leftFootH = 0;
  const paramAreaTop = bodyY + leftHeadH;
  const paramAreaH = Math.max(0, bodyH - leftHeadH);

  fillSoftText(isLight ? '#0284c7' : accentHex, () => {
    ctx.font = `bold ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('实验参数', innerX + pad, bodyY + leftHeadH / 2);
  });

  const rawIs = Number(d.Is || 0);
  const isVal = rawIs > 0.05 ? rawIs / 1000 : rawIs;
  const rawCoilPos = Number(d.rightCoilPos || 0);
  const coilPosVal = Math.abs(rawCoilPos) > 0.5 ? rawCoilPos / 100 : rawCoilPos;
  const rawLen = Number(d.solenoidLength || 0.30);
  const lenVal = rawLen > 1.0 ? rawLen / 100 : rawLen;

  const params = [
    { key: 'Im', label: '励磁电流 Im', value: Number(d.Im || 0), unit: 'A', digits: 2 },
    { key: 'Is', label: '霍尔电流 Is', value: isVal, unit: 'A', digits: 3 },
    { key: 'hallK', label: '灵敏度 K', value: Number(d.hallK || HALL_K), unit: 'V/(A·T)', digits: 0 },
    ...(target === 'helmholtz'
      ? [
          { key: 'leftCoilPos', label: '左线圈位置', value: 0, unit: 'm', digits: 3 },
          { key: 'rightCoilPos', label: '右线圈位置', value: coilPosVal, unit: 'm', digits: 3 },
        ]
      : [
          { key: 'solenoidLength', label: '螺线管长度 L', value: lenVal, unit: 'm', digits: 2 },
          { key: 'turns', label: '螺线管匝数 N', value: Number(d.turns || 2340), unit: '匝', digits: 0 },
          { key: 'turnsDensity', label: '匝数密度 n', value: Math.round(Number(d.turns || 2340) / (lenVal || 0.3)), unit: '匝/米', digits: 0 },
        ]),
  ];

  // Divide paramAreaH strictly by params.length to guarantee no footer collisions
  const paramRowH = paramAreaH / Math.max(1, params.length);
  const labelPx = Math.max(12, Math.min(15, Math.round(paramRowH * 0.38)));
  const valuePx = Math.max(13, Math.min(17, Math.round(paramRowH * 0.44)));

  params.forEach((p, i) => {
    const y = paramAreaTop + i * paramRowH;
    const cy = y + paramRowH / 2;

    if (i % 2 === 1) {
      ctx.fillStyle = isLight ? 'rgba(14, 165, 233, 0.05)' : 'rgba(56, 189, 248, 0.04)';
      roundRect(ctx, innerX + Math.round(6 * scale), y + 2, leftW - Math.round(12 * scale), Math.max(0, paramRowH - 4), 6);
      ctx.fill();
    } else if (i > 0) {
      ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.22)' : 'rgba(148, 163, 184, 0.12)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(innerX + pad, y);
      ctx.lineTo(innerX + leftW - pad, y);
      ctx.stroke();
    }

    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${labelPx}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(p.label, innerX + pad, cy);

    const valText = `${Number(p.value).toFixed(p.digits)}${p.unit ? ` ${p.unit}` : ''}`;
    const maxValW = leftW - pad * 2 - ctx.measureText(p.label).width - Math.round(6 * scale);
    ctx.fillStyle = isLight ? '#0369a1' : '#7dd3fc';
    let fSize = valuePx;
    ctx.font = `bold ${fSize}px "Microsoft YaHei", sans-serif`;
    while (ctx.measureText(valText).width > maxValW && fSize > 10) {
      fSize -= 1;
      ctx.font = `bold ${fSize}px "Microsoft YaHei", sans-serif`;
    }
    ctx.textAlign = 'right';
    ctx.fillText(valText, innerX + leftW - pad, cy);
  });

  // ── Right: VH readout strip + data table / curve ──
  ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.88)' : 'rgba(2, 12, 27, 0.72)';
  ctx.strokeStyle = isLight ? 'rgba(14, 165, 233, 0.45)' : 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1.4;
  roundRect(ctx, rightX, bodyY, rightW, bodyH, 12);
  ctx.fill();
  ctx.stroke();

  const rightHeadH = Math.round(38 * scale);
  const rightFootH = Math.round(10 * scale);
  const titleText = d.showCurve ? 'B–X 磁场分布' : '实验数据记录';

  fillSoftText(isLight ? '#0284c7' : accentHex, () => {
    ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(titleText, rightX + pad, bodyY + rightHeadH / 2);
  });

  const chartX = rightX + pad;
  const chartY = bodyY + rightHeadH;
  const chartW = rightW - pad * 2;
  const chartH = Math.max(Math.round(96 * scale), bodyH - rightHeadH - rightFootH);
  ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(15, 23, 42, 0.78)';
  roundRect(ctx, chartX, chartY, chartW, chartH, 8);
  ctx.fill();

  if (d.showCurve) {
    const same = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps;
    const isHelmholtz = target === 'helmholtz';
    const shown = records.filter((r) => r.target === target
      && (isHelmholtz || same(r.turns ?? d.turns, d.turns))
      && (target !== 'helmholtz' || same(r.rightCoilPos ?? d.rightCoilPos, d.rightCoilPos))
      && same(r.Im ?? d.Im, d.Im)
      && Number(r.direction ?? d.direction) === Number(d.direction));
    const xMin = -0.15;
    const xMax = 0.15;

    const measured = shown.map((r) => {
      const rawPos = Number(r.pos || 0);
      return {
        x: Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos,
        b: hallRecordedB(r),
        coilMode: r.coilMode || 'both',
      };
    });

    const curvesToDraw = [];
    if (isHelmholtz) {
      if (measured.some((p) => p.coilMode === 'fixed')) {
        curvesToDraw.push({
          key: 'fixed',
          label: 'B₁',
          color: isLight ? '#d97706' : '#fbbf24',
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
          color: isLight ? '#059669' : '#34d399',
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
          color: isLight ? '#0284c7' : '#38bdf8',
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
        color: isLight ? '#0284c7' : '#38bdf8',
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

    const plotL = chartX + Math.round(44 * scale);
    const plotR = chartX + chartW - Math.round(10 * scale);
    const plotT = chartY + Math.round(24 * scale);
    const plotB = chartY + chartH - Math.round(24 * scale);
    const px = (x) => plotL + ((x - xMin) / (xMax - xMin)) * (plotR - plotL);
    const py = (b) => plotB - ((b - yMin) / Math.max(1e-9, yMax - yMin)) * (plotB - plotT);

    ctx.lineWidth = 1;
    ctx.font = `${Math.round(10 * scale)}px "Microsoft YaHei", sans-serif`;
    for (let i = 0; i <= 4; i++) {
      const t = i / 4;
      const gx = plotL + (plotR - plotL) * t;
      const gy = plotB - (plotB - plotT) * t;
      ctx.strokeStyle = isLight ? 'rgba(148, 163, 184, 0.45)' : 'rgba(148, 163, 184, 0.14)';
      ctx.beginPath(); ctx.moveTo(gx, plotT); ctx.lineTo(gx, plotB); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(plotL, gy); ctx.lineTo(plotR, gy); ctx.stroke();
      fillSoftText(isLight ? '#0f172a' : 'rgba(203, 213, 225, 0.78)', () => {
        ctx.font = `${Math.round(10 * scale)}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText((xMin + (xMax - xMin) * t).toFixed(2), gx, plotB + Math.round(3 * scale));
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText((yMin + (yMax - yMin) * t).toFixed(4), plotL - Math.round(4 * scale), gy);
      });
    }
    ctx.strokeStyle = isLight ? '#64748b' : 'rgba(226, 232, 240, 0.45)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(plotL, plotT); ctx.lineTo(plotL, plotB); ctx.lineTo(plotR, plotB); ctx.stroke();

    fillSoftText(isLight ? '#0f172a' : '#cbd5e1', () => {
      ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('B / T', chartX + Math.round(4 * scale), chartY + Math.round(4 * scale));
      ctx.textAlign = 'right';
      ctx.fillText('X / m', plotR, plotB + Math.round(14 * scale));
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
          if (first) {
            ctx.moveTo(cx, cy);
            first = false;
          } else {
            ctx.lineTo(cx, cy);
          }
        });
        ctx.strokeStyle = c.color;
        ctx.lineWidth = Math.max(1.8, Math.round(2.2 * scale));
        if (!isLight) {
          ctx.shadowColor = 'rgba(56, 189, 248, 0.45)';
          ctx.shadowBlur = 4;
        }
        ctx.stroke();
        ctx.restore();
      });
    }

    measured.forEach((p) => {
      if (p.x < xMin || p.x > xMax) return;
      const cx = px(p.x);
      const cy = py(p.b);
      const r = Math.round(3.5 * scale);
      let pointColor = isLight ? '#0284c7' : '#38bdf8';
      if (isHelmholtz) {
        if (p.coilMode === 'fixed') pointColor = isLight ? '#d97706' : '#fbbf24';
        else if (p.coilMode === 'moving') pointColor = isLight ? '#059669' : '#34d399';
      }
      ctx.strokeStyle = pointColor;
      ctx.lineWidth = Math.max(1.3, Math.round(1.6 * scale));
      ctx.beginPath();
      ctx.moveTo(cx - r, cy);
      ctx.lineTo(cx + r, cy);
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx, cy + r);
      ctx.stroke();
    });

    fillSoftText(isLight ? '#0f172a' : '#cbd5e1', () => {
      ctx.font = `bold ${Math.round(10 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';

      if (d.showFit && curvesToDraw.length > 0) {
        let curX = plotR;
        const totalCountText = `+ 实测 ${shown.length} 组`;
        ctx.fillStyle = isLight ? '#475569' : '#94a3b8';
        ctx.fillText(totalCountText, curX, chartY + Math.round(4 * scale));
        curX -= ctx.measureText(totalCountText).width + Math.round(10 * scale);

        for (let idx = curvesToDraw.length - 1; idx >= 0; idx -= 1) {
          const item = curvesToDraw[idx];
          const text = `— ${item.label}`;
          ctx.fillStyle = item.color;
          ctx.fillText(text, curX, chartY + Math.round(4 * scale));
          curX -= ctx.measureText(text).width + Math.round(8 * scale);
        }
      } else {
        const fitLabel = (d.showFit && curvesToDraw.length > 0) ? '— 拟合曲线   ' : '';
        ctx.fillStyle = isLight ? '#0284c7' : '#38bdf8';
        ctx.fillText(`${fitLabel}+ 实测 ${shown.length} 组`, plotR, chartY + Math.round(4 * scale));
      }
    });
  } else {
    // Non-overlapping, compact column headers with clear gaps
    const cols = [
      { label: '#', x: 0.04, align: 'left' },
      { label: 'X (m)', x: 0.35, align: 'right' },
      { label: 'VH (mV)', x: 0.68, align: 'right' },
      { label: 'B (T)', x: 0.96, align: 'right' },
    ];
    const headRowH = Math.round(24 * scale);
    ctx.fillStyle = isLight ? 'rgba(14, 165, 233, 0.14)' : 'rgba(56, 189, 248, 0.16)';
    roundRect(ctx, chartX, chartY, chartW, headRowH, 4);
    ctx.fill();
    fillSoftText(isLight ? '#0284c7' : '#7dd3fc', () => {
      ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textBaseline = 'middle';
      cols.forEach((col) => {
        ctx.textAlign = col.align || 'left';
        ctx.fillText(col.label, chartX + chartW * col.x, chartY + headRowH / 2);
      });
    });

    const dataRowH = Math.max(Math.round(22 * scale), Math.round(24 * scale));
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
        ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
        ctx.textBaseline = 'middle';
        const rawPos = Number(r.pos || 0);
        const posM = Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos;
        const rawVh = Number(r.vh || 0);
        const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
        const values = [
          String(start + i + 1),
          posM.toFixed(3),
          (vhV * 1000).toFixed(2),
          hallRecordedB(r).toFixed(4),
        ];
        cols.forEach((col, ci) => {
          ctx.textAlign = col.align || 'left';
          ctx.fillText(values[ci], chartX + chartW * col.x, y + dataRowH / 2);
        });
      });
    });

    if (!records.length) {
      ctx.fillStyle = isLight ? '#475569' : 'rgba(148, 163, 184, 0.75)';
      ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const emptyStr = wrapText(ctx, '在桌面控制面板点击「记录当前读数」', chartW - Math.round(16 * scale))[0] || '在控制面板点击「记录读数」';
      ctx.fillText(emptyStr, chartX + chartW / 2, chartY + headRowH + (chartH - headRowH) / 2);
    }

    if (records.length > maxRows) {
      const trackW = Math.round(5 * scale);
      const trackX = chartX + chartW - trackW - Math.round(4 * scale);
      const trackY = chartY + headRowH + Math.round(2 * scale);
      const trackH = chartH - headRowH - Math.round(6 * scale);
      ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.12)' : 'rgba(255, 255, 255, 0.1)';
      roundRect(ctx, trackX, trackY, trackW, trackH, Math.round(3 * scale));
      ctx.fill();

      const thumbH = Math.max(Math.round(24 * scale), trackH * (maxRows / records.length));
      const thumbY = trackY + (start / Math.max(1, maxStart)) * (trackH - thumbH);
      ctx.fillStyle = isLight ? 'rgba(14, 165, 233, 0.65)' : 'rgba(56, 189, 248, 0.75)';
      roundRect(ctx, trackX, thumbY, trackW, thumbH, Math.round(3 * scale));
      ctx.fill();
    }
  }

  // Action bar buttons with pure text labels
  const btnGap = Math.round(10 * scale);
  const isFitting = d.showCurve && !!d.showFit;
  const labels = [
    { label: d.showCurve ? '返回记录' : '生成曲线', action: 'hall-chart' },
    {
      label: isFitting ? '隐藏拟合' : '拟合曲线',
      action: 'hall-fit',
      active: isFitting,
    },
    { label: '导出数据', action: 'hall-export' },
    { label: '清空', action: 'hall-clear' },
  ];
  const bw = (innerW - btnGap * (labels.length - 1)) / labels.length;
  labels.forEach((b, i) => {
    drawHallButton(
      ctx, hits,
      innerX + i * (bw + btnGap), btnY, bw, btnH,
      b.label, b.action, {}, accentHex, !!b.active,
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
  const { hits, innerX, innerW, contentTop, hud, accentHex } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isDisplay = cfg.surface === 'display';
  const scale = holoUiScale(cfg.surface || (isDisplay ? 'display' : 'full'));
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const d = hud?.data || {};
  const gap = Math.round(10 * scale);
  const x = innerX;
  const w = innerW;
  const pink = _uiTheme === 'light' ? '#be185d' : '#f9a8d4';
  const vh = Number(d.vh || 0);
  const isNType = d.nType !== false;

  const nVal = Math.max(0.01, Number(d.n || 1));
  const dVal = Math.max(0.01, Number(d.d || 0.5));
  const sign = isNType ? -1 : 1;
  const kVal = sign / (nVal * (dVal / 0.5));
  const kFormatted = (kVal >= 0 ? '+' : '') + kVal.toFixed(3);
  const vhFormatted = (vh >= 0 ? '+' : '') + vh.toFixed(3);
  const qFormatted = isNType ? '-e' : '+e';

  let cy = contentTop;

  // ── 顶部栏：电流 I · 磁场 B · 霍尔电压 U_H ──
  const topH = Math.round(60 * scale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = 1.2;
  roundRect(ctx, x, cy, w, topH, 10);
  ctx.fill();
  ctx.stroke();

  const colW1 = w / 3;

  // 电流 I
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('电流 I', x + colW1 * 0.5, cy + Math.round(9 * scale));
  ctx.fillStyle = P.text;
  ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(`${Number(d.I || 0).toFixed(2)} A`, x + colW1 * 0.5, cy + Math.round(30 * scale));

  // 磁场 B
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText('磁场 B', x + colW1 * 1.5, cy + Math.round(9 * scale));
  ctx.fillStyle = P.text;
  ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(`${Number(d.B || 0).toFixed(2)} T`, x + colW1 * 1.5, cy + Math.round(30 * scale));

  // 霍尔电压 U_H（与前两项保持一致的高对比颜色 P.text）
  drawMathFormula(
    ctx,
    '霍尔电压 U_{H}',
    x + colW1 * 2.5,
    cy + Math.round(9 * scale),
    { fontSize: Math.round(12 * scale), color: P.muted, align: 'center', textBaseline: 'top' },
  );
  drawMathFormula(
    ctx,
    `U_{H} = ${vhFormatted}\\text{ V}`,
    x + colW1 * 2.5,
    cy + Math.round(30 * scale),
    { fontSize: Math.round(15 * scale), color: P.text, align: 'center', textBaseline: 'top' },
  );

  cy += topH + gap;

  // ── 中间主体框：载流子类型 ──
  const boxH = Math.round(108 * scale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = 1.4;
  roundRect(ctx, x, cy, w, boxH, 12);
  ctx.fill();
  ctx.stroke();

  const titlePadX = Math.round(16 * scale);
  const titlePadY = Math.round(12 * scale);
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('载流子类型', x + titlePadX, cy + titlePadY);

  const btnH = Math.round(44 * scale);
  const btnY = cy + titlePadY + Math.round(28 * scale);
  const btnGap = Math.round(12 * scale);
  const innerPadX = Math.round(16 * scale);
  const typeW = (w - innerPadX * 2 - btnGap) / 2;

  // 上角标 e⁻ / h⁺
  drawHallButton(
    ctx, hits, x + innerPadX, btnY, typeW, btnH,
    'n型·电子 (e⁻)', 'hall-demo-type', { nType: true }, accentHex, isNType,
  );
  drawHallButton(
    ctx, hits, x + innerPadX + typeW + btnGap, btnY, typeW, btnH,
    'p型·空穴 (h⁺)', 'hall-demo-type', { nType: false }, accentHex, !isNType,
  );

  cy += boxH + gap;

  // ── 底部栏：载流子电量 q · 载流子浓度 n · 元件厚度 d · 元件灵敏度 K_H ──
  const botH = Math.round(60 * scale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = 1.2;
  roundRect(ctx, x, cy, w, botH, 10);
  ctx.fill();
  ctx.stroke();

  const colW3 = w / 4;

  // 1. 载流子电量 q
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('载流子电量 q', x + colW3 * 0.5, cy + Math.round(9 * scale));
  ctx.fillStyle = P.text;
  ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(qFormatted, x + colW3 * 0.5, cy + Math.round(30 * scale));

  // 2. 载流子浓度 n
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText('载流子浓度 n', x + colW3 * 1.5, cy + Math.round(9 * scale));
  ctx.fillStyle = P.text;
  ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(`${nVal.toFixed(2)} m⁻³`, x + colW3 * 1.5, cy + Math.round(30 * scale));

  // 3. 元件厚度 d
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText('元件厚度 d', x + colW3 * 2.5, cy + Math.round(9 * scale));
  ctx.fillStyle = P.text;
  ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(`${dVal.toFixed(2)} m`, x + colW3 * 2.5, cy + Math.round(30 * scale));

  // 4. 元件灵敏度 K_H（与前三栏保持相同大字号和高对比度颜色 P.text）
  drawMathFormula(
    ctx,
    '元件灵敏度 K_{H}',
    x + colW3 * 3.5,
    cy + Math.round(9 * scale),
    { fontSize: Math.round(11 * scale), color: P.muted, align: 'center', textBaseline: 'top' },
  );
  drawMathFormula(
    ctx,
    `${kFormatted}\\text{ V/(A}\\cdot\\text{T)}`,
    x + colW3 * 3.5,
    cy + Math.round(30 * scale),
    { fontSize: Math.round(13 * scale), color: P.text, align: 'center', textBaseline: 'top' },
  );
}

function drawOptButton(ctx, hits, x, y, w, h, label, action, meta, accent, active = false) {
  drawPremiumHoloButton(ctx, hits, x, y, w, h, label, action, meta, accent, active, _uiTheme);
}

function diffractionColor(nm, alpha = 1) {
  let r = 0; let g = 0; let b = 0;
  if (nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else r = 1;
  let f = 1;
  if (nm < 420) f = 0.3 + 0.7 * (nm - 380) / 40;
  if (nm > 700) f = 0.3 + 0.7 * (780 - nm) / 80;
  return `rgba(${Math.round(Math.max(0, r * f) * 255)},${Math.round(Math.max(0, g * f) * 255)},${Math.round(Math.max(0, b * f) * 255)},${alpha})`;
}

/**
 * Optics content screen — zoned layout (no full-width plot stack):
 *
 *   ┌ metrics (large type) ──────────────────────────────────┐
 *   ├ controls ~62% ─────────────────┬ side card ~36% ──────┤
 *   │ presets · tall sliders · tools │ live I(x) / 标注核对  │
 *   │                                │ 或对照摘要            │
 *   ├────────────────────────────────┴──────────────────────┤
 *   └ action bar：写入对照 · 核对曲线 · 对照表 ─────────────┘
 *
 * 「写入对照」：把当前配置与模型可观测量写入对照表（改参后横向比较）。
 * 「核对曲线」：在理论 I(x) 上标注主极大、包络零点与远场条件。
 * 「对照表」：弹出多组参数对比表（非独立实测）。
 */
/**
 * Geometric optics content screen — large type + tight packing.
 * Bottom-up band reservation: footer / tools never collide with sliders.
 */
function drawGeometricOpticsExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface } = cfg;
  _uiTheme = theme || 'dark';
  const d = hud?.data || {};
  const P = screenPalette(_uiTheme, accentHex, surface === 'display');
  // Display canvas is 960×720; full holoUiScale(1.78) made chrome overflow and stack.
  // Cap geometric-optics display scale so bands always fit in contentH.
  const rawScale = holoUiScale(surface || 'full');
  const scale = surface === 'display' ? Math.min(rawScale, 1.28) : rawScale;
  const x = innerX;
  const w = innerW;
  const reflection = d.opticsMode === 'mirror' || isReflectionExp(experiment.id);
  const fmt = (v, digits = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—');
  const records = Array.isArray(d.records) ? d.records : [];
  const panelOpen = d.recordsPanelOpen === true;
  const modules = getModulesForExperiment(experiment.id);
  const hasModules = !!(modules && modules.length);
  const chipGap = Math.max(4, Math.round(5 * scale));

  // —— Bottom-up reserved bands (never let sliders invade these) ——
  let btnH = Math.round(48 * scale);
  let hintH = Math.round(20 * scale);
  let toolH = Math.round(42 * scale);
  let gap = Math.round(5 * scale);
  let statH = Math.round(70 * scale);
  let chipH = Math.round(42 * scale);

  // Tools: toggles + data table only — record lives in footer (avoid duplicate).
  const tools = [];
  if (!reflection) {
    tools.push({
      label: d.dispersion ? '色散开' : '色散关',
      action: 'optics-geo-toggle',
      meta: { key: 'dispersion' },
      active: !!d.dispersion,
    });
    tools.push({
      label: d.showReflect !== false ? '反射线' : '反射关',
      action: 'optics-geo-toggle',
      meta: { key: 'showReflect' },
      active: d.showReflect !== false,
    });
  }
  tools.push({
    label: panelOpen ? '关闭表' : `数据表(${records.length})`,
    action: 'optics-geo-records-panel',
    meta: {},
    active: panelOpen,
  });
  const showTools = tools.length > 0;

  // Params list (may drop height on tight layouts)
  const params = [
    { key: 'angle', label: '入射角 θ', value: Number(d.angle || 0), unit: '°', min: 0, max: 75, digits: 1 },
    { key: 'rotate', label: '台面转角', value: Number(d.rotate || 0), unit: '°', min: -90, max: 90, digits: 0 },
    { key: 'rayCount', label: '光束数', value: Number(d.rayCount || 1), unit: '', min: 1, max: 12, digits: 0 },
  ];
  if (!reflection) {
    params.push(
      { key: 'ior', label: '折射率 n', value: Number(d.ior || 1.52), unit: '', min: 1.0, max: 2.6, digits: 2 },
    );
  }
  if (d.dispersion || experiment.id === 'dispersion') {
    params.push(
      { key: 'dispersionStrength', label: '色散系数', value: Number(d.dispersionStrength || 0.6), unit: '', min: 0, max: 1.5, digits: 2 },
    );
  }
  let showHeight = true;

  const chipRows = 1 // shapes
    + (hasModules ? 1 : 0)
    + (!reflection ? 1 : 0); // medium presets

  const minStat = Math.round(52 * scale);
  const minChip = Math.round(32 * scale);
  const minTool = Math.round(32 * scale);
  const minBtn = Math.round(40 * scale);
  const minHint = Math.round(14 * scale);
  const minGap = 3;
  const minRowH = Math.round(36 * scale);

  function chromeHeight(_includeHeight) {
    // Param tracks moved to tabletop; reserve a short readout band only.
    const readoutNeed = Math.round(36 * scale);
    const toolNeed = showTools ? toolH + gap : 0;
    return statH + gap
      + chipRows * (chipH + gap)
      + readoutNeed + gap
      + toolNeed
      + hintH + gap
      + btnH;
  }

  // Shrink chrome until everything fits in contentH (never force overflow).
  let guard = 0;
  while (chromeHeight(showHeight) > contentH && guard < 40) {
    guard += 1;
    if (showHeight && chromeHeight(false) <= contentH) {
      showHeight = false;
      continue;
    }
    if (gap > minGap) { gap = Math.max(minGap, gap - 1); continue; }
    if (hintH > minHint) { hintH = Math.max(minHint, hintH - 2); continue; }
    if (toolH > minTool) { toolH = Math.max(minTool, toolH - 2); continue; }
    if (chipH > minChip) { chipH = Math.max(minChip, chipH - 2); continue; }
    if (btnH > minBtn) { btnH = Math.max(minBtn, btnH - 2); continue; }
    if (statH > minStat) { statH = Math.max(minStat, statH - 3); continue; }
    break;
  }
  if (showHeight) {
    params.push(
      { key: 'height', label: '光束高度', value: Number(d.height || 0), unit: '', min: -0.6, max: 0.6, digits: 2 },
    );
  }

  // Fixed bottom stack positions
  const bottom = contentTop + contentH;
  const btnY = bottom - btnH;
  const hintY = btnY - gap - hintH;
  const toolY = showTools ? (hintY - gap - toolH) : hintY;
  const midBottom = (showTools ? toolY : hintY) - gap; // sliders must end at or above this

  // Metrics strip
  let readout;
  if (reflection) {
    const dTh = d.deltaTheta;
    readout = [
      ['θᵢ', d.theta1 == null ? '—' : `${fmt(d.theta1)}°`],
      ['θᵣ', d.theta2 == null ? '—' : `${fmt(d.theta2)}°`],
      ['|Δθ|', dTh == null ? '—' : `${fmt(dTh, 3)}°`],
      ['验证', d.verifyOk ? 'θᵢ≈θᵣ ✓' : (dTh == null ? '—' : '偏差')],
    ];
  } else {
    readout = [
      ['θ₁', d.theta1 == null ? '—' : `${fmt(d.theta1)}°`],
      ['θ₂', d.tir || d.theta2 == null ? 'TIR' : `${fmt(d.theta2)}°`],
      ['n', fmt(d.ior, 3)],
      ['sin比', d.snellRatio == null ? '—' : fmt(d.snellRatio, 3)],
    ];
  }

  const statY = contentTop;
  const tStatLabel = Math.max(14, Math.round(statH * 0.26));
  const tStatValue = Math.max(20, Math.round(statH * 0.42));
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = 1.4;
  roundRect(ctx, x, statY, w, statH, 10);
  ctx.fill();
  ctx.stroke();
  readout.forEach(([label, value], i) => {
    const cw = w / readout.length;
    const cx = x + i * cw + cw / 2;
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${tStatLabel}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(label, cx, statY + Math.round(statH * 0.12));
    ctx.fillStyle = i === 0 ? accentHex : P.text;
    ctx.font = `bold ${tStatValue}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(String(value), cx, statY + Math.round(statH * 0.46));
  });
  ctx.textAlign = 'left';

  let cy = statY + statH + gap;

  // Module chips 1.1–1.4 / 2.1–2.4
  if (hasModules) {
    const nMod = modules.length;
    const modW = (w - chipGap * (nMod - 1)) / nMod;
    modules.forEach((mod, i) => {
      const short = mod.title.length > 4 ? `${mod.code} ${mod.title.slice(0, 2)}` : `${mod.code} ${mod.title}`;
      drawOptButton(
        ctx, hits,
        x + i * (modW + chipGap), cy, modW, chipH,
        short, 'optics-geo-module', { module: mod.id },
        accentHex, d.moduleId === mod.id,
      );
    });
    cy += chipH + gap;
  }

  // Shape chips
  let shapeChoices;
  if (experiment.id === 'reflection') {
    shapeChoices = d.moduleId === 'multi'
      ? [['平面镜', 'mirror'], ['凸面镜', 'mirror-convex']]
      : [['平面镜', 'mirror']];
  } else if (experiment.id === 'lens') {
    shapeChoices = [['球透镜', 'sphere'], ['柱透镜', 'cylinder']];
  } else if (experiment.id === 'dispersion') {
    shapeChoices = [['三棱镜', 'prism']];
  } else if (experiment.id === 'refraction') {
    shapeChoices = [['三棱镜', 'prism'], ['玻璃砖', 'block']];
  } else {
    shapeChoices = reflection
      ? [['平面镜', 'mirror'], ['凸面镜', 'mirror-convex']]
      : [['三棱镜', 'prism'], ['玻璃砖', 'block']];
  }
  const nShape = shapeChoices.length;
  const chipW = (w - chipGap * Math.max(0, nShape - 1)) / nShape;
  shapeChoices.forEach(([label, shape], i) => {
    drawOptButton(
      ctx, hits,
      x + i * (chipW + chipGap), cy, chipW, chipH,
      label, 'optics-geo-set', { key: 'shape', value: shape },
      accentHex, d.shape === shape,
    );
  });
  cy += chipH + gap;

  // Medium presets (dielectric only)
  if (!reflection) {
    const mW = (w - chipGap * 3) / 4;
    MEDIUM_PRESETS.forEach((m, i) => {
      drawOptButton(
        ctx, hits,
        x + i * (mW + chipGap), cy, mW, chipH,
        m.label, 'optics-geo-preset-ior', { ior: m.ior },
        accentHex, Math.abs(Number(d.ior) - m.ior) < 0.001,
      );
    });
    cy += chipH + gap;
  }

  // Params live on the tabletop desk panel — short readout only
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
  const paramSummary = params
    .map((p) => `${p.label.replace(/\s.*/, '')} ${Number(p.value).toFixed(p.digits ?? 1)}${p.unit || ''}`)
    .join(' · ');
  ctx.fillText(
    `参数（桌右侧滑条）：${paramSummary.length > 52 ? `${paramSummary.slice(0, 50)}…` : paramSummary}`,
    x + 2,
    cy + Math.round(4 * scale),
  );
  cy += Math.round(36 * scale) + gap;

  // Tools row (reserved Y — never Math.min into footer)
  if (showTools) {
    const toolW = (w - chipGap * (tools.length - 1)) / tools.length;
    tools.forEach((t, i) => {
      drawOptButton(
        ctx, hits,
        x + i * (toolW + chipGap), toolY, toolW, toolH,
        t.label, t.action, t.meta, accentHex, t.active,
      );
    });
  }

  // Hint line (reserved band)
  const tHint = Math.max(13, Math.round(hintH * 0.85));
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${tHint}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  const activeMod = hasModules
    ? (modules.find((m) => m.id === d.moduleId) || modules[0])
    : null;
  const modTag = activeMod ? `${activeMod.code} ${activeMod.title} · ` : '';
  const hint = !reflection && d.criticalDeg != null
    ? `${modTag}θc≈${fmt(d.criticalDeg, 1)}° · ${SHAPE_LABELS[d.shape] || d.shape || '—'} · ${Number(d.rayCount || 1)} 束`
    : `${modTag}${SHAPE_LABELS[d.shape] || d.shape || '—'} · ${Number(d.rayCount || 1)} 束光`;
  ctx.fillText(hint.length > 48 ? `${hint.slice(0, 46)}…` : hint, x + 2, hintY + Math.round(1 * scale));

  // Footer actions (fixed bottom)
  const footerGap = Math.round(6 * scale);
  const footerW = (w - footerGap) / 2;
  drawPremiumHoloButton(
    ctx, hits, x, btnY, footerW, btnH,
    '重置', 'optics-geo-reset', {}, accentHex, false, theme,
  );
  drawPremiumHoloButton(
    ctx, hits, x + footerW + footerGap, btnY, footerW, btnH,
    records.length ? '再记一组' : '记录本组', 'optics-geo-record', {}, accentHex, false, theme,
  );

  if (panelOpen) {
    drawGeoOpticsRecordsPanel(ctx, hits, {
      x, y: contentTop, w, h: contentH,
      d, accentHex, theme, surface, experiment,
    });
  }
}

function drawGeoOpticsRecordsPanel(ctx, hits, cfg) {
  const { x, y, w, h, d, accentHex, theme, surface, experiment } = cfg;
  _uiTheme = theme || 'dark';
  const P = screenPalette(_uiTheme, accentHex, surface === 'display');
  const scale = holoUiScale(surface || 'full');
  const records = Array.isArray(d.records) ? d.records : [];
  const columns = geoOpticsRecordColumns(experiment.id);

  // Dimmer
  hits.push({
    x, y, w, h,
    action: 'optics-geo-records-panel',
    meta: { open: false },
    role: 'optics_records_dimmer',
  });

  const pad = Math.round(12 * scale);
  const panelW = Math.min(w - pad * 2, Math.round(w * 0.97));
  const panelH = Math.min(h - pad * 2, Math.round(h * 0.90));
  const px = x + (w - panelW) / 2;
  const py = y + (h - panelH) / 2;

  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  hits.push({
    x: px, y: py, w: panelW, h: panelH,
    action: 'optics-geo-records-panel',
    meta: { open: true },
    role: 'optics_records_panel',
  });

  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = 1.5;
  roundRect(ctx, px, py, panelW, panelH, 12);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = accentHex;
  ctx.font = `bold ${Math.round(24 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText('实验数据记录', px + pad, py + pad);

  drawPremiumHoloButton(
    ctx, hits,
    px + panelW - pad - Math.round(100 * scale), py + pad - 2,
    Math.round(100 * scale), Math.round(42 * scale),
    '关闭', 'optics-geo-records-panel', { open: false },
    accentHex, false, theme,
  );

  const tableTop = py + pad + Math.round(48 * scale);
  const rowH = Math.round(34 * scale);
  const headerH = Math.round(36 * scale);
  const maxRows = Math.max(4, Math.floor((panelH - pad * 3 - Math.round(100 * scale) - headerH) / rowH));
  const maxStart = Math.max(0, records.length - maxRows);
  let start = d.tableScrollAuto !== false
    ? maxStart
    : Math.max(0, Math.min(maxStart, Number(d.tableScrollTop || 0)));
  const visible = records.slice(start, start + maxRows);

  // Header
  let cx = px + pad;
  const tableW = panelW - pad * 2;
  ctx.fillStyle = P.stepBox;
  roundRect(ctx, px + pad, tableTop, tableW, headerH, 6);
  ctx.fill();
  columns.forEach((col) => {
    const cw = tableW * col.width;
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(col.label, cx + cw / 2, tableTop + Math.round(9 * scale));
    cx += cw;
  });

  visible.forEach((row, i) => {
    const ry = tableTop + headerH + i * rowH;
    if (i % 2 === 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.fillRect(px + pad, ry, tableW, rowH);
    }
    let rx = px + pad;
    columns.forEach((col) => {
      const cw = tableW * col.width;
      ctx.fillStyle = P.text;
      ctx.font = `bold ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(
        formatOpticsRecordCell(row, col.key, start + i),
        rx + cw / 2,
        ry + Math.round(8 * scale),
      );
      rx += cw;
    });
  });

  if (!records.length) {
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(18 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('暂无数据 — 调节仪器后点击「记录本组」', px + panelW / 2, tableTop + headerH + Math.round(40 * scale));
  }

  // Scroll hit region
  if (maxStart > 0) {
    hits.push({
      x: px + pad,
      y: tableTop,
      w: tableW,
      h: headerH + maxRows * rowH,
      action: 'hall-scroll-table',
      meta: { maxRows, maxStart, rowH },
      role: 'table_scroll',
    });
  }

  const footY = py + panelH - pad - Math.round(42 * scale);
  const fGap = Math.round(8 * scale);
  const fW = (panelW - pad * 2 - fGap * 2) / 3;
  drawPremiumHoloButton(ctx, hits, px + pad, footY, fW, Math.round(40 * scale), '再记一组', 'optics-geo-record', {}, accentHex, true, theme);
  drawPremiumHoloButton(ctx, hits, px + pad + fW + fGap, footY, fW, Math.round(40 * scale), '清空', 'optics-geo-clear', {}, accentHex, false, theme);
  drawPremiumHoloButton(ctx, hits, px + pad + 2 * (fW + fGap), footY, fW, Math.round(40 * scale), '关闭', 'optics-geo-records-panel', { open: false }, accentHex, false, theme);
}

function drawDiffractionExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, surface = 'full' } = cfg;
  _uiTheme = cfg.theme || 'dark';
  const isDisplay = surface === 'display';
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const rawScale = holoUiScale(surface || 'full');
  // Display canvas is 1280×1040 (or 960x720); cap scale to ensure generous room without element collisions.
  const scale = isDisplay ? Math.min(rawScale, 1.25) : rawScale;
  const d = hud?.data || {};
  const steps = experiment.steps || [];
  const stepIndex = Number(hud?.stepIndex || 0);
  const step = steps[stepIndex] || {};
  const records = Array.isArray(d.records) ? d.records : [];
  const chartOpen = !!d.chartOpen;
  const panelOpen = d.recordsPanelOpen === true;
  const x = innerX;
  const w = innerW;
  const fmt = (v, n = 3) => Number(v || 0).toFixed(n);
  const half = diffractionHalfSpan(d);
  const lambdaNm = Number(d.lambdaNm || 550);
  const last = records.length ? records[records.length - 1] : null;
  const Nslit = Math.max(1, Math.round(Number(d.N || 1)));
  const isLight = _uiTheme === 'light';

  // —— Vertical Layout Bands ——
  const statH = Math.round(72 * scale);
  const btnH = Math.round(48 * scale);
  const bandGap = Math.round(8 * scale);

  const statY = contentTop;
  const midTop = statY + statH + bandGap;
  const btnY = contentTop + contentH - btnH;
  const midH = Math.max(Math.round(220 * scale), btnY - midTop - bandGap);

  const split = Math.round(10 * scale);
  const leftW = Math.floor(w * 0.52);
  const rightW = w - leftW - split;
  const rightX = x + leftW + split;
  const pad = Math.round(12 * scale);
  const chipGap = Math.round(6 * scale);

  // —— Top Metrics Strip (4 Columns) ——
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.6 : 1.2;
  roundRect(ctx, x, statY, w, statH, 10);
  ctx.fill();
  ctx.stroke();

  const isSingle = Nslit <= 1;
  const stats = [
    {
      label: isSingle ? '中央亮纹' : '条纹间距 Δx',
      value: isSingle ? `${fmt(d.centralWidthMm, 2)} mm` : `${fmt(d.fringeSpacingMm, 3)} mm`,
      color: accentHex,
    },
    {
      label: '包络全宽',
      value: `${fmt(d.centralWidthMm, 2)} mm`,
      color: P.text,
    },
    {
      label: '菲涅耳数 F',
      value: Number(d.fresnel || 0).toExponential(1),
      color: P.text,
    },
    {
      label: '远场条件',
      value: d.farField ? '满足 (Fraunhofer)' : '近场 (Fresnel)',
      color: d.farField ? '#4ade80' : '#fb7185',
    },
  ];

  const colW = w / stats.length;
  stats.forEach((st, i) => {
    const cx = x + i * colW + colW / 2;
    if (i > 0) {
      ctx.strokeStyle = P.panelStroke;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + i * colW, statY + Math.round(12 * scale));
      ctx.lineTo(x + i * colW, statY + statH - Math.round(12 * scale));
      ctx.stroke();
    }
    // Label
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(st.label, cx, statY + Math.round(11 * scale));

    // Value
    ctx.textBaseline = 'middle';
    ctx.fillStyle = st.color;
    ctx.font = `bold ${Math.round(18 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(st.value, cx, statY + Math.round(45 * scale));
  });
  ctx.textAlign = 'left';

  // —— Middle Left Panel: Presets + Parameter Readout + Tools ——
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  roundRect(ctx, x, midTop, leftW, midH, 12);
  ctx.fill();
  ctx.stroke();

  // 1. Presets Header
  let ly = midTop + pad;
  ctx.fillStyle = accentHex;
  ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText('光阑与波形预设', x + pad, ly);
  ly += Math.round(22 * scale);

  const presets = [
    ['单缝 (N=1)', 'single'],
    ['双缝 (N=2)', 'double'],
    ['三缝 (N=3)', 'triple'],
    ['六缝 (N=6)', 'multi'],
    ['光栅 (N=10)', 'grating'],
    ['He-Ne 激光', 'hene2'],
  ];
  const pCols = 3;
  const pGap = Math.max(4, Math.round(chipGap * 0.8));
  const pH = Math.round(34 * scale);
  const pW = (leftW - pad * 2 - pGap * (pCols - 1)) / pCols;

  presets.forEach(([label, preset], i) => {
    const col = i % pCols;
    const row = Math.floor(i / pCols);
    drawOptButton(
      ctx, hits,
      x + pad + col * (pW + pGap), ly + row * (pH + pGap),
      pW, pH, label, 'optics-diff-preset', { preset }, accentHex, d.preset === preset,
    );
  });
  ly += 2 * pH + pGap + Math.round(14 * scale);

  // 2. Parameters Card / Readout
  ctx.fillStyle = P.title;
  ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText('实时光学参数', x + pad, ly);
  ctx.fillStyle = P.muted;
  ctx.font = `${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText('桌侧滑条可微调', x + leftW - pad, ly + Math.round(2 * scale));
  ctx.textAlign = 'left';
  ly += Math.round(20 * scale);

  const toolH = Math.round(38 * scale);
  const toolY = midTop + midH - pad - toolH;
  const paramBoxH = Math.max(Math.round(60 * scale), toolY - ly - Math.round(10 * scale));

  ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(2, 6, 23, 0.45)';
  roundRect(ctx, x + pad, ly, leftW - pad * 2, paramBoxH, 8);
  ctx.fill();

  const theta0 = (Number(d.lambdaNm || 550) * 1e-6 / Math.max(1e-4, Number(d.slitMm || 0.05)));
  const paramsList = [
    { label: '波长 λ', value: `${Number(d.lambdaNm || 550).toFixed(0)} nm` },
    { label: '缝数 N', value: `${Nslit}` },
    { label: '缝宽 a', value: `${Number(d.slitMm || 0.05).toFixed(3)} mm` },
    { label: '缝距 d', value: isSingle ? '— (无)' : `${Number(d.pitchMm || 0.25).toFixed(3)} mm` },
    { label: '屏距 L', value: `${Number(d.distM || 1).toFixed(2)} m` },
    { label: '衍射半角 θ₀', value: `${theta0.toFixed(4)} rad` },
  ];

  const pRows = 3;
  const pColCount = 2;
  const paramColW = (leftW - pad * 2 - Math.round(16 * scale)) / pColCount;
  const paramRowH = paramBoxH / pRows;

  paramsList.forEach((p, idx) => {
    const col = idx % pColCount;
    const row = Math.floor(idx / pColCount);
    const px = x + pad + Math.round(8 * scale) + col * paramColW;
    const py = ly + row * paramRowH + paramRowH / 2;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(p.label, px, py);

    ctx.textAlign = 'right';
    ctx.fillStyle = P.text;
    ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(p.value, px + paramColW - Math.round(12 * scale), py);
  });
  ctx.textAlign = 'left';

  // 3. Quick Tools Row
  const tools = [
    { label: d.lightOn ? '激光开' : '激光关', action: 'optics-diff-power', meta: {}, active: !!d.lightOn },
    { label: d.showBeam !== false ? '光锥显' : '光锥关', action: 'optics-diff-toggle', meta: { key: 'showBeam' }, active: d.showBeam !== false },
    { label: d.showWave !== false ? '波前显' : '波前关', action: 'optics-diff-toggle', meta: { key: 'showWave' }, active: d.showWave !== false },
    { label: d.demoOn ? '扫频中' : '自动扫频', action: 'optics-diff-demo', meta: {}, active: !!d.demoOn },
  ];
  const toolW = (leftW - pad * 2 - chipGap * 3) / 4;
  tools.forEach((t, i) => {
    drawOptButton(
      ctx, hits,
      x + pad + i * (toolW + chipGap), toolY, toolW, toolH,
      t.label, t.action, t.meta, accentHex, t.active,
    );
  });

  // —— Middle Right Panel: Intensity Curve + Pattern Stripe + Physics Analysis ——
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  roundRect(ctx, rightX, midTop, rightW, midH, 12);
  ctx.fill();
  ctx.stroke();

  const rp = Math.round(12 * scale);
  const tSideTitle = Math.round(14 * scale);
  const tSideMeta = Math.round(12 * scale);

  ctx.fillStyle = accentHex;
  ctx.font = `bold ${tSideTitle}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(chartOpen ? '核对 I(x) 理论曲线' : '光强分布与干涉条纹', rightX + rp, midTop + pad);
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${tSideMeta}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'right';
  ctx.fillText(
    `λ ${fmt(lambdaNm, 0)}nm · ${isSingle ? '单缝' : `N=${Nslit}`}`,
    rightX + rightW - rp,
    midTop + pad + Math.round(1 * scale),
  );
  ctx.textAlign = 'left';

  // Plot Area
  const sidePlotTop = midTop + pad + Math.round(24 * scale);
  const sidePlotH = Math.max(Math.round(110 * scale), Math.floor((midH - pad * 2 - Math.round(24 * scale)) * (chartOpen ? 0.58 : 0.50)));
  const stripeH = Math.max(Math.round(14 * scale), Math.round(sidePlotH * 0.16));
  const px0 = rightX + Math.round(16 * scale);
  const pw = rightW - Math.round(32 * scale);
  const py0 = sidePlotTop + Math.round(6 * scale);
  const ph = Math.max(Math.round(20 * scale), sidePlotH - stripeH - Math.round(16 * scale));
  const xToPx = (xv) => px0 + ((xv + half) / Math.max(1e-12, 2 * half)) * pw;

  // Background Box for Plot
  ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.05)' : 'rgba(2, 6, 23, 0.55)';
  roundRect(ctx, rightX + Math.round(8 * scale), sidePlotTop, rightW - Math.round(16 * scale), sidePlotH, 8);
  ctx.fill();

  // Markers under the curve (draw first when chartOpen)
  if (chartOpen) {
    const zeros = diffractionEnvelopeZeros(d, half);
    const maxima = diffractionPrincipalMaxima(d, half);
    zeros.forEach(({ x: zx }) => {
      [zx, -zx].forEach((xv) => {
        if (Math.abs(xv) > half) return;
        const mx = xToPx(xv);
        ctx.strokeStyle = isLight ? 'rgba(249, 115, 22, 0.65)' : 'rgba(251, 146, 60, 0.65)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(mx, py0);
        ctx.lineTo(mx, py0 + ph);
        ctx.stroke();
        ctx.setLineDash([]);
      });
    });
    maxima.forEach(({ x: mxv, p }) => {
      if (Math.abs(mxv) > half) return;
      const mx = xToPx(mxv);
      ctx.strokeStyle = isLight ? 'rgba(14, 165, 233, 0.55)' : 'rgba(56, 189, 248, 0.6)';
      ctx.lineWidth = p === 0 ? 1.6 : 1;
      ctx.beginPath();
      ctx.moveTo(mx, py0);
      ctx.lineTo(mx, py0 + ph);
      ctx.stroke();
    });
  }

  // Draw Intensity Curve
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) {
    const xv = -half + (2 * half * i) / 200;
    const intensity = diffractionIntensity(xv, d);
    const px = px0 + (i / 200) * pw;
    const py = py0 + ph * (1 - intensity);
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.strokeStyle = diffractionColor(lambdaNm);
  ctx.shadowColor = diffractionColor(lambdaNm);
  ctx.shadowBlur = chartOpen ? 8 : 6;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Axis ticks / labels
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.max(10, Math.round(10 * scale))}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('−x', px0 + 4, py0 + ph + Math.round(2 * scale));
  ctx.fillText('0', xToPx(0), py0 + ph + Math.round(2 * scale));
  ctx.fillText('+x', px0 + pw - 4, py0 + ph + Math.round(2 * scale));
  ctx.textAlign = 'left';

  // Stripe bar (diffraction pattern)
  const stripeY = sidePlotTop + sidePlotH - stripeH - Math.round(6 * scale);
  const stripeGrad = ctx.createLinearGradient(px0, 0, px0 + pw, 0);
  for (let i = 0; i <= 80; i++) {
    const xv = -half + (2 * half * i) / 80;
    const I = diffractionIntensity(xv, d);
    const soft = Math.min(1, (I / (I + 0.08)) ** 0.85);
    stripeGrad.addColorStop(i / 80, diffractionColor(lambdaNm, 0.05 + soft * 0.95));
  }
  ctx.fillStyle = '#030509';
  roundRect(ctx, px0, stripeY, pw, stripeH, 4);
  ctx.fill();
  ctx.fillStyle = stripeGrad;
  roundRect(ctx, px0, stripeY, pw, stripeH, 4);
  ctx.fill();

  // Peak markers on the stripe (when chartOpen)
  if (chartOpen) {
    const maxima = diffractionPrincipalMaxima(d, half);
    maxima.forEach(({ x: mxv }) => {
      if (Math.abs(mxv) > half) return;
      const mx = xToPx(mxv);
      ctx.fillStyle = isLight ? '#0284c7' : '#7dd3fc';
      ctx.fillRect(mx - 1, stripeY, 2, stripeH);
    });
  }

  // Summary / Analysis List below the plot
  const sumTop = sidePlotTop + sidePlotH + Math.round(8 * scale);
  const sumBottom = midTop + midH - pad;
  let summary = [];
  if (chartOpen) {
    const zero1Mm = (() => {
      const z = diffractionEnvelopeZeros(d, half)[0];
      return z ? (z.x * 1e3).toFixed(2) : '—';
    })();
    summary = [
      ['主极大间距 Δx', isSingle ? '单缝（无干涉主极大）' : `${fmt(d.fringeSpacingMm, 3)} mm`],
      ['包络零点 ±λL/a', `±${zero1Mm} mm`],
      ['菲涅耳数 F', Number(d.fresnel || 0).toExponential(2)],
      ['远场 Fraunhofer', d.farField ? '满足 (F ≪ 1)' : '近场 · 需加大 L'],
    ];
  } else if (isSingle) {
    summary = [
      ['中央亮纹全宽 2λL/a', `${fmt(d.centralWidthMm, 2)} mm`],
      ['第1级暗纹位置 ±λL/a', `±${(Number(d.centralWidthMm) / 2).toFixed(2)} mm`],
      ['屏距 L', `${fmt(d.distM, 2)} m`],
      ['对照表', `${records.length} 组数据`],
    ];
  } else {
    const ratio = Number(d.pitchMm) / Math.max(1e-4, Number(d.slitMm));
    summary = [
      ['条纹间距 Δx', `${fmt(d.fringeSpacingMm, 3)} mm`],
      ['包络全宽 2λL/a', `${fmt(d.centralWidthMm, 2)} mm`],
      ['缝距缝宽比 d/a', `${ratio.toFixed(1)} (第${Math.round(ratio)}级缺级)`],
      ['对照表', `${records.length} 组数据`],
    ];
  }

  const sumLine = Math.max(Math.round(18 * scale), Math.floor((sumBottom - sumTop - Math.round(16 * scale)) / Math.max(1, summary.length)));
  summary.forEach(([label, value], i) => {
    const sy = sumTop + i * sumLine;
    if (sy + sumLine * 0.55 > sumBottom) return;
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rightX + rp, sy + sumLine / 2);

    ctx.fillStyle = (chartOpen && label.startsWith('远场'))
      ? (d.farField ? '#4ade80' : '#fb7185')
      : P.text;
    ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'right';
    const val = String(value);
    ctx.fillText(val, rightX + rightW - rp, sy + sumLine / 2);
  });
  ctx.textAlign = 'left';

  // Caption at bottom of right card
  const footNoteY = sumTop + summary.length * sumLine + Math.round(4 * scale);
  if (footNoteY < sumBottom) {
    ctx.fillStyle = P.muted;
    ctx.font = `${Math.round(11 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'middle';
    if (chartOpen) {
      ctx.fillText(
        isSingle ? '• 橙色虚线: 包络零点 (暗纹)' : '• 蓝色细线: 主极大 · 橙色虚线: 包络零点',
        rightX + rp,
        footNoteY,
      );
    } else if (last) {
      ctx.fillText(
        `末组: N=${Math.round(last.N)} Δx=${fmt(last.fringeSpacingMm, 3)}mm`,
        rightX + rp,
        footNoteY,
      );
    }
  }

  // —— Action Bar (Bottom 3 Buttons) ——
  const actions = [
    { label: records.length ? `写入第 ${records.length + 1} 组` : '写入对照', action: 'optics-diff-record', active: false },
    { label: chartOpen ? '关闭标注' : '核对曲线', action: 'optics-diff-chart', active: chartOpen },
    {
      label: records.length ? `对照表 (${records.length})` : '对照表',
      action: 'optics-diff-records-panel',
      active: panelOpen || records.length > 0,
    },
  ];
  const btnGap = Math.round(8 * scale);
  const bw = (w - btnGap * (actions.length - 1)) / actions.length;
  actions.forEach((b, i) => {
    drawOptButton(
      ctx, hits,
      x + i * (bw + btnGap), btnY, bw, btnH,
      b.label, b.action, {}, accentHex, b.active,
    );
  });

  if (panelOpen) {
    drawOpticsRecordsPanel(ctx, hits, {
      innerX, innerW, contentTop, contentH, accentHex, theme: _uiTheme, scale, d, records, P,
    });
  }
}

/**
 * Overlay comparison table for multi-slit diffraction records.
 * Purpose: change one parameter, write another row, compare Δx / envelope / far-field.
 */
function drawOpticsRecordsPanel(ctx, hits, cfg) {
  const {
    innerX, innerW, contentTop, contentH, accentHex, theme, scale, d, records, P,
  } = cfg;
  const isLight = theme === 'light';
  const x = innerX;
  const w = innerW;

  ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.28)' : 'rgba(2, 6, 23, 0.55)';
  ctx.fillRect(innerX - Math.round(8 * scale), contentTop - Math.round(4 * scale), innerW + Math.round(16 * scale), contentH + Math.round(8 * scale));
  hits.push({
    x: innerX - Math.round(8 * scale),
    y: contentTop - Math.round(4 * scale),
    w: innerW + Math.round(16 * scale),
    h: contentH + Math.round(8 * scale),
    action: 'optics-diff-records-panel',
    open: true,
    role: 'optics_records_dimmer',
  });

  const pad = Math.round(14 * scale);
  const panelW = w;
  const panelH = Math.min(contentH - Math.round(12 * scale), Math.round(420 * scale));
  const panelX = x;
  const panelY = contentTop + Math.round(8 * scale);
  ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 23, 42, 0.96)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 2;
  roundRect(ctx, panelX, panelY, panelW, panelH, 14);
  ctx.fill();
  ctx.stroke();

  hits.push({
    x: panelX,
    y: panelY,
    w: panelW,
    h: panelH,
    action: 'optics-diff-records-panel',
    open: true,
    role: 'optics_records_panel',
  });

  ctx.fillStyle = accentHex;
  ctx.font = `bold ${Math.round(18 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`参数对照表 · ${records.length} 组`, panelX + pad, panelY + Math.round(12 * scale));
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText('改一个量再写入；比较 Δx=λL/d 与包络宽∝λL/a（模型导出，非实测）', panelX + pad, panelY + Math.round(36 * scale));

  const closeW = Math.round(88 * scale);
  const closeH = Math.round(34 * scale);
  drawPremiumHoloButton(
    ctx, hits,
    panelX + panelW - pad - closeW, panelY + Math.round(10 * scale), closeW, closeH,
    '关闭', 'optics-diff-records-panel', { open: false },
    accentHex, false, theme,
  );

  const columns = opticsRecordColumns();
  const chartX = panelX + Math.round(10 * scale);
  const chartY = panelY + Math.round(58 * scale);
  const chartW = panelW - Math.round(20 * scale);
  const footerH = Math.round(52 * scale);
  const chartH = panelH - Math.round(70 * scale) - footerH;
  const headerH = Math.round(28 * scale);
  ctx.fillStyle = isLight ? 'rgba(245, 158, 11, 0.14)' : 'rgba(251, 191, 36, 0.14)';
  ctx.fillRect(chartX, chartY, chartW, headerH);
  ctx.fillStyle = isLight ? '#92400e' : '#fcd34d';
  ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
  let colX = chartX + Math.round(4 * scale);
  const totalW = columns.reduce((s, c) => s + c.width, 0) || 1;
  columns.forEach((col) => {
    const cw = (chartW - Math.round(8 * scale)) * (col.width / totalW);
    ctx.fillText(col.label, colX, chartY + Math.round(7 * scale));
    col.xPx = colX;
    colX += cw;
  });

  const bodyY = chartY + headerH;
  const bodyH = chartH - headerH;
  const rowHTable = Math.round(26 * scale);
  const maxRows = Math.max(1, Math.floor(bodyH / rowHTable));
  const maxStart = Math.max(0, records.length - maxRows);
  let start = maxStart;
  if (Number.isFinite(d.tableScrollTop) && d.tableScrollTop >= 0 && !d.tableScrollAuto) {
    start = Math.max(0, Math.min(maxStart, Math.round(d.tableScrollTop)));
  } else {
    d.tableScrollTop = maxStart;
    d.tableScrollAuto = true;
  }
  const visible = records.slice(start, start + maxRows);

  hits.push({
    x: chartX,
    y: chartY,
    w: chartW,
    h: chartH,
    action: 'hall-scroll-table',
    role: 'scrollable_table',
    maxRows,
    maxStart,
    rowH: rowHTable,
    scrollable: maxStart > 0,
  });

  visible.forEach((row, i) => {
    const y = bodyY + i * rowHTable;
    if (i % 2 === 0) {
      ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(chartX, y, chartW, rowHTable);
    }
    ctx.fillStyle = isLight ? '#0f172a' : '#e2e8f0';
    ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
    columns.forEach((col) => {
      ctx.fillText(
        formatOpticsRecordCell(row, col.key, start + i),
        col.xPx,
        y + Math.round(6 * scale),
      );
    });
  });

  if (!records.length) {
    ctx.fillStyle = isLight ? '#64748b' : 'rgba(148, 163, 184, 0.75)';
    ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('点「写入对照」添加第一行 · 改参后再写可横向比较', chartX + chartW / 2, bodyY + bodyH / 2);
    ctx.textAlign = 'left';
  }

  const footY = panelY + panelH - footerH + Math.round(4 * scale);
  const footGap = Math.round(8 * scale);
  const footBtns = [
    { label: '再写一组', action: 'optics-diff-record', active: true },
    { label: '清空', action: 'optics-diff-clear', active: false },
    { label: '关闭', action: 'optics-diff-records-panel', meta: { open: false }, active: false },
  ];
  const fbw = (panelW - pad * 2 - footGap * (footBtns.length - 1)) / footBtns.length;
  footBtns.forEach((b, i) => {
    drawPremiumHoloButton(
      ctx, hits,
      panelX + pad + i * (fbw + footGap), footY, fbw, Math.round(40 * scale),
      b.label, b.action, b.meta || {},
      accentHex, b.active, theme,
    );
  });
}

/**
 * Compact thermodynamics content screen — optimized hierarchy, spacing and typography.
 * Data table lives in a separate overlay opened by 「数据表」.
 */
function drawThermoExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface } = cfg;
  _uiTheme = theme || 'dark';
  const d = hud?.data || {};
  const isDisplay = surface === 'display';
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const rawScale = holoUiScale(surface || 'full');
  const scale = isDisplay ? Math.min(rawScale, 1.25) : rawScale;

  const x = innerX;
  const w = innerW;
  const isLight = _uiTheme === 'light';
  const expId = experiment.id;
  const steps = experiment.steps || [];
  const stepIndex = Math.max(0, Math.min(steps.length - 1, Number(hud?.stepIndex || 0)));
  const step = steps[stepIndex] || {};
  const m = computeThermoMetrics(expId, d);
  const canRecord = thermoCanRecord(expId, d);
  const columns = thermoRecordColumns(expId);
  const records = Array.isArray(d.records) ? d.records : [];
  const panelOpen = d.recordsPanelOpen === true;
  const fmt = (v, digits = 1) => (Number.isFinite(Number(v)) ? Number(v).toFixed(digits) : '—');

  // —— 1. Top Metrics Readout ——
  let readout = [];
  if (expId === 'calorimetry') {
    let statusText = '待倒水';
    let statusColor = P.muted;
    if (d.pouring) {
      statusText = `倒水中 ${Math.round((d.pourProgress || 0) * 100)}%`;
      statusColor = accentHex;
    } else if (m.poured) {
      if (m.mixPct >= 95) {
        statusText = '已达平衡';
        statusColor = isLight ? '#16a34a' : '#4ade80';
      } else {
        statusText = `混合 ${m.mixPct}%`;
        statusColor = accentHex;
      }
    }

    readout = [
      { label: 'T测 (实时)', value: m.tNow == null ? '—' : `${fmt(m.tNow)}°C`, color: m.tNow == null ? P.muted : accentHex },
      { label: 'Tₑq (理论)', value: m.teq == null ? '—' : `${fmt(m.teq)}°C`, color: m.teq == null ? P.muted : P.text },
      { label: '|ΔT| 偏差', value: m.err == null ? '—' : `${fmt(m.err, 2)}°C`, color: m.err == null ? P.muted : (m.err < 1.0 ? (isLight ? '#16a34a' : '#4ade80') : P.text) },
      { label: '实验状态', value: statusText, color: statusColor },
    ];
  } else if (expId === 'convection') {
    readout = [
      { label: 'ΔT 温差', value: `${fmt(m.deltaT, 0)} K`, color: accentHex },
      { label: 'Ra 瑞利数', value: m.ra >= 1e6 ? `${(m.ra / 1e6).toFixed(1)}e6` : fmt(m.ra, 0), color: P.text },
      { label: '对流系数 h', value: `${fmt(m.h, 1)} W/m²K`, color: P.text },
      { label: '换热量 Q', value: `${fmt(m.q, 0)} W`, color: isLight ? '#16a34a' : '#4ade80' },
    ];
  } else if (expId === 'heat-conduction') {
    readout = [
      { label: '中点温度 T中', value: `${fmt(m.mid, 0)} K`, color: accentHex },
      { label: '热流密度 q', value: `${fmt(m.heatFlux, 0)} W/m²`, color: P.text },
      { label: '两端温差 ΔT', value: `${fmt(m.deltaT, 0)} K`, color: P.text },
      { label: '稳态进度', value: `${fmt(m.steadyPct, 0)}%`, color: m.steadyPct >= 95 ? (isLight ? '#16a34a' : '#4ade80') : accentHex },
    ];
  } else if (expId === 'ideal-gas') {
    readout = [
      { label: '压强 P', value: `${fmt(m.pressure, 1)} kPa`, color: accentHex },
      { label: '相对体积 V', value: `${fmt(m.V, 2)} V₀`, color: P.text },
      { label: '分子平均速率', value: `${fmt(m.avgSpeed, 0)} m/s`, color: P.text },
      { label: '器壁碰撞率', value: `${fmt(m.collisions, 0)} Hz`, color: P.text },
    ];
  } else {
    readout = [
      { label: '伸长量 ΔL', value: `${fmt(m.deltaL * 1000, 3)} mm`, color: accentHex },
      { label: '当前长度 L', value: `${fmt(m.length * 1000, 1)} mm`, color: P.text },
      { label: '线膨胀系数 α', value: `${fmt(m.alpha * 1e6, 1)} ×10⁻⁶`, color: P.text },
      { label: '当前材料', value: m.materialLabel || '—', color: isLight ? '#0284c7' : '#38bdf8' },
    ];
  }

  // —— 2. Parameters Definition ——
  const params = [];
  if (expId === 'calorimetry') {
    params.push(
      { key: 'tHot', label: '热水温度 T₁', value: d.tHot, min: 40, max: 95, unit: '°C', digits: 0, tag: 'HOT' },
      { key: 'tCold', label: '冷水温度 T₂', value: d.tCold, min: 5, max: 40, unit: '°C', digits: 0, tag: 'COLD' },
      { key: 'mHot', label: '热水质量 m₁', value: d.mHot, min: 50, max: 400, unit: 'g', digits: 0, tag: 'HOT' },
      { key: 'mCold', label: '冷水质量 m₂', value: d.mCold, min: 50, max: 400, unit: 'g', digits: 0, tag: 'COLD' },
    );
  } else if (expId === 'convection') {
    params.push(
      { key: 'tPlate', label: '热板温度 T_plate', value: d.tPlate, min: 300, max: 900, unit: 'K', digits: 0 },
      { key: 'tAir', label: '环境温度 T_air', value: d.tAir, min: 250, max: 350, unit: 'K', digits: 0 },
      { key: 'area', label: '换热面积 A', value: d.area, min: 0.05, max: 0.25, unit: 'm²', digits: 2 },
    );
  } else if (expId === 'heat-conduction') {
    params.push(
      { key: 'tHot', label: '热端温度 T_hot', value: d.tHot, min: 200, max: 900, unit: 'K', digits: 0 },
      { key: 'tCold', label: '冷端温度 T_cold', value: d.tCold, min: 200, max: 900, unit: 'K', digits: 0 },
      { key: 'conductivity', label: '导热系数 k', value: d.conductivity, min: 0.15, max: 3.5, unit: 'W/(m·K)', digits: 2 },
    );
  } else if (expId === 'ideal-gas') {
    params.push(
      { key: 'temperature', label: '气体温度 T', value: d.temperature, min: 150, max: 600, unit: 'K', digits: 0 },
      { key: 'volume', label: '容器容积 V', value: d.volume, min: 0.4, max: 1.25, unit: '×', digits: 2 },
    );
  } else if (expId === 'thermal-expansion') {
    params.push(
      { key: 'temperature', label: '加热温度 T', value: d.temperature, min: 20, max: 400, unit: '°C', digits: 0 },
      { key: 'length0', label: '初始长度 L₀', value: d.length0, min: 0.6, max: 1.4, unit: 'm', digits: 2 },
    );
  }

  // —— 3. Geometry & Adaptive Rhythm ——
  const headerH = Math.round(22 * scale);
  const statH = Math.round(62 * scale);
  const rowH = Math.round(48 * scale);
  const rowGap = Math.round(6 * scale);
  const colGap = Math.round(8 * scale);
  const chipH = Math.round(42 * scale);
  const btnH = Math.round(44 * scale);

  const numRows = Math.ceil(params.length / 2);
  const paramsTotalH = numRows * rowH + Math.max(0, numRows - 1) * rowGap;
  const hasChips = expId !== 'ideal-gas';
  const chipsTotalH = hasChips ? chipH : 0;
  const btnY = contentTop + contentH - btnH;

  const fixedHeights = headerH + statH + paramsTotalH + chipsTotalH + btnH;
  const availableSpace = Math.max(0, contentH - fixedHeights);
  const gapCount = hasChips ? 4 : 3;
  const dynGap = Math.max(Math.round(8 * scale), Math.min(Math.round(18 * scale), Math.floor(availableSpace / gapCount)));

  let cy = contentTop;

  // —— Header: Step Tracker & Helper Hint ——
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
  const stepLabel = `步骤 ${stepIndex + 1}/${Math.max(1, steps.length)} · ${step?.text || experiment.name || '进行中'}`;
  ctx.fillText(stepLabel, x + 2, cy + headerH / 2);

  ctx.textAlign = 'right';
  ctx.fillStyle = isLight ? '#64748b' : 'rgba(148, 163, 184, 0.7)';
  ctx.font = `${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText('右侧滑条调节参数', x + w - 2, cy + headerH / 2);
  ctx.textAlign = 'left';

  cy += headerH + dynGap;

  // —— Metrics Strip (Stat Bar) ——
  const statY = cy;
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = isDisplay ? 1.5 : 1.2;
  roundRect(ctx, x, statY, w, statH, 10);
  ctx.fill();
  ctx.stroke();

  const numCols = readout.length;
  const cw = w / numCols;
  const tStatLabel = Math.max(11, Math.round(12 * scale));
  const tStatValue = Math.max(16, Math.round(18 * scale));

  readout.forEach((item, i) => {
    const cx = x + i * cw + cw / 2;

    if (i > 0) {
      ctx.strokeStyle = isLight ? 'rgba(0, 0, 0, 0.08)' : 'rgba(255, 255, 255, 0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + i * cw, statY + Math.round(10 * scale));
      ctx.lineTo(x + i * cw, statY + statH - Math.round(10 * scale));
      ctx.stroke();
    }

    ctx.fillStyle = P.muted;
    ctx.font = `bold ${tStatLabel}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(item.label, cx, statY + Math.round(9 * scale));

    ctx.fillStyle = item.color;
    ctx.font = `bold ${tStatValue}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(String(item.value), cx, statY + Math.round(29 * scale));
  });

  cy += statH + dynGap;

  // —— Parameters Grid (2 columns) ——
  const colW = (w - colGap) / 2;
  params.forEach((p, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const px = x + col * (colW + colGap);
    const py = cy + row * (rowH + rowGap);

    ctx.fillStyle = P.panel;
    ctx.strokeStyle = P.panelStroke;
    ctx.lineWidth = 1.0;
    roundRect(ctx, px, py, colW, rowH, 8);
    ctx.fill();
    ctx.stroke();

    if (p.tag === 'HOT') {
      ctx.fillStyle = '#ef4444';
      roundRect(ctx, px + 2, py + Math.round(8 * scale), Math.round(3 * scale), rowH - Math.round(16 * scale), 1.5);
      ctx.fill();
    } else if (p.tag === 'COLD') {
      ctx.fillStyle = '#3b82f6';
      roundRect(ctx, px + 2, py + Math.round(8 * scale), Math.round(3 * scale), rowH - Math.round(16 * scale), 1.5);
      ctx.fill();
    }

    const padLeft = p.tag ? Math.round(16 * scale) : Math.round(12 * scale);

    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(p.label, px + padLeft, py + Math.round(8 * scale));

    ctx.fillStyle = P.text;
    ctx.font = `bold ${Math.round(18 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'top';
    const valStr = `${Number(p.value).toFixed(p.digits ?? 2)}${p.unit ? ` ${p.unit}` : ''}`;
    ctx.fillText(valStr, px + padLeft, py + Math.round(24 * scale));
  });

  cy += paramsTotalH + dynGap;

  // —— Context Operation Controls ——
  if (expId === 'calorimetry') {
    const cw = (w - colGap) / 2;
    const hotLabel = d.cupHot ? '热水已倒入 ✓' : `倒入热水 (${d.tHot}°C)`;
    const coldLabel = d.cupCold ? '冷水已倒入 ✓' : `倒入冷水 (${d.tCold}°C)`;
    drawPremiumHoloButton(ctx, hits, x, cy, cw, chipH, hotLabel, 'thermo-pour-hot', {}, accentHex, !!d.cupHot, theme);
    drawPremiumHoloButton(ctx, hits, x + cw + colGap, cy, cw, chipH, coldLabel, 'thermo-pour-cold', {}, accentHex, !!d.cupCold, theme);
    cy += chipH + dynGap;
  } else if (expId === 'convection' || expId === 'heat-conduction') {
    const flowBtnW = Math.min(w, Math.round(260 * scale));
    const flowBtnX = x + (w - flowBtnW) / 2;
    const flowLabel = d.running ? '⏸ 暂停热流动' : '▶ 开启热流动模拟';
    drawPremiumHoloButton(
      ctx, hits, flowBtnX, cy, flowBtnW, chipH,
      flowLabel,
      'thermo-toggle', { key: 'running' },
      accentHex, !!d.running, theme,
    );
    cy += chipH + dynGap;
  } else if (expId === 'thermal-expansion') {
    const labels = [['aluminum', '铝'], ['copper', '铜'], ['steel', '钢'], ['invar', '殷钢']];
    const cw = (w - colGap * 3) / 4;
    labels.forEach(([key, label], i) => {
      drawPremiumHoloButton(
        ctx, hits, x + i * (cw + colGap), cy, cw, chipH,
        label, 'thermo-set', { key: 'material', value: key },
        accentHex, d.material === key, theme,
      );
    });
    cy += chipH + dynGap;
  }

  // —— Main Action Bar: 写入数据 | 数据表 | 重置 ——
  const btnGap = Math.round(8 * scale);
  const mainButtons = [
    {
      label: canRecord ? '写入数据' : '写入数据 (待就绪)',
      action: 'thermo-record',
      active: canRecord,
    },
    {
      label: records.length ? `数据表 (${records.length})` : '数据表',
      action: 'thermo-records-panel',
      meta: { open: true },
      active: panelOpen || records.length > 0,
    },
    { label: '重置', action: 'thermo-reset', active: false },
  ];
  const bw = (w - btnGap * (mainButtons.length - 1)) / mainButtons.length;
  mainButtons.forEach((b, i) => {
    drawPremiumHoloButton(
      ctx, hits,
      x + i * (bw + btnGap), btnY, bw, btnH,
      b.label, b.action, b.meta || {},
      accentHex, b.active, theme,
    );
  });

  // —— Overlay: Data Table Panel (Opened by button) ——
  if (!panelOpen) return;

  // Dim main content
  ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.28)' : 'rgba(2, 6, 23, 0.55)';
  ctx.fillRect(innerX - Math.round(8 * scale), contentTop - Math.round(4 * scale), innerW + Math.round(16 * scale), contentH + Math.round(8 * scale));
  hits.push({
    x: innerX - Math.round(8 * scale),
    y: contentTop - Math.round(4 * scale),
    w: innerW + Math.round(16 * scale),
    h: contentH + Math.round(8 * scale),
    action: 'thermo-records-panel',
    open: true,
    role: 'thermo_records_dimmer',
  });

  const pad = Math.round(12 * scale);
  const panelW = w;
  const panelH = Math.min(contentH - Math.round(12 * scale), Math.round(420 * scale));
  const panelX = x;
  const panelY = contentTop + Math.round(8 * scale);
  ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 23, 42, 0.96)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 2;
  roundRect(ctx, panelX, panelY, panelW, panelH, 14);
  ctx.fill();
  ctx.stroke();

  hits.push({
    x: panelX,
    y: panelY,
    w: panelW,
    h: panelH,
    action: 'thermo-records-panel',
    open: true,
    role: 'thermo_records_panel',
  });

  ctx.fillStyle = accentHex;
  ctx.font = `bold ${Math.round(20 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`对照数据表 · ${records.length} 组`, panelX + pad, panelY + Math.round(10 * scale));
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(thermoRecordCaption(expId), panelX + pad, panelY + Math.round(36 * scale));

  const closeW = Math.round(88 * scale);
  const closeH = Math.round(36 * scale);
  drawPremiumHoloButton(
    ctx, hits,
    panelX + panelW - pad - closeW, panelY + Math.round(8 * scale), closeW, closeH,
    '关闭', 'thermo-records-panel', { open: false },
    accentHex, false, theme,
  );

  const chartX = panelX + Math.round(10 * scale);
  const chartY = panelY + Math.round(58 * scale);
  const chartW = panelW - Math.round(20 * scale);
  const footerH = Math.round(52 * scale);
  const chartH = panelH - Math.round(70 * scale) - footerH;
  const headerTableH = Math.round(30 * scale);
  ctx.fillStyle = isLight ? 'rgba(249, 115, 22, 0.12)' : 'rgba(251, 146, 60, 0.14)';
  ctx.fillRect(chartX, chartY, chartW, headerTableH);
  ctx.fillStyle = isLight ? '#9a3412' : '#fdba74';
  ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
  let colX = chartX + Math.round(4 * scale);
  const totalW = columns.reduce((s, c) => s + c.width, 0) || 1;
  columns.forEach((col) => {
    const colWidth = (chartW - Math.round(8 * scale)) * (col.width / totalW);
    ctx.fillText(col.label, colX, chartY + Math.round(7 * scale));
    col.xPx = colX;
    colX += colWidth;
  });

  const bodyY = chartY + headerTableH;
  const bodyH = chartH - headerTableH;
  const rowHTable = Math.round(28 * scale);
  const maxRows = Math.max(1, Math.floor(bodyH / rowHTable));
  const maxStart = Math.max(0, records.length - maxRows);
  let start = maxStart;
  if (Number.isFinite(d.tableScrollTop) && d.tableScrollTop >= 0 && !d.tableScrollAuto) {
    start = Math.max(0, Math.min(maxStart, Math.round(d.tableScrollTop)));
  } else {
    d.tableScrollTop = maxStart;
    d.tableScrollAuto = true;
  }
  const visible = records.slice(start, start + maxRows);

  hits.push({
    x: chartX,
    y: chartY,
    w: chartW,
    h: chartH,
    action: 'hall-scroll-table',
    role: 'scrollable_table',
    maxRows,
    maxStart,
    rowH: rowHTable,
    scrollable: maxStart > 0,
  });

  visible.forEach((row, i) => {
    const rowY = bodyY + i * rowHTable;
    if (i % 2 === 0) {
      ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.04)' : 'rgba(255, 255, 255, 0.03)';
      ctx.fillRect(chartX, rowY, chartW, rowHTable);
    }
    ctx.fillStyle = isLight ? '#0f172a' : '#e2e8f0';
    ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
    columns.forEach((col) => {
      ctx.fillText(
        formatThermoRecordCell(expId, row, col.key, start + i),
        col.xPx,
        rowY + Math.round(6 * scale),
      );
    });
  });

  if (!records.length) {
    ctx.fillStyle = isLight ? '#64748b' : 'rgba(148, 163, 184, 0.75)';
    ctx.font = `bold ${Math.round(17 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(
      canRecord ? '点「写入数据」添加第一行' : '条件就绪后方可写入',
      chartX + chartW / 2,
      bodyY + bodyH / 2,
    );
    ctx.textAlign = 'left';
  }

  const footY = panelY + panelH - footerH + Math.round(4 * scale);
  const footGap = Math.round(6 * scale);
  const footBtns = [
    { label: canRecord ? '写入数据' : '不可写入', action: 'thermo-record', active: canRecord },
    { label: '清空', action: 'thermo-clear-records', active: false },
    { label: '关闭', action: 'thermo-records-panel', meta: { open: false }, active: false },
  ];
  const fbw = (panelW - pad * 2 - footGap * (footBtns.length - 1)) / footBtns.length;
  footBtns.forEach((b, i) => {
    drawPremiumHoloButton(
      ctx, hits,
      panelX + pad + i * (fbw + footGap), footY, fbw, Math.round(42 * scale),
      b.label, b.action, b.meta || {},
      accentHex, b.active, theme,
    );
  });
}

function drawViscosityRecordsPanel(ctx, hits, cfg) {
  const { x, y, w, h, d, accentHex, theme, surface, params } = cfg;
  _uiTheme = theme || 'dark';
  const P = screenPalette(_uiTheme, accentHex, surface === 'display');
  const rawScale = holoUiScale(surface || 'full');
  const scale = surface === 'display' ? Math.min(rawScale, 1.25) : Math.min(rawScale, 1.15);
  const isLight = _uiTheme === 'light';
  const records = Array.isArray(params?._records) ? params._records : (Array.isArray(d?.records) ? d.records : []);

  // Dimmer hit
  hits.push({
    x, y, w, h,
    action: 'viscosity-records-panel',
    meta: { open: false },
    role: 'viscosity_records_dimmer',
  });

  const pad = Math.round(14 * scale);
  const panelW = Math.min(w - pad * 2, Math.round(w * 0.96));
  const panelH = Math.min(h - pad * 2, Math.round(h * 0.90));
  const px = x + (w - panelW) / 2;
  const py = y + (h - panelH) / 2;

  ctx.fillStyle = isLight ? 'rgba(15, 23, 42, 0.48)' : 'rgba(0, 0, 0, 0.72)';
  roundRect(ctx, x, y, w, h, 8);
  ctx.fill();

  hits.push({
    x: px, y: py, w: panelW, h: panelH,
    action: 'viscosity-records-panel',
    meta: { open: true },
    role: 'viscosity_records_panel',
  });

  ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.96)' : 'rgba(8, 20, 42, 0.96)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = 1.6;
  roundRect(ctx, px, py, panelW, panelH, 12);
  ctx.fill();
  ctx.stroke();

  // Header Title
  ctx.fillStyle = isLight ? '#0284c7' : accentHex;
  ctx.font = `bold ${Math.round(20 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('落球法测粘滞系数 · 实验数据记录表', px + pad + 4, py + pad + 12);

  // Close button
  const closeW = Math.round(90 * scale);
  const closeH = Math.round(34 * scale);
  drawPremiumHoloButton(
    ctx, hits,
    px + panelW - pad - closeW, py + pad,
    closeW, closeH,
    '关闭', 'viscosity-records-panel', { open: false },
    accentHex, false, theme,
  );

  const tableTop = py + pad + Math.round(44 * scale);
  const colDefs = [
    { label: '序号', w: 0.10, align: 'center' },
    { label: '钢球 d (mm)', w: 0.20, align: 'center' },
    { label: '计时 Δt (s)', w: 0.22, align: 'center' },
    { label: '下落速度 v (m/s)', w: 0.24, align: 'center' },
    { label: '测定粘度 η (Pa·s)', w: 0.24, align: 'center' },
  ];

  const headerH = Math.round(32 * scale);
  const rowH = Math.round(32 * scale);

  // Table header background
  ctx.fillStyle = isLight ? 'rgba(226, 232, 240, 0.85)' : 'rgba(30, 41, 59, 0.85)';
  roundRect(ctx, px + pad, tableTop, panelW - pad * 2, headerH, 6);
  ctx.fill();

  let curX = px + pad;
  const tableW = panelW - pad * 2;
  colDefs.forEach((col) => {
    const cw = tableW * col.w;
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = col.align;
    ctx.textBaseline = 'middle';
    const tx = col.align === 'center' ? curX + cw / 2 : (col.align === 'right' ? curX + cw - 8 : curX + 8);
    ctx.fillText(col.label, tx, tableTop + headerH / 2);
    curX += cw;
  });

  const maxRows = Math.max(3, Math.floor((panelH - Math.round(160 * scale)) / rowH));
  const visibleRecords = records.slice(-maxRows);

  visibleRecords.forEach((row, idx) => {
    const ry = tableTop + headerH + 6 + idx * rowH;
    ctx.fillStyle = idx % 2 === 0
      ? (isLight ? 'rgba(241, 245, 249, 0.5)' : 'rgba(255, 255, 255, 0.03)')
      : 'transparent';
    roundRect(ctx, px + pad, ry, tableW, rowH - 2, 4);
    ctx.fill();

    const actualIdx = records.indexOf(row) + 1;
    const values = [
      String(actualIdx),
      Number(row.d).toFixed(1),
      Number(row.dt).toFixed(3),
      Number(row.v).toFixed(5),
      Number(row.eta).toFixed(4),
    ];

    let cellX = px + pad;
    colDefs.forEach((col, cIdx) => {
      const cw = tableW * col.w;
      ctx.fillStyle = cIdx === 4 ? (isLight ? '#0284c7' : '#38bdf8') : P.text;
      ctx.font = `${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
      ctx.textAlign = col.align;
      ctx.textBaseline = 'middle';
      const tx = col.align === 'center' ? cellX + cw / 2 : (col.align === 'right' ? cellX + cw - 8 : cellX + 8);
      ctx.fillText(values[cIdx] || '—', tx, ry + (rowH - 2) / 2);
      cellX += cw;
    });
  });

  if (!records.length) {
    ctx.fillStyle = P.muted;
    ctx.font = `${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('暂无测量记录。完成下落计时后点击「记录数据」添加。', px + panelW / 2, tableTop + headerH + 40);
  }

  // Summary Footer
  const sumH = Math.round(52 * scale);
  const sumY = py + panelH - pad - sumH;
  ctx.fillStyle = isLight ? 'rgba(241, 245, 249, 0.9)' : 'rgba(15, 23, 42, 0.85)';
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = 1;
  roundRect(ctx, px + pad, sumY, tableW, sumH, 8);
  ctx.fill();
  ctx.stroke();

  if (records.length) {
    const avgEta = records.reduce((s, r) => s + (Number(r.eta) || 0), 0) / records.length;
    const LIQUIDS_REF = {
      glycerin: { eta20: 1.49, tempFactor: 0.085 },
      castor: { eta20: 0.986, tempFactor: 0.06 },
      silicone: { eta20: 0.5, tempFactor: 0.04 },
      machine: { eta20: 0.29, tempFactor: 0.05 },
    };
    const liquid = LIQUIDS_REF[params.liquid || 'glycerin'] || LIQUIDS_REF.glycerin;
    const temp = Number(params.temperature ?? 20);
    const etaTrue = liquid.eta20 * Math.exp(-liquid.tempFactor * (temp - 20));
    const avgErr = ((avgEta - etaTrue) / etaTrue) * 100;

    ctx.fillStyle = P.text;
    ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      `已记录 ${records.length} 组 · 平均 η̄ = ${avgEta.toFixed(4)} Pa·s · 理论 η₀ = ${etaTrue.toFixed(4)} Pa·s · 相对误差 ${avgErr >= 0 ? '+' : ''}${avgErr.toFixed(1)}%`,
      px + pad + 14,
      sumY + sumH / 2,
    );
  } else {
    ctx.fillStyle = P.muted;
    ctx.font = `${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('提示：更换不同直径小球多次测量，可求平均粘滞系数并验证管壁效应修正。', px + pad + 14, sumY + sumH / 2);
  }

  // Clear button inside modal
  const clearW = Math.round(110 * scale);
  const clearH = Math.round(34 * scale);
  drawPremiumHoloButton(
    ctx, hits,
    px + panelW - pad - clearW - 8, sumY + (sumH - clearH) / 2,
    clearW, clearH,
    '清空记录', 'mechanics-source-action', { id: 'clear' },
    '#f87171', false, theme,
  );
}

/** Dedicated, high-precision content layout for Falling Ball Viscosity experiment. */
function drawViscosityExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface } = cfg;
  _uiTheme = theme || 'dark';
  const d = hud?.data || {};
  const isDisplay = surface === 'display';
  const isLight = _uiTheme === 'light';
  const P = screenPalette(_uiTheme, accentHex, isDisplay);
  const rawScale = holoUiScale(surface || 'full');
  const scale = isDisplay ? Math.min(rawScale, 1.25) : Math.min(rawScale, 1.15);

  const x = innerX;
  const w = innerW;
  const params = d.params || experiment.defaults || {};
  const readouts = Array.isArray(d.readouts) ? d.readouts : [];
  const records = Array.isArray(params._records) ? params._records : (Array.isArray(d.records) ? d.records : []);
  const panelOpen = d.recordsPanelOpen === true;

  const LIQUID_CONFIG = {
    glycerin: { label: '甘油 (丙三醇)', rho: 1260, eta20: 1.49, tempFactor: 0.085 },
    castor: { label: '蓖麻油', rho: 960, eta20: 0.986, tempFactor: 0.06 },
    silicone: { label: '硅油 (高粘)', rho: 970, eta20: 0.5, tempFactor: 0.04 },
    machine: { label: '机油 (SAE 30)', rho: 880, eta20: 0.29, tempFactor: 0.05 },
  };
  const STEEL_RHO = 7800;
  const G = 9.81;

  const curLiquidKey = params.liquid || 'glycerin';
  const curLiquid = LIQUID_CONFIG[curLiquidKey] || LIQUID_CONFIG.glycerin;
  const temp = Number(params.temperature ?? 20);
  const dMm = Number(params.diameterMm ?? 2.5);
  const DMm = Number(params.tubeDiameterMm ?? 50);
  const measureS = Number(params.measureS ?? 0.2);

  const etaTrue = curLiquid.eta20 * Math.exp(-curLiquid.tempFactor * (temp - 20));
  const rM = (dMm / 2) * 1e-3;
  const vTerm = (2 * rM * rM * (STEEL_RHO - curLiquid.rho) * G) / (9 * etaTrue);

  // Extract from readouts
  const posItem = readouts.find((r) => r.label === '位置')?.value || '钢球盒中';
  const speedItem = readouts.find((r) => r.label?.includes('速度'))?.value || '0.00 mm/s';
  const dtItem = readouts.find((r) => r.label?.includes('Δt'))?.value || '—';
  const vMeasItem = readouts.find((r) => r.label?.includes('v = S/Δt'))?.value || '—';
  const etaMeasItem = readouts.find((r) => r.label?.includes('η 测量'))?.value || '—';
  const errItem = readouts.find((r) => r.label?.includes('相对误差'))?.value || '—';

  const steps = experiment.steps || [];
  const stepIndex = Math.max(0, Math.min(steps.length - 1, Number(hud?.stepIndex ?? d.workflowStep ?? 0)));
  const step = steps[stepIndex] || {};

  // Component heights & Vertical Rhythm
  const stepHeaderH = Math.round(34 * scale);
  const cardH = Math.round(112 * scale);
  const cardRowGap = Math.round(12 * scale);
  const dashboardH = cardH * 2 + cardRowGap;
  const chipH = Math.round(50 * scale);
  const footerBtnH = Math.round(54 * scale);

  const totalFixedH = stepHeaderH + dashboardH + chipH + footerBtnH;
  const availableSpace = Math.max(0, contentH - totalFixedH);
  const dynGap = Math.max(Math.round(16 * scale), Math.min(Math.round(28 * scale), Math.floor(availableSpace / 4)));

  let cy = contentTop + Math.round(4 * scale);

  // 1. Step Header & Status Badge
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = isLight ? '#0284c7' : accentHex;
  ctx.font = `bold ${Math.round(17 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(`步骤 ${stepIndex + 1}/${steps.length || 6} · ${step.text || '实验进行中'}`, x + 2, cy + stepHeaderH / 2);

  ctx.fillStyle = P.muted;
  ctx.font = `${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
  const hintText = step.hint ? `提示: ${step.hint}` : '从桌上钢球盒取球拖拽至漏斗口，松开后释放下落';
  ctx.fillText(hintText, x + Math.round(280 * scale), cy + stepHeaderH / 2);

  // Status Badge on Right
  const badgeW = Math.round(160 * scale);
  const badgeH = Math.round(30 * scale);
  const badgeX = x + w - badgeW;
  const badgeY = cy + (stepHeaderH - badgeH) / 2;

  let badgeBg = isLight ? 'rgba(148, 163, 184, 0.2)' : 'rgba(30, 41, 59, 0.8)';
  let badgeBorder = isLight ? '#94a3b8' : '#475569';
  let badgeColor = isLight ? '#334155' : '#cbd5e1';

  if (posItem.includes('液体')) {
    badgeBg = isLight ? 'rgba(34, 197, 94, 0.15)' : 'rgba(34, 197, 94, 0.25)';
    badgeBorder = '#22c55e';
    badgeColor = isLight ? '#15803d' : '#4ade80';
  } else if (posItem.includes('漏斗')) {
    badgeBg = isLight ? 'rgba(14, 165, 233, 0.15)' : 'rgba(14, 165, 233, 0.25)';
    badgeBorder = '#0ea5e9';
    badgeColor = isLight ? '#0369a1' : '#38bdf8';
  } else if (posItem.includes('沉底')) {
    badgeBg = isLight ? 'rgba(168, 85, 247, 0.15)' : 'rgba(168, 85, 247, 0.25)';
    badgeBorder = '#a855f7';
    badgeColor = isLight ? '#7e22ce' : '#c084fc';
  } else if (posItem.includes('拖拽')) {
    badgeBg = isLight ? 'rgba(245, 158, 11, 0.15)' : 'rgba(245, 158, 11, 0.25)';
    badgeBorder = '#f59e0b';
    badgeColor = isLight ? '#b45309' : '#fbbf24';
  }

  ctx.fillStyle = badgeBg;
  ctx.strokeStyle = badgeBorder;
  ctx.lineWidth = 1.2;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = badgeColor;
  ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(posItem, badgeX + badgeW / 2, badgeY + badgeH / 2);

  cy += stepHeaderH + dynGap;

  // 2. Metrics 2x2 High-Contrast Spacious Dashboard
  const colGap = Math.round(14 * scale);
  const cardW = (w - colGap) / 2;

  const statCards = [
    // Card 1: Medium & Environment
    {
      title: '待测介质与环境条件',
      mainValue: `${curLiquid.label}`,
      mainColor: isLight ? '#0284c7' : '#38bdf8',
      tags: [
        `介质密度 ρ = ${curLiquid.rho} kg/m³`,
        `温度 t = ${temp} °C`,
        `钢球密度 ρ₀ = ${STEEL_RHO} kg/m³`,
      ],
    },
    // Card 2: Stokes Theory Benchmark
    {
      title: 'Stokes 理论基准粘度 (温度修正)',
      mainValue: `${etaTrue.toFixed(4)} Pa·s`,
      mainColor: isLight ? '#b45309' : '#fbbf24',
      tags: [
        `20°C 基准: ${curLiquid.eta20} Pa·s`,
        `极限速度 v∞ = ${(vTerm * 1000).toFixed(1)} mm/s`,
      ],
    },
    // Card 3: Apparatus & Ball
    {
      title: '实验装置规格与测量间距',
      mainValue: `钢球直径 d = ${dMm.toFixed(1)} mm`,
      mainColor: P.text,
      tags: [
        `量筒内径 D = ${DMm} mm`,
        `光电门间距 S = ${measureS.toFixed(2)} m`,
        `实时速度 |v| = ${speedItem}`,
      ],
    },
    // Card 4: Measurement & Viscosity Result
    {
      title: '光电门测量与测定粘度结果',
      mainValue: etaMeasItem !== '—' ? `η = ${etaMeasItem}` : (dtItem !== '—' ? `Δt = ${dtItem}` : '就绪待释放'),
      mainColor: etaMeasItem !== '—' ? (isLight ? '#16a34a' : '#4ade80') : (dtItem !== '—' ? (isLight ? '#7c3aed' : '#a78bfa') : P.muted),
      tags: [
        dtItem !== '—' ? `计时 Δt = ${dtItem}` : '计时未触发',
        vMeasItem !== '—' ? `测定速度 v = ${vMeasItem}` : 'v = S/Δt',
        errItem !== '—' ? `相对误差: ${errItem}` : `已记录: ${records.length} 组`,
      ],
    },
  ];

  statCards.forEach((card, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const px = x + col * (cardW + colGap);
    const py = cy + row * (cardH + cardRowGap);

    ctx.fillStyle = P.panel;
    ctx.strokeStyle = P.panelStroke;
    ctx.lineWidth = 1.2;
    roundRect(ctx, px, py, cardW, cardH, 12);
    ctx.fill();
    ctx.stroke();

    // Top Section Title
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(card.title, px + Math.round(18 * scale), py + Math.round(14 * scale));

    // Middle Main Value (Large, prominent typography)
    ctx.fillStyle = card.mainColor;
    ctx.font = `bold ${Math.round(24 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(String(card.mainValue), px + Math.round(18 * scale), py + Math.round(40 * scale));

    // Bottom Badges / Tags row
    let tagX = px + Math.round(18 * scale);
    const tagY = py + Math.round(80 * scale);
    card.tags.forEach((tag) => {
      ctx.font = `${Math.round(12 * scale)}px "Microsoft YaHei", sans-serif`;
      const tw = ctx.measureText(tag).width + Math.round(14 * scale);
      const th = Math.round(20 * scale);

      ctx.fillStyle = isLight ? 'rgba(241, 245, 249, 0.9)' : 'rgba(255, 255, 255, 0.06)';
      ctx.strokeStyle = isLight ? 'rgba(203, 213, 225, 0.8)' : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1;
      roundRect(ctx, tagX, tagY, tw, th, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = P.soft;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(tag, tagX + tw / 2, tagY + th / 2);

      tagX += tw + Math.round(8 * scale);
    });
  });

  cy += dashboardH + dynGap;

  // 3. Liquid Selection Row
  const sectionLabelW = Math.round(110 * scale);
  ctx.fillStyle = P.muted;
  ctx.font = `bold ${Math.round(15 * scale)}px "Microsoft YaHei", sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('待测液体', x + 2, cy + chipH / 2);

  const liqOptions = [
    { key: 'glycerin', label: '甘油 (丙三醇)' },
    { key: 'castor', label: '蓖麻油' },
    { key: 'silicone', label: '硅油 (高粘)' },
    { key: 'machine', label: '机油 (SAE 30)' },
  ];
  const liqChipW = (w - sectionLabelW - colGap * (liqOptions.length - 1)) / liqOptions.length;

  liqOptions.forEach((opt, index) => {
    const chipX = x + sectionLabelW + index * (liqChipW + colGap);
    const active = curLiquidKey === opt.key;
    drawPremiumHoloButton(
      ctx, hits,
      chipX, cy, liqChipW, chipH,
      opt.label,
      'mechanics-source-select',
      { key: 'liquid', value: opt.key },
      accentHex,
      active,
      theme,
    );
  });

  // 4. Action Bar at Footer
  const footerY = contentTop + contentH - footerBtnH;
  const actionGap = Math.round(10 * scale);

  const canDrop = posItem.includes('漏斗');
  const canRecord = etaMeasItem !== '—' && !etaMeasItem.includes('null');

  const actionButtons = [
    {
      label: '释放钢球',
      action: 'mechanics-source-action',
      meta: { id: 'drop' },
      active: canDrop,
      color: accentHex,
    },
    {
      label: '放回球盒',
      action: 'mechanics-source-action',
      meta: { id: 'returnBtn' },
      active: false,
      color: accentHex,
    },
    {
      label: '记录数据',
      action: 'mechanics-source-action',
      meta: { id: 'record' },
      active: canRecord,
      color: '#34d399',
    },
    {
      label: records.length ? `数据表 (${records.length})` : '数据表',
      action: 'viscosity-records-panel',
      meta: { open: !panelOpen },
      active: panelOpen || records.length > 0,
      color: accentHex,
    },
    {
      label: '清空数据',
      action: 'mechanics-source-action',
      meta: { id: 'clear' },
      active: false,
      color: '#f87171',
    },
    {
      label: d.paused ? '继续' : '暂停',
      action: 'mechanics-source-pause',
      meta: {},
      active: !!d.paused,
      color: accentHex,
    },
    {
      label: '重置',
      action: 'mechanics-source-reset',
      meta: {},
      active: false,
      color: accentHex,
    },
  ];

  const totalActW = (w - actionGap * (actionButtons.length - 1));
  const standardW = totalActW / actionButtons.length;

  actionButtons.forEach((btn, index) => {
    const bx = x + index * (standardW + actionGap);
    drawPremiumHoloButton(
      ctx, hits,
      bx, footerY, standardW, footerBtnH,
      btn.label, btn.action, btn.meta,
      btn.color || accentHex,
      btn.active,
      theme,
    );
  });

  // 5. Modal overlay for records table
  if (panelOpen) {
    drawViscosityRecordsPanel(ctx, hits, {
      x, y: contentTop, w, h: contentH,
      d, accentHex, theme, surface, params,
    });
  }
}

/** Source-faithful mechanics controls/readouts hosted on the holographic screen. */
function drawSourceMechanicsExperiment(ctx, _W, _H, cfg) {
  const { hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface } = cfg;
  _uiTheme = theme || 'dark';
  const data = hud?.data || {};
  const params = data.params || experiment.defaults || {};
  const P = screenPalette(_uiTheme, accentHex, surface === 'display');
  const rawScale = holoUiScale(surface || 'full');
  const scale = surface === 'display' ? Math.min(rawScale, 1.25) : rawScale;
  const gap = Math.round(7 * scale);
  const x = innerX;
  const w = innerW;

  let y = contentTop;
  const readouts = Array.isArray(data.readouts) ? data.readouts.slice(0, 6) : [];
  const statH = Math.round((readouts.length > 3 ? 116 : 62) * scale);
  ctx.fillStyle = P.panel;
  ctx.strokeStyle = P.panelStroke;
  ctx.lineWidth = 1.2;
  roundRect(ctx, x, y, w, statH, 10);
  ctx.fill();
  ctx.stroke();
  const statCols = 3;
  const statRows = Math.max(1, Math.ceil(readouts.length / statCols));
  const statCellW = w / statCols;
  const statCellH = statH / statRows;
  readouts.forEach((item, index) => {
    const col = index % statCols;
    const row = Math.floor(index / statCols);
    const cx = x + col * statCellW + statCellW / 2;
    const cy = y + row * statCellH;
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(13 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(String(item.label || ''), cx, cy + Math.round(7 * scale));
    ctx.fillStyle = index === 0 ? accentHex : P.text;
    ctx.font = `bold ${Math.round(17 * scale)}px "Microsoft YaHei", sans-serif`;
    const value = String(item.value || '—');
    ctx.fillText(value.length > 24 ? `${value.slice(0, 22)}…` : value, cx, cy + Math.round(28 * scale));
  });
  if (!readouts.length) {
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(16 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('源仿真正在初始化…', x + w / 2, y + statH / 2 - 8);
  }
  ctx.textAlign = 'left';
  y += statH + gap;

  const controls = Array.isArray(experiment.controls) ? experiment.controls : [];
  const selects = controls.filter((control) => control.kind === 'select');
  const ranges = controls.filter((control) => control.kind !== 'select');
  const chipH = Math.round(42 * scale);
  selects.forEach((control) => {
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.fillText(control.label, x + 2, y + Math.round(10 * scale));
    const labelW = Math.round(130 * scale);
    const options = control.options || [];
    const optionGap = Math.round(5 * scale);
    const optionW = (w - labelW - optionGap * Math.max(0, options.length - 1)) / Math.max(1, options.length);
    options.forEach((option, index) => {
      drawPremiumHoloButton(
        ctx, hits,
        x + labelW + index * (optionW + optionGap), y, optionW, chipH,
        option.label,
        'mechanics-source-select',
        { key: control.key, value: option.value },
        accentHex,
        params[control.key] === option.value,
        theme,
      );
    });
    y += chipH + gap;
  });

  const colGap = Math.round(7 * scale);
  const colW = (w - colGap) / 2;
  const sliderH = Math.round(48 * scale);
  const sliderGap = Math.round(4 * scale);
  ranges.forEach((control, index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const px = x + col * (colW + colGap);
    const py = y + row * (sliderH + sliderGap);
    ctx.fillStyle = P.panel;
    ctx.strokeStyle = P.panelStroke;
    roundRect(ctx, px, py, colW, sliderH, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(control.label, px + Math.round(12 * scale), py + Math.round(10 * scale));
    ctx.fillStyle = P.text;
    ctx.font = `bold ${Math.round(20 * scale)}px "Microsoft YaHei", sans-serif`;
    const digits = control.digits ?? 2;
    const unit = control.unit || '';
    ctx.fillText(
      `${Number(params[control.key] ?? 0).toFixed(digits)}${unit ? ` ${unit}` : ''}`,
      px + Math.round(12 * scale),
      py + Math.round(28 * scale),
    );
  });
  y += Math.ceil(Math.max(ranges.length, 1) / 2) * (sliderH + sliderGap) + gap;
  y += Math.round(12 * scale);

  const footerH = Math.round(48 * scale);
  const footerY = contentTop + contentH - footerH;
  const actionGap = Math.round(6 * scale);
  const sourceActions = Array.isArray(experiment.actions) ? experiment.actions : [];
  if (sourceActions.length) {
    y = Math.min(y, footerY - chipH - gap);
    const actionW = (w - actionGap * (sourceActions.length - 1)) / sourceActions.length;
    sourceActions.forEach((item, index) => {
      drawPremiumHoloButton(
        ctx, hits,
        x + index * (actionW + actionGap), y, actionW, chipH,
        item.label,
        'mechanics-source-action',
        { id: item.id },
        accentHex,
        false,
        theme,
      );
    });
    y += chipH + gap;
  }

  const step = experiment.steps?.[hud?.stepIndex || 0];
  if (y < footerY - Math.round(20 * scale)) {
    ctx.fillStyle = P.muted;
    ctx.font = `bold ${Math.round(14 * scale)}px "Microsoft YaHei", sans-serif`;
    const hint = step?.hint || step?.text || '调节参数后观察源仿真读数';
    ctx.fillText(`步骤 ${(hud?.stepIndex || 0) + 1}/${experiment.steps?.length || 1} · ${hint}`, x + 2, y);
  }

  const footerGap = Math.round(8 * scale);
  const footerW = (w - footerGap) / 2;
  drawPremiumHoloButton(
    ctx, hits, x, footerY, footerW, footerH,
    data.paused ? '继续仿真' : '暂停仿真',
    'mechanics-source-pause', {}, accentHex, !!data.paused, theme,
  );
  drawPremiumHoloButton(
    ctx, hits, x + footerW + footerGap, footerY, footerW, footerH,
    '重置实验', 'mechanics-source-reset', {}, accentHex, false, theme,
  );
}

/**
 * Return the logical canvas size required by the current hologram UI.
 * Dense experiment screens grow vertically instead of squeezing their rows,
 * while station menus grow with the number of experiment cards.
 *
 * surface:
 *  - 'selector' — tabletop terminal (activate + pick experiment only)
 *  - 'display'  — large floating content panel in front of the bench
 *  - 'full'     — legacy single-panel mode (menu + experiment on one surface)
 */
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
      faraday_induction: 780,
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
    faraday_induction: 580,
    induced_electric_field: 600,
    multi_slit_diffraction: 720,
    reflection: 700,
    refraction: 720,
    dispersion: 700,
    lens: 680,
    calorimetry: 640,
    convection: 600,
    'heat-conduction': 600,
    'ideal-gas': 560,
    'thermal-expansion': 620,
    'free-fall': 660,
    'inclined-plane': 640,
    pendulum: 660,
    collision: 700,
    projectile: 700,
    viscosity: 960,
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
    if (experiment.id === 'multi_slit_diffraction') {
      drawDiffractionExperiment(ctx, W, H, {
        hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
      });
      return { hits };
    }
    if (isGeometricOpticsExp(experiment.id)) {
      drawGeometricOpticsExperiment(ctx, W, H, {
        hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
      });
      return { hits };
    }
    if (['calorimetry', 'convection', 'heat-conduction', 'ideal-gas', 'thermal-expansion'].includes(experiment.id)) {
      drawThermoExperiment(ctx, W, H, {
        hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
      });
      return { hits };
    }
    if (['free-fall', 'inclined-plane', 'pendulum', 'collision', 'projectile', 'viscosity'].includes(experiment.id)) {
      if (experiment.id === 'viscosity') {
        drawViscosityExperiment(ctx, W, H, {
          hits, innerX, innerW, contentTop, contentH, experiment, hud, accentHex, theme, surface,
        });
        return { hits };
      }
      drawSourceMechanicsExperiment(ctx, W, H, {
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
