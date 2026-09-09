/**
 * Physical tabletop parameter sliders — larger control card on the bench,
 * edge-anchored so it sits flush against the sitting side of the desk.
 *
 * Layout per row (top → bottom in local −Z):
 *   [ label ………… value ]
 *   [ ═══════●════ track ]
 *
 * Interaction: pickFromRay returns the same pick shape as holoScreen
 * param sliders so manager.dispatchSliderValue works unchanged.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const MAX_SLOTS = 8;
/** Card width (local X) — wide enough to read labels at a glance. */
const CARD_W = 0.58;
const TRACK_LEN = 0.48;
const TRACK_H = 0.014;
const TRACK_D = 0.020;
const THUMB_R = 0.020;
const PANEL_PAD_X = 0.036;
const PANEL_PAD_Z = 0.020;
/**
 * One slider row height. Kept moderately compact so 5–6 params still fit in the
 * front desk strip without covering the optical / experiment rail.
 */
const ROW_H = 0.096;
const BASE_H = 0.022;
const MIN_ROWS_VISUAL = 1;
/** Keep a small gap so the rim clears the desk lip. */
const EDGE_INSET = 0.024;

/**
 * World-space text plane sizes. Canvas textures MUST use the same aspect
 * (width/height) or glyphs look vertically squashed on the desk.
 */
const HEADER_MESH_W = CARD_W - PANEL_PAD_X * 1.5;
/** Taller band so label/value glyphs read larger on the desk. */
const HEADER_MESH_H = 0.042;
/** Texture pixel height; width is derived from mesh aspect. */
const TEX_PX_H = 160;

function makeCanvasForMesh(meshW, meshH, pxH = TEX_PX_H) {
  const aspect = Math.max(1e-6, meshW / meshH);
  const c = document.createElement('canvas');
  c.height = pxH;
  c.width = Math.max(64, Math.round(pxH * aspect));
  return c;
}

/** Desk panel text: dark slate for contrast on the light card. */
const DESK_TEXT = '#0f172a';
const DESK_TEXT_MUTED = '#1e293b';

