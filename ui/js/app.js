import { Engine } from './engine.js';
import { buildControls } from './controls.js';
import { buildDeck, WaveView, PhaseMeter, view } from './deckui.js';
import { buildMixer } from './mixerui.js';
import { refreshAll } from './widgets.js';
import { Library, saveTrackInfo } from './library.js';
import { Learn } from './learn.js';
import { Coach } from './coach.js';
import { installAgent } from './agent.js';
import { PRACTICE } from './synth.js';

const { invoke } = window.__TAURI__.core;

const $ = (s) => document.querySelector(s);
const MAX_MIN = 20; // durée max d'un morceau (min) : au-delà c'est un mix, trop lourd en mémoire

// ------------------------------------------------------------------ utilitaires
let toastT = null;
function toast(msg, ms = 3200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
window.dj.onToast?.((m) => toast(m, 6000));
function modal(html, onReady) {
  const m = $('#modal'); $('#modal-body').innerHTML = html; m.hidden = false;
  const close = () => (m.hidden = true);
  m.onclick = (e) => { if (e.target === m) close(); };
  m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  onReady?.(m, close);
  return close;
}

// première ouverture de la version Rust : on reprend les données de l'ancienne version Electron
// (cours terminés, BPM / tonalités analysés ; les cues et hot cues sont repris par le moteur)
try {
  if (!localStorage.getItem('migratedV2')) {
    const old = await invoke('migrated_storage');
    if (old) for (const [k, v] of Object.entries(old)) if (localStorage.getItem(k) == null) localStorage.setItem(k, v);
    localStorage.setItem('migratedV2', '1');
  }
} catch (e) { console.warn('reprise des anciennes données', e); }

// ------------------------------------------------------------------ démarrage
const engine = await new Engine().init();
const C = buildControls(engine);
const app = { engine, controls: C, toast, view };
window.__app = app;

for (const d of ['A', 'B']) buildDeck($(`#deck-${d}`), engine.decks[d], C, app);
buildMixer($('#mixer'), engine, C);
const waves = { A: new WaveView($('#wave-A canvas'), engine.decks.A, '#2ea8ff'), B: new WaveView($('#wave-B canvas'), engine.decks.B, '#ff8a1f') };
const phase = new PhaseMeter($('#phase canvas'), engine);
document.querySelectorAll('[data-zoom]').forEach((b) => (b.onclick = () => { view.zoom = Math.max(2, Math.min(32, view.zoom * (b.dataset.zoom > 0 ? 0.7 : 1 / 0.7))); }));
$('#btn-audio').dataset.zone = 'btn-audio';

app.coach = new Coach(app);
app.library = new Library(app);
app.learn = new Learn(app);
app.setHideBpm = (v) => { view.hideBpm = !!v; };
installAgent(app);

// BPM et tonalité analysés : gardés pour la bibliothèque
for (const d of ['A', 'B']) {
  engine.decks[d].on('analysis', () => {
    const t = engine.decks[d].track;
    if (!t || t.source === 'practice') return;
    saveTrackInfo(t, { bpm: t.bpm, key: t.key });
    if (t.source === 'files') window.dj.lib.update(t.id, { bpm: t.bpm, key: t.key });
    app.library.render();
  });
}

// ------------------------------------------------------------------ chargement des morceaux
const loadingEl = (d, html) => {
  const root = $(`#deck-${d}`); let el = root.querySelector('.loading');
  if (!html) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.className = 'loading'; root.appendChild(el); }
  el.innerHTML = html;
};

