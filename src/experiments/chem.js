/**
 * Chemistry station handlers — same interaction contract as thermo:
 *   interact(role) / beginManipulation / endManipulation / holdInteract / onUiAction / onKey
 */

import { getReagent, getElement, tryResolveLocalFormula, formatSubscriptFormula } from '../chem/reagentCatalog.js';
import {
  showReagentSearchDock,
  hideReagentSearchDock,
  setReagentSearchHandler,
  setReagentSearchValue,
  focusSearchInput,
  toggleSpeechRecognition,
} from '../chem/reagentSearchDock.js';
import * as THREE from 'three';

const _invMat = new THREE.Matrix4();
const _localRay = new THREE.Ray();
const _deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _vertPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.15);
const _hitPoint = new THREE.Vector3();
const _sdfCache = new Map();
let pourReactionRequestId = 0;

export const station = {
  id: 'chem',
  title: '化学实验台',
  accent: '#94a3b8',
  experiments: [
    {
      id: 'reagent-mix',
      name: '试剂混合与结构',
      goal: '选元素→选试剂→装入烧杯→倾倒混合→查看成分 3D 结构',
      theory: '试剂可倾倒混合；点击右侧成分可在桌上查看分子结构',
      steps: [
        { id: 'pick_cup', text: '点击烧杯打开元素周期表', hint: '瞄准烧杯点击打开' },
        { id: 'fill', text: '选择元素与常见试剂装入烧杯', hint: '在前方悬浮屏中点选' },
        { id: 'pour', text: '拖动烧杯向另一杯倾倒混合', hint: '按住拖到另一杯松开' },
        { id: 'inspect', text: '在右侧面板查看成分并显示 3D 结构', hint: '点击成分行' },
      ],
    },
  ],
};

function snapshotCups(eq) {
  const s = eq?.getCupState?.();
  if (!s) {
    return {
      cupA: { reagents: [], fill: 0, color: 0x94a3b8, formula: '' },
      cupB: { reagents: [], fill: 0, color: 0x94a3b8, formula: '' },
    };
  }
  return { cupA: s.A, cupB: s.B };
}

function buildComponents(data) {
  const map = new Map();
  const viewCup = data.viewCup || 'all';
  const targetCups = viewCup === 'A' ? [data.cupA] : viewCup === 'B' ? [data.cupB] : [data.cupA, data.cupB];

  for (const cup of targetCups) {
    for (const r of cup?.reagents || []) {
      if (!r || (!r.formula && !r.id && !r.name_zh)) continue;
      const key = String(r.formula || r.id || r.name_zh || '').trim().toUpperCase();
      if (!map.has(key)) {
        map.set(key, { ...r, percent: r.percent || 100 });
      }
    }
  }
  const list = [...map.values()];
  if (!list.length) return [];
  const total = list.reduce((s, c) => s + (c.percent || 1), 0) || 1;
  return list.map((c, i) => ({
    id: c.id || `comp-${i}-${c.formula}`,
    formula: c.formula || c.name_zh,
    name_zh: c.name_zh || c.formula,
    color: c.color || 0x38bdf8,
    query: c.query || c.formula,
    percent: Math.round(((c.percent || 1) / total) * 1000) / 10,
  }));
}

function roleToKind(role) {
  if (role === 'chem_cup_a' || role === 'chem_cup_a_label') return 'A';
  if (role === 'chem_cup_b' || role === 'chem_cup_b_label') return 'B';
  return null;
}

