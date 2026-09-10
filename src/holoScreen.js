
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
