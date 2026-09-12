import { formatPhysicsNumber } from '../physicsFormula.js';

/** Render the compact data strip shown below a station's hologram controls. */
export function formatExperimentData(stationId, expId, data) {
  if (!data) return '—';
  if (expId === 'hall_effect') {
    const isSolenoid = data.target !== 'helmholtz';
    const target = isSolenoid ? '长螺线管' : '亥姆霍兹线圈';
    const records = Array.isArray(data.records) ? data.records : [];
    const wiringText = data.wiring?.energized ? `${data.wiring.label}${data.wiring.reversed ? '（反接）' : '（正接）'}` : data.wiring?.status === 'invalid' ? '接线无效/未闭合' : 'Im 输出未接线';
    const rawPos = Number(data.probePos ?? (isSolenoid ? 16 : 0));
    const posVal = isSolenoid
      ? (Math.abs(rawPos) <= 0.5 ? rawPos * 100 : rawPos)
      : (Math.abs(rawPos) > 0.5 ? rawPos / 100 : rawPos);
    const cleanPos = Math.abs(posVal) < 1e-6 ? 0 : posVal;
    const posText = isSolenoid ? `X = ${cleanPos.toFixed(1)} cm` : `X = ${cleanPos.toFixed(3)} m`;
    const rawVh = Number(data.vh || 0);
    const vhV = Math.abs(rawVh) > 0.05 ? rawVh / 1000 : rawVh;
    const rawIs = Number(data.Is || 0);
    const isA = rawIs > 0.05 ? rawIs / 1000 : rawIs;
    const lenM = Number(data.solenoidLength || 0.30);
    const turns = Number(data.turns || 2340);
    const nDensity = Math.round(turns / (lenM > 1 ? lenM / 100 : lenM));
    const solInfo = isSolenoid ? `L = 300 mm　N = ${turns} (n = ${nDensity} 匝/米)　K = 301 V/(A·T)\n` : '';
    const viewMode = data.showCurve ? (data.showFit ? ' · 曲线图[已拟合]' : ' · 曲线散点图') : ' · 记录表';
    return `对象: ${target}\n接线: ${wiringText}\n${solInfo}VH = ${(vhV * 1000).toFixed(2)} mV　${posText}\nIm = ${Number(data.Im || 0).toFixed(2)} A　Is = ${isA.toFixed(3)} A\n记录: ${records.length} 组${viewMode}`;
  }
  if (expId === 'faraday_induction') {
    const fmt = (value, digits = 3) => Number(value || 0).toFixed(digits);
    return `B = ${fmt(data.B, 2)} T · S = ${fmt(data.area)} m² · Φ_B = ${fmt(data.flux)} Wb\n铜棒 x = ${fmt(data.x)} m · 楞次方向: ${data.currentSense || '无'}\n动生 ε_i = ${data.lastMotion ? fmt(data.lastMotion.emf, 4) : '—'} V · 感生 ε_i = ${data.lastInduction ? fmt(data.lastInduction.emf, 4) : '—'} V\n记录: ${Array.isArray(data.records) ? data.records.length : 0} 组`;
  }
  if (expId === 'induced_electric_field') {
    const fmt = (value, digits = 3) => Number(value || 0).toFixed(digits);
    const region = Number(data.probeR || 0) <= Number(data.R || 0) + 1e-6 ? '面内' : '面外';
    return `B = ${fmt(data.B, 2)} T · dB/dt = ${fmt(data.dBdt, 2)} T/s\nR = ${fmt(data.R, 2)} m · r = ${fmt(data.probeR, 2)} m（${region}）\n|E| = ${fmt(data.magnitudeE, 3)} V/m · ${data.senseLabel || '—'}\n${data.paused ? '振荡已暂停' : 'B = B₀ sin(ωt) 振荡中'}`;
  }
  if (expId === 'electric_field') {
    const qCount = Array.isArray(data.charges) ? data.charges.length : 0;
    const probe = data.probe || {};
    const q0 = Number(probe.q0 ?? 1);
    const eVal = Number.isFinite(data.magnitudeE) ? formatPhysicsNumber(data.magnitudeE, { digits: 2, unit: 'N/C' }) : '—';
    const fVal = Number.isFinite(data.magnitudeF) ? formatPhysicsNumber(data.magnitudeF, { digits: 2, unit: 'N' }) : '—';
    const vVal = Number.isFinite(data.potential) ? `${Number(data.potential).toFixed(1)} V` : '—';
    return `场源电荷: ${qCount} 个 · 探针 q₀=${q0 > 0 ? '+' : ''}${q0.toFixed(1)} μC\n|E| = ${eVal} · |F| = ${fVal}\n探针电势 φ = ${vVal}\n<span class="ok">高斯包围电荷 Q_enc = ${Number(data.qEnclosed || 0).toFixed(2)} μC</span>`;
  }
  if (expId === 'gauss_theorem') {
    const qEnc = Number.isFinite(data.qEnclosed) ? `${Number(data.qEnclosed).toFixed(2)} μC` : '—';
    const flux = Number.isFinite(data.flux) ? formatPhysicsNumber(data.flux, { digits: 2, unit: 'N·m²/C' }) : '—';
    const r = Number(data.radius || 2.4).toFixed(2);
    const shape = data.gaussShape === 'cylinder' ? '柱面' : data.gaussShape === 'box' ? '正方体' : '球面';
    return `高斯面半径 R = ${r} m · 形状: ${shape}\n包围电荷 Q_enc = ${qEnc}\n电通量 Φ = ${flux}\n<span class="ok">高斯定理 Φ = Q_enc / ε₀ 验证中</span>`;
  }
  if (expId === 'hall_carrier_demo') return `I = ${Number(data.I || 0).toFixed(2)} A　B = ${Number(data.B || 0).toFixed(2)} T\nn = ${Number(data.n || 0).toFixed(2)} m⁻³　d = ${Number(data.d || 0).toFixed(2)} m\nU_H = ${Number(data.vh || 0).toFixed(3)} V　${data.nType ? 'n 型' : 'p 型'}\n${data.paused ? '动画已暂停' : '载流子运动中'}`;
  if (expId === 'calorimetry') {
    const teq = data.cupHot && data.cupCold ? (data.mHot * data.tHot + data.mCold * data.tCold) / (data.mHot + data.mCold) : null;
    const motion = data.pouring ? `倒入${data.pouring === 'hot' ? '热水' : '冷水'} · ${Math.round((data.pourProgress || 0) * 100)}%` : data.mixProgress > 0 && data.mixProgress < 1 ? `混合中 · ${Math.round(data.mixProgress * 100)}%` : '静置';
    return `热水 ${Number(data.tHot || 0).toFixed(0)} °C / ${Number(data.mHot || 0).toFixed(0)} g\n冷水 ${Number(data.tCold || 0).toFixed(0)} °C / ${Number(data.mCold || 0).toFixed(0)} g\n过程：${motion} · 终温 ${data.tCurrent == null ? '—' : Number(data.tCurrent).toFixed(1) + ' °C'}\n<span class="ok">理论平衡 = ${teq == null ? '—' : teq.toFixed(1) + ' °C'} · 记录 ${data.records?.length || 0} 组</span>`;
  }
  if (expId === 'convection') {
    const deltaT = Math.max(0, Number(data.tPlate || 0) - Number(data.tAir || 0));
    const L = Math.sqrt(Number(data.area || 0.12));
    const ra = 1e8 * deltaT * L ** 3;
    const nu = 0.15 * Math.pow(Math.max(ra, 1), 1 / 3);
    const h = deltaT < 1 ? 2 : Math.max(3, nu * 0.028 / L);
    return `热板 ${Number(data.tPlate || 0).toFixed(0)} K · 环境 ${Number(data.tAir || 0).toFixed(0)} K\nRa = ${ra.toFixed(0)} · Nu = ${nu.toFixed(1)}\n<span class="ok">h = ${h.toFixed(1)} W/(m²·K) · 记录 ${data.records?.length || 0} 组</span>`;
  }
  if (expId === 'heat-conduction') return `热端 ${Number(data.tHot || 0).toFixed(0)} K · 冷端 ${Number(data.tCold || 0).toFixed(0)} K\nk = ${Number(data.conductivity || 0).toFixed(2)} · 中点 ${Number(data.temps?.[24] || 0).toFixed(1)} K\n<span class="ok">记录 ${data.records?.length || 0} 组</span>`;
  if (expId === 'ideal-gas') {
    const p = (Number(data.n || 0) * 8.314 * Number(data.temperature || 0) / Math.max(0.01, Number(data.volume || 1)) / 1000) * 12;
    return `T = ${Number(data.temperature || 0).toFixed(0)} K · V = ${Number(data.volume || 0).toFixed(2)} ×\nP = ${p.toFixed(1)} kPa · n = ${Number(data.n || 0).toFixed(3)} mol\n<span class="ok">碰撞率 ${data.collisionsPerSec || 0} Hz · 记录 ${data.records?.length || 0} 组</span>`;
  }
  if (expId === 'thermal-expansion') {
    const alpha = ({ aluminum: 23.1, copper: 16.5, steel: 12, invar: 1.2 }[data.material] || 23.1) * 1e-6;
    const dL = alpha * Number(data.length0 || 1) * (Number(data.temperature || 20) - 20);
    return `材料 ${data.material || 'aluminum'} · T = ${Number(data.temperature || 0).toFixed(0)} °C\nΔL = ${(dL * 1000).toFixed(3)} mm · L = ${((Number(data.length0 || 1) + dL) * 1000).toFixed(2)} mm\n<span class="ok">α = ${(alpha * 1e6).toFixed(1)} ×10⁻⁶/K · 记录 ${data.records?.length || 0} 组</span>`;
  }
  if (data && typeof data === 'object') {
    const safe = {};
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('_')) continue;
      if (ArrayBuffer.isView(v)) continue;
      if (typeof v === 'object' && v !== null && Object.keys(v).length > 20) continue;
      safe[k] = v;
    }
    return JSON.stringify(safe);
  }
  return String(data);
}
