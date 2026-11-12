// Façade du moteur Rust : même API que l'ancien moteur Web Audio (Deck / Engine), mais tout le son,
// la logique des platines (cue, sync, boucles, hot cues, grille) et les effets tournent en Rust.
// L'état arrive ~60 fois par seconde par un canal Tauri ; les actions partent par `invoke`.
//
// Table : platine -> TRIM -> EQ -> COLOR -> [VU, CUE casque] -> fader -> crossfader -> master (+ Beat FX)

const { invoke, Channel } = window.__TAURI__.core;

export const DECKS = ['A', 'B'];
export const TEMPO_RANGES = [6, 10, 16, 50];
export const FX_TYPES = { echo: 'Echo', reverb: 'Reverb', flanger: 'Flanger' };
export const FX_BEATS = [1 / 8, 1 / 4, 1 / 2, 3 / 4, 1, 2, 4, 8];
export const LOOP_BEATS = [1 / 4, 1 / 2, 1, 2, 4, 8, 16, 32];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => (g <= 1e-6 ? -120 : 20 * Math.log10(g));

class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return () => (this._h[ev] = this._h[ev].filter((f) => f !== fn)); }
  emit(ev, ...a) { (this._h[ev] || []).forEach((f) => { try { f(...a); } catch (e) { console.error(e); } }); }
}

const EMPTY = { loaded: false, track: null, version: 0, duration: 0, playing: false, scratching: false, pos: 0, rate: 1, tempo: 0, range: 10, bend: 0,
  keylock: false, quantize: true, sync: false, cuePoint: 0, hotcues: Array(8).fill(null), loop: { in: null, out: null, active: false, beats: null }, cueHeld: false, bpm: 0, firstBeat: 0, waveVersion: 0, rev: 0 };

// ------------------------------------------------------------------ platine
export class Deck extends Emitter {
  constructor(engine, id) {
    super();
    this.engine = engine; this.id = id;
    this.s = { ...EMPTY }; this._at = performance.now();
    this._ver = 0; this._waveV = 0;
    this.wave = null;
    this.vinyl = true;          // mode du jog (interface seulement)
    this.tapBpm = null;
    this.lastEvent = null;
    this._last = Promise.resolve();
    this._inflight = 0;
  }

  // état reçu du moteur
  _apply(s, fromCmd = false) {
    // pendant qu'une action est en route, on ignore les instantanés (ils peuvent être plus anciens qu'elle)
    if (!fromCmd && this._inflight > 0) return;
    if (s.rev < this.s.rev) return;
    const verChanged = s.version !== this._ver;
    this.s = s; this._at = performance.now();
    if (verChanged) { this._ver = s.version; this.wave = null; this._waveV = 0; }
    if (s.waveVersion !== this._waveV && s.waveVersion > 0 && s.loaded) {
      this._waveV = s.waveVersion;
      this._fetchWave(s.version);
    }
  }
  async _fetchWave(version) {
    try {
      const buf = await invoke('get_wave', { d: this.id });
      const dv = new DataView(buf), n = dv.getUint32(0, true), pps = dv.getUint32(4, true);
      const u = new Uint8Array(buf, 8);
      const f = (o) => { const a = new Float32Array(n); for (let i = 0; i < n; i++) a[i] = u[o + i] / 255; return a; };
      if (this.s.version !== version) return;
      this.wave = { pps, low: f(0), mid: f(n), high: f(2 * n) };
      this.emit('analysis'); this.emit('change');
    } catch (e) { console.warn('forme d\'onde', e); }
  }

  _cmd(cmd, v, w) {
    this._inflight++;
    const p = invoke('deck', { d: this.id, cmd, v: v ?? null, w: w ?? null })
      .then((r) => { this._inflight--; this._apply(r.deck, true); return r.ok; }, (e) => { this._inflight--; throw e; });
    p.catch((e) => console.error(cmd, e));
    this._last = p.catch(() => {});
    return p;
  }
  idle() { return this._last; }