// Formats que le moteur Rust ne lit pas (Opus / WebM de YouTube) : décodés par WebView2, puis envoyés au moteur.
async function decodeInPage(d, track, path) {
  const bytes = await invoke('read_file', { path });
  const ctx = new OfflineAudioContext(2, 1, engine.sr);
  const buf = await ctx.decodeAudioData(bytes);
  if (buf.duration > MAX_MIN * 60) throw new Error(`Morceau trop long (${Math.round(buf.duration / 60)} min) : c'est sûrement un mix entier. Choisis un morceau seul.`);
  const L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L;
  const body = new Uint8Array(L.length * 8);
  new Float32Array(body.buffer, 0, L.length).set(L);
  new Float32Array(body.buffer, L.length * 4, L.length).set(R);
  return invoke('load_pcm', body, { headers: { 'x-deck': d, 'x-track': encodeURIComponent(JSON.stringify(track)), 'x-sr': String(buf.sampleRate) } });
}

let pendingLoad = null;
app.loadTrack = async (d, track, { force = false } = {}) => {
  const deck = engine.decks[d];
  if (!force && deck.playing && engine.audible(d) > 0.05) {
    const key = `${d}:${track.source}:${track.id}`;
    if (!pendingLoad || pendingLoad.key !== key || Date.now() - pendingLoad.t > 4000) {
      pendingLoad = { key, t: Date.now() };
      toast(`La platine ${d} est à l'antenne ! Sur un vrai CDJ ça couperait le son. Reclique pour charger quand même.`, 4000);
      return false;
    }
  }
  pendingLoad = null;
  loadingEl(d, `Chargement de<br><b>${track.title.replace(/</g, '&lt;')}</b>…${track.source === 'practice' ? '<br><small>(première fois : génération de la piste)</small>' : (track.source === 'soundcloud' || track.source === 'youtube') && !track.downloaded ? '<br><small>(téléchargement dans le dossier Téléchargés)</small>' : ''}`);
  try {
    // tout se passe dans le moteur Rust : téléchargement, décodage, rééchantillonnage, analyse
    let r = await invoke('load_track', { d, track: { ...track } });
    if (r && r.needDecode) r = await decodeInPage(d, r.track || track, r.needDecode);
    // attendre que l'état de la platine montre le nouveau morceau
    for (let i = 0; i < 50 && !(deck.track && deck.track.source === track.source && String(deck.track.id) === String(track.id)); i++) await new Promise((res) => setTimeout(res, 20));
    if ((track.source === 'soundcloud' || track.source === 'youtube') && !track.downloaded) { track.downloaded = true; app.library.results.files = null; }
    loadingEl(d, null);
    return true;
  } catch (e) {
    console.error(e);
    loadingEl(d, null);
    toast(`Impossible de charger « ${track.title} » : ${e.message || e}`, 6000);
    return false;
  }
};

app.freeDeck = () => {
  const { A, B } = engine.decks;
  if (!A.loaded) return 'A'; if (!B.loaded) return 'B';
  if (!A.playing && B.playing) return 'A'; if (!B.playing && A.playing) return 'B';
  return engine.audible('A') <= engine.audible('B') ? 'A' : 'B';
};

// ---- glisser-déposer ----
const dropHint = $('#drop-hint');
const deckAt = (x, y) => document.elementFromPoint(x, y)?.closest('.deck')?.dataset.deck || null;
const markDeck = (d) => document.querySelectorAll('.deck').forEach((el) => el.classList.toggle('dragover', el.dataset.deck === d));

// un morceau de la bibliothèque glissé sur une platine
app.startDrag = (e, track) => {
  if (e.button !== 0) return;
  const x0 = e.clientX, y0 = e.clientY;
  let ghost = null;
  const move = (ev) => {
    if (!ghost) {
      if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
      ghost = document.createElement('div'); ghost.className = 'drag-ghost';
      ghost.textContent = `${track.artist ? track.artist + ' – ' : ''}${track.title}`;
      document.body.appendChild(ghost);
    }
    ghost.style.left = ev.clientX + 12 + 'px'; ghost.style.top = ev.clientY + 8 + 'px';
    markDeck(deckAt(ev.clientX, ev.clientY));
  };
  const up = (ev) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    if (!ghost) return;
    ghost.remove(); markDeck(null);
    const d = deckAt(ev.clientX, ev.clientY);
    if (d) app.loadTrack(d, track);
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
};