function renderHeaderCanvas(c, ctx, label, valueText, _accent = '#ec4899') {
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.textBaseline = 'middle';

  // Large bold glyphs (~62% of band) for readability at desk distance.
  const fontPx = Math.round(c.height * 0.62);

  // Label (left)
  ctx.textAlign = 'left';
  ctx.fillStyle = DESK_TEXT_MUTED;
  ctx.font = `bold ${fontPx}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillText(String(label || ''), Math.round(c.width * 0.02), c.height * 0.52);

  // Value (right, mono)
  ctx.textAlign = 'right';
  ctx.fillStyle = DESK_TEXT;
  ctx.font = `bold ${Math.round(fontPx * 1.06)}px "Microsoft YaHei", sans-serif`;
  ctx.fillText(String(valueText || '—'), c.width - Math.round(c.width * 0.02), c.height * 0.52);
}

function makeHeaderTexture(label, valueText, accent = '#ec4899') {
  const c = makeCanvasForMesh(HEADER_MESH_W, HEADER_MESH_H);
  const ctx = c.getContext('2d');
  renderHeaderCanvas(c, ctx, label, valueText, accent);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

const BTN_R = 0.017;
const BTN_H = 0.012;
const BTN_PLANE_SIZE = BTN_R * 2;

function renderButtonCanvas(c, ctx, symbol, accentHex = '#ec4899') {
  ctx.clearRect(0, 0, c.width, c.height);
  const cx = c.width / 2;
  const cy = c.height / 2;
  const r = Math.round(c.width * 0.44);

  ctx.beginPath();
  if (typeof ctx.arc === 'function') {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (typeof ctx.arcTo === 'function') {
    ctx.moveTo(cx + r, cy);
    ctx.arcTo(cx + r, cy + r, cx, cy + r, r);
    ctx.arcTo(cx - r, cy + r, cx - r, cy, r);
    ctx.arcTo(cx - r, cy - r, cx - r, cy, r);
    ctx.arcTo(cx + r, cy - r, cx + r, cy, r);
  }
  ctx.closePath();

  ctx.fillStyle = 'rgba(236, 72, 153, 0.16)';
  ctx.strokeStyle = accentHex;
  ctx.lineWidth = Math.max(3, Math.round(c.height * 0.07));
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = DESK_TEXT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontPx = Math.round(r * 1.05);
  ctx.font = `bold ${fontPx}px "Microsoft YaHei", "Segoe UI", sans-serif`;
  ctx.fillText(String(symbol), cx, cy * 1.02);
}

function makeButtonTexture(symbol, accentHex = '#ec4899') {
  const c = makeCanvasForMesh(BTN_PLANE_SIZE, BTN_PLANE_SIZE, 128);
  const ctx = c.getContext('2d');
  renderButtonCanvas(c, ctx, symbol, accentHex);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

function pulseButtonMesh(mesh) {
  if (!mesh) return;
  mesh.scale.set(0.92, 0.92, 0.92);
  setTimeout(() => {
    try {
      mesh.scale.set(1, 1, 1);
    } catch { /* ignore */ }
  }, 120);
}

function renderActionGroupCanvas(c, ctx, buttons, accentHex = '#ec4899') {
  ctx.clearRect(0, 0, c.width, c.height);

  const list = Array.isArray(buttons) ? buttons : [];
  const count = Math.max(1, list.length);
  const pad = Math.round(c.height * 0.08);
  const gap = Math.round(c.width * 0.025);
  const totalW = c.width - pad * 2;
  const btnW = (totalW - gap * (count - 1)) / count;
  const h = c.height - pad * 2;
  const y = pad;
  const r = Math.round(h * 0.24);

  list.forEach((btn, i) => {
    const x = pad + i * (btnW + gap);
    const active = !!btn.active;

    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + btnW, y, x + btnW, y + h, r);
    ctx.arcTo(x + btnW, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + btnW, y, r);
    ctx.closePath();

    if (active) {
      ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = Math.max(3, Math.round(c.height * 0.08));
    } else {
      ctx.fillStyle = 'rgba(236, 72, 153, 0.16)';
      ctx.strokeStyle = accentHex;
      ctx.lineWidth = Math.max(2, Math.round(c.height * 0.06));
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = active ? '#0284c7' : DESK_TEXT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let fontPx = count >= 3 ? Math.round(c.height * 0.36) : Math.round(c.height * 0.42);
    ctx.font = `bold ${fontPx}px "Microsoft YaHei", "Segoe UI", sans-serif`;
    const labelText = String(btn.label || '');
    const maxW = btnW - Math.round(c.width * 0.03);
    const measuredW = typeof ctx.measureText === 'function' ? (ctx.measureText(labelText)?.width || 0) : 0;
    if (measuredW > maxW && measuredW > 0) {
      fontPx = Math.max(10, Math.floor(fontPx * (maxW / measuredW)));
      ctx.font = `bold ${fontPx}px "Microsoft YaHei", "Segoe UI", sans-serif`;
    }
    ctx.fillText(labelText, x + btnW / 2, y + h * 0.52);
  });
}

/** Full-width or multi-button action chip texture for discrete desk controls. */
function makeActionGroupTexture(buttons, accentHex = '#ec4899') {
  const meshW = CARD_W - PANEL_PAD_X * 1.2;
  const meshH = ROW_H * 0.72;
  const c = makeCanvasForMesh(meshW, meshH, 180);
  const ctx = c.getContext('2d');
  renderActionGroupCanvas(c, ctx, buttons, accentHex);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, meshW, meshH };
}

function makeActionButtonTexture(label, accent = '#ec4899') {
  return makeActionGroupTexture([{ label, action: '', active: false }], accent);
}

function formatValue(value, digits = 2, unit = '') {
  const n = Number(value);
  const t = Number.isFinite(n) ? n.toFixed(digits) : '—';
  return unit ? `${t} ${unit}` : t;
}

function panelDepthForRows(rows) {
  const n = Math.max(MIN_ROWS_VISUAL, Math.min(MAX_SLOTS, rows | 0));
  return ROW_H * n + PANEL_PAD_Z * 2;
}

/**
 * @param {object} opts
 * @param {string} opts.stationId
 * @param {string} opts.accentHex
 * @param {number} [opts.accentNum]
 * @param {number} [opts.maxSlots]
 */
export function createDeskSliderPanel({
  stationId,
  accentHex = '#ec4899',
  accentNum = 0xec4899,
  maxSlots = MAX_SLOTS,
} = {}) {
  const root = new THREE.Group();
  root.name = `desk-sliders-${stationId}`;

  const slots = [];
  let activeCount = 0;
  let specsSig = '';
  /** @type {{ worldX: number, worldY: number, worldZ: number, face: '+z'|'-z'|'+x'|'-x', inset?: number } | null} */
  let edgeAnchor = null;

  const baseW = CARD_W;
  let baseD = panelDepthForRows(1);
  const baseH = BASE_H;
  const trackX0 = -TRACK_LEN / 2;

  function applyEdgeAnchor() {
    if (!edgeAnchor) return;
    const inset = Number.isFinite(edgeAnchor.inset) ? edgeAnchor.inset : EDGE_INSET;
    const halfD = baseD / 2;
    const halfW = baseW / 2;
    let x = edgeAnchor.worldX;
    let y = edgeAnchor.worldY;
    let z = edgeAnchor.worldZ;
    // Stick the named local face to the world edge, panel extends into the desk.
    switch (edgeAnchor.face) {
      case '+z':
        z = edgeAnchor.worldZ - halfD - inset;
        break;
      case '-z':
        z = edgeAnchor.worldZ + halfD + inset;
        break;
      case '+x':
        x = edgeAnchor.worldX - halfW - inset;
        break;
      case '-x':
        x = edgeAnchor.worldX + halfW + inset;
        break;
      default:
        break;
    }
    root.position.set(x, y, z);
  }

  const baseMat = new THREE.MeshPhysicalMaterial({
    color: 0xf8fafc,
    metalness: 0.1,
    roughness: 0.26,
    transparent: false,
    opacity: 1.0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.16,
    envMapIntensity: 0.65,
  });
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    metalness: 0.18,
    roughness: 0.42,
  });
  const trackWellMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    metalness: 0.1,
    roughness: 0.55,
  });
  const fillMat = new THREE.MeshStandardMaterial({
    color: accentNum,
    metalness: 0.28,
    roughness: 0.32,
    emissive: accentNum,
    emissiveIntensity: 0.3,
  });
  const thumbMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.1,
    roughness: 0.2,
    emissive: 0xffffff,
    emissiveIntensity: 0.05,
  });
  const rimMat = new THREE.MeshStandardMaterial({
    color: accentNum,
    metalness: 0.42,
    roughness: 0.32,
    emissive: accentNum,
    emissiveIntensity: 0.2,
  });
  const tickMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    metalness: 0.1,
    roughness: 0.5,
  });
  const zeroTickMat = new THREE.MeshStandardMaterial({
    color: accentNum,
    metalness: 0.2,
    roughness: 0.4,
    emissive: accentNum,
    emissiveIntensity: 0.2,
  });

  const minusTex = makeButtonTexture('−', accentHex);
  const plusTex = makeButtonTexture('+', accentHex);
  const minusFaceMat = new THREE.MeshBasicMaterial({
    map: minusTex,
    transparent: true,
    depthWrite: false,
  });
  const plusFaceMat = new THREE.MeshBasicMaterial({
    map: plusTex,
    transparent: true,
    depthWrite: false,
  });
  const btnMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.12,
    roughness: 0.35,
    emissive: accentNum,
    emissiveIntensity: 0.06,
  });

  const base = new THREE.Mesh(
    new RoundedBoxGeometry(baseW, baseH, baseD, 3, 0.022),
    baseMat,
  );
  base.position.y = baseH / 2;
  base.castShadow = true;
  base.receiveShadow = true;
  root.add(base);

  const rim = new THREE.Mesh(
    new RoundedBoxGeometry(baseW + 0.012, 0.005, baseD + 0.012, 2, 0.008),
    rimMat,
  );
  rim.position.y = 0.0025;
  root.add(rim);

  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(baseW * 1.08, baseD * 1.1),
    new THREE.MeshBasicMaterial({
      color: 0x0f172a,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  root.add(shadow);

  const hitBox = new THREE.Mesh(
    new THREE.BoxGeometry(baseW + 0.05, 0.14, baseD + 0.05),
    new THREE.MeshBasicMaterial({ visible: false }),
  );
  hitBox.position.y = 0.06;
  root.add(hitBox);

  function layoutShell(rows) {
    const nextD = panelDepthForRows(rows);
    if (Math.abs(nextD - baseD) > 1e-4) {
      baseD = nextD;
      base.geometry.dispose();
      base.geometry = new RoundedBoxGeometry(baseW, baseH, baseD, 3, 0.022);
      rim.geometry.dispose();
      rim.geometry = new RoundedBoxGeometry(baseW + 0.012, 0.005, baseD + 0.012, 2, 0.008);
      shadow.geometry.dispose();
      shadow.geometry = new THREE.PlaneGeometry(baseW * 1.08, baseD * 1.1);
      hitBox.geometry.dispose();
      hitBox.geometry = new THREE.BoxGeometry(baseW + 0.05, 0.14, baseD + 0.05);
    }
    for (let i = 0; i < maxSlots; i += 1) {
      const slot = slots[i];
      if (!slot) continue;
      const z = -baseD / 2 + PANEL_PAD_Z + ROW_H * (i + 0.5);
      slot.row.position.z = z;
    }
    hitBox.position.set(0, 0.06, 0);
    applyEdgeAnchor();
  }

  for (let i = 0; i < maxSlots; i += 1) {
    const row = new THREE.Group();
    row.visible = false;

    // Header: label left + value right (one plane, full card width)
    // Canvas & CanvasTexture created once per slot and reused across value updates
    const headerCanvas = makeCanvasForMesh(HEADER_MESH_W, HEADER_MESH_H);
    const headerCtx = headerCanvas.getContext('2d');
    renderHeaderCanvas(headerCanvas, headerCtx, '—', '—', accentHex);
    const headerTex = new THREE.CanvasTexture(headerCanvas);
    headerTex.colorSpace = THREE.SRGBColorSpace;
    headerTex.anisotropy = 4;
    headerTex.needsUpdate = true;

    const headerPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(HEADER_MESH_W, HEADER_MESH_H),
      new THREE.MeshBasicMaterial({
        map: headerTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    headerPlane.rotation.x = -Math.PI / 2;
    // Top of the row card
    headerPlane.position.set(0, baseH + 0.007, -ROW_H * 0.28);
    headerPlane.renderOrder = 2;
    row.add(headerPlane);

    // Discrete action chip (hidden for range rows)
    const actionMeshW = CARD_W - PANEL_PAD_X * 1.2;
    const actionMeshH = ROW_H * 0.72;
    const actionCanvas = makeCanvasForMesh(actionMeshW, actionMeshH, 180);
    const actionCtx = actionCanvas.getContext('2d');
    renderActionGroupCanvas(actionCanvas, actionCtx, [{ label: '—', action: '', active: false }], accentHex);
    const actionTex = new THREE.CanvasTexture(actionCanvas);
    actionTex.colorSpace = THREE.SRGBColorSpace;
    actionTex.anisotropy = 4;
    actionTex.needsUpdate = true;

    const actionPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(actionMeshW, actionMeshH),
      new THREE.MeshBasicMaterial({
        map: actionTex,
        transparent: true,
        depthWrite: false,
      }),
    );
    actionPlane.rotation.x = -Math.PI / 2;
    actionPlane.position.set(0, baseH + 0.008, 0);
    actionPlane.renderOrder = 2;
    actionPlane.visible = false;
    row.add(actionPlane);

    // Track well + rail centered under header
    const well = new THREE.Mesh(
      new RoundedBoxGeometry(TRACK_LEN + 0.018, TRACK_H * 0.5, TRACK_D + 0.012, 1, 0.005),
      trackWellMat.clone(),
    );
    well.position.set(0, baseH + 0.004, ROW_H * 0.18);
    row.add(well);

    const track = new THREE.Mesh(
      new RoundedBoxGeometry(TRACK_LEN, TRACK_H, TRACK_D, 1, 0.006),
      trackMat.clone(),
    );
    track.position.set(0, baseH + TRACK_H / 2 + 0.005, ROW_H * 0.18);
    track.castShadow = true;
    row.add(track);

    const fill = new THREE.Mesh(
      new RoundedBoxGeometry(TRACK_LEN, TRACK_H * 0.75, TRACK_D * 0.7, 1, 0.004),
      fillMat.clone(),
    );
    fill.position.copy(track.position);
    fill.scale.x = 0.02;
    row.add(fill);

    const capGeo = new THREE.SphereGeometry(TRACK_D * 0.42, 10, 8);
    const capL = new THREE.Mesh(capGeo, trackMat.clone());
    const capR = new THREE.Mesh(capGeo, trackMat.clone());
    capL.position.set(trackX0, track.position.y, track.position.z);
    capR.position.set(trackX0 + TRACK_LEN, track.position.y, track.position.z);
    row.add(capL, capR);

    // Division ticks under the track
    const ticks = new THREE.Group();
    for (let t = 0; t <= 4; t += 1) {
      const u = t / 4;
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.0028, 0.0045, t === 2 ? 0.016 : 0.011),
        tickMat.clone(),
      );
      tick.position.set(
        trackX0 + TRACK_LEN * u,
        baseH + 0.0025,
        track.position.z + TRACK_D * 0.7,
      );
      ticks.add(tick);
    }
    const zeroTick = new THREE.Mesh(
      new THREE.BoxGeometry(0.0032, 0.0055, 0.018),
      zeroTickMat.clone(),
    );
    zeroTick.position.set(0, baseH + 0.003, track.position.z - TRACK_D * 0.65);
    zeroTick.visible = false;
    ticks.add(zeroTick);
    row.add(ticks);

    const thumb = new THREE.Mesh(
      new THREE.SphereGeometry(THUMB_R, 18, 14),
      thumbMat.clone(),
    );
    const thumbRing = new THREE.Mesh(
      new THREE.TorusGeometry(THUMB_R * 0.9, 0.0028, 8, 18),
      new THREE.MeshStandardMaterial({
        color: accentNum,
        metalness: 0.4,
        roughness: 0.28,
        emissive: accentNum,
        emissiveIntensity: 0.28,
      }),
    );
    thumbRing.rotation.x = Math.PI / 2;
    thumb.add(thumbRing);
    thumb.position.set(trackX0, baseH + TRACK_H + THUMB_R * 0.4, track.position.z);
    thumb.castShadow = true;
    row.add(thumb);

    // Grab volume: tall in Y for noisy AR rays, but Z span stays within one row
    // so adjacent tracks do not overlap. Row choice itself uses plane projection
    // in pickFromRay (not “first tall box along the ray”), so a front row cannot
    // steal aim from a rear label when the camera looks down at the card.
    const grab = new THREE.Mesh(
      new THREE.BoxGeometry(TRACK_LEN + 0.08, 0.12, ROW_H * 0.88),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    grab.position.set(0, baseH + 0.05, track.position.z);
    grab.userData.slotIndex = i;
    grab.userData.deskSliderGrab = true;
    row.add(grab);

    // Plus/Minus discrete buttons for fine step adjustment (round circular buttons)
    const btnMinus = new THREE.Group();
    const minusBody = new THREE.Mesh(
      new THREE.CylinderGeometry(BTN_R, BTN_R * 1.05, BTN_H, 24),
      btnMat.clone(),
    );
    minusBody.position.y = baseH + BTN_H / 2 + 0.003;
    minusBody.castShadow = true;
    btnMinus.add(minusBody);

    const minusFace = new THREE.Mesh(
      new THREE.PlaneGeometry(BTN_PLANE_SIZE, BTN_PLANE_SIZE),
      minusFaceMat,
    );
    minusFace.rotation.x = -Math.PI / 2;
    minusFace.position.y = baseH + BTN_H + 0.0035;
    minusFace.renderOrder = 3;
    btnMinus.add(minusFace);

    btnMinus.position.set(-0.236, 0, track.position.z);
    btnMinus.visible = false;
    row.add(btnMinus);

    const btnPlus = new THREE.Group();
    const plusBody = new THREE.Mesh(
      new THREE.CylinderGeometry(BTN_R, BTN_R * 1.05, BTN_H, 24),
      btnMat.clone(),
    );
    plusBody.position.y = baseH + BTN_H / 2 + 0.003;
    plusBody.castShadow = true;
    btnPlus.add(plusBody);

    const plusFace = new THREE.Mesh(
      new THREE.PlaneGeometry(BTN_PLANE_SIZE, BTN_PLANE_SIZE),
      plusFaceMat,
    );
    plusFace.rotation.x = -Math.PI / 2;
    plusFace.position.y = baseH + BTN_H + 0.0035;
    plusFace.renderOrder = 3;
    btnPlus.add(plusFace);

    btnPlus.position.set(0.236, 0, track.position.z);
    btnPlus.visible = false;
    row.add(btnPlus);

    root.add(row);

    slots.push({
      row,
      headerPlane,
      headerCanvas,
      headerCtx,
      headerTex,
      actionPlane,
      actionCanvas,
      actionCtx,
      actionTex,
      track,
      fill,
      thumb,
      grab,
      well,
      ticks,
      capL,
      capR,
      zeroTick,
      btnMinus,
      btnPlus,
      trackX0,
      trackLen: TRACK_LEN,
      trackZ: track.position.z,
      actionMeshW,
      actionMeshH,
      spec: null,
      value: 0,
      _headerKey: '',
      _isAction: false,
      _hasButtons: false,
    });
  }

  layoutShell(1);

  root.userData.interactive = true;
  root.userData.type = 'desk_param_panel';
  root.userData.role = 'desk_param_panel';
  root.userData.stationId = stationId;
  root.userData.present = false;
  root.visible = false;

  root.traverse((m) => {
    if (m.isMesh) m.raycast = () => {};
  });

  function setPresent(on) {
    const present = !!on;
    root.userData.present = present;
    root.visible = present;
    root.traverse((m) => {
      if (!m.isMesh) return;
      m.raycast = present ? THREE.Mesh.prototype.raycast : () => {};
    });
  }

  function setRangePartsVisible(slot, on) {
    const vis = !!on;
    slot.headerPlane.visible = vis;
    slot.well.visible = vis;
    slot.track.visible = vis;
    slot.fill.visible = vis;
    slot.thumb.visible = vis;
    slot.ticks.visible = vis;
    slot.capL.visible = vis;
    slot.capR.visible = vis;
    if (slot.btnMinus) slot.btnMinus.visible = vis && !!slot._hasButtons;
    if (slot.btnPlus) slot.btnPlus.visible = vis && !!slot._hasButtons;
    // Bipolar zero tick is re-enabled by applySlotVisual for range rows.
    if (slot.zeroTick && !vis) slot.zeroTick.visible = false;
  }

  function applySlotVisual(slot) {
    const { spec, value } = slot;
    if (!spec) return;

    const isActionGroup = spec.kind === 'actionGroup';
    const isAction = spec.kind === 'action' || isActionGroup;
    slot._isAction = isAction;
    if (slot.actionPlane) slot.actionPlane.visible = isAction;
    setRangePartsVisible(slot, !isAction);

    if (isAction) {
      const buttons = isActionGroup
        ? (spec.buttons || [])
        : [{ label: spec.label || '操作', action: spec.action, payload: spec.payload || spec.meta, active: spec.active }];
      const headerKey = `action|` + buttons.map((b) => `${b.label}:${b.action}:${!!b.active}`).join(';');
      if (slot._headerKey !== headerKey) {
        slot._headerKey = headerKey;
        renderActionGroupCanvas(slot.actionCanvas, slot.actionCtx, buttons, accentHex);
        slot.actionTex.needsUpdate = true;
      }
      return;
    }

    const hasButtons = !!(spec.hasButtons ?? (spec.buttonDelta != null));
    slot._hasButtons = hasButtons;
    if (slot.btnMinus) slot.btnMinus.visible = hasButtons;
    if (slot.btnPlus) slot.btnPlus.visible = hasButtons;

    const curTrackLen = hasButtons ? 0.36 : TRACK_LEN;
    const curTrackX0 = -curTrackLen / 2;
    slot.trackLen = curTrackLen;
    slot.trackX0 = curTrackX0;

    const trackScaleX = curTrackLen / TRACK_LEN;
    slot.track.scale.x = trackScaleX;
    slot.well.scale.x = trackScaleX;
    slot.capL.position.x = curTrackX0;
    slot.capR.position.x = curTrackX0 + curTrackLen;

    for (let t = 0; t <= 4; t += 1) {
      const tick = slot.ticks.children[t];
      if (tick) {
        tick.position.x = curTrackX0 + curTrackLen * (t / 4);
      }
    }

    const min = Number(spec.min);
    const max = Number(spec.max);
    const range = Math.max(1e-9, max - min);
    const u = Math.max(0, Math.min(1, (Number(value) - min) / range));
    const bipolar = min < 0 && max > 0;
    const zu = bipolar ? (0 - min) / range : 0;

    if (bipolar) {
      const left = Math.min(u, zu);
      const right = Math.max(u, zu);
      const span = Math.max(0.02, right - left);
      slot.fill.scale.x = span * trackScaleX;
      slot.fill.position.x = curTrackX0 + curTrackLen * (left + right) * 0.5;
    } else {
      slot.fill.scale.x = Math.max(0.02, u * trackScaleX);
      slot.fill.position.x = curTrackX0 + (curTrackLen * u) / 2;
    }
    slot.thumb.position.x = curTrackX0 + curTrackLen * u;

    if (slot.zeroTick) {
      slot.zeroTick.visible = bipolar;
      if (bipolar) slot.zeroTick.position.x = curTrackX0 + curTrackLen * zu;
    }

    const digits = spec.digits ?? 2;
    const unit = spec.unit || '';
    const labelText = spec.label || spec.key || '';
    const valueText = formatValue(value, digits, unit);
    const headerKey = `${labelText}|${valueText}`;
    if (slot._headerKey !== headerKey) {
      slot._headerKey = headerKey;
      renderHeaderCanvas(slot.headerCanvas, slot.headerCtx, labelText, valueText, accentHex);
      slot.headerTex.needsUpdate = true;
    }
  }

  /**
   * @param {Array<object>} specs
   * @param {string} [_title] ignored — desk panel has no title band
   */
  function setSpecs(specs = [], _title = '参数调节') {
    const list = Array.isArray(specs) ? specs.slice(0, maxSlots) : [];
    const sig = list.map((s) => {
      if (s.kind === 'actionGroup') {
        const btns = (s.buttons || []).map((b) => `${b.label}:${b.action}:${!!b.active}`).join(',');
        return `group|${s.key}|${btns}`;
      }
      return `${s.kind || 'range'}|${s.action}|${s.setAction}|${s.key}|${s.target}|${s.label}|${s.min}|${s.max}|${s.step}|${s.buttonDelta}|${s.hasButtons}|${s.active}`;
    }).join(';');
    const structureChanged = sig !== specsSig;
    specsSig = sig;
    activeCount = list.length;
    layoutShell(Math.max(1, activeCount));

    for (let i = 0; i < maxSlots; i += 1) {
      const slot = slots[i];
      const spec = list[i] || null;
      slot.spec = spec;
      if (!spec) {
        slot.row.visible = false;
        continue;
      }
      slot.row.visible = true;
      if (structureChanged || !Number.isFinite(slot.value)) {
        if (spec.kind === 'action' || spec.kind === 'actionGroup') {
          slot.value = 0;
        } else {
          slot.value = Number.isFinite(spec.value) ? Number(spec.value) : Number(spec.min) || 0;
        }
        slot._headerKey = '';
      }
      applySlotVisual(slot);
    }
  }

  function syncValues(getValue) {
    if (typeof getValue !== 'function') return;
    for (let i = 0; i < activeCount; i += 1) {
      const slot = slots[i];
      if (!slot.spec || slot.spec.kind === 'action' || slot.spec.kind === 'actionGroup') continue;
      const next = getValue(slot.spec, i);
      if (!Number.isFinite(next)) continue;
      if (Math.abs(next - slot.value) < 1e-6) continue;
      slot.value = next;
      applySlotVisual(slot);
    }
  }

  function valueAtLocalX(slot, localX) {
    const min = Number(slot.spec.min);
    const max = Number(slot.spec.max);
    const u = Math.max(0, Math.min(1, (localX - slot.trackX0) / slot.trackLen));
    let val = min + u * (max - min);
    const step = slot.spec?.step;
    if (Number.isFinite(step) && step > 0) {
      val = Math.round((val - min) / step) * step + min;
      val = Math.max(min, Math.min(max, val));
    }
    return Math.round(val * 1e6) / 1e6;
  }

  /** Local Y of the track top — horizontal pick plane for row/value resolution. */
  const PICK_PLANE_Y = baseH + TRACK_H / 2 + 0.005;

  const _local = new THREE.Vector3();
  const _planePoint = new THREE.Vector3();
  const _planeNormal = new THREE.Vector3();
  const _worldHit = new THREE.Vector3();
  const _tmp = new THREE.Vector3();

  /**
   * Project the ray onto the card’s local horizontal plane.
   * Tall front grab boxes used to win by ray distance when the camera looks
   * down, so aiming “半径 R” could resolve as “磁感应 B” (the next nearer row).
   * Plane projection keeps row choice tied to where the crosshair lands on the
   * card surface, not which vertical volume is entered first.
   */
  function projectRayToPickPlane(raycaster) {
    root.updateWorldMatrix(true, false);
    _planePoint.set(0, PICK_PLANE_Y, 0);
    root.localToWorld(_planePoint);
    _planeNormal.set(0, 1, 0).transformDirection(root.matrixWorld).normalize();

    const { origin, direction } = raycaster.ray;
    const denom = direction.dot(_planeNormal);
    if (Math.abs(denom) < 1e-8) return null;
    const t = _tmp.copy(_planePoint).sub(origin).dot(_planeNormal) / denom;
    // Slightly behind origin is OK (near-plane / hand-ray noise).
    if (t < -0.08) return null;
    _worldHit.copy(origin).addScaledVector(direction, t);
    root.worldToLocal(_local.copy(_worldHit));
    return _local;
  }

  function slotAtLocal(local) {
    if (!local) return null;
    // Outside the card footprint — ignore (ray only clipped a tall side volume).
    if (Math.abs(local.x) > baseW * 0.55) return null;
    if (Math.abs(local.z) > baseD * 0.55 + ROW_H * 0.15) return null;

    let best = null;
    let bestDz = Infinity;
    for (let i = 0; i < activeCount; i += 1) {
      const s = slots[i];
      if (!s.spec) continue;
      // Row mid between header band and track (matches visual “this row”).
      const rowPickZ = s.row.position.z - ROW_H * 0.05;
      const dz = Math.abs(local.z - rowPickZ);
      if (dz < bestDz) {
        bestDz = dz;
        best = s;
      }
    }
    // Must land inside the row band; half-row would be the midpoint between rows.
    if (!best || bestDz > ROW_H * 0.55) return null;
    return best;
  }

  function pickFromRay(raycaster, lockedKey = null) {
    if (!root.userData.present || !root.visible || activeCount <= 0) return null;
    let local = projectRayToPickPlane(raycaster);
    if (!local) {
      const hits = raycaster.intersectObject(root, true);
      if (hits.length) {
        root.worldToLocal(_local.copy(hits[0].point));
        local = _local;
      }
    }
    if (!local) return null;

    let slot = null;
    if (lockedKey) {
      slot = slots.find((s) => s.spec && (s.spec.key === lockedKey || s.spec.axis === lockedKey)) || null;
    }
    if (!slot) {
      slot = slotAtLocal(local);
    }
    if (!slot) return null;

    const spec = slot.spec;
    if (spec.kind === 'action' || spec.kind === 'actionGroup') {
      const buttons = spec.kind === 'actionGroup'
        ? (spec.buttons || [])
        : [{ label: spec.label, action: spec.action, payload: spec.payload || spec.meta, meta: spec.meta || spec.payload }];
      const count = Math.max(1, buttons.length);
      const actionMeshW = slot.actionMeshW || (CARD_W - PANEL_PAD_X * 1.2);
      const normX = Math.max(0, Math.min(1, (local.x + actionMeshW / 2) / actionMeshW));
      const btnIdx = Math.max(0, Math.min(count - 1, Math.floor(normX * count)));
      const btn = buttons[btnIdx] || {};

      return {
        id: `desk-${stationId}-${btn.action || spec.key || 'action'}-${btnIdx}`,
        role: 'desk_action',
        action: btn.action,
        payload: btn.payload || btn.meta || {},
        meta: btn.meta || btn.payload || {},
        channel: btn.payload?.channel || btn.channel,
        key: btn.key ?? spec.key ?? null,
        kind: 'action',
        desk: true,
      };
    }

    // Range slider row: If not actively dragging, check for minus or plus button click!
    if (!lockedKey && slot._hasButtons) {
      const BTN_CLICK_THRESH = 0.195;
      if (local.x < -BTN_CLICK_THRESH && local.x >= -baseW * 0.55) {
        const delta = Number.isFinite(spec.buttonDelta) ? spec.buttonDelta : 0.01;
        if (slot.btnMinus) pulseButtonMesh(slot.btnMinus);
        return {
          id: `desk-${stationId}-${spec.key || 'slider'}-minus`,
          role: 'desk_action',
          action: spec.setAction || 'hall-set',
          payload: {
            key: spec.key,
            delta: -delta,
          },
          meta: {
            key: spec.key,
            delta: -delta,
          },
          kind: 'action',
          desk: true,
        };
      }
      if (local.x > BTN_CLICK_THRESH && local.x <= baseW * 0.55) {
        const delta = Number.isFinite(spec.buttonDelta) ? spec.buttonDelta : 0.01;
        if (slot.btnPlus) pulseButtonMesh(slot.btnPlus);
        return {
          id: `desk-${stationId}-${spec.key || 'slider'}-plus`,
          role: 'desk_action',
          action: spec.setAction || 'hall-set',
          payload: {
            key: spec.key,
            delta: delta,
          },
          meta: {
            key: spec.key,
            delta: delta,
          },
          kind: 'action',
          desk: true,
        };
      }
    }

    const value = valueAtLocalX(slot, local.x);
    const action = spec.action || 'param-slider';
    return {
      id: `desk-${stationId}-${spec.key || spec.axis || 'v'}`,
      role: action,
      action,
      setAction: spec.setAction || null,
      key: spec.key ?? null,
      axis: spec.axis ?? null,
      target: spec.target ?? null,
      step: spec.step ?? null,
      min: Number(spec.min),
      max: Number(spec.max),
      value,
      trackX: 0,
      trackW: 1000,
      px: ((value - Number(spec.min)) / Math.max(1e-9, Number(spec.max) - Number(spec.min))) * 1000,
      dragAxis: 'x',
      desk: true,
    };
  }

  /**
   * Pin one face of the panel to a world-space desk edge.
   * As row count changes depth, the panel stays flush on that edge.
   * @param {{ worldX: number, worldY: number, worldZ: number, face: '+z'|'-z'|'+x'|'-x', inset?: number }} anchor
   */
  function setEdgeAnchor(anchor) {
    edgeAnchor = anchor && Number.isFinite(anchor.worldX) && Number.isFinite(anchor.worldZ)
      ? {
        worldX: Number(anchor.worldX),
        worldY: Number.isFinite(anchor.worldY) ? Number(anchor.worldY) : 0,
        worldZ: Number(anchor.worldZ),
        face: anchor.face || '+z',
        inset: Number.isFinite(anchor.inset) ? Number(anchor.inset) : EDGE_INSET,
      }
      : null;
    applyEdgeAnchor();
  }

  root.userData.setPresent = setPresent;
  root.userData.setSpecs = setSpecs;
  root.userData.syncValues = syncValues;
  root.userData.pickFromRay = pickFromRay;
  root.userData.getActiveCount = () => activeCount;
  root.userData.setEdgeAnchor = setEdgeAnchor;
  root.userData.getSlots = () => slots;

  setPresent(false);
  setSpecs([]);

  return root;
}