  get loaded() { return this.s.loaded; }
  get track() { return this.s.track; }
  get duration() { return this.s.duration; }
  get playing() { return this.s.playing; }
  get scratching() { return this.s.scratching; }
  get bpm() { return this.s.bpm || 0; }
  get tempo() { return this.s.tempo; }
  get range() { return this.s.range; }
  set range(r) { this.s = { ...this.s, range: r }; this._cmd('setRangeRaw', r); }
  get bend() { return this.s.bend; }
  get keylock() { return this.s.keylock; }
  get quantize() { return this.s.quantize; }
  set quantize(v) { this.s = { ...this.s, quantize: !!v }; this._cmd('setQuantize', v ? 1 : 0); }
  get sync() { return this.s.sync; }
  get cuePoint() { return this.s.cuePoint; }
  set cuePoint(sec) { this.s = { ...this.s, cuePoint: sec }; this._cmd('setCuePoint', sec); }
  get hotcues() { return this.s.hotcues; }
  set hotcues(h) { if (h.every((x) => x == null)) { this.s = { ...this.s, hotcues: Array(8).fill(null) }; this._cmd('clearHotcues'); } }
  get loop() { return this.s.loop; }
  get _cueHeld() { return this.s.cueHeld; }
  get rate() { return 1 + this.s.tempo * this.s.range / 100 + this.s.bend; }
  get effBpm() { return this.bpm * (1 + this.s.tempo * this.s.range / 100); }
  get tempoPct() { return this.s.tempo * this.s.range; }
  get beatLen() { return this.bpm ? 60 / this.bpm : 0.5; }

  // position (s), extrapolée depuis le dernier instantané
  position() {
    const s = this.s;
    if (!s.loaded) return 0;
    let p = s.pos;
    if (s.playing && !s.scratching) {
      p += Math.min(0.1, (performance.now() - this._at) / 1000) * this.rate;
      const l = s.loop;
      if (l.active && l.out > l.in && p >= l.out) p = l.in + ((p - l.in) % (l.out - l.in));
    }
    return clamp(p, 0, s.duration);
  }

  // ---- grille rythmique ----
  beatAt(sec) { return this.bpm ? (sec - (this.s.firstBeat || 0)) / this.beatLen : 0; }
  secAtBeat(b) { return (this.s.firstBeat || 0) + b * this.beatLen; }
  nearestBeatSec(sec) { return this.secAtBeat(Math.round(this.beatAt(sec))); }
  barInfo(sec = this.position()) {
    const b = this.beatAt(sec) + 1e-4;
    const beat = Math.floor(b);
    return { beat: b, bar: Math.floor(beat / 4) + 1, beatInBar: ((beat % 4) + 4) % 4 + 1, phase: b - beat, phrase: Math.floor(Math.floor(beat / 4) / 8) + 1, barInPhrase: ((Math.floor(beat / 4) % 8) + 8) % 8 + 1 };
  }

  // ---- actions (exécutées par le moteur Rust) ----
  unload() { return this._cmd('unload'); }
  saveMeta() { /* le moteur enregistre tout seul cue, hot cues et grille */ }
  play() { return this._cmd('play'); }
  pause() { return this._cmd('pause'); }
  togglePlay() { return this._cmd('togglePlay'); }
  seek(sec) { return this._cmd('seek', sec); }
  cueDown() { return this._cmd('cueDown'); }
  cueUp() { return this._cmd('cueUp'); }
  setCueHere() { return this._cmd('setCueHere'); }
  setTempo(v, fromSync = false) { this.s = { ...this.s, tempo: clamp(v, -1, 1) }; return this._cmd('setTempo', v, fromSync ? 1 : 0); }
  setRange(r) { return this._cmd('setRange', r); }
  setBend(b) { this.s = { ...this.s, bend: b }; return this._cmd('setBend', b); }
  setKeylock(on) { return this._cmd('setKeylock', on ? 1 : 0); }
  nudge(beatsFraction) { return this.seek(this.position() + beatsFraction * this.beatLen); }
  other() { return this.engine.decks[this.id === 'A' ? 'B' : 'A']; }
  matchTempo() { return this._cmd('matchTempo'); }
  alignPhase() { return this._cmd('alignPhase'); }
  setSync(on) { return this._cmd('setSync', on ? 1 : 0); }
  hotcue(i) { return this._cmd('hotcue', i); }
  deleteHotcue(i) { return this._cmd('deleteHotcue', i); }
  loopIn() { return this._cmd('loopIn'); }
  loopOut() { return this._cmd('loopOut'); }
  autoLoop(beats) { return this._cmd('autoLoop', beats); }
  resizeLoop(f) { return this._cmd('resizeLoop', f); }
  exitLoop() { return this._cmd('exitLoop'); }
  reloop() { return this._cmd('reloop'); }
  toggleLoop() { return this._cmd('toggleLoop'); }
  beatJump(beats) { return this._cmd('beatJump', beats); }
  scratchStart() { return this._cmd('scratchStart'); }
  scratchMove(dSec) { return this._cmd('scratchMove', dSec); }
  scratchEnd() { return this._cmd('scratchEnd'); }
  setGrid(bpm, firstBeat) { return this._cmd('setGrid', bpm, firstBeat); }
  setDownbeatHere() { return this._cmd('setDownbeatHere'); }
  shiftGrid(ms) { return this._cmd('shiftGrid', ms); }
}

