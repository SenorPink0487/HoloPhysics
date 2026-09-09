/**
 * Canvas painters for chemistry holos: left status, right composition,
 * front periodic-table / reagent picker.
 *
 * Vision Pro Light Mode Frosted Glass styling:
 * High-clarity frosted glass background, bold crystal-clear slate typography,
 * spacious layout proportions, and elegant spatial computing aesthetics.
 */

import {
  CHEM_ELEMENTS,
  elementGridCell,
  getElement,
  getReagentsForElement,
  formatSubscriptFormula,
} from './reagentCatalog.js';
import { pickHoloScreen } from '../holoScreen.js';

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

function fillGlass(ctx, w, h) {
  // Clear previous frame pixels to prevent ghosting / multi-layer bleeding
  ctx.clearRect?.(0, 0, w, h);

  // Vision Pro light mode frosted glass background
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255, 255, 255, 0.98)');
  g.addColorStop(0.5, 'rgba(248, 250, 252, 0.95)');
  g.addColorStop(1, 'rgba(241, 245, 249, 0.98)');
  ctx.fillStyle = g;
  // Smooth Vision Pro corner radius
  roundRect(ctx, 0, 0, w, h, 48);
  ctx.fill();

  // Soft specular outer glass rim
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.75)';
  ctx.lineWidth = 2.5;
  roundRect(ctx, 1.5, 1.5, w - 3, h - 3, 46);
  ctx.stroke();

  // Inner highlight rim
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 1.5;
  roundRect(ctx, 6, 6, w - 12, h - 12, 42);
  ctx.stroke();

  // Vision Pro window grab bar indicator at top
  const barW = 84;
  const barH = 6;
  roundRect(ctx, (w - barW) / 2, 14, barW, barH, 3);
  ctx.fillStyle = 'rgba(100, 116, 139, 0.45)';
  ctx.fill();
}

function cupLabel(cup) {
  if (!cup?.reagents?.length) return '空 · 点击选择试剂';
  return cup.reagents.map((r) => formatSubscriptFormula(r.formula)).join(' + ');
}

/**
 * Left always-on status panel (W=1400, H=1040).
 * @returns {{ hits: object[] }}
 */
export function drawChemLeftPanel(ctx, W, H, data = {}) {
  const hits = [];
  fillGlass(ctx, W, H);
  const pad = 44;
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 48px "Outfit", "Noto Sans SC", system-ui, sans-serif';
  ctx.fillText('化学实验台', pad, 72);
  ctx.fillStyle = '#64748b';
  ctx.font = '600 22px "Outfit", system-ui, sans-serif';
  ctx.fillText('REAGENT MIX · CENTER ISLAND', pad, 108);

  const cupA = data.cupA || {};
  const cupB = data.cupB || {};
  const cardH = 160;
  const cards = [
    { key: 'A', title: '烧杯 A', body: cupLabel(cupA), action: 'chem-select-cup', cup: 'A', y: 140 },
    { key: 'B', title: '烧杯 B', body: cupLabel(cupB), action: 'chem-select-cup', cup: 'B', y: 140 + cardH + 28 },
  ];

  for (const card of cards) {
    const active = data.activeCup === card.cup;
    roundRect(ctx, pad, card.y, W - pad * 2, cardH, 24);
    ctx.fillStyle = active ? 'rgba(255, 255, 255, 0.96)' : 'rgba(255, 255, 255, 0.60)';
    ctx.fill();
    ctx.strokeStyle = active ? '#0f172a' : 'rgba(203, 213, 225, 0.70)';
    ctx.lineWidth = active ? 3.5 : 1.8;
    ctx.stroke();

    // Active status pill tag
    if (active) {
      roundRect(ctx, W - pad - 140, card.y + 24, 116, 36, 18);
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 18px "Noto Sans SC", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('当前选中', W - pad - 82, card.y + 48);
      ctx.textAlign = 'left';
    }

    ctx.fillStyle = '#0f172a';
    ctx.font = '800 38px "Outfit", "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText(card.title, pad + 32, card.y + 54);
    ctx.fillStyle = active ? '#1e293b' : '#475569';
    ctx.font = '600 28px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText(card.body, pad + 32, card.y + 110);
    hits.push({
      x: pad, y: card.y, w: W - pad * 2, h: cardH,
      action: card.action, cup: card.cup, role: 'chem_ui',
    });
  }

  // Hint
  ctx.fillStyle = '#475569';
  ctx.font = '600 24px "Noto Sans SC", system-ui, sans-serif';
  const hint = data.hint || '点击烧杯选择试剂 · 拖动倾倒到另一杯';
  wrapText(ctx, hint, pad, 530, W - pad * 2, 38);

  // Reset button (Vision Pro light glass pill style)
  const by = H - 110;
  roundRect(ctx, pad, by, W - pad * 2, 74, 24);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.80)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.60)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 28px "Noto Sans SC", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('重置实验台', W / 2, by + 48);
  ctx.textAlign = 'left';
  hits.push({ x: pad, y: by, w: W - pad * 2, h: 74, action: 'chem-reset', role: 'chem_ui' });

  return { hits };
}

