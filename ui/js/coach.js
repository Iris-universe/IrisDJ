// Coach : surveille le mix et prévient des erreurs classiques (saturation, deux basses, tempos/phase pas calés…).
import { phaseDiff } from './deckui.js';

export class Coach {
  constructor(app) {
    this.app = app; this.engine = app.engine; this.enabled = true;
    this.el = document.getElementById('coach'); this.txt = document.getElementById('coach-text');
    this.override = null; this.current = null; this.since = {};
    const btn = document.getElementById('btn-coach');
    try { this.enabled = localStorage.getItem('coach') !== 'off'; } catch {}
    btn.classList.toggle('on', this.enabled);
    btn.onclick = () => { this.enabled = !this.enabled; btn.classList.toggle('on', this.enabled); try { localStorage.setItem('coach', this.enabled ? 'on' : 'off'); } catch {} if (!this.enabled) this.show('Coach désactivé.', ''); };
    setInterval(() => this.tick(), 300);
  }

  // message temporaire (cours, assistant…)
  say(text, level = '', ms = 5000) { this.override = { text, level, until: performance.now() + ms }; this.show(text, level); }

  show(text, level) {
    if (this.txt.textContent !== text) this.txt.textContent = text;
    this.el.className = level || '';
    this.el.title = text;
  }

  // une condition doit durer un peu avant d'être signalée (évite les faux positifs)
  lasting(key, cond, ms) { const now = performance.now(); if (!cond) { delete this.since[key]; return false; } this.since[key] ||= now; return now - this.since[key] >= ms; }

  rules() {
    const e = this.engine, { A, B } = e.decks, m = e.mix, lv = e.lastLevels || {};
    const aud = (id) => e.decks[id].playing && e.audible(id) > 0.15;
    const out = [];
    const mpk = Math.max(lv.L?.peak ?? -120, lv.R?.peak ?? -120);
    if (this.lasting('mclip', mpk > -0.3, 250)) out.push(['bad', `Le master sature (${mpk.toFixed(1)} dB) : baisse les TRIM ou le MASTER. Sur une vraie table, ça distordrait.`]);
    for (const id of ['A', 'B']) if (this.lasting('clip' + id, (lv[id]?.peak ?? -120) > -0.2, 400)) out.push(['bad', `Voie ${id} dans le rouge : baisse son TRIM (vise le haut du vert / le jaune).`]);
    if (aud('A') && aud('B')) {
      const lowA = m.A.low > -0.6, lowB = m.B.low > -0.6;
      if (this.lasting('2bass', lowA && lowB && e.audible('A') > 0.3 && e.audible('B') > 0.3, 1800))
        out.push(['warn', 'Deux basses en même temps : coupe LOW sur une des deux voies (bass swap). Deux kicks ensemble = bouillie.']);
      const ph = phaseDiff(e);
      if (ph && Math.abs(ph.tempoDiff) > 0.08 && this.lasting('tempo', true, 1200)) out.push(['warn', `Tempos pas calés : A ${A.effBpm.toFixed(2)} / B ${B.effBpm.toFixed(2)} BPM. Règle le fader de tempo (ou SYNC).`]);
      else if (ph && this.lasting('phase', Math.abs(ph.ms) > 22, 1200)) out.push(['warn', `Les kicks ne tombent pas ensemble (${ph.ms > 0 ? 'B en avance' : 'B en retard'} de ${Math.abs(ph.ms).toFixed(0)} ms) : corrige avec le jog de B.`]);
      else if (!ph && A.bpm && B.bpm && this.lasting('ratio', true, 1500)) out.push(['warn', `Tempos très différents (${A.effBpm.toFixed(0)} / ${B.effBpm.toFixed(0)} BPM) : rapproche-les ou fais une coupe / un echo out.`]);
    }
    for (const id of ['A', 'B']) {
      const d = e.decks[id];
      if (d.playing && e.audible(id) < 0.02 && !m[id].cue && this.lasting('silent' + id, true, 6000) && !(aud('A') || aud('B')))
        out.push(['warn', `La platine ${id} joue mais on ne l'entend pas : monte son fader (et vérifie le crossfader).`]);
    }
    return out;
  }

  tick() {
    const now = performance.now();
    if (this.override && now < this.override.until) return;
    this.override = null;
    if (!this.enabled) return;
    const r = this.rules();
    this.current = r;
    if (r.length) this.show(r[0][1], r[0][0]);
    else {
      const { A, B } = this.engine.decks;
      const playing = [A, B].filter((d) => d.playing);
      const tip = !A.loaded && !B.loaded ? 'Charge un morceau (bibliothèque en bas) ou ouvre « Apprendre » pour suivre les cours.'
        : playing.length === 0 ? 'Prêt. Appuie sur PLAY (touches W / P).'
        : 'Tout est propre. ✓';
      this.show(tip, playing.length ? 'good' : '');
    }
  }

  messages() { return (this.current || []).map(([level, text]) => ({ niveau: level === 'bad' ? 'erreur' : 'attention', texte: text })); }
}
