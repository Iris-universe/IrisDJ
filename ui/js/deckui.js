// Interface d'une platine (type CDJ) + formes d'onde + indicateur de phase.
import { knob, vfader, toggle, seg, live } from './widgets.js';
import { TEMPO_RANGES } from './engine.js';
import { SECTIONS } from './synth.js';
import { camelot, compatible, shiftedCamelot } from './keys.js';

export const HOTCUE_COLORS = ['#ff4d6d', '#ffa62b', '#ffe14d', '#3ddc84', '#2ec5ff', '#4d7cff', '#b57bff', '#ff6ad5'];
const fmt = (s, neg = false) => { if (!isFinite(s)) s = 0; const m = Math.floor(s / 60), r = s - m * 60; return `${neg ? '-' : ''}${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`; };
export const sectionAt = (deck, bar) => (deck.track?.source === 'practice' ? SECTIONS.find((s) => bar >= s.from && bar <= s.to)?.name : null);

export const view = { zoom: 8, hideBpm: false };

export function buildDeck(root, deck, C, app) {
  const d = deck.id;
  const color = d === 'A' ? '#2ea8ff' : '#ff8a1f';
  root.innerHTML = `
  <div class="head">
    <div class="badge">${d}</div>
    <div class="meta"><div class="title">Aucun morceau</div><div class="artist">Glisse un morceau ici, ou clique sur ${d} dans la bibliothèque en bas</div></div>
    <div class="bpmbox"><div class="bpm num" data-ctl="${d}.bpm">---.--<small> BPM</small></div><div class="sub"><span class="orig"></span><span class="keytag" data-ctl="${d}.key" hidden></span></div></div>
  </div>
  <div class="overview" data-ctl="${d}.overview" title="Vue d'ensemble du morceau : clique pour te déplacer (needle search)"><canvas></canvas></div>
  <div class="info"><span><b class="t-el">0:00.0</b> <span class="t-rem"></span></span><span class="sec"></span><span data-ctl="${d}.position">Mesure <b class="bar">–</b>.<b class="bt">–</b> · Phrase <b class="phr">–</b></span></div>
  <div class="body">
    <div class="transport">
      <div class="lbl">Boucle</div>
      <div class="grid4" style="grid-template-columns:1fr 1fr 1fr">
        <button class="btn" data-ctl="${d}.loopIn" title="LOOP IN : début de la boucle">IN</button>
        <button class="btn" data-ctl="${d}.loopOut" title="LOOP OUT : fin de la boucle (elle démarre)">OUT</button>
        <button class="btn lit-g" data-ctl="${d}.reloop" title="RELOOP / EXIT : sortir de la boucle ou y retourner">⟲</button>
      </div>
      <div class="grid4">${[1, 4, 8, 16].map((b) => `<button class="btn lit-g" data-ctl="${d}.loop${b}" data-loop="${b}" title="Boucle automatique de ${b} temps${b >= 4 ? ` (${b / 4} mesure${b > 4 ? 's' : ''})` : ''}">${b}</button>`).join('')}</div>
      <div class="grid2"><button class="btn" data-ctl="${d}.loopHalf" title="Boucle deux fois plus courte">½</button><button class="btn" data-ctl="${d}.loopDouble" title="Boucle deux fois plus longue">×2</button></div>
      <div class="lbl">Saut (4 mesures)</div>
      <div class="grid2"><button class="btn" data-ctl="${d}.jumpBack" title="BEAT JUMP : recule de 16 temps (4 mesures)">◀◀</button><button class="btn" data-ctl="${d}.jumpFwd" title="BEAT JUMP : avance de 16 temps (4 mesures)">▶▶</button></div>
      <div class="bigrow">
        <button class="bigbtn cue" data-ctl="${d}.cuebtn" title="CUE (façon CDJ)\n• À l'arrêt : pose le point de cue ici ; maintiens pour l'écouter, relâche pour y revenir.\n• En lecture : revient au point de cue et s'arrête.\nClavier : ${d === 'A' ? 'Q' : 'O'}">CUE</button>
        <button class="bigbtn play" data-ctl="${d}.play" title="PLAY / PAUSE\nClavier : ${d === 'A' ? 'W' : 'P'}">▶❚❚</button>
      </div>
    </div>
    <div class="jogwrap" data-ctl="${d}.jog"><canvas class="jog" title="JOG\n• En lecture : tourne le bord pour accélérer/freiner (caler la phase).\n• Mode VINYL : appuie sur le dessus pour arrêter le disque et scratcher.\n• À l'arrêt : tourne pour chercher le point exact.\n• Molette : petit décalage précis."></canvas>
      <button class="btn jogmode lit-y" title="Mode vinyle du jog">VINYL</button></div>
    <div class="tempo">
      <button class="btn rangebtn" data-ctl="${d}.range" title="Plage du fader de tempo (TEMPO RANGE)">±10%</button>
      <div class="pct num"></div>
      <div class="tf"></div>
      <div class="grid2" style="width:100%"><button class="btn" data-bend="-1" title="Freiner (pitch bend) — clavier ${d === 'A' ? 'A' : 'K'}">−</button><button class="btn" data-bend="1" title="Pousser (pitch bend) — clavier ${d === 'A' ? 'S' : 'L'}">+</button></div>
      <button class="btn lit-r" data-mt style="width:100%">M.TEMPO</button>
      <button class="btn lit-y" data-sync style="width:100%">SYNC</button>
    </div>
  </div>
  <div class="pads" data-ctl="${d}.hotcues">${HOTCUE_COLORS.map((c, i) => `<button class="pad" data-ctl="${d}.hc${i + 1}" data-hc="${i}" title="HOT CUE ${'ABCDEFGH'[i]}\nVide : mémorise l'endroit actuel. Plein : saute à cet endroit.\nClic droit : effacer.">${'ABCDEFGH'[i]}</button>`).join('')}</div>
  <div class="tools">
    <button class="btn lit-y" data-q>QUANTIZE</button>
    <span class="sp"></span>
    <button class="btn" data-ctl="${d}.bpmHalf" title="Le BPM détecté est le double du vrai : divise par 2">BPM ÷2</button>
    <button class="btn" data-ctl="${d}.bpmDouble" title="Le BPM détecté est la moitié du vrai : multiplie par 2">×2</button>
    <button class="btn" data-ctl="${d}.tap" title="TAP : tape en rythme (4 fois ou plus) pour mesurer le tempo">TAP</button>
    <button class="btn" data-ctl="${d}.downbeat" title="La grille est décalée d'un ou plusieurs temps ? Mets la lecture sur un « 1 » (premier temps d'une mesure) et clique.">1er temps ici</button>
    <button class="btn" data-ctl="${d}.gridL" title="Décaler la grille de 5 ms vers la gauche">◀</button><button class="btn" data-ctl="${d}.gridR" title="Décaler la grille de 5 ms vers la droite">▶</button>
    <button class="btn" data-ctl="${d}.eject" title="Éjecter le morceau">⏏</button>
  </div>`;

  const $ = (s) => root.querySelector(s);
  const on = (sel, ev, fn) => root.querySelectorAll(sel).forEach((el) => el.addEventListener(ev, fn));

  // ---- transport ----
  const cueBtn = $('.bigbtn.cue'), playBtn = $('.bigbtn.play');
  cueBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); cueBtn.setPointerCapture(e.pointerId); deck.cueDown(); });
  cueBtn.addEventListener('pointerup', () => deck.cueUp());
  playBtn.addEventListener('click', () => deck.togglePlay());
  on('[data-loop]', 'click', (e) => deck.autoLoop(Number(e.currentTarget.dataset.loop)));
  $(`[data-ctl="${d}.loopIn"]`).onclick = () => deck.loopIn();
  $(`[data-ctl="${d}.loopOut"]`).onclick = () => deck.loopOut();
  $(`[data-ctl="${d}.reloop"]`).onclick = () => deck.toggleLoop();
  $(`[data-ctl="${d}.loopHalf"]`).onclick = () => deck.resizeLoop(0.5);
  $(`[data-ctl="${d}.loopDouble"]`).onclick = () => deck.resizeLoop(2);
  $(`[data-ctl="${d}.jumpBack"]`).onclick = () => deck.beatJump(-16);
  $(`[data-ctl="${d}.jumpFwd"]`).onclick = () => deck.beatJump(16);
  on('[data-hc]', 'click', (e) => deck.hotcue(Number(e.currentTarget.dataset.hc)));
  on('[data-hc]', 'contextmenu', (e) => { e.preventDefault(); deck.deleteHotcue(Number(e.currentTarget.dataset.hc)); });
  on('[data-bend]', 'pointerdown', (e) => { e.currentTarget.setPointerCapture(e.pointerId); deck.setBend(0.04 * Number(e.currentTarget.dataset.bend)); });
  on('[data-bend]', 'pointerup', () => deck.setBend(0));
  $(`[data-ctl="${d}.bpmHalf"]`).onclick = () => deck.bpm && deck.setGrid(deck.bpm / 2, deck.track.firstBeat);
  $(`[data-ctl="${d}.bpmDouble"]`).onclick = () => deck.bpm && deck.setGrid(deck.bpm * 2, deck.track.firstBeat);
  $(`[data-ctl="${d}.downbeat"]`).onclick = () => deck.setDownbeatHere();
  $(`[data-ctl="${d}.gridL"]`).onclick = () => deck.shiftGrid(-5);
  $(`[data-ctl="${d}.gridR"]`).onclick = () => deck.shiftGrid(5);
  $(`[data-ctl="${d}.eject"]`).onclick = () => { if (deck.playing && app.engine.audible(d) > 0.05) return app.toast('La platine est à l\'antenne : baisse son fader avant d\'éjecter.'); deck.unload(); };
  const taps = [];
  $(`[data-ctl="${d}.tap"]`).onclick = () => {
    const t = performance.now();
    if (taps.length && t - taps.at(-1) > 2000) taps.length = 0;
    taps.push(t); if (taps.length > 16) taps.shift();
    if (taps.length >= 4) {
      const bpm = 60000 / ((taps.at(-1) - taps[0]) / (taps.length - 1));
      deck.tapBpm = bpm;
      app.toast(`TAP : ${bpm.toFixed(1)} BPM${deck.loaded ? ` (grille actuelle : ${deck.bpm.toFixed(2)})` : ''}`);
      deck.emit('tap', bpm);
    } else app.toast(`TAP… (${taps.length}/4)`);
  };

  toggle($('[data-mt]'), C.get(`${d}.keylock`));
  toggle($('[data-sync]'), C.get(`${d}.sync`));
  toggle($('[data-q]'), C.get(`${d}.quantize`));
  toggle($('.jogmode'), C.get(`${d}.vinyl`));
  $('[data-mt]').dataset.ctl = `${d}.keylock`; $('[data-sync]').dataset.ctl = `${d}.sync`;
  vfader($('.tf'), C.get(`${d}.tempo`), { invert: true, center: true });
  $('.rangebtn').onclick = () => { const i = TEMPO_RANGES.indexOf(deck.range); deck.setRange(TEMPO_RANGES[(i + 1) % TEMPO_RANGES.length]); };

  // glisser-déposer d'un morceau : géré par app.js (bibliothèque -> platine, fichiers Windows -> platine)

  // ---- vue d'ensemble ----
  const ov = new Overview($('.overview canvas'), deck, color);
  $('.overview').addEventListener('pointerdown', (e) => {
    if (!deck.loaded) return;
    const r = e.currentTarget.getBoundingClientRect();
    deck.seek(((e.clientX - r.left) / r.width) * deck.duration);
  });

  // ---- jog ----
  const jog = new Jog($('.jog'), deck, color);

  // ---- affichage ----
  const el = { title: $('.title'), artist: $('.artist'), bpm: $('.bpm'), orig: $('.orig'), key: $('.keytag'), tel: $('.t-el'), trem: $('.t-rem'), bar: $('.bar'), bt: $('.bt'), phr: $('.phr'), sec: $('.sec'), pct: $('.pct'), range: $('.rangebtn') };
  const loopBtns = [...root.querySelectorAll('[data-loop]')];
  const pads = [...root.querySelectorAll('[data-hc]')];
  let lastSig = '';
  live(() => {
    const t = deck.track;
    const sig = t ? `${t.title}|${t.artist}` : '';
    if (sig !== lastSig) { lastSig = sig; el.title.textContent = t ? t.title : 'Aucun morceau'; el.artist.textContent = t ? (t.artist || '—') + (t.genre ? ` · ${t.genre}` : '') : `Glisse un morceau ici, ou clique sur ${d} dans la bibliothèque en bas`; }
    const pos = deck.position();
    el.tel.textContent = t ? fmt(pos) : '0:00.0';
    el.trem.textContent = t ? fmt(deck.duration - pos, true) : '';
    if (t && deck.bpm) {
      el.bpm.innerHTML = view.hideBpm ? '???.??<small> BPM</small>' : `${deck.effBpm.toFixed(2)}<small> BPM</small>`;
      el.orig.textContent = view.hideBpm ? '' : `orig. ${deck.bpm.toFixed(2)}`;
      const bi = deck.barInfo(pos);
      el.bar.textContent = bi.bar; el.bt.textContent = bi.beatInBar; el.phr.textContent = `${bi.phrase} (${bi.barInPhrase}/8)`;
      el.sec.textContent = sectionAt(deck, bi.bar) || '';
    } else { el.bpm.innerHTML = '---.--<small> BPM</small>'; el.orig.textContent = t ? 'analyse…' : ''; el.bar.textContent = el.bt.textContent = el.phr.textContent = '–'; el.sec.textContent = ''; }
    // tonalité (Camelot), décalée si le tempo change sans Master Tempo
    const cam = t?.key ? camelot(t.key) : null;
    if (cam) {
      const shift = deck.keylock ? 0 : 12 * Math.log2(deck.rate);
      const c = shiftedCamelot(cam, shift);
      const o = deck.other(); const oc = o.track?.key ? shiftedCamelot(camelot(o.track.key), o.keylock ? 0 : 12 * Math.log2(o.rate)) : null;
      el.key.hidden = false; el.key.textContent = c + (c !== cam ? '*' : '');
      el.key.title = `Tonalité : ${t.key} (Camelot ${cam})${t.keyEstimated ? ' — estimée par IrisDJ, peut être fausse' : ''}${c !== cam ? `\n* transposée en ${c} par le tempo (active M.TEMPO pour garder ${cam})` : ''}${oc ? `\n${compatible(c, oc) ? 'Compatible' : 'Pas compatible'} avec l'autre platine (${oc})` : ''}`;
      el.key.className = 'keytag' + (oc ? (compatible(c, oc) ? ' ok' : ' bad') : '');
    } else el.key.hidden = true;
    el.pct.textContent = `${deck.tempoPct >= 0 ? '+' : ''}${deck.tempoPct.toFixed(2)}%`;
    el.range.textContent = deck.range === 50 ? 'WIDE' : `±${deck.range}%`;
    playBtn.classList.toggle('on', deck.playing && !deck._cueHeld);
    cueBtn.classList.toggle('on', deck.loaded && !deck.playing && Math.abs(pos - deck.cuePoint) < 0.02);
    cueBtn.classList.toggle('blink', deck.loaded && !deck.playing && Math.abs(pos - deck.cuePoint) >= 0.02);
    loopBtns.forEach((b) => b.classList.toggle('on', deck.loop.active && deck.loop.beats === Number(b.dataset.loop)));
    root.querySelector(`[data-ctl="${d}.reloop"]`).classList.toggle('on', deck.loop.active);
    pads.forEach((p, i) => { const set = deck.hotcues[i] != null; p.classList.toggle('set', set); p.style.background = set ? HOTCUE_COLORS[i] : ''; });
    ov.render(); jog.render();
  });
  return { ov, jog };
}