// des fichiers glissés depuis l'Explorateur : sur une platine -> chargés ; ailleurs -> ajoutés à « Mes fichiers »
window.__TAURI__.webviewWindow.getCurrentWebviewWindow().onDragDropEvent(async (ev) => {
  const p = ev.payload;
  const pos = p.position ? { x: p.position.x / devicePixelRatio, y: p.position.y / devicePixelRatio } : null;
  if (p.type === 'enter' || p.type === 'over') { dropHint.hidden = false; if (pos) markDeck(deckAt(pos.x, pos.y)); return; }
  dropHint.hidden = true; markDeck(null);
  if (p.type !== 'drop' || !p.paths?.length) return;
  const lib = await window.dj.lib.addPaths(p.paths);
  app.library.results.files = lib;
  const added = lib.filter((t) => p.paths.some((x) => t.path === x || t.path.startsWith(x + '\\')));
  const d = pos && deckAt(pos.x, pos.y);
  if (d && added[0]) app.loadTrack(d, added[0]);
  else if (added.length) { app.library.setTab('files'); toast(`${added.length} morceau(x) ajouté(s) à « Mes fichiers »`); }
});

// ------------------------------------------------------------------ mise en place pour un cours
app.prepare = async (s) => {
  const e = engine;
  for (const d of ['A', 'B']) e.decks[d].pause();
  for (const d of ['A', 'B']) {
    for (const k of ['hi', 'mid', 'low', 'filter']) e.set(`${d}.${k}`, 0);
    e.set(`${d}.trim`, s.trim?.[d] ?? 0);
    e.set(`${d}.fader`, s.faders?.[d] ?? 0);
    e.set(`${d}.cue`, d === 'B' && !!s.cueB);
    e.set(`${d}.xf`, d);
  }
  e.set('xfader', s.xfader ?? 0); e.set('xfCurve', 'smooth');
  e.set('fx.on', false); e.set('fx.type', 'echo'); e.set('fx.beat', 1); e.set('fx.channel', 'A'); e.set('fx.level', 0.5);
  view.hideBpm = false;
  for (const d of ['A', 'B']) {
    const id = s[d]; if (!id) continue;
    const deck = e.decks[d];
    // id d'une piste d'entraînement, ou vrai morceau { source, id, title, artist } (SoundCloud / YouTube)
    const want = typeof id === 'object' ? id : PRACTICE.find((x) => x.id === id);
    if (!(deck.track?.source === want.source && String(deck.track.id) === String(want.id))) {
      if (!(await app.loadTrack(d, want, { force: true }))) return false;
    }
    // vrai morceau : attendre l'analyse (BPM + grille) avant de placer le cue
    for (let i = 0; i < 100 && !deck.bpm; i++) await new Promise((r) => setTimeout(r, 150));
    deck.setSync(false); deck.setKeylock(false); deck.quantize = true; deck.exitLoop();
    deck.range = d === 'B' && s.rangeB ? s.rangeB : 10; deck.setTempo(0, true);
    deck.hotcues = Array(8).fill(null);
    const bar = s[`seek${d}`] || 1;
    deck.cuePoint = deck.secAtBeat((bar - 1) * 4); deck.saveMeta();
    deck.seek(deck.cuePoint);
    deck.emit('change');
  }
  if (s.matchB && e.decks.B.loaded) e.decks.B.matchTempo();
};