/**
 * Right always-on composition panel (W=1400, H=1040).
 */
export function drawChemRightPanel(ctx, W, H, data = {}) {
  const hits = [];
  fillGlass(ctx, W, H);
  const pad = 44;
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 48px "Outfit", "Noto Sans SC", system-ui, sans-serif';
  ctx.fillText('成分构成与比例', pad, 72);
  const components = data.components || [];

  // --- Beaker View Selector Tabs (Top Right) ---
  const currentView = data.viewCup || 'all';
  const tabs = [
    { id: 'all', label: '全部成分' },
    { id: 'A', label: '烧杯 A' },
    { id: 'B', label: '烧杯 B' },
  ];

  const tabW = 185;
  const tabH = 64;
  const tabGap = 16;
  const totalTabsW = tabs.length * tabW + (tabs.length - 1) * tabGap;
  let tabX = W - pad - totalTabsW;
  const tabY = 32;

  tabs.forEach((t) => {
    const isSel = currentView === t.id;
    ctx.fillStyle = isSel ? 'rgba(14, 165, 233, 0.95)' : 'rgba(241, 245, 249, 0.85)';
    roundRect(ctx, tabX, tabY, tabW, tabH, 16);
    ctx.fill();
    ctx.strokeStyle = isSel ? '#0284c7' : 'rgba(203, 213, 225, 0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.fillStyle = isSel ? '#ffffff' : '#334155';
    ctx.font = '700 28px "Noto Sans SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t.label, tabX + tabW / 2, tabY + tabH / 2);
    ctx.textAlign = 'left';

    hits.push({
      x: tabX,
      y: tabY,
      w: tabW,
      h: tabH,
      action: 'chem-select-view-cup',
      cup: t.id,
      role: 'chem_ui',
    });

    tabX += tabW + tabGap;
  });

  // --- Circular Percentage Chart (Donut Chart) ---
  const cx = W / 2;
  const cy = 245;
  const R = 110;
  const r = 68;

  if (!components.length) {
    // Empty state ring
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.arc(cx, cy, r, Math.PI * 2, 0, true);
    ctx.closePath();
    ctx.fillStyle = 'rgba(241, 245, 249, 0.65)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#64748b';
    ctx.font = '600 24px "Noto Sans SC", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('暂无成分', cx, cy + 8);

    ctx.font = '500 22px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText('装入试剂或倾倒混合后，成分与比例将在此显示。', cx, cy + 175);
    ctx.textAlign = 'left';

    // Allow wheel & drag scroll interaction even when empty
    hits.push({
      x: pad,
      y: 380,
      w: W - pad * 2,
      h: H - 420,
      action: 'chem-scroll-right',
      role: 'scrollable_components',
      maxScroll: 0,
    });
    return { hits };
  }

  // Calculate component percentages
  let totalWeight = 0;
  const weights = components.map((c) => {
    const p = Number(c.percent);
    const w = Number.isFinite(p) && p > 0 ? p : 1;
    totalWeight += w;
    return w;
  });
  const pcts = weights.map((w) => (w / totalWeight) * 100);

  // Render Donut Slices
  let startAngle = -Math.PI / 2;
  components.forEach((comp, idx) => {
    const pct = pcts[idx];
    const sliceAngle = (pct / 100) * 2 * Math.PI;
    const endAngle = startAngle + sliceAngle;
    const isSelected = data.selectedComponentId === comp.id;
    const sliceR = isSelected ? R + 8 : R;
    const sliceColor = `#${(comp.color >>> 0).toString(16).padStart(6, '0')}`;

    ctx.beginPath();
    ctx.arc(cx, cy, sliceR, startAngle, endAngle, false);
    ctx.arc(cx, cy, r, endAngle, startAngle, true);
    ctx.closePath();

    ctx.fillStyle = sliceColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Hit region for slice
    hits.push({
      x: cx - sliceR,
      y: cy - sliceR,
      w: sliceR * 2,
      h: sliceR * 2,
      action: 'chem-show-component',
      componentId: comp.id,
      role: 'chem_ui',
    });

    startAngle = endAngle;
  });

  // Inner Donut Center Hole
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(203, 213, 225, 0.70)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Donut Center Text: selected component formula or total count
  const selComp = components.find((c) => c.id === data.selectedComponentId) || components[0];
  const selIdx = components.indexOf(selComp);
  const selPct = selIdx >= 0 ? pcts[selIdx] : 0;

  ctx.textAlign = 'center';
  ctx.fillStyle = '#0f172a';
  ctx.font = '800 28px "Outfit", system-ui, sans-serif';
  ctx.fillText(formatSubscriptFormula(selComp.formula || selComp.name_zh || `${components.length} 种成分`), cx, cy - 4);

  ctx.fillStyle = '#0284c7';
  ctx.font = '700 22px "Outfit", system-ui, sans-serif';
  ctx.fillText(`${selPct.toFixed(1)}%`, cx, cy + 26);
  ctx.textAlign = 'left';

  // --- Scrollable Component List Below ---
  const listTop = 385;
  const listBottom = H - 40; // 1000
  const viewportH = listBottom - listTop; // 615
  const rowH = 92;
  const rowGap = 14;
  const totalH = components.length * (rowH + rowGap);
  const maxScroll = Math.max(0, totalH - viewportH);
  const scrollY = Math.min(Math.max(0, data.rightPanelScrollY || 0), maxScroll);

  // Section Header
  ctx.fillStyle = '#334155';
  ctx.font = '700 24px "Noto Sans SC", system-ui, sans-serif';
  ctx.fillText(`成分列表 (${components.length})`, pad, 370);

  ctx.fillStyle = '#64748b';
  ctx.font = '500 20px "Noto Sans SC", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('↕ 支持滚轮/拖拽滑动', W - pad, 370);
  ctx.textAlign = 'left';

  // Clip list area
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, pad, listTop, W - pad * 2, viewportH, 16);
  ctx.clip();

  components.forEach((comp, idx) => {
    const pct = pcts[idx];
    const y = listTop - scrollY + idx * (rowH + rowGap);
    if (y + rowH < listTop || y > listBottom) return;

    const active = data.selectedComponentId === comp.id;
    roundRect(ctx, pad, y, W - pad * 2, rowH, 22);
    ctx.fillStyle = active ? 'rgba(255, 255, 255, 0.98)' : 'rgba(255, 255, 255, 0.65)';
    ctx.fill();
    ctx.strokeStyle = active ? '#0f172a' : 'rgba(203, 213, 225, 0.70)';
    ctx.lineWidth = active ? 3.5 : 1.8;
    ctx.stroke();

    // Color Swatch
    ctx.fillStyle = `#${(comp.color >>> 0).toString(16).padStart(6, '0')}`;
    roundRect(ctx, pad + 20, y + (rowH - 48) / 2, 48, 48, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.50)';
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Formula & Name
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 32px "Outfit", system-ui, sans-serif';
    ctx.fillText(formatSubscriptFormula(comp.formula || comp.id), pad + 84, y + 40);

    ctx.fillStyle = '#475569';
    ctx.font = '600 22px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText(comp.name_zh || '', pad + 84, y + 72);

    // Percentage Pill Badge
    const pillW = 120;
    const pillH = 40;
    const pillX = W - pad - 20 - pillW;
    const pillY = y + (rowH - pillH) / 2;

    roundRect(ctx, pillX, pillY, pillW, pillH, 14);
    ctx.fillStyle = active ? '#0f172a' : 'rgba(15, 23, 42, 0.08)';
    ctx.fill();

    const pctStr = pct >= 0.1
      ? `${pct.toFixed(1)}%`
      : pct >= 0.005
      ? `${pct.toFixed(2)}%`
      : pct > 0
      ? '<0.01%'
      : '0%';
    ctx.fillText(pctStr, pillX + pillW / 2, pillY + 28);
    ctx.textAlign = 'left';

    // Clickable hit region for component item
    hits.push({
      x: pad,
      y: Math.max(listTop, y),
      w: W - pad * 2,
      h: Math.min(rowH, listBottom - y),
      action: 'chem-show-component',
      componentId: comp.id,
      role: 'chem_ui',
    });
  });

  ctx.restore();

  // Glass Scrollbar Indicator
  if (totalH > viewportH) {
    const sbTrackW = 6;
    const sbX = W - pad - sbTrackW;
    const sbY = listTop;
    const thumbH = Math.max(36, (viewportH / totalH) * viewportH);
    const thumbY = listTop + (scrollY / maxScroll) * (viewportH - thumbH);

    roundRect(ctx, sbX, sbY, sbTrackW, viewportH, 3);
    ctx.fillStyle = 'rgba(203, 213, 225, 0.40)';
    ctx.fill();

    roundRect(ctx, sbX, thumbY, sbTrackW, thumbH, 3);
    ctx.fillStyle = 'rgba(100, 116, 139, 0.60)';
    ctx.fill();
  }

  // General scroll hit region covering list area
  hits.push({
    x: pad,
    y: listTop,
    w: W - pad * 2,
    h: viewportH,
    action: 'chem-scroll-right',
    role: 'scrollable_components',
    maxScroll,
  });

  return { hits };
}