export function createHandlers(ctx) {
  const { state, equipment, toast, pushHud, setStep, currentStep } = ctx;

  function eq() {
    return equipment.chem;
  }

  function syncFromRig() {
    const cups = snapshotCups(eq());
    state.data.cupA = cups.cupA;
    state.data.cupB = cups.cupB;
    state.data.components = buildComponents(state.data);
    eq()?.rig?.setDimmed?.(!!state.data.pickerOpen);
    pushHud();
  }

  /** Keep AI progress visible in both the left status holo and picker button. */
  function setAiSearchState(message, tone = 'info', busy = state.data?.searchBusy) {
    if (!state.data) return;
    const text = String(message || '');
    state.data.searchStatus = text;
    state.data.searchStatusTone = tone;
    if (busy !== undefined) state.data.searchBusy = !!busy;
    if (text) state.data.hint = text;
    pushHud();
  }

  function openPickerForCup(kind) {
    const k = kind === 'B' ? 'B' : 'A';
    state.data.activeCup = k;
    state.data.pickerOpen = true;
    state.data.pickerPhase = 'elements';
    state.data.pickedElement = null;
    state.data.searchFocused = false;
    state.data.condMenuOpen = false;
    if (!state.data.searchBusy) {
      state.data.searchStatus = '';
      state.data.searchStatusTone = 'info';
    }
    setStep('pick_cup');
    toast(`烧杯 ${k} · 选择元素或主屏下方 AI 检索`);
    eq()?.rig?.setDimmed?.(true);
    pushHud();
    return true;
  }

  function closePicker() {
    state.data.pickerOpen = false;
    state.data.searchFocused = false;
    state.data.condMenuOpen = false;
    hideReagentSearchDock();
    eq()?.rig?.setDimmed?.(false);
    pushHud();
    return true;
  }

  /**
   * AI 试剂检索：直接调 DeepSeek `/api/resolve-molecule`（或 A+B 反应判定）。
   * 装杯只依赖 AI 返回的成分；PubChem 3D 是后续可选步骤，失败不阻断 AI。
   */
  async function runAiReagentQuery(query, condition = '') {
    const cup = state.data.activeCup === 'B' ? 'B' : 'A';
    const raw = String(query || '').trim();
    if (!raw) {
      setAiSearchState('请输入化学式、名称或 SMILES', 'error', false);
      toast('请输入化学式或说明');
      return false;
    }
    if (state.data.searchBusy) return false;

    state.data.searchFocused = false;
    hideReagentSearchDock();

    // Try zero-latency local resolution first for determined single formulas (e.g. h2o, NaCl, C8H18)
    const localMatch = tryResolveLocalFormula(raw);
    if (localMatch && !condition) {
      const formula = localMatch.formula;
      const nameZh = localMatch.name_zh;
      const reagent = {
        id: `local-${Date.now().toString(36)}`,
        formula: String(formula),
        name_zh: String(nameZh),
        color: colorForFormula(String(formula)),
        query: String(formula),
        element: String(formula).replace(/[^A-Za-z].*$/, '') || 'C',
        local: true,
      };

      eq()?.assignReagent?.(cup, reagent);
      syncFromRig();

      const compItem = state.data.components?.find(
        (c) => String(c.formula || c.id || '').toUpperCase() === String(reagent.formula).toUpperCase()
      ) || state.data.components?.[0];

      if (compItem) {
        state.data.selectedComponentId = compItem.id;
        void loadAndShowMolecule(eq(), compItem, toast);
      }

      state.data.hint = `已装入 ${formatSubscriptFormula(reagent.formula)} · 可倾倒或点右侧成分看 3D`;
      state.data.searchStatus = `已识别：${formatSubscriptFormula(reagent.formula)}`;
      state.data.searchStatusTone = 'ok';
      state.data.searchBusy = false;
      state.data.pickerOpen = false;
      hideReagentSearchDock();
      eq()?.rig?.setDimmed?.(false);
      setStep('pour');
      pushHud();

      toast(`${formatSubscriptFormula(reagent.formula)} → 烧杯 ${cup}`);
      setReagentSearchValue('');
      state.data.searchQuery = '';
      return true;
    }

    setAiSearchState('AI 正在解析…', 'info', true);
    toast('AI 解析中…');
    eq()?.showLoadingMolecule?.(query);
    try {
      const product = await resolveAiProduct(query, condition, (msg) => {
        setAiSearchState(String(msg || 'AI 正在解析…'), 'info', true);
      });

      const comps = Array.isArray(product?.components) ? product.components : [];
      if (!comps.length) {
        throw new Error(product?.reason || `无法解析「${query}」的化学成分`);
      }

      const primary = comps[0];
      const formula = primary?.formula || primary?.name_en || product?.product_zh || query;
      const nameZh = primary?.name_zh || product?.product_zh || formula;
      const queryKey = primary?.smiles
        || primary?.formula
        || primary?.name_en
        || primary?.name_zh
        || formula
        || query;

      const reagent = {
        id: `ai-${Date.now().toString(36)}`,
        formula: String(formula),
        name_zh: String(nameZh),
        color: colorForFormula(String(formula)),
        query: String(queryKey),
        element: String(formula).replace(/[^A-Za-z].*$/, '') || 'C',
        ai: true,
      };

      eq()?.assignReagent?.(cup, reagent);

      const mapped = comps.map((c, i) => ({
        id: c.id || `comp-${i}-${String(c.formula || c.name_zh || i)}`,
        formula: c.formula || c.name_zh || `成分${i + 1}`,
        name_zh: c.name_zh || c.formula || '',
        color: colorForFormula(String(c.formula || c.name_zh || '')),
        query: c.smiles || c.formula || c.name_en || c.name_zh || '',
        percent: c.percent,
      }));

      syncFromRig();
      if (mapped.length > 1) {
        state.data.components = mapped;
      }
      
      mapped.forEach((c) => {
        void fetchSdfForComp(c);
      });
      
      state.data.hint = `已装入 ${reagent.formula}（AI）· 可倾倒或点右侧成分看 3D`;
      state.data.searchStatus = `解析完成：${reagent.formula}`;
      state.data.searchStatusTone = 'ok';
      state.data.searchBusy = false;
      state.data.pickerOpen = false;
      hideReagentSearchDock();
      setStep('pour');
      pushHud();

      // 3D 结构可选：失败只 toast，不回滚装杯
      const showComp = mapped[0];
      if (showComp) {
        state.data.selectedComponentId = showComp.id;
        void loadAndShowMolecule(eq(), showComp, toast);
      }

      toast(`${reagent.formula} → 烧杯 ${cup}`);
      setReagentSearchValue('');
      state.data.searchQuery = '';
      return true;
    } catch (err) {
      console.warn('[chem] AI query failed', err);
      const msg = err?.message || 'AI 解析失败';
      setAiSearchState(`AI 解析失败：${msg}`, 'error', false);
      toast(msg);
      return false;
    }
  }

  /**
   * 调用 DeepSeek：单物质 resolve-molecule；A+B 走 resolve-reaction。
   */
  async function resolveAiProduct(query, condition, onStatus) {
    const raw = String(query || '').trim();
    if (!raw) throw new Error('请输入内容');

    const [{ parseAddExpression, expandMixtureComponents }, { resolveWithDeepSeek }, reactionMod] = await Promise.all([
      import('../../../chem/pubchem.js'),
      import('../../../chem/deepseek.js'),
      import('../../../chem/reaction.js'),
    ]);

    const parts = parseAddExpression(raw);
    if (parts && parts.length >= 2) {
      onStatus?.(`AI 正在判定：${parts.map((p) => p.name).join(' + ')}`);
      const reaction = await reactionMod.resolveReaction(parts, condition || '');
      return {
        ...reaction,
        components: expandMixtureComponents(reaction.components || []),
      };
    }

    onStatus?.(`AI 正在拆解「${raw}」…`);
    const ai = await resolveWithDeepSeek(raw);
    const components = expandMixtureComponents(ai.components || []);
    if (!components.length) {
      throw new Error(ai.reason || `无法解析「${raw}」的化学成分`);
    }
    return {
      kind: components.length <= 1 ? 'pure' : (ai.kind || 'mixture'),
      product_zh: ai.product_zh || raw,
      product_en: ai.product_en || '',
      note: ai.note,
      reason: ai.reason,
      model: ai.model,
      components,
    };
  }

  // Wire dock once per handler instance
  setReagentSearchHandler((query, condition) => runAiReagentQuery(query, condition));

  /**
   * After pour animation finishes: sync cup reagents → right panel components.
   * If a reaction occurred, reagents are already replaced with products in the rig.
   */
  function finishPourSync(to) {
    // Focus right panel on the destination cup that received the mixture/products
    if (to === 'A' || to === 'B') state.data.viewCup = to;
    syncFromRig();

    const dstState = (eq()?.getCupState?.() || {})[to];
    const comps = state.data.components || [];
    if (comps.length) {
      state.data.selectedComponentId = comps[0].id;
      state.data.rightPanelScrollY = 0;
      // Prefetch SDF for all product components so right-panel clicks are instant
      comps.forEach((c) => { void fetchSdfForComp(c); });
      void loadAndShowMolecule(eq(), comps[0], toast);
    }

    if (dstState?.lastReaction?.reacts) {
      const desc = dstState.lastReaction.description || '发生化学反应';
      const productLabel = comps.map((c) => formatSubscriptFormula(c.formula)).join(' · ')
        || formatSubscriptFormula(dstState.formula)
        || '产物';
      state.data.hint = `✨ ${desc} · 右侧已更新为：${productLabel}`;
      toast(`✨ ${desc}`);
    } else {
      state.data.hint = '混合完成 · 在右侧查看成分并显示 3D 结构';
      toast('试剂已倾倒混合');
    }
    setStep('inspect');
    pushHud();

    // The rig handles the curated classroom reactions synchronously. For any
    // other pair, ask the shared proxy after the animation has committed so
    // a network request never blocks pouring or the render loop.
    if (!dstState?.lastReaction?.reacts) {
      void resolveUnmatchedPourReaction(to);
    }
  }

  async function resolveUnmatchedPourReaction(to) {
    const requestId = ++pourReactionRequestId;
    const dst = (eq()?.getCupState?.() || {})[to];
    const reactants = [...new Map(
      (dst?.reagents || [])
        .map((item) => [String(item.formula || item.name_zh || item.id || '').trim(), item])
        .filter(([name]) => name),
    ).values()];
    if (reactants.length < 2) return;

    try {
      const { resolveReaction } = await import('../../../chem/reaction.js');
      const reaction = await resolveReaction(
        reactants.map((item) => ({ name: item.name_zh || item.formula || item.id })),
        state.data.searchCondition || '',
      );
      if (requestId !== pourReactionRequestId) return;
      if (!eq()?.rig?.applyExternalReaction?.(to, reaction)) return;

      state.data.viewCup = to;
      syncFromRig();
      const productState = (eq()?.getCupState?.() || {})[to];
      const products = state.data.components || [];
      const label = products.map((item) => formatSubscriptFormula(item.formula)).join(' · ')
        || formatSubscriptFormula(productState?.formula || '')
        || '产物';
      state.data.selectedComponentId = products[0]?.id || null;
      state.data.hint = `✨ ${reaction.reason || '两种试剂发生化学反应'} · 右侧已更新为：${label}`;
      toast(`✨ ${reaction.reason || '两种试剂发生化学反应'}`);
      if (products[0]) void loadAndShowMolecule(eq(), products[0], toast);
      pushHud();
    } catch (error) {
      // NO_REACTION is a valid chemistry result for ordinary mixtures. It
      // should leave the already-committed mixture visible without an error.
      if (error?.code !== 'NO_REACTION') console.warn('[chem] pour reaction lookup failed', error);
    }
  }

  /** Wait until rig pour FSM is idle, then refresh HUD / right panel. */
  function waitPourThenSync(to) {
    const e = eq();
    const started = performance.now();
    const poll = () => {
      // Only rig.pour (FSM object) means still pouring — e.pour is the API function
      if (e?.rig?.pour) {
        if (performance.now() - started < 4000) {
          requestAnimationFrame(poll);
          return;
        }
      }
      finishPourSync(to);
    };
    requestAnimationFrame(poll);
  }

  function pourBetween(from, to) {
    const e = eq();
    if (!e) return false;
    const cups = e.getCupState?.() || {};
    if ((cups[from]?.fill || 0) <= 0.02) {
      toast(`烧杯 ${from} 为空 · 先装入试剂`);
      openPickerForCup(from);
      return true;
    }
    const ok = e.pour?.(from, to) || e.startPour?.(from, to);
    if (!ok) {
      toast('无法倾倒');
      return false;
    }
    setStep('pour');
    toast(`烧杯 ${from} → ${to}`);
    waitPourThenSync(to);
    return true;
  }

  return {
    initData() {
      return {
        activeCup: 'A',
        viewCup: 'all',
        pickerOpen: false,
        pickerPhase: 'elements',
        pickedElement: null,
        selectedComponentId: null,
        cupA: { reagents: [], fill: 0, color: 0x94a3b8, formula: '' },
        cupB: { reagents: [], fill: 0, color: 0x94a3b8, formula: '' },
        components: [],
        rightPanelScrollY: 0,
        dragging: null,
        dragStartTime: 0,
        dragLifted: false,
        hint: '点击烧杯选择试剂 · 长按或拖动烧杯向另一杯倾倒',
        completed: false,
        searchQuery: '',
        searchCondition: '',
        condMenuOpen: false,
        searchFocused: false,
        searchBusy: false,
        searchStatus: '',
        searchStatusTone: 'info',
      };
    },

    applyVisualDefaults(expId) {
      // Same as thermo: equipment owns apparatus mode.
      eq()?.setMode?.(expId || 'reagent-mix');
      eq()?.showcase?.();
      eq()?.getPickSet?.();
    },

    cleanup() {},

    /**
     * Cup click / E → open periodic picker (primary action).
     */
    /**
     * Cup click / E → open periodic picker only if clicking black label bar.
     */
    interact(target, _t, step) {
      if (state.data?.pickerOpen && target?.userData?.chemKind !== 'periodic') {
        return false;
      }
      const role = target?.userData?.role;
      
      if (role === 'chem_molecule') {
        const mol = eq()?.rig?.molecule;
        if (mol?.userData?.toggleStyle) {
          mol.userData.toggleStyle();
          eq()?.getPickSet?.();
          return true;
        }
      }

      const isLabel = target?.userData?.isLabel || role === 'chem_cup_a_label' || role === 'chem_cup_b_label';
      const kind = roleToKind(role);
      if (kind && isLabel) return openPickerForCup(kind);

      if (role === 'ui_action' || role === 'generic') {
        const sid = step?.id;
        if (sid === 'pick_cup' || sid === 'fill') {
          return openPickerForCup(state.data.activeCup || 'A');
        }
        if (sid === 'pour') {
          const from = state.data.activeCup === 'B' ? 'B' : 'A';
          const to = from === 'A' ? 'B' : 'A';
          return pourBetween(from, to);
        }
        return openPickerForCup(state.data.activeCup || 'A');
      }
      return false;
    },

    /**
     * Arm drag role — black label bar opens picker; beaker body drags/pours; right panel scrolls.
     */
    beginManipulation(target, context = {}) {
      if (state.data?.pickerOpen && target?.userData?.chemKind !== 'periodic') {
        return false;
      }
      const chemKind = target?.userData?.chemKind;
      const pickRole = context?.pick?.role;
      const pickAction = context?.pick?.action;
      const isRightPanel = chemKind === 'right'
        || target?.name === 'chem-holo-chem-right'
        || pickRole === 'scrollable_components'
        || pickAction === 'chem-scroll-right';

      if (isRightPanel) {
        state.data.dragging = 'chem_right_panel';
        state.data.dragStartScrollY = state.data.rightPanelScrollY || 0;
        const raycaster = context?.raycaster;
        if (raycaster && target) {
          const uvInfo = target.userData?.getUvFromRay?.(raycaster)
            || target.userData?.screenAimFromRay?.(raycaster);
          if (uvInfo?.v != null) {
            state.data.dragStartPixelY = (1 - uvInfo.v) * 1040;
          }
        }
        return true;
      }

      const role = target?.userData?.role;
      const isLabel = target?.userData?.isLabel || role === 'chem_cup_a_label' || role === 'chem_cup_b_label';
      const kind = roleToKind(role);
      if (!kind) return false;

      // Click on black label bar (A/B) -> open selection panel immediately
      if (isLabel) {
        state.data.dragging = null;
        return openPickerForCup(kind);
      }

      if (role !== 'chem_cup_a' && role !== 'chem_cup_b') return false;

      state.data.dragging = role;
      state.data.dragStartTime = performance.now();
      state.data.dragLifted = false;
      state.data.dragStartX = null;
      state.data.dragStartZ = null;
      state.data.activeCup = kind;
      return true;
    },

    updateManipulation(_target, context = {}) {
      if (!state.data.dragging) return false;

      if (state.data.dragging === 'chem_right_panel') {
        const raycaster = context.raycaster;
        if (raycaster && _target) {
          const uvInfo = _target.userData?.getUvFromRay?.(raycaster)
            || _target.userData?.screenAimFromRay?.(raycaster);
          if (uvInfo?.v != null) {
            const currentPixelY = (1 - uvInfo.v) * 1040;
            if (state.data.dragStartPixelY != null) {
              const dy = currentPixelY - state.data.dragStartPixelY;
              const count = state.data?.components?.length || 0;
              const rowH = 92;
              const rowGap = 14;
              const viewportH = 615;
              const maxScroll = Math.max(0, count * (rowH + rowGap) - viewportH);

              const newScroll = Math.min(Math.max(0, (state.data.dragStartScrollY || 0) + dy), maxScroll);
              if (newScroll !== state.data.rightPanelScrollY) {
                state.data.rightPanelScrollY = newScroll;
                pushHud();
              }
            }
          }
        }
        return true;
      }

      const kind = roleToKind(state.data.dragging);
      if (!kind) return false;

      const raycaster = context.raycaster;
      const root = eq()?.rig?.root;
      if (raycaster && root) {
        root.updateWorldMatrix?.(true, false);
        const invMat = _invMat.copy(root.matrixWorld).invert();
        const localRay = _localRay.copy(raycaster.ray).applyMatrix4(invMat);
        const hitPoint = _hitPoint;
        if (localRay.intersectPlane(_vertPlane, hitPoint)) {
          if (state.data.dragStartX == null) {
            state.data.dragStartX = hitPoint.x;
            state.data.dragStartY = hitPoint.y;
            try { eq()?.beginDrag?.(kind, null, hitPoint); } catch { /* ignore */ }
          }

          const dist = Math.hypot(hitPoint.x - state.data.dragStartX, hitPoint.y - state.data.dragStartY);
          const duration = performance.now() - Number(state.data.dragStartTime || 0);

          // Only lift beaker if dragged significantly (>0.04 units) or held and moved (>0.015 units after 200ms)
          if (!state.data.dragLifted && (dist > 0.04 || (dist > 0.015 && duration > 200))) {
            state.data.dragLifted = true;
            if (state.data.pickerOpen) {
              closePicker();
            }
          }

          if (state.data.dragLifted) {
            eq()?.updateDrag?.(hitPoint.x, hitPoint.y);
          }
          return true;
        }
      }
      return false;
    },

    /**
     * Release: if dragged (lifted), attempt pour or snap home.
     * If click on beaker body, do not open picker panel.
     */
    endManipulation() {
      const role = state.data?.dragging;
      if (role === 'chem_right_panel') {
        state.data.dragging = null;
        state.data.dragStartPixelY = null;
        return true;
      }

      const lifted = !!state.data?.dragLifted;
      state.data.dragging = null;
      state.data.dragLifted = false;
      state.data.dragStartX = null;
      state.data.dragStartZ = null;
      if (!role) return false;

      // If beaker was actually lifted/dragged across the desk -> pour or snap home
      if (lifted) {
        const result = eq()?.endDrag?.() || { poured: false };
        if (result.poured) {
          setStep('pour');
          toast(`烧杯 ${result.from || '?'} → ${result.to || '?'}`);
          // Wait for pour animation + reaction product commit before updating right panel
          waitPourThenSync(result.to || (result.from === 'A' ? 'B' : 'A'));
          return true;
        }
        return true;
      }

      // Click on beaker body (not label bar) -> just relax beaker, do not open selection panel
      try { eq()?.endDrag?.(); } catch { /* ignore */ }
      return true;
    },

    onWheel(delta, target, pick) {
      const chemKind = target?.userData?.chemKind;
      const isRightPanel = chemKind === 'right'
        || target?.name === 'chem-holo-chem-right'
        || pick?.role === 'scrollable_components'
        || pick?.action === 'chem-scroll-right';

      if (isRightPanel) {
        const count = state.data?.components?.length || 0;
        const rowH = 92;
        const rowGap = 14;
        const viewportH = 615;
        const maxScroll = Math.max(0, count * (rowH + rowGap) - viewportH);

        const step = delta > 0 ? 50 : -50;
        const next = Math.min(Math.max(0, (state.data.rightPanelScrollY || 0) + step), maxScroll);
        if (next !== state.data.rightPanelScrollY) {
          state.data.rightPanelScrollY = next;
          pushHud();
        }
        return true;
      }
      return false;
    },

    holdInteract(holding) {
      if (holding && state.data?.dragging && !state.data?.dragLifted) {
        const kind = roleToKind(state.data.dragging);
        if (kind) {
          state.data.dragLifted = true;
          try { eq()?.beginDrag?.(kind, null, null); } catch { /* ignore */ }
        }
      }
      if (!holding && state.data?.dragging) this.endManipulation();
    },

    onKey(code) {
      if (code === 'Escape') {
        if (state.data?.pickerOpen) {
          return this.onUiAction('chem-close-picker');
        }
      }
      if (code === 'KeyR') return this.onUiAction('chem-reset');
      if (code !== 'KeyE') return false;
      const step = currentStep?.() || null;
      return this.interact({ userData: { role: 'ui_action' } }, 0, step);
    },

    onUiAction(action, payload = {}) {
      const d = state.data;
      if (!d) return false;

      switch (action) {
        case 'chem-select-cup':
          return openPickerForCup(payload.cup === 'B' ? 'B' : 'A');
        case 'chem-close-picker':
          d.pickedElement = null;
          d.pickerPhase = 'elements';
          return closePicker();
        case 'chem-picker-back':
          d.pickerPhase = 'elements';
          d.pickedElement = null;
          showReagentSearchDock({ activeCup: d.activeCup || 'A', keepStatus: true });
          pushHud();
          return true;
        case 'chem-ai-search': {
          d.searchFocused = false;
          hideReagentSearchDock();
          const q = String(payload.query || payload.q || '').trim();
          if (!q) {
            toast('请输入要检索的物质');
            return false;
          }
          void runAiReagentQuery(q, payload.condition || '');
          return true;
        }
        case 'chem-search-focus': {
          d.condMenuOpen = false;
          d.searchFocused = true;
          focusSearchInput(d.searchQuery || '', (newVal) => {
            d.searchQuery = newVal;
            pushHud();
          }, (submitVal) => {
            d.searchQuery = submitVal;
            d.searchFocused = false;
            hideReagentSearchDock();
            const cond = d.searchCondition || '';
            if (submitVal.trim()) {
              void runAiReagentQuery(submitVal.trim(), cond);
            }
          }, () => onUiAction('chem-search-voice'));
          pushHud();
          return true;
        }
        case 'chem-search-voice': {
          toggleSpeechRecognition((text) => {
            d.searchQuery = text;
            toast(`已识别：${text}`);
            pushHud();
          }, (status, err) => {
            d.speechPhase = status;
            if (status === 'requesting') {
              d.speechListening = false;
              toast('请按系统提示允许“语音识别”和“麦克风”，授权后直接说出物质名称');
            } else if (status === 'listening') {
              d.speechListening = true;
              toast('🎙️ 正在聆听 · 说出物质名称，再次点击麦克风可结束');
            } else if (status === 'stopping') {
              d.speechListening = false;
              toast('正在结束录音并生成识别文字…');
            } else if (status === 'unsupported') {
              d.speechListening = false;
              toast('当前浏览器环境不支持语音识别，请键盘输入');
            } else if (status === 'error') {
              d.speechListening = false;
              if (err === 'not-allowed') {
                toast('语音权限未开启，请在“设置 → HoloGrip”中允许麦克风和语音识别');
              } else {
                toast('语音识别中断，请重试');
              }
            } else {
              d.speechListening = false;
              d.speechPhase = 'idle';
              if (status === 'stopped') toast('已取消语音输入');
            }
            pushHud();
          });
          return true;
        }
        case 'chem-search-submit': {
          d.condMenuOpen = false;
          d.searchFocused = false;
          hideReagentSearchDock();
          const q = String(d.searchQuery || '').trim();
          if (!q) {
            toast('请输入化学式、名称或 SMILES');
            return false;
          }
          void runAiReagentQuery(q, d.searchCondition || '');
          return true;
        }
        case 'chem-pick-element': {
          d.searchFocused = false;
          hideReagentSearchDock();
          const el = getElement(payload.element);
          if (!el) return false;
          d.pickedElement = el.symbol;
          d.pickerPhase = 'reagents';
          toast(`${el.symbol} · ${el.name_zh}`);
          setStep('fill');
          pushHud();
          return true;
        }
        case 'chem-pick-reagent': {
          const reagent = getReagent(payload.reagentId);
          if (!reagent) return false;
          const cup = d.activeCup === 'B' ? 'B' : 'A';
          eq()?.assignReagent?.(cup, reagent);
          syncFromRig();
          d.pickerOpen = false;
          hideReagentSearchDock();
          d.selectedComponentId = reagent.id;
          d.hint = `已装入 ${reagent.formula} · 点右侧成分可切换 3D，或拖向另一杯倾倒`;
          toast(`${reagent.formula} → 烧杯 ${cup}`);
          setStep('pour');
          // Show 3D ball-stick on island pedestal (PubChem SDF, fallback mesh if offline)
          void loadAndShowMolecule(eq(), {
            id: reagent.id,
            formula: reagent.formula,
            name_zh: reagent.name_zh,
            query: reagent.query || reagent.formula,
            color: reagent.color,
          }, toast);
          pushHud();
          return true;
        }
        case 'chem-reset': {
          eq()?.resetAll?.();
          eq()?.reset?.(state.expId);
          Object.assign(d, this.initData());
          eq()?.setMode?.(state.expId || 'reagent-mix');
          hideReagentSearchDock();
          toast('实验台已重置');
          pushHud();
          return true;
        }
        case 'chem-show-component': {
          const id = payload.componentId;
          const comp = (d.components || []).find((c) => c.id === id);
          if (!comp) return false;
          d.selectedComponentId = id;
          setStep('inspect');
          void loadAndShowMolecule(eq(), comp, toast);
          pushHud();
          return true;
        }
        case 'chem-select-view-cup': {
          d.viewCup = payload.cup;
          syncFromRig();
          toast(`切换成分视角：${payload.cup === 'A' ? '烧杯 A' : payload.cup === 'B' ? '烧杯 B' : '全部成分'}`);
          pushHud();
          return true;
        }
        case 'chem-pour-a-to-b':
          return pourBetween('A', 'B');
        case 'chem-pour-b-to-a':
          return pourBetween('B', 'A');
        default:
          return false;
      }
    },

    update() {
      // no continuous sim; pour animation is rig-owned
    },
  };
}

