const EASE_OUT = 'cubic-bezier(0.23, 1, 0.32, 1)';

/** Lightweight first-paint loader. All motion is compositor-friendly. */
export function createLabLoader() {
  const root = document.getElementById('loader');
  if (!root) return { setProgress() {}, setStatus() {}, setBusy() {}, finish: async () => {} };

  const fill = root.querySelector('.loader-bar-fill');
  const glow = root.querySelector('.loader-bar-glow');
  const pct = root.querySelector('.loader-pct');
  const status = root.querySelector('.loader-status');
  let target = 0;
  let displayed = 0;
  let raf = 0;
  let finishing = false;

  document.body.classList.add('is-loading');
  root.dataset.delay = '80';

  const render = (value) => {
    const ratio = Math.max(0, Math.min(1, value));
    fill?.style.setProperty('transform', `scaleX(${ratio})`);
    glow?.style.setProperty('transform', `translateX(${ratio * 100}%) translateX(-50%)`);
    if (pct) pct.textContent = String(Math.round(ratio * 100));
    root.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  };

  const pump = () => {
    raf = 0;
    if (finishing) return;
    displayed += (target - displayed) * 0.22;
    if (Math.abs(target - displayed) < 0.001) displayed = target;
    render(displayed);
    if (displayed !== target) raf = requestAnimationFrame(pump);
  };

  function setProgress(ratio, message) {
    if (finishing) return;
    target = Math.max(target, Math.min(1, Number(ratio) || 0));
    if (message) setStatus(message);
    if (!raf) raf = requestAnimationFrame(pump);
  }

  function setStatus(message) {
    if (status && message) status.textContent = message;
  }

  function setBusy(busy) {
    root.classList.toggle('loader-busy', !!busy);
  }

  async function finish() {
    if (finishing) return;
    finishing = true;
    if (raf) cancelAnimationFrame(raf);
    render(1);
    root.classList.add('loader-revealing');
    const reduce = matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reduce ? 160 : 220;
    const animation = root.animate(
      [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-1.5%)' }],
      { duration, easing: EASE_OUT, fill: 'forwards' },
    );
    await animation.finished.catch(() => {});
    root.remove();
    document.body.classList.remove('is-loading');
    document.body.classList.add('lab-ready');
  }

  render(0);
  setProgress(0.01);
  return { setProgress, setStatus, setBusy, finish };
}
