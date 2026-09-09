let bridge = null;
let state = {
  ar: { active: false, phase: 'off', status: 'AR mode off · H' },
  tutorialVisible: false,
};

function ensureNode(id, tag = 'div', parent = document.body) {
  let node = document.getElementById(id);
  if (!node) {
    node = document.createElement(tag);
    node.id = id;
    parent.appendChild(node);
  }
  return node;
}

export function mountUi({ bridge: nextBridge } = {}) {
  bridge = nextBridge || null;
  const root = ensureNode('ui-root');
  root.replaceChildren();

  const help = document.createElement('button');
  help.type = 'button';
  help.id = 'native-help-toggle';
  help.className = 'native-control';
  help.setAttribute('aria-label', '操作指南');
  help.innerHTML = `
    <svg class="native-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"></circle>
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
      <circle cx="12" cy="17" r="0.5" fill="currentColor"></circle>
    </svg>
    <span>操作指南</span>
  `;

  const handleHelp = (e) => {
    e.stopPropagation();
    if (bridge?.toggleHelpModal) {
      bridge.toggleHelpModal();
    } else if (bridge?.openHelpModal) {
      bridge.openHelpModal();
    } else {
      const modal = document.getElementById('help-modal-wrap');
      if (modal) {
        const isOpen = modal.classList.toggle('is-open');
        modal.setAttribute('aria-hidden', String(!isOpen));
      }
    }
  };

  help.addEventListener('pointerdown', (e) => e.stopPropagation());
  help.addEventListener('mousedown', (e) => e.stopPropagation());
  help.addEventListener('click', handleHelp);
  root.appendChild(help);

  const ar = document.createElement('button');
  ar.type = 'button';
  ar.id = 'native-ar-toggle';
  ar.className = 'native-control';
  ar.setAttribute('aria-label', '手势交互');
  ar.innerHTML = `
    <svg class="native-btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0"></path>
      <path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v2"></path>
      <path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v8"></path>
      <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.8-5.9-2.3L3.3 15a2 2 0 0 1 .3-2.8v0a2 2 0 0 1 2.8.3L8 14"></path>
    </svg>
    <span>手势交互</span>
  `;

  const handleAr = (e) => {
    e.stopPropagation();
    bridge?.toggleHandTracking?.();
  };

  ar.addEventListener('pointerdown', (e) => e.stopPropagation());
  ar.addEventListener('mousedown', (e) => e.stopPropagation());
  ar.addEventListener('click', handleAr);
  root.appendChild(ar);

  ensureNode('toast');
  return { root, destroy: () => root.replaceChildren() };
}

export function updateHud() {}

export function updateToast(message) {
  const node = ensureNode('toast');
  node.textContent = message || '';
  node.classList.toggle('show', !!message);
}

export function updateArStatus(status = {}) {
  state.ar = { ...state.ar, ...status };
  const node = document.getElementById('native-ar-toggle');
  if (!node) return;
  node.setAttribute('aria-pressed', String(!!state.ar.active));
  node.dataset.phase = state.ar.phase || 'off';
  const labelSpan = node.querySelector('span');
  if (labelSpan) {
    labelSpan.textContent = state.ar.active ? '手势已开启' : '手势交互';
  }
}

export function updateTutorial(visible) {
  state.tutorialVisible = !!visible;
}