// ------------------------------------------------------------------ reset
app.resetAll = () => {
  const e = engine;
  for (const d of ['A', 'B']) {
    const k = e.decks[d];
    k.pause(); k.setSync(false); k.setKeylock(false); k.quantize = true; k.vinyl = true; k.exitLoop(); k.setBend(0);
    k.range = 10; k.setTempo(0, true);
    if (k.loaded) k.seek(k.cuePoint);
    for (const p of ['trim', 'hi', 'mid', 'low', 'filter']) e.set(`${d}.${p}`, 0);
    e.set(`${d}.fader`, 0); e.set(`${d}.cue`, false); e.set(`${d}.xf`, d);
    k.emit('change');
  }
  e.set('xfader', 0); e.set('xfCurve', 'smooth'); e.set('master', 0.8); e.set('phonesMix', 0); e.set('phonesLevel', 0.8); e.set('limiter', true);
  e.set('fx.on', false); e.set('fx.type', 'echo'); e.set('fx.beat', 1); e.set('fx.channel', 'A'); e.set('fx.level', 0.5);
  view.hideBpm = false; view.zoom = 8;
  app.learn.highlight([]);
  app.coach.say('Table remise à zéro.', 'good', 2500);
};
$('#btn-reset').onclick = () => app.resetAll();

// ------------------------------------------------------------------ clavier
const held = new Set();
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (held.has(k)) return; held.add(k);
  const { A, B } = engine.decks;
  const lowToggle = (d) => engine.set(`${d}.low`, engine.mix[d].low <= -0.98 ? 0 : -1);
  const map = {
    q: () => A.cueDown(), w: () => A.togglePlay(), a: () => A.setBend(-0.04), s: () => A.setBend(0.04), d: () => lowToggle('A'),
    o: () => B.cueDown(), p: () => B.togglePlay(), k: () => B.setBend(-0.04), l: () => B.setBend(0.04), j: () => lowToggle('B'),
    1: () => A.hotcue(0), 2: () => A.hotcue(1), 3: () => A.hotcue(2), 4: () => A.hotcue(3),
    7: () => B.hotcue(0), 8: () => B.hotcue(1), 9: () => B.hotcue(2), 0: () => B.hotcue(3),
    arrowleft: () => engine.set('xfader', -1), arrowright: () => engine.set('xfader', 1), arrowdown: () => engine.set('xfader', 0),
    e: () => engine.set('fx.on', !engine.mix.fx.on),
  };
  if (map[k]) { map[k](); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase(); held.delete(k);
  const { A, B } = engine.decks;
  if (k === 'q') A.cueUp(); if (k === 'o') B.cueUp();
  if (k === 'a' || k === 's') A.setBend(0); if (k === 'k' || k === 'l') B.setBend(0);
});
window.addEventListener('blur', () => held.clear());
$('#btn-keys').onclick = () => modal(`<h2>Raccourcis clavier</h2>
  <p class="hint">Sur un vrai matériel tu as deux mains : le clavier t'aide à faire deux gestes en même temps (le bass swap !).</p>
  <table>
  <tr><td>Q / O</td><td>CUE platine A / B (maintenir pour pré-écouter)</td></tr>
  <tr><td>W / P</td><td>PLAY / PAUSE platine A / B</td></tr>
  <tr><td>A, S / K, L</td><td>freiner, pousser A / B (pitch bend, maintenir)</td></tr>
  <tr><td>1-4 / 7-0</td><td>hot cues A-D de la platine A / B</td></tr>
  <tr><td>D / J</td><td>couper / remettre les basses (LOW) de A / B</td></tr>
  <tr><td>← ↓ →</td><td>crossfader à gauche / centre / droite</td></tr>
  <tr><td>E</td><td>effet ON / OFF</td></tr>
  <tr><td>Molette</td><td>sur un potard ou un fader : régler ; sur le jog : décalage fin</td></tr>
  <tr><td>Double-clic</td><td>remettre un potard au centre</td></tr>
  <tr><td>Maj + glisser</td><td>réglage fin</td></tr>
  <tr><td>F11 / F5</td><td>plein écran / recharger</td></tr></table>
  <div class="acts"><button data-close>Fermer</button></div>`);