/**
 * Front floating periodic table / reagent picker (W=1920, H=1120).
 * Vision Pro Light Mode Frosted Glass styling with balanced card proportions,
 * bold crystal-clear slate typography, and spacious layout grid.
 */
export function drawChemPeriodicPanel(ctx, W, H, data = {}) {
  const hits = [];
  fillGlass(ctx, W, H);
  const pad = 44;
  const phase = data.pickerPhase || 'elements';
  const activeCup = data.activeCup || 'A';

  ctx.fillStyle = '#0f172a';
  ctx.font = '800 48px "Outfit", "Noto Sans SC", system-ui, sans-serif';
  ctx.fillText(phase === 'elements' ? '元素周期表 · 选择元素' : '常见试剂 · 装入烧杯', pad, 68);
  ctx.fillStyle = '#64748b';
  ctx.font = '600 24px "Noto Sans SC", system-ui, sans-serif';
  ctx.fillText(`当前烧杯 ${activeCup}  ·  点击元素或在下方输入 AI 检索`, pad, 108);

  // Dedicated Compact Search Bar centered at bottom of Main Front Screen (W=1920, H=1120)
  const slotW = 1080;
  const slotX = (W - slotW) / 2;
  const slotY = H - 124;
  const slotH = 92;
  roundRect(ctx, slotX, slotY, slotW, slotH, 24);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(14, 165, 233, 0.45)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Input Field (Full Width & Proportional)
  const inputX = slotX + 18;
  const inputY = slotY + 12;
  const btnW = 190;
  const inputW = 712;
  const inputH = 68;

  roundRect(ctx, inputX, inputY, inputW, inputH, 16);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = data.searchFocused ? '#0284c7' : 'rgba(203, 213, 225, 0.95)';
  ctx.lineWidth = data.searchFocused ? 2.5 : 1.5;
  ctx.stroke();

  const query = data.searchQuery != null ? data.searchQuery : '';
  const speechPhase = String(data.speechPhase || 'idle');
  const speechMessage = speechPhase === 'requesting'
    ? '请按系统提示允许语音识别和麦克风'
    : speechPhase === 'listening'
      ? '正在聆听…再次点击麦克风结束'
      : speechPhase === 'stopping'
        ? '正在生成识别文字…'
        : '';
  const searchMessage = speechMessage || (
    data.searchBusy || data.searchStatusTone === 'error'
      ? String(data.searchStatus || '')
      : ''
  );
  if (searchMessage) {
    ctx.fillStyle = speechPhase === 'requesting'
      ? '#b45309'
      : data.searchStatusTone === 'error' ? '#dc2626' : '#0284c7';
    ctx.font = '700 23px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText(searchMessage.slice(0, 30), inputX + 20, inputY + 44);
  } else if (query) {
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 25px "Outfit", "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText(query + (data.searchFocused ? '|' : ''), inputX + 20, inputY + 44);
  } else {
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 23px "Noto Sans SC", system-ui, sans-serif';
    ctx.fillText('输入化学式 / 名称 / SMILES', inputX + 20, inputY + 44);
  }

  hits.push({
    x: inputX, y: inputY, w: inputW, h: inputH,
    action: 'chem-search-focus', role: 'chem_ui',
  });

  // Compact icon-only voice button beside the search field.
  const voiceX = inputX + inputW + 14;
  const voiceW = 78;
  roundRect(ctx, voiceX, inputY, voiceW, inputH, 16);
  const isListening = speechPhase === 'listening' || !!data.speechListening;
  const isRequesting = speechPhase === 'requesting';
  const isStopping = speechPhase === 'stopping';

  if (isListening) {
    const voiceGrad = ctx.createLinearGradient(voiceX, inputY, voiceX + voiceW, inputY + inputH);
    voiceGrad.addColorStop(0, '#ef4444');
    voiceGrad.addColorStop(1, '#dc2626');
    ctx.fillStyle = voiceGrad;
    ctx.fill();
    ctx.strokeStyle = '#fca5a5';
    ctx.lineWidth = 2.5;
    ctx.stroke();

  } else if (isRequesting || isStopping) {
    const phaseGrad = ctx.createLinearGradient(voiceX, inputY, voiceX + voiceW, inputY + inputH);
    phaseGrad.addColorStop(0, isRequesting ? '#f59e0b' : '#38bdf8');
    phaseGrad.addColorStop(1, isRequesting ? '#d97706' : '#0284c7');
    ctx.fillStyle = phaseGrad;
    ctx.fill();
    ctx.strokeStyle = isRequesting ? '#fcd34d' : '#7dd3fc';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.95)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

  }

  // Draw a stable vector microphone instead of an emoji/text glyph; emoji
  // rendering differs between Safari and WKWebView and previously shifted.
  const micX = voiceX + voiceW / 2;
  const micY = inputY + inputH / 2 - 3;
  ctx.strokeStyle = (isListening || isRequesting || isStopping) ? '#ffffff' : '#0284c7';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  roundRect(ctx, micX - 8, micY - 14, 16, 27, 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(micX, micY, 15, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(micX, micY + 15);
  ctx.lineTo(micX, micY + 23);
  ctx.moveTo(micX - 9, micY + 23);
  ctx.lineTo(micX + 9, micY + 23);
  ctx.stroke();
  if (isListening) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(voiceX + voiceW - 14, inputY + 14, 5, 0, Math.PI * 2);
    ctx.fill();
  }

  hits.push({
    x: voiceX, y: inputY, w: voiceW, h: inputH,
    action: 'chem-search-voice', role: 'chem_ui',
  });

  // AI Parse Button
  const btnX = voiceX + voiceW + 14;
  roundRect(ctx, btnX, inputY, btnW, inputH, 16);
  const isBusy = !!data.searchBusy;
  const btnGrad = ctx.createLinearGradient(btnX, inputY, btnX + btnW, inputY + inputH);
  btnGrad.addColorStop(0, '#0ea5e9');
  btnGrad.addColorStop(1, '#0284c7');
  ctx.fillStyle = isBusy ? '#94a3b8' : btnGrad;
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 25px "Noto Sans SC", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(isBusy ? '解析中…' : 'AI 解析', btnX + btnW / 2, inputY + 44);
  ctx.textAlign = 'left';

  hits.push({
    x: btnX, y: inputY, w: btnW, h: inputH,
    action: 'chem-search-submit', role: 'chem_ui',
  });

  // Close button (Prominent Vision Pro Red Glass Badge)
  const closeW = 160;
  const closeH = 68;
  const closeX = W - pad - closeW;
  const closeY = 24;
  roundRect(ctx, closeX, closeY, closeW, closeH, 22);
  ctx.fillStyle = 'rgba(239, 68, 68, 0.90)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.90)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.font = '800 28px "Outfit", "Noto Sans SC", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('关闭  ×', closeX + closeW / 2, closeY + 44);
  ctx.textAlign = 'left';

  hits.push({
    x: closeX, y: closeY, w: closeW, h: closeH,
    action: 'chem-close-picker', role: 'chem_ui',
  });

  if (phase === 'reagents') {
    const el = getElement(data.pickedElement);
    const reagents = getReagentsForElement(data.pickedElement) || [];
    // Back button
    roundRect(ctx, pad, 126, 170, 54, 18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(203, 213, 225, 0.85)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.font = '700 24px "Noto Sans SC", system-ui';
    ctx.fillText('← 返回', pad + 34, 161);
    hits.push({
      x: pad, y: 126, w: 170, h: 54,
      action: 'chem-picker-back', role: 'chem_ui',
    });

    ctx.fillStyle = '#0f172a';
    ctx.font = '800 34px "Outfit", "Noto Sans SC", system-ui';
    ctx.fillText(`${el?.symbol || ''} · ${el?.name_zh || ''} · 共 ${reagents.length} 种试剂`, pad + 205, 163);

    // Balanced 3-Column Card Grid with bold typography and spacious card proportion
    const listTop = 205;
    const gapX = 24;
    const gapY = 20;
    const listCols = 3;
    const containerW = W - pad * 2;
    const cardW = (containerW - gapX * (listCols - 1)) / listCols;
    const cardH = 110;

    reagents.forEach((r, i) => {
      const col = i % listCols;
      const row = Math.floor(i / listCols);
      const x = pad + col * (cardW + gapX);
      const y = listTop + row * (cardH + gapY);
      if (y + cardH > slotY - 12) return;

      roundRect(ctx, x, y, cardW, cardH, 22);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const sw = 64;
      ctx.fillStyle = `#${(r.color >>> 0).toString(16).padStart(6, '0')}`;
      roundRect(ctx, x + 24, y + (cardH - sw) / 2, sw, sw, 16);
      ctx.fill();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.60)';
      ctx.lineWidth = 2;
      ctx.stroke();

      const textX = x + 24 + sw + 22;
      ctx.fillStyle = '#0f172a';
      ctx.font = '800 32px "Outfit", system-ui';
      ctx.fillText(formatSubscriptFormula(r.formula), textX, y + 48);
      ctx.fillStyle = '#475569';
      ctx.font = '600 24px "Noto Sans SC", system-ui';
      ctx.fillText(r.name_zh, textX, y + 86);

      hits.push({
        x, y, w: cardW, h: cardH,
        action: 'chem-pick-reagent',
        reagentId: r.id,
        role: 'chem_ui',
      });
    });
  } else {
    // Element grid — 18 cols x 6 rows with bold high-clarity typography
    const cols = 18;
    const rows = 6;
    const gridTop = 135;
    const gridLeft = pad;
    const gridW = W - pad * 2;
    const gridH = slotY - gridTop - 12;
    const cellW = gridW / cols;
    const cellH = Math.min(135, gridH / rows);

    for (const el of CHEM_ELEMENTS) {
      const { col, row } = elementGridCell(el);
      const x = gridLeft + col * cellW + 4;
      const y = gridTop + row * cellH + 4;
      const cw = cellW - 8;
      const ch = cellH - 8;
      roundRect(ctx, x, y, cw, ch, 16);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(203, 213, 225, 0.80)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#0f172a';
      const symSize = Math.max(28, Math.min(44, cw * 0.60));
      ctx.font = `800 ${symSize}px "Outfit", system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText(el.symbol, x + cw / 2, y + ch * 0.48);
      ctx.fillStyle = '#334155';
      const nameSize = Math.max(16, Math.min(22, cw * 0.36));
      ctx.font = `700 ${nameSize}px "Noto Sans SC", system-ui`;
      ctx.fillText(el.name_zh, x + cw / 2, y + ch * 0.80);
      ctx.textAlign = 'left';

      hits.push({
        x, y, w: cw, h: ch,
        action: 'chem-pick-element',
        element: el.symbol,
        role: 'chem_ui',
      });
    }
  }

  // Dedicated hit region for enlarged close button aligned with visual badge
  hits.push({
    x: closeX,
    y: closeY,
    w: closeW,
    h: closeH,
    action: 'chem-close-picker',
    role: 'chem_ui',
  });

  return { hits };
}

function wrapText(ctx, text, x, y, maxW, lineH) {
  const chars = String(text || '').split('');
  let line = '';
  let cy = y;
  for (const ch of chars) {
    const test = line + ch;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, cy);
      line = ch;
      cy += lineH;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, cy);
}

/** Hit-test helper for chemistry holos with precise pixel-perfect alignment. */
export function pickChemHits(hits, u, v, W, H) {
  if (!hits?.length || u == null || v == null || !Number.isFinite(u) || !Number.isFinite(v)) {
    return null;
  }
  const px = u * W;
  const py = (1 - v) * H;
  const mirroredPy = v * H;
  const pad = 12;

  const inRegion = (h, y) => (
    px >= h.x - pad
    && px <= h.x + h.w + pad
    && y >= h.y - pad
    && y <= h.y + h.h + pad
  );

  // Search controls sit at the bottom edge and are the most sensitive to the
  // inverted-v quirk seen in iPad WKWebView. Resolve both UV orientations
  // before generic element cards so a tap on AI/voice cannot be stolen by a
  // periodic-table cell at the mirrored coordinate.
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const h = hits[i];
    if (!/^chem-search-(focus|voice|submit)$/.test(h.action || '')) continue;
    if (inRegion(h, py)) return { ...h, px, py };
    if (inRegion(h, mirroredPy)) {
      return { ...h, px, py: mirroredPy, uvMirrored: true };
    }
  }

  // 1. Check other specific interactive UI actions.
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const h = hits[i];
    if (/^chem-search-(focus|voice|submit)$/.test(h.action || '')) continue;
    if (h.role === 'scrollable_components' || h.action === 'chem-scroll-right') continue;
    if (inRegion(h, py)) {
      return { ...h, px, py };
    }
  }

  // 2. Fallback to scrollable background region
  for (let i = hits.length - 1; i >= 0; i -= 1) {
    const h = hits[i];
    if (h.role !== 'scrollable_components' && h.action !== 'chem-scroll-right') continue;
    if (inRegion(h, py)) {
      return { ...h, px, py };
    }
  }
  return null;
}
