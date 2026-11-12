// Widgets : potards, faders, boutons on/off et sélecteurs liés au registre des contrôles.
// Chaque widget se met à jour tout seul à chaque image (refreshAll), donc il suit aussi les changements
// faits par l'assistant, le SYNC ou les cours.

const widgets = [];
export function refreshAll() { for (const w of widgets) w(); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function dragValue(el, ctl, axis, sizePx, opts = {}) {
  let start = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    start = { x: e.clientX, y: e.clientY, v: ctl.get() };
    if (opts.jump) opts.jump(e);
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || !el.hasPointerCapture(e.pointerId)) return;
    const d = axis === 'y' ? (start.y - e.clientY) * (opts.invert ? -1 : 1) : e.clientX - start.x;
    const k = e.shiftKey ? 0.15 : 1;
    ctl.set(clamp(start.v + (d / sizePx()) * (ctl.max - ctl.min) * k, ctl.min, ctl.max));
    if (e.shiftKey) start = { x: e.clientX, y: e.clientY, v: ctl.get() };
  });
  el.addEventListener('pointerup', () => (start = null));
  el.addEventListener('dblclick', () => ctl.set(ctl.def));
  el.addEventListener('wheel', (e) => { e.preventDefault(); ctl.set(clamp(ctl.get() - Math.sign(e.deltaY) * (ctl.max - ctl.min) * (e.shiftKey ? 0.005 : 0.03), ctl.min, ctl.max)); }, { passive: false });
  el.title = `${ctl.label}\n${ctl.help || ''}\n\nSur une vraie table : ${ctl.hw}\n(double-clic = valeur par défaut, Maj = réglage fin, molette)`;
}

