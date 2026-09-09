/**
 * Off-screen typing bridge for the 3D main screen search bar.
 * Ensures canvas holos can receive real physical keyboard typing without floating DOM elements on screen.
 * Reuses original HoloChem AI: DeepSeek resolve + PubChem lookupMolecule.
 */

/** @type {HTMLInputElement | null} */
let inputEl = null;
/** @type {null | ((query: string, condition: string) => void | Promise<void>)} */
let onSubmit = null;
/** @type {null | ((val: string) => void)} */
let onChange = null;
/** @type {null | (() => void)} */
let onVoice = null;
const boundInputs = new WeakSet();

function bindInputHandlers(el) {
  if (!el || boundInputs.has(el)) return;
  boundInputs.add(el);
  el.addEventListener('input', () => {
    onChange?.(el.value || '');
  });
  el.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const val = el.value || '';
    hideReagentSearchDock();
    onSubmit?.(val, '');
  });
  el.addEventListener('keyup', (e) => e.stopPropagation());
  el.addEventListener('keypress', (e) => e.stopPropagation());
}

function ensureHiddenInput() {
  if (inputEl) return inputEl;

  inputEl = document.createElement('input');
  inputEl.type = 'text';
  inputEl.id = 'chem-reagent-query-hidden';
  inputEl.autocomplete = 'off';
  inputEl.spellcheck = false;
  inputEl.style.cssText = [
    'position:fixed',
    'left:-9999px',
    'top:-9999px',
    'width:1px',
    'height:1px',
    'opacity:0',
    'pointer-events:none',
    'z-index:-1',
  ].join(';');

  bindInputHandlers(inputEl);

  document.body.appendChild(inputEl);
  return inputEl;
}

export function focusSearchInput(initialVal = '', changeCb = null, submitCb = null, voiceCb = null) {
  onChange = typeof changeCb === 'function' ? changeCb : null;
  if (typeof submitCb === 'function') onSubmit = submitCb;
  onVoice = typeof voiceCb === 'function' ? voiceCb : null;

  // iPad/WebView: show visible keyboard dock instead of hidden input
  // (hidden inputs frequently fail to trigger virtual keyboard on iPad)
  const isCoarse = 'ontouchstart' in window || navigator.maxTouchPoints > 1;
  if (isCoarse && !inputEl) {
    // Create visible bottom keyboard dock
    const dock = document.createElement('div');
    dock.id = 'chem-reagent-dock-wrap';
    dock.style.cssText = `
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      z-index: 99999;
      background: rgba(248,250,252,0.96);
      border-top: 1px solid rgba(0,0,0,0.1);
      padding: 10px max(16px, env(safe-area-inset-right)) calc(10px + env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
      backdrop-filter: blur(20px);
      font-size: 16px;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      gap: 10px;
      align-items: center;
      box-shadow: 0 -10px 30px rgba(15,23,42,0.12);
      touch-action: manipulation;
    `;
    dock.innerHTML = `
      <input id="chem-reagent-iPad" 
        type="text" 
        autocomplete="off" 
        spellcheck="false"
        inputmode="text"
        enterkeyhint="search"
        style="min-width:0; width:100%; box-sizing:border-box; padding:12px 16px; border:1px solid #cbd5e1; border-radius:14px; font-size:16px; color:#0f172a; background:white; outline:none;"
        placeholder="输入化学式、名称或 SMILES..."
      />
      <button id="chem-reagent-voice" type="button" aria-label="语音输入" title="语音输入" style="width:46px; height:46px; padding:0; display:grid; place-items:center; border:1px solid #bae6fd; border-radius:14px; background:#fff; color:#0369a1; cursor:pointer;" >
        <svg aria-hidden="true" width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="2" width="6" height="12" rx="3"></rect>
          <path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"></path>
        </svg>
      </button>
      <button id="chem-reagent-submit" type="button" style="height:46px; padding:0 18px; border:0; border-radius:14px; background:linear-gradient(135deg,#0ea5e9,#0284c7); color:#fff; font-size:15px; font-weight:800; white-space:nowrap; cursor:pointer;">AI 解析</button>
      <button id="chem-reagent-dismiss" type="button" aria-label="收起键盘" title="收起键盘" style="width:46px; height:46px; padding:0; display:grid; place-items:center; border:1px solid #e2e8f0; border-radius:14px; background:#f1f5f9; color:#64748b; font-size:18px; font-weight:600; cursor:pointer;">
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>
    `;
    document.body.appendChild(dock);
    inputEl = dock.querySelector('#chem-reagent-iPad');
    bindInputHandlers(inputEl);
    dock.addEventListener('pointerdown', (event) => event.stopPropagation());
    dock.addEventListener('touchstart', (event) => event.stopPropagation(), { passive: true });
    dock.querySelector('#chem-reagent-voice')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onVoice?.();
    });
    dock.querySelector('#chem-reagent-submit')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const val = inputEl?.value || '';
      hideReagentSearchDock();
      onSubmit?.(val, '');
    });
    dock.querySelector('#chem-reagent-dismiss')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideReagentSearchDock();
    });
  }

  const el = inputEl || ensureHiddenInput();
  bindInputHandlers(el);
  el.value = String(initialVal || '');
  el.focus({ preventScroll: true });
}

export function setReagentSearchHandler(handler) {
  onSubmit = typeof handler === 'function' ? handler : null;
}

export function setReagentSearchStatus() {
  // Status is now rendered directly inside the 3D main screen Canvas
}