function colorForFormula(formula) {
  const f = String(formula || '').toUpperCase();
  if (f.includes('CU')) return 0x2563eb;
  if (f.includes('FE')) return 0xea580c;
  if (f.includes('KMN') || f.includes('MNO4')) return 0xa21caf;
  if (f.includes('CL') || f.includes('HCL')) return 0xfbbf24;
  if (f.includes('OH') || f.includes('NAOH')) return 0x86efac;
  if (f.includes('H2O') || f === 'WATER') return 0x38bdf8;
  if (f.includes('SO4')) return 0xf59e0b;
  if (f.includes('NO3')) return 0xfb7185;
  if (f.includes('C')) return 0x64748b;
  // stable hash → soft pastel
  let h = 0;
  for (let i = 0; i < f.length; i += 1) h = (h * 31 + f.charCodeAt(i)) >>> 0;
  const r = 80 + (h & 0x7f);
  const g = 100 + ((h >> 8) & 0x7f);
  const b = 140 + ((h >> 16) & 0x7f);
  return (r << 16) | (g << 8) | b;
}

/**
 * Extract SDF from HoloChem lookupMolecule / loadComponentStructure results.
 * Pure lookup returns { molecule: { sdf }, components }; AI mix returns components only.
 */
function extractSdfFromLookup(result) {
  if (!result) return '';
  if (typeof result.sdf === 'string' && result.sdf.length > 20) return result.sdf;
  if (typeof result.mol === 'string' && result.mol.length > 20) return result.mol;
  if (result.molecule?.sdf && String(result.molecule.sdf).length > 20) {
    return result.molecule.sdf;
  }
  return '';
}