// ------------------------------------------------------------------ forme d'onde défilante
const WAVE_COL = { low: '#1f6cff', mid: '#ff9d1a', high: '#f4f4f4' };

function sizeCanvas(c) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(c.clientWidth * dpr)), h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; return true; }
  return false;
}

export class WaveView {
  constructor(canvas, deck, color) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.deck = deck; this.color = color;
    this.tiles = null; this.H = 160;
    deck.on('analysis', () => this.build());
    deck.on('load', () => { this.tiles = null; });
  }
  build() {
    const w = this.deck.wave; if (!w) return;
    const TILE = 4096, H = this.H, n = w.low.length;
    this.tiles = [];
    for (let s = 0; s < n; s += TILE) {
      const len = Math.min(TILE, n - s);
      const c = new OffscreenCanvas(len, H), g = c.getContext('2d');
      const mid = H / 2;
      for (const [arr, col, k] of [[w.mid, WAVE_COL.mid, 0.9], [w.high, WAVE_COL.high, 0.55], [w.low, WAVE_COL.low, 0.8]]) {
        g.fillStyle = col;
        for (let i = 0; i < len; i++) { const h = Math.max(0.5, arr[s + i] * mid * k); g.fillRect(i, mid - h, 1, h * 2); }
      }
      this.tiles.push({ c, start: s });
    }
  }
  render() {
    sizeCanvas(this.c);
    const g = this.g, W = this.c.width, H = this.c.height, dpr = window.devicePixelRatio || 1, deck = this.deck;
    g.fillStyle = '#07080a'; g.fillRect(0, 0, W, H);
    if (!deck.loaded) { g.fillStyle = '#3a414d'; g.font = `${12 * dpr}px Segoe UI`; g.fillText(`Platine ${deck.id} vide`, 40 * dpr, H / 2 + 4); return; }
    const pos = deck.position();
    const pxPerSec = W / (view.zoom * Math.max(0.2, deck.rate));
    const x = (sec) => W / 2 + (sec - pos) * pxPerSec;
    const t0 = pos - W / 2 / pxPerSec, t1 = pos + W / 2 / pxPerSec;
    // boucle
    const l = deck.loop;
    if (l.in != null) { g.fillStyle = l.active ? 'rgba(56,217,122,.18)' : 'rgba(56,217,122,.07)'; g.fillRect(x(l.in), 0, l.out != null ? x(l.out) - x(l.in) : 2 * dpr, H); }
    // forme d'onde
    if (this.tiles) {
      const pps = deck.wave.pps;
      for (const t of this.tiles) {
        const ts = t.start / pps, te = (t.start + t.c.width) / pps;
        if (te < t0 || ts > t1) continue;
        g.drawImage(t.c, x(ts), 0, (te - ts) * pxPerSec, H);
      }
    } else { g.fillStyle = '#3a414d'; g.font = `${12 * dpr}px Segoe UI`; g.fillText('Analyse de la forme d\'onde…', 40 * dpr, H / 2 + 4); }
    // grille
    if (deck.bpm) {
      const b0 = Math.ceil(deck.beatAt(t0)), b1 = Math.floor(deck.beatAt(t1));
      for (let b = b0; b <= b1; b++) {
        const X = Math.round(x(deck.secAtBeat(b)));
        const bar = b % 4 === 0, phrase = b % 32 === 0;
        g.fillStyle = phrase ? 'rgba(255,61,61,.95)' : bar ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.16)';
        g.fillRect(X, 0, phrase ? 2 * dpr : 1, H);
        if (bar) {
          g.fillStyle = phrase ? '#ff6b6b' : 'rgba(255,255,255,.55)';
          g.font = `${(phrase ? 11 : 9.5) * dpr}px Segoe UI`;
          g.fillText(phrase ? `PHRASE ${Math.floor(b / 32) + 1}` : String(b / 4 + 1), X + 3 * dpr, H - 4 * dpr);
        }
      }
    }
    // cue + hot cues
    const tri = (X, col, top = true) => { g.fillStyle = col; g.beginPath(); const s = 6 * dpr; if (top) { g.moveTo(X - s, 0); g.lineTo(X + s, 0); g.lineTo(X, s * 1.3); } else { g.moveTo(X - s, H); g.lineTo(X + s, H); g.lineTo(X, H - s * 1.3); } g.fill(); };
    tri(x(deck.cuePoint), '#ffaa00'); g.fillStyle = 'rgba(255,170,0,.6)'; g.fillRect(x(deck.cuePoint), 0, 1, H);
    deck.hotcues.forEach((h, i) => {
      if (h == null) return; const X = x(h); if (X < -20 || X > W + 20) return;
      g.fillStyle = HOTCUE_COLORS[i]; g.fillRect(X, 0, 1.5 * dpr, H);
      g.fillRect(X, 0, 13 * dpr, 13 * dpr); g.fillStyle = '#000'; g.font = `bold ${10 * dpr}px Segoe UI`; g.fillText('ABCDEFGH'[i], X + 3 * dpr, 10.5 * dpr);
    });
    // tête de lecture
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, 0, W / 2, H);
    g.fillStyle = '#fff'; g.fillRect(W / 2 - dpr, 0, 2 * dpr, H);
  }
}