export function knob(el, ctl, { label, color = '#e7eaef', small } = {}) {
  el.classList.add('knob'); if (small) el.classList.add('sm');
  el.dataset.ctl = ctl.id;
  el.innerHTML = `<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15.5" fill="#262b33" stroke="#0a0b0d" stroke-width="2"/>
    <path class="bg" fill="none" stroke="#2c323c" stroke-width="3" stroke-linecap="round"/><path class="arc" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round"/>
    <line class="ind" x1="20" y1="20" x2="20" y2="8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>${label ? `<span class="kl">${label}</span>` : ''}`;
  const arcPath = (a0, a1) => {
    const p = (a) => [20 + 18.5 * Math.sin(a), 20 - 18.5 * Math.cos(a)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M${x0},${y0} A18.5,18.5 0 ${Math.abs(a1 - a0) > Math.PI ? 1 : 0} ${a1 > a0 ? 1 : 0} ${x1},${y1}`;
  };
  const A = (135 * Math.PI) / 180;
  el.querySelector('.bg').setAttribute('d', arcPath(-A, A));
  const arc = el.querySelector('.arc'), ind = el.querySelector('.ind');
  const bip = ctl.min < 0;
  let last = null;
  dragValue(el, ctl, 'y', () => 180);
  widgets.push(() => {
    const v = ctl.get(); if (v === last) return; last = v;
    const t = (v - ctl.min) / (ctl.max - ctl.min);
    const a = -A + t * 2 * A;
    ind.setAttribute('transform', `rotate(${(a * 180) / Math.PI} 20 20)`);
    const from = bip ? 0 : -A;
    arc.setAttribute('d', Math.abs(a - from) < 0.02 ? '' : arcPath(Math.min(from, a), Math.max(from, a)));
    el.classList.toggle('kill', bip && v <= -0.98);
    arc.setAttribute('stroke', bip && v <= -0.98 ? '#ff3d3d' : color);
  });
  return el;
}

export function vfader(el, ctl, { invert = false, center = false } = {}) {
  el.classList.add('vfader'); if (center) el.classList.add('center');
  el.dataset.ctl = ctl.id;
  el.innerHTML = '<div class="ticks"></div><div class="track"></div><div class="cap"></div>';
  const cap = el.querySelector('.cap');
  const h = () => el.clientHeight - 12;
  const posToVal = (e) => {
    const r = el.getBoundingClientRect();
    let t = 1 - (e.clientY - r.top - 6) / (r.height - 12); t = clamp(t, 0, 1);
    if (invert) t = 1 - t;
    return ctl.min + t * (ctl.max - ctl.min);
  };
  dragValue(el, ctl, 'y', h, {
    invert,
    jump: (e) => { if (e.target !== cap) ctl.set(posToVal(e)); },
  });
  let last = null;
  widgets.push(() => {
    const v = ctl.get(); const H = el.clientHeight; if (v === last && H === el._h) return; last = v; el._h = H;
    let t = (v - ctl.min) / (ctl.max - ctl.min); if (invert) t = 1 - t;
    cap.style.top = `${6 + (1 - t) * (H - 12)}px`;
  });
  return el;
}

export function hfader(el, ctl) {
  el.classList.add('hfader'); el.dataset.ctl = ctl.id;
  el.innerHTML = '<div class="track"></div><div class="cap"></div>';
  const cap = el.querySelector('.cap');
  dragValue(el, ctl, 'x', () => el.clientWidth - 16, {
    jump: (e) => {
      if (e.target === cap) return;
      const r = el.getBoundingClientRect();
      const t = clamp((e.clientX - r.left - 8) / (r.width - 16), 0, 1);
      ctl.set(ctl.min + t * (ctl.max - ctl.min));
    },
  });
  let last = null;
  widgets.push(() => {
    const v = ctl.get(); const W = el.clientWidth; if (v === last && W === el._w) return; last = v; el._w = W;
    const t = (v - ctl.min) / (ctl.max - ctl.min);
    cap.style.left = `${8 + t * (W - 16)}px`;
  });
  return el;
}

export function toggle(el, ctl) {
  el.dataset.ctl = ctl.id;
  el.addEventListener('click', () => ctl.set(!ctl.get()));
  el.title = `${ctl.label}\n${ctl.help || ''}\n\nSur une vraie table : ${ctl.hw}`;
  let last = null;
  widgets.push(() => { const v = !!ctl.get(); if (v !== last) { last = v; el.classList.toggle('on', v); } });
  return el;
}

export function seg(el, ctl, labels = {}) {
  el.classList.add('seg'); el.dataset.ctl = ctl.id;
  el.innerHTML = ctl.options.map((o) => `<button data-v="${o}">${labels[o] ?? o}</button>`).join('');
  el.title = `${ctl.label}\n${ctl.help || ''}\n\nSur une vraie table : ${ctl.hw}`;
  el.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; const o = ctl.options.find((x) => String(x) === b.dataset.v); ctl.set(o); });
  let last = null;
  widgets.push(() => { const v = String(ctl.get()); if (v === last) return; last = v; el.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v)); });
  return el;
}

// mise à jour libre (texte, classes…) à chaque image
export function live(fn) { widgets.push(fn); }

// VU-mètre à segments (dBFS) ; renvoie une fonction set(db)
export function vuMeter(el, n = 15) {
  const segs = [];
  // échelle : -24 dB .. +3 dB
  for (let i = 0; i < n; i++) {
    const db = -24 + (27 * (i + 1)) / n;
    const s = document.createElement('i');
    s.className = db > 0 ? 'r' : db > -6 ? 'y' : 'g';
    el.appendChild(s); segs.push({ s, db, on: false });
  }
  let hold = -120, holdT = 0;
  return (db) => {
    const now = performance.now();
    if (db > hold || now - holdT > 900) { hold = db; holdT = now; }
    for (const g of segs) {
      const on = db >= g.db - 27 / n / 2 || (Math.abs(g.db - hold) < 27 / n / 2 && hold > -24);
      if (on !== g.on) { g.on = on; g.s.classList.toggle('on', on); }
    }
  };
}