async function fetchSdfForComp(comp) {
  if (!comp) return null;
  const key = comp.query || comp.formula || comp.name_zh || comp.name_en;
  if (!key) return null;
  if (_sdfCache.has(key)) return _sdfCache.get(key);

  try {
    const { lookupMolecule, loadComponentStructure } = await import('../../../chem/pubchem.js');
    let sdf = '';

    try {
      const structured = await loadComponentStructure({
        name_zh: comp.name_zh,
        name_en: comp.name_en,
        formula: comp.formula,
        smiles: comp.smiles,
      });
      sdf = extractSdfFromLookup(structured);
    } catch (e) {
      console.warn('[chem] loadComponentStructure miss', e?.message || e);
    }

    if (!sdf) {
      const query = String(key);
      const product = await lookupMolecule(query);
      sdf = extractSdfFromLookup(product);
      if (!sdf && product?.molecule) sdf = extractSdfFromLookup(product.molecule);
      if (!sdf && Array.isArray(product?.components) && product.components[0]) {
        const c0 = product.components[0];
        try {
          const sub = await loadComponentStructure(c0);
          sdf = extractSdfFromLookup(sub);
        } catch {
          const subProd = await lookupMolecule(c0.query || c0.formula || c0.name_zh || query);
          sdf = extractSdfFromLookup(subProd) || extractSdfFromLookup(subProd?.molecule);
        }
      }
    }

    if (sdf) _sdfCache.set(key, sdf);
    return sdf;
  } catch (err) {
    console.warn('[chem] fetchSdfForComp failed', err);
    return null;
  }
}

async function loadAndShowMolecule(equipment, comp, toast) {
  if (!equipment || !comp) return;
  const label = comp.formula || comp.name_zh || '分子';
  const key = comp.query || comp.formula || comp.name_zh || comp.name_en;

  if (key && _sdfCache.has(key)) {
    equipment.showMoleculeFromSdf?.(_sdfCache.get(key), label);
    toast?.(`已在桌上显示 ${label}`);
    return;
  }

  toast?.(`加载 ${label} 结构…`);
  equipment.showLoadingMolecule?.(label);

  try {
    const sdf = await fetchSdfForComp(comp);
    equipment.showMoleculeFromSdf?.(sdf || null, label);
    toast?.(sdf ? `已在桌上显示 ${label}` : `桌上示意模型 · ${label}`);
  } catch (err) {
    console.warn('[chem] molecule load failed', err);
    equipment.showMoleculeFromSdf?.(null, comp.formula || comp.name_zh);
    toast?.(`结构加载失败，已用示意模型 · ${label}`);
  }
}