// ------------------------------------------------------------------ vue d'ensemble
class Overview {
  constructor(canvas, deck, color) { this.c = canvas; this.g = canvas.getContext('2d'); this.deck = deck; this.color = color; this.img = null; this.forW = 0; deck.on('analysis', () => (this.img = null)); deck.on('load', () => (this.img = null)); }
  build(W, H) {
    const w = this.deck.wave; if (!w) return null;
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d'), n = w.low.length, mid = H / 2;
    for (const [arr, col, k] of [[w.mid, WAVE_COL.mid, 0.9], [w.high, WAVE_COL.high, 0.55], [w.low, WAVE_COL.low, 0.8]]) {
      g.fillStyle = col;
      for (let X = 0; X < W; X++) {
        const a = Math.floor((X / W) * n), b = Math.max(a + 1, Math.floor(((X + 1) / W) * n));
        let m = 0; for (let i = a; i < b; i++) if (arr[i] > m) m = arr[i];
        const h = Math.max(0.5, m * mid * k); g.fillRect(X, mid - h, 1, 2 * h);
      }
    }
    return c;
  }
  render() {
    const resized = sizeCanvas(this.c);
    const g = this.g, W = this.c.width, H = this.c.height, deck = this.deck, dpr = window.devicePixelRatio || 1;
    g.fillStyle = '#08090b'; g.fillRect(0, 0, W, H);
    if (!deck.loaded) return;
    if (!this.img || resized || this.forW !== W) { this.img = this.build(W, H); this.forW = W; }
    if (this.img) g.drawImage(this.img, 0, 0);
    const X = (s) => (s / deck.duration) * W;
    // sections (pistes d'entraînement) ou phrases
    if (deck.bpm) {
      g.font = `${9 * dpr}px Segoe UI`;
      if (deck.track.source === 'practice') {
        for (const s of SECTIONS) { const xs = X(deck.secAtBeat((s.from - 1) * 4)); g.fillStyle = 'rgba(255,210,61,.8)'; g.fillRect(xs, 0, 1, H); g.fillText(s.name, xs + 3, 10 * dpr); }
      } else {
        g.fillStyle = 'rgba(255,255,255,.25)';
        for (let b = 0; deck.secAtBeat(b) < deck.duration; b += 32) g.fillRect(X(deck.secAtBeat(b)), H - 5 * dpr, 1, 5 * dpr);
      }
    }
    const p = X(deck.position());
    g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, 0, p, H);
    const l = deck.loop; if (l.in != null && l.out != null) { g.fillStyle = 'rgba(56,217,122,.35)'; g.fillRect(X(l.in), 0, Math.max(2, X(l.out) - X(l.in)), H); }
    g.fillStyle = '#ffaa00'; g.fillRect(X(deck.cuePoint) - dpr, H - 6 * dpr, 3 * dpr, 6 * dpr);
    deck.hotcues.forEach((h, i) => { if (h != null) { g.fillStyle = HOTCUE_COLORS[i]; g.fillRect(X(h) - dpr, 0, 3 * dpr, 6 * dpr); } });
    g.fillStyle = '#fff'; g.fillRect(p - dpr, 0, 2 * dpr, H);
  }
}