export function setReagentSearchBusy() {
  // Busy state is now rendered directly inside the 3D main screen Canvas
}

export function showReagentSearchDock() {
  ensureHiddenInput();
}

export function hideReagentSearchDock() {
  if (inputEl) {
    try { inputEl.blur(); } catch { /* ignore */ }
  }
  if (typeof document !== 'undefined' && document.activeElement && typeof document.activeElement.blur === 'function') {
    try { document.activeElement.blur(); } catch { /* ignore */ }
  }
  // iPad dock cleanup
  const dock = document.getElementById('chem-reagent-iPad')?.parentElement;
  if (dock) {
    dock.remove();
  }
  inputEl = null;
}

export function updateReagentSearchDockPosition() {
  // No floating HTML dock DOM element; fully integrated into 3D main screen
}

export function isReagentSearchDockVisible() {
  return false;
}

export function getReagentSearchValue() {
  return String(inputEl?.value || '').trim();
}

export function setReagentSearchValue(v) {
  ensureHiddenInput();
  if (inputEl) inputEl.value = String(v || '');
}

/** @type {any} */
let activeRecognition = null;

function setVoiceDockPhase(phase = 'idle') {
  const button = document.getElementById('chem-reagent-voice');
  if (!button) return;
  const states = {
    requesting: ['正在请求语音权限', '#92400e', '#fef3c7', '#f59e0b'],
    listening: ['正在聆听，再次点击可结束', '#ffffff', '#dc2626', '#fca5a5'],
    stopping: ['正在生成识别文字', '#075985', '#e0f2fe', '#38bdf8'],
    idle: ['语音输入', '#0369a1', '#ffffff', '#bae6fd'],
  };
  const [label, color, background, border] = states[phase] || states.idle;
  button.setAttribute('aria-label', label);
  button.setAttribute('title', label);
  button.setAttribute('aria-pressed', phase === 'listening' ? 'true' : 'false');
  button.style.color = color;
  button.style.background = background;
  button.style.borderColor = border;
}

export function toggleSpeechRecognition(onResult, onStatusChange) {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  const isAppleTouchDevice = /iPad|iPhone|iPod/i.test(navigator.userAgent || '')
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // WKWebView does not expose window.webkitSpeechRecognition. The iPad Tauri
  // shell bridges this action to Speech.framework (SFSpeechRecognizer) and
  // AVAudioEngine instead.
  if (isTauri && isAppleTouchDevice) {
    if (activeRecognition?.kind === 'native-ios') {
      const current = activeRecognition;
      if (current.phase === 'requesting') {
        current.cancelled = true;
        activeRecognition = null;
        setVoiceDockPhase('idle');
        onStatusChange?.('stopped');
        return false;
      }
      void import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('stop_speech_native'))
        .catch((err) => console.warn('[speech] Native stop failed:', err));
      current.phase = 'stopping';
      current.stopping = true;
      setVoiceDockPhase('stopping');
      onStatusChange?.('stopping');
      return false;
    }

    const session = {
      kind: 'native-ios', phase: 'requesting', stopping: false, cancelled: false,
    };
    activeRecognition = session;
    setVoiceDockPhase('requesting');
    onStatusChange?.('requesting');
    void import('@tauri-apps/api/core')
      .then(async ({ invoke }) => {
        await invoke('request_speech_permissions_native');
        if (session.cancelled || activeRecognition !== session) return null;
        session.phase = 'listening';
        setVoiceDockPhase('listening');
        onStatusChange?.('listening');
        return invoke('recognize_speech_native');
      })
      .then((text) => {
        if (activeRecognition !== session) return;
        const resultText = String(text || '').trim();
        activeRecognition = null;
        if (resultText) {
          setReagentSearchValue(resultText);
          onResult?.(resultText);
        }
        setVoiceDockPhase('idle');
        onStatusChange?.('ended');
      })
      .catch((err) => {
        if (activeRecognition !== session) return;
        activeRecognition = null;
        setVoiceDockPhase('idle');
        const message = String(err || 'speech-recognition-failed');
        const code = /permission-denied/i.test(message) ? 'not-allowed' : message;
        onStatusChange?.('error', code);
      });
    return true;
  }

  const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRec) {
    onStatusChange?.('unsupported');
    return false;
  }

  if (activeRecognition) {
    try { activeRecognition.stop(); } catch { /* ignore */ }
    activeRecognition = null;
    setVoiceDockPhase('idle');
    onStatusChange?.('stopped');
    return false;
  }

  try {
    const recognition = new SpeechRec();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setVoiceDockPhase('listening');
      onStatusChange?.('listening');
    };

    recognition.onresult = (event) => {
      let resultText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        resultText += event.results[i][0].transcript;
      }
      if (resultText) {
        setReagentSearchValue(resultText);
        onResult?.(resultText);
      }
    };

    recognition.onerror = (err) => {
      console.warn('[speech] Recognition error:', err);
      activeRecognition = null;
      setVoiceDockPhase('idle');
      onStatusChange?.('error', err?.error);
    };

    recognition.onend = () => {
      activeRecognition = null;
      setVoiceDockPhase('idle');
      onStatusChange?.('ended');
    };

    recognition.start();
    activeRecognition = recognition;
    return true;
  } catch (err) {
    console.warn('[speech] Start failed:', err);
    activeRecognition = null;
    setVoiceDockPhase('idle');
    onStatusChange?.('error', String(err));
    return false;
  }
}