// ------------------------------------------------------------------ moteur
export class Engine extends Emitter {
  async init() {
    this.decks = { A: new Deck(this, 'A'), B: new Deck(this, 'B') };
    this.mix = {
      A: { trim: 0, hi: 0, mid: 0, low: 0, filter: 0, fader: 0, cue: false, xf: 'A' },
      B: { trim: 0, hi: 0, mid: 0, low: 0, filter: 0, fader: 0, cue: false, xf: 'B' },
      xfader: 0, xfCurve: 'smooth', master: 0.8, phonesMix: 0, phonesLevel: 0.8, limiter: true,
      fx: { type: 'echo', beat: 1, channel: 'A', level: 0.5, on: false },
    };
    const lv = { peak: -120, rms: -120 };
    this._levels = { A: lv, B: lv, L: lv, R: lv };
    this.sr = 48000;
    this.phonesMode = 'off';
    this.recorder = null;
    const ch = new Channel();
    ch.onmessage = (s) => this._onSnap(s);
    await invoke('subscribe', { channel: ch });
    await invoke('set_mix', { mix: this.mix });
    return this;
  }

  _onSnap(s) {
    this.sr = s.sr;
    this._levels = s.levels;
    this.decks.A._apply(s.decks[0]);
    this.decks.B._apply(s.decks[1]);
    for (const ev of s.events) {
      if (ev.name === 'analysis') continue; // émis quand la forme d'onde est arrivée
      const d = this.decks[ev.deck];
      d.lastEvent = ev;
      if (ev.arg != null) d.emit(ev.name, ev.arg); else d.emit(ev.name);
      d.lastEvent = null;
    }
    // après un rechargement (F5) pendant un enregistrement
    if (!this._recSeen) { this._recSeen = true; if (s.rec != null) { this.recorder = true; this.recStart = Date.now() - s.rec * 1000; } }
  }

  // ---- réglages de la table ----
  set(path, value) {
    const parts = path.split('.');
    let o = this.mix;
    for (let i = 0; i < parts.length - 1; i++) o = o[parts[i]];
    o[parts.at(-1)] = value;
    this._pushMix();
    this.emit('mix', path, value);
  }
  get(path) { return path.split('.').reduce((o, k) => o?.[k], this.mix); }
  _pushMix() {
    if (this._mixQueued) return;
    this._mixQueued = true;
    queueMicrotask(() => { this._mixQueued = false; invoke('set_mix', { mix: this.mix }).catch((e) => console.error(e)); });
  }
  applyAll() { this._pushMix(); }

  xfGain(id) {
    const m = this.mix[id], x = this.mix.xfader;
    if (m.xf === 'THRU') return 1;
    const pos = m.xf === 'A' ? x : -x;
    if (this.mix.xfCurve === 'cut') return pos > 0.92 ? Math.max(0, (1 - pos) / 0.08) : 1;
    return pos <= 0 ? 1 : Math.cos(pos * Math.PI / 2);
  }
  fxBpm() {
    const c = this.mix.fx.channel;
    const d = c === 'M' ? this.masterDeck() : this.decks[c];
    return d?.loaded && d.bpm ? d.effBpm : 128;
  }
  masterDeck() {
    let best = null, bv = -1;
    for (const id of DECKS) {
      const d = this.decks[id]; if (!d.loaded) continue;
      const v = (d.playing ? 1 : 0.01) * this.audible(id);
      if (v > bv) { bv = v; best = d; }
    }
    return best;
  }
  audible(id) { const m = this.mix[id]; return (m.fader <= 0 ? 0 : Math.pow(m.fader, 2.2)) * this.xfGain(id) * dbToGain(m.trim * 12); }

  // ---- niveaux (dBFS, crête depuis le dernier instantané) ----
  levels() { return this._levels; }

  // ---- sorties ----
  async setOutputs({ master = '', phones = 'off', phonesDevice = '' } = {}) {
    this.phonesMode = phones;
    return invoke('audio_set', { master, phones, phonesDevice });
  }
  async outputs() { return invoke('audio_outputs'); }

  // ---- enregistrement du mix (WAV dans Musique\IrisDJ) ----
  async startRecording() {
    if (this.recorder) return;
    await invoke('rec_start');
    this.recorder = true; this.recStart = Date.now();
    this.emit('rec', true);
  }
  async stopRecording() {
    if (!this.recorder) return null;
    const p = await invoke('rec_stop');
    this.recorder = null; this.recStart = 0;
    this.emit('rec', false);
    return p;
  }
}
