export function createSlider(container, { id, label, min, max, step, value, unit = '', onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control';
  wrap.dataset.id = id;

  const lab = document.createElement('label');
  const name = document.createElement('span');
  name.textContent = label;
  const val = document.createElement('span');
  val.className = 'value';
  val.textContent = `${formatDisplay(value, step)}${unit}`;
  lab.append(name, val);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  input.addEventListener('input', () => {
    const v = Number(input.value);
    val.textContent = `${formatDisplay(v, step)}${unit}`;
    onChange?.(v);
  });

  wrap.append(lab, input);
  container.appendChild(wrap);
  return {
    get value() {
      return Number(input.value);
    },
    set value(v) {
      input.value = String(v);
      val.textContent = `${formatDisplay(v, step)}${unit}`;
    },
    el: wrap,
  };
}

export function createSelect(container, { id, label, options, value, onChange }) {
  const wrap = document.createElement('div');
  wrap.className = 'control';
  wrap.dataset.id = id;

  const lab = document.createElement('label');
  lab.innerHTML = `<span>${label}</span><span class="value"></span>`;

  const select = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === value) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => onChange?.(select.value));

  wrap.append(lab, select);
  container.appendChild(wrap);
  return {
    get value() {
      return select.value;
    },
    set value(v) {
      select.value = v;
    },
    el: wrap,
  };
}

/**
 * Slider bound to params[key]; updates params and rebuilds the 3D scene (debounced via ui.requestRebuild).
 */
export function liveSlider(ui, params, key, opts) {
  return createSlider(ui.controls, {
    ...opts,
    value: params[key],
    onChange: (v) => {
      params[key] = v;
      opts.map?.(params, v);
      opts.onChange?.(v);
      ui.requestRebuild?.();
    },
  });
}

/**
 * Select bound to params[key]; same live rebuild behavior.
 */
export function liveSelect(ui, params, key, opts) {
  return createSelect(ui.controls, {
    ...opts,
    value: params[key],
    onChange: (v) => {
      params[key] = v;
      opts.map?.(params, v);
      opts.onChange?.(v);
      ui.requestRebuild?.();
    },
  });
}

export function setReadouts(container, items) {
  // Host mechanics ticks every frame. Rewriting innerHTML 60×/s thrashes layout
  // and forces hologram re-parse — only paint when the text actually changes.
  const html = items
    .map(
      (it) => `
      <div class="readout">
        <span class="k">${it.label}</span>
        <span class="v">${it.value}</span>
      </div>`
    )
    .join('');
  if (container._lastReadoutHtml === html) return;
  container._lastReadoutHtml = html;
  container.innerHTML = html;
}

export function setFormula(card, html) {
  card.innerHTML = html;
}

function formatDisplay(v, step) {
  const s = String(step);
  if (s.includes('.')) return Number(v).toFixed(s.split('.')[1].length);
  return String(v);
}