// ------------------------------------------------------------------ sorties audio
const loadAudioCfg = () => { try { return JSON.parse(localStorage.getItem('audio') || '{}'); } catch { return {}; } };
async function applyAudioCfg(c) {
  if (c.limiter === false) engine.set('limiter', false);
  if (!c.master && (!c.phones || c.phones === 'off')) return;
  const r = await engine.setOutputs({ master: c.master || '', phones: c.phones || 'off', phonesDevice: c.phonesDevice || '' });
  if (r && !r.ok) toast('Sortie audio : ' + r.errors.join(' · '), 6000);
}
applyAudioCfg(loadAudioCfg());
$('#btn-audio').onclick = async () => {
  let devs = [];
  try { devs = await engine.outputs(); } catch {}
  const c = loadAudioCfg();
  const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const opts = (sel) => devs.map((n) => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
  modal(`<h2>Sorties audio</h2>
    <div class="fr"><label>Master (enceintes)</label><select id="a-master"><option value="">Sortie par défaut de Windows</option>${opts(c.master)}</select>
    <label>Casque (pré-écoute)</label><select id="a-ph"><option value="off">Pas de casque séparé</option><option value="split" ${c.phones === 'split' ? 'selected' : ''}>Split : gauche = casque (CUE), droite = master</option><option value="device" ${c.phones === 'device' ? 'selected' : ''}>Une autre sortie (2e carte son / casque USB)</option></select>
    <label>Sortie casque</label><select id="a-phdev">${opts(c.phonesDevice)}</select>
    <label>Limiteur de sécurité</label><label><input type="checkbox" id="a-lim" ${engine.mix.limiter ? 'checked' : ''}> empêche la saturation sur tes enceintes</label></div>
    <p class="hint"><b>Split</b> : branche ton casque sur la sortie master. Dans l'oreille gauche, tu entends ce que tu pré-écoutes (boutons CUE 🎧), dans la droite le mix. C'est la solution si tu n'as qu'une seule sortie audio.<br>
    <b>Deux sorties</b> : la vraie configuration DJ. Avec une carte son DJ (ou un contrôleur) qui a une sortie casque, ou un casque USB/Bluetooth en plus des enceintes. Attention, le Bluetooth a du retard : déconseillé pour caler.</p>
    <div class="acts"><button data-close>Annuler</button><button id="a-ok" class="tbtn accent">Appliquer</button></div>`, (m, close) => {
    m.querySelector('#a-ok').onclick = async () => {
      const cfg = { master: m.querySelector('#a-master').value, phones: m.querySelector('#a-ph').value, phonesDevice: m.querySelector('#a-phdev').value, limiter: m.querySelector('#a-lim').checked };
      try { localStorage.setItem('audio', JSON.stringify(cfg)); } catch {}
      engine.set('limiter', cfg.limiter);
      const r = await engine.setOutputs(cfg);
      close();
      toast(r && !r.ok ? 'Problème : ' + r.errors.join(' · ') : 'Sorties audio appliquées', r && !r.ok ? 6000 : 3200);
    };
  });
};

// ------------------------------------------------------------------ enregistrement
$('#btn-rec').onclick = async () => {
  if (!engine.recorder) { await engine.startRecording(); $('#btn-rec').classList.add('rec'); toast('Enregistrement du mix démarré (WAV dans Musique\\IrisDJ)'); return; }
  const p = await engine.stopRecording(); $('#btn-rec').classList.remove('rec'); $('#rec-label').textContent = 'REC';
  if (p) toast('Mix enregistré : ' + p, 5000);
};

// ------------------------------------------------------------------ boucle d'affichage
function frame() {
  refreshAll();
  waves.A.render(); waves.B.render(); phase.render();
  $('#btn-rec').classList.toggle('rec', !!engine.recorder);
  if (engine.recorder) { const s = Math.floor((Date.now() - engine.recStart) / 1000); $('#rec-label').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// premier lancement : on ouvre les cours
try { if (!localStorage.getItem('lessons:done') && !localStorage.getItem('seenLearn')) { localStorage.setItem('seenLearn', '1'); app.learn.open(); } } catch {}