// ------------------------------------------------------------------ jog
class Jog {
  constructor(canvas, deck, color) {
    this.c = canvas; this.g = canvas.getContext('2d'); this.deck = deck; this.color = color; this.touch = null;
    const ang = (e) => { const r = canvas.getBoundingClientRect(); return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)); };
    const rad = (e) => { const r = canvas.getBoundingClientRect(); return Math.hypot(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) / (Math.min(r.width, r.height) / 2); };
    let last = 0, bendTimer = null;
    canvas.addEventListener('pointerdown', (e) => {
      if (!deck.loaded) return;
      canvas.setPointerCapture(e.pointerId);
      last = ang(e);
      const inner = rad(e) < 0.74;
      this.touch = (!deck.playing || (deck.vinyl !== false && inner)) ? 'scratch' : 'bend';
      if (this.touch === 'scratch') deck.scratchStart();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.touch) return;
      const a = ang(e); let da = a - last; last = a;
      if (da > Math.PI) da -= 2 * Math.PI; if (da < -Math.PI) da += 2 * Math.PI;
      if (this.touch === 'scratch') deck.scratchMove((da / (2 * Math.PI)) * 1.8);
      else { deck.setBend(Math.max(-0.25, Math.min(0.25, da * 1.6))); clearTimeout(bendTimer); bendTimer = setTimeout(() => deck.setBend(0), 70); }
    });
    const end = () => { if (this.touch === 'scratch') deck.scratchEnd(); else deck.setBend(0); this.touch = null; };
    canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('wheel', (e) => { e.preventDefault(); if (!deck.loaded) return; deck.seek(deck.position() - Math.sign(e.deltaY) * (e.shiftKey ? 0.002 : 0.008)); }, { passive: false });
  }
  render() {
    sizeCanvas(this.c);
    const g = this.g, W = this.c.width, H = this.c.height, R = Math.min(W, H) / 2 - 2, cx = W / 2, cy = H / 2, deck = this.deck;
    g.clearRect(0, 0, W, H);
    // bague extérieure
    g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.fillStyle = '#0d0f12'; g.fill();
    g.lineWidth = R * 0.05; g.strokeStyle = this.touch === 'bend' ? this.color : '#2b313b'; g.stroke();
    for (let i = 0; i < 48; i++) { const a = (i / 48) * 2 * Math.PI; g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.8, cy + Math.sin(a) * R * 0.8); g.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92); g.strokeStyle = '#1f242c'; g.lineWidth = R * 0.03; g.stroke(); }
    // plateau
    const rot = deck.loaded ? (deck.position() / 1.8) * 2 * Math.PI : 0;
    g.beginPath(); g.arc(cx, cy, R * 0.74, 0, 2 * Math.PI);
    const grd = g.createRadialGradient(cx, cy - R * 0.3, R * 0.1, cx, cy, R * 0.74); grd.addColorStop(0, '#2e343e'); grd.addColorStop(1, '#181b21');
    g.fillStyle = grd; g.fill(); g.lineWidth = 2; g.strokeStyle = this.touch === 'scratch' ? this.color : '#38404b'; g.stroke();
    g.save(); g.translate(cx, cy); g.rotate(rot);
    g.fillStyle = this.color; g.fillRect(-R * 0.025, -R * 0.72, R * 0.05, R * 0.28);
    g.restore();
    // centre : position mesure.temps
    g.beginPath(); g.arc(cx, cy, R * 0.34, 0, 2 * Math.PI); g.fillStyle = '#0a0c0f'; g.fill();
    if (deck.loaded && deck.bpm) {
      const bi = deck.barInfo();
      // anneau de phase (4 temps)
      for (let i = 0; i < 4; i++) {
        g.beginPath(); g.arc(cx, cy, R * 0.3, -Math.PI / 2 + (i * Math.PI) / 2 + 0.06, -Math.PI / 2 + ((i + 1) * Math.PI) / 2 - 0.06);
        g.lineWidth = R * 0.05; g.strokeStyle = i + 1 === bi.beatInBar ? this.color : '#232831'; g.stroke();
      }
      g.fillStyle = '#e7eaef'; g.font = `700 ${R * 0.17}px Cascadia Mono, Consolas`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(`${bi.bar}.${bi.beatInBar}`, cx, cy);
      g.textAlign = 'start'; g.textBaseline = 'alphabetic';
    }
  }
}

// ------------------------------------------------------------------ indicateur de phase (entre les formes d'onde)
export class PhaseMeter {
  constructor(canvas, engine) { this.c = canvas; this.g = canvas.getContext('2d'); this.engine = engine; }
  render() {
    sizeCanvas(this.c);
    const g = this.g, W = this.c.width, H = this.c.height, dpr = window.devicePixelRatio || 1;
    g.fillStyle = '#0c0e11'; g.fillRect(0, 0, W, H);
    const { A, B } = this.engine.decks;
    const bw = Math.min(W * 0.36, 420 * dpr), x0 = (W - bw) / 2, rowH = (H - 3 * dpr) / 2;
    [[A, '#2ea8ff', 0], [B, '#ff8a1f', rowH + 3 * dpr]].forEach(([d, col, y]) => {
      for (let i = 0; i < 4; i++) {
        const lit = d.loaded && d.bpm && d.barInfo().beatInBar === i + 1;
        g.fillStyle = lit ? col : '#1c2027';
        g.fillRect(x0 + (i * bw) / 4 + dpr, y + dpr, bw / 4 - 2 * dpr, rowH - dpr);
      }
      if (d.loaded && d.bpm) { const bi = d.barInfo(); const X = x0 + ((bi.beatInBar - 1 + bi.phase) / 4) * bw; g.fillStyle = '#fff'; g.fillRect(X - dpr, y, 2 * dpr, rowH + dpr); }
    });
    g.font = `${10.5 * dpr}px Cascadia Mono, Consolas`; g.textBaseline = 'middle';
    const ph = phaseDiff(this.engine);
    g.fillStyle = '#8d95a3';
    g.fillText('PHASE', x0 - 52 * dpr, H / 2);
    if (ph) {
      const bad = Math.abs(ph.ms) > 25, ok = Math.abs(ph.ms) < 10;
      g.fillStyle = ok ? '#38d97a' : bad ? '#ff3d3d' : '#ffd23d';
      const txt = view.hideBpm ? (ok ? 'calé' : 'décalé') : `${ph.ms >= 0 ? '+' : ''}${ph.ms.toFixed(0)} ms ${ph.ms > 2 ? '(B en avance)' : ph.ms < -2 ? '(B en retard)' : ''}`;
      g.fillText(txt + (ph.ratio !== 1 ? `  ·  tempo ×${ph.ratio}` : ''), x0 + bw + 12 * dpr, H / 2);
    }
    g.textBaseline = 'alphabetic';
  }
}

// écart de phase entre B et A (ms, >0 = B en avance), si les deux jouent et ont une grille
export function phaseDiff(engine) {
  const { A, B } = engine.decks;
  if (!A.loaded || !B.loaded || !A.bpm || !B.bpm || !A.playing || !B.playing) return null;
  const r = B.effBpm / A.effBpm;
  const ratio = Math.abs(r - 1) < 0.25 ? 1 : Math.abs(r - 2) < 0.4 ? 2 : Math.abs(r - 0.5) < 0.1 ? 0.5 : null;
  if (!ratio) return null;
  const bA = A.beatAt(A.position()), bB = B.beatAt(B.position());
  // compare au tempo le plus rapide
  let d = ratio >= 1 ? bB - bA * ratio : bB / ratio - bA;
  d = ((d % 1) + 1.5) % 1 - 0.5;
  const beatMs = 60000 / Math.max(A.effBpm, B.effBpm);
  return { ms: d * beatMs, beats: d, ratio, tempoDiff: B.effBpm - A.effBpm * ratio };
}
