// Panneau « Apprendre » : liste des cours, déroulé des étapes, vérification automatique, surlignage.
import { LESSONS } from './lessons.js';
import { phaseDiff, view } from './deckui.js';

const DONE_KEY = 'lessons:done';
const getDone = () => { try { return JSON.parse(localStorage.getItem(DONE_KEY) || '{}'); } catch { return {}; } };
const setDone = (id) => { const d = getDone(); d[id] = Date.now(); try { localStorage.setItem(DONE_KEY, JSON.stringify(d)); } catch {} };

export class Learn {
  constructor(app) {
    this.app = app; this.engine = app.engine;
    this.panel = document.getElementById('learn');
    this.body = document.getElementById('learn-body');
    this.titleEl = document.getElementById('learn-title');
    this.back = document.getElementById('learn-back');
    this.lesson = null; this.step = 0; this.mem = {}; this.stepStart = 0; this.finished = false;
    this.events = {};
    this.peaks = { A: [], B: [] };
    document.getElementById('learn-close').onclick = () => this.close();
    this.back.onclick = () => this.showList();
    document.getElementById('btn-learn').onclick = () => (this.panel.hidden ? this.open() : this.close());

    // journal des évènements des platines (pour vérifier les étapes)
    for (const id of ['A', 'B']) {
      const deck = this.engine.decks[id];
      for (const ev of ['play', 'pause', 'cue', 'hotcue', 'tap', 'grid', 'load', 'loopin', 'seek']) {
        deck.on(ev, () => {
          const o = deck.other(), le = deck.lastEvent;
          const beat = le ? le.beat : deck.bpm ? deck.beatAt(deck.position()) : null;
          const otherBeat = le ? le.otherBeat : o.loaded && o.bpm && o.playing ? o.beatAt(o.position()) : null;
          this.events[`${id}.${ev}`] = { t: performance.now(), beat: beat ?? null, otherBeat: otherBeat ?? null };
        });
      }
    }
    setInterval(() => this.tick(), 120);
  }

  open() { this.panel.hidden = false; if (!this.lesson) this.showList(); }
  close() { this.panel.hidden = true; this.clearHl(); }

  showList() {
    this.leave();
    this.lesson = null; this.back.hidden = true; this.titleEl.textContent = 'Apprendre à mixer';
    const done = getDone();
    let html = '<div class="lesson-list">', chap = '';
    LESSONS.forEach((l, i) => {
      if (l.chap !== chap) { chap = l.chap; html += `<div class="chap">${chap}</div>`; }
      html += `<div class="lesson-item ${done[l.id] ? 'done' : ''}" data-id="${l.id}"><div class="n">${done[l.id] ? '✓' : i + 1}</div><div><div class="t">${l.title}</div><div class="d">${l.desc}</div></div></div>`;
    });
    html += '</div><p style="color:var(--dim);font-size:12.5px;margin-top:14px">Les cours utilisent les pistes d\'entraînement (onglet Entraînement). Chaque étape se valide toute seule quand tu as réussi. Bloqué ? Le bouton « Demander à Orbiz » envoie ta question avec ce que tu as à l\'écran.</p>';
    this.body.innerHTML = html;
    this.body.querySelectorAll('.lesson-item').forEach((el) => (el.onclick = () => this.start(el.dataset.id)));
  }

  leave() { if (this.lesson?.onExit) this.lesson.onExit(this.app); this.clearHl(); }

  async start(id, { prepare = true } = {}) {
    const l = LESSONS.find((x) => x.id === id);
    if (!l) return false;
    this.leave();
    this.panel.hidden = false;
    this.lesson = l; this.step = 0; this.mem = {}; this.finished = false; this.stepStart = performance.now();
    this.back.hidden = false; this.titleEl.textContent = l.title;
    this.render();
    if (prepare && l.setup) { this.body.querySelector('.prep')?.setAttribute('disabled', ''); await this.app.prepare(l.setup); this.stepStart = performance.now(); this.render(); }
    return true;
  }

  render() {
    const l = this.lesson; if (!l) return;
    const steps = l.steps.map((s, i) => {
      const cls = i < this.step ? 'done' : i === this.step && !this.finished ? 'cur' : i > this.step ? 'todo' : 'done';
      const manual = !s.check;
      return `<div class="step ${cls}" data-i="${i}"><div class="sth"><div class="stn">${i < this.step || this.finished ? '✓' : i + 1}</div><div class="stb">${s.html}
        ${i === this.step && !this.finished ? `<div class="live"></div><div class="acts">${s.action ? `<button class="primary" data-act>${s.action.label}</button>` : ''}${manual ? '<button class="primary" data-next>Suivant</button>' : '<button data-skip>Passer cette étape</button>'}</div>` : ''}</div></div></div>`;
    }).join('');
    this.body.innerHTML = `${l.intro || ''}
      ${l.setup ? '<div class="learn-foot"><button class="prep">↺ Remettre la table en place pour ce cours</button></div>' : ''}
      <div class="steps">${steps}</div>
      ${this.finished || !l.steps.length ? `<div class="success"><b>Cours terminé ✓</b></div>${l.outro || ''}` : ''}
      <div class="learn-foot">
        <button data-ask>Demander à Orbiz</button>
        ${this.finished || !l.steps.length ? '<button class="primary" data-nextlesson>Cours suivant →</button>' : ''}
      </div>`;
    const $ = (s) => this.body.querySelector(s);
    $('.prep') && ($('.prep').onclick = async () => { await this.app.prepare(l.setup); this.step = 0; this.mem = {}; this.finished = false; this.stepStart = performance.now(); this.render(); });
    $('[data-next]') && ($('[data-next]').onclick = () => this.advance());
    $('[data-skip]') && ($('[data-skip]').onclick = () => this.advance(true));
    $('[data-act]') && ($('[data-act]').onclick = () => l.steps[this.step].action.run(this.app));
    $('[data-ask]').onclick = () => this.ask();
    $('[data-nextlesson]') && ($('[data-nextlesson]').onclick = () => { const i = LESSONS.indexOf(l); if (LESSONS[i + 1]) this.start(LESSONS[i + 1].id); else this.showList(); });
    if (!l.steps.length) setDone(l.id);
    this.highlight();
    this.body.querySelector('.step.cur')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  advance(skipped = false) {
    const l = this.lesson; if (!l) return;
    this.step++; this.mem = {}; this.stepStart = performance.now();
    if (this.step >= l.steps.length) { this.finished = true; this.step = l.steps.length; if (!skipped || l.steps.length) setDone(l.id); this.app.coach.say('Cours terminé, bravo ! 🎉', 'good', 6000); }
    else if (!skipped) this.app.coach.say('Étape réussie ✓', 'good', 2500);
    this.render();
  }

  clearHl() { document.querySelectorAll('.hl').forEach((e) => e.classList.remove('hl')); }
  highlight(ids) {
    this.clearHl();
    const list = ids || (this.lesson && !this.finished ? this.lesson.steps[this.step]?.hl : null) || [];
    for (const id of list) {
      document.querySelectorAll(`[data-ctl="${id}"], [data-zone="${id}"]`).forEach((e) => e.classList.add('hl'));
      const byId = document.getElementById(id); if (byId) byId.classList.add('hl');
    }
  }

  ctx() {
    const e = this.engine, now = performance.now(), mem = this.mem, start = this.stepStart;
    const self = this;
    return {
      e, A: e.decks.A, B: e.decks.B, m: e.mix, lv: e.lastLevels, ph: phaseDiff(e), view, mem, now, t: now - start, app: this.app,
      ev: (n) => (self.events[n]?.t || 0) > start,
      evData: (n) => ((self.events[n]?.t || 0) > start ? self.events[n] : null),
      hold: (k, cond, ms) => { if (!cond) { mem['h_' + k] = 0; return false; } mem['h_' + k] ||= now; return now - mem['h_' + k] >= ms; },
      peakMax: (d, ms) => self.peaks[d].filter((p) => now - p.t < ms).reduce((a, p) => Math.max(a, p.db), -120),
      peakHold: (d, ms, lo, hi) => { const arr = self.peaks[d].filter((p) => now - p.t < ms); if (!arr.length || now - start < ms) return false; const mx = Math.max(...arr.map((p) => p.db)); return mx >= lo && mx <= hi; },
    };
  }

  tick() {
    const lv = this.engine.lastLevels;
    if (lv) { const now = performance.now(); for (const d of ['A', 'B']) { this.peaks[d].push({ t: now, db: lv[d].peak }); while (this.peaks[d].length && now - this.peaks[d][0].t > 6000) this.peaks[d].shift(); } }
    const l = this.lesson; if (!l || this.finished || this.panel.hidden && !l) return;
    const s = l.steps[this.step]; if (!s) return;
    const x = this.ctx();
    try {
      const liveEl = this.body.querySelector('.step.cur .live');
      if (liveEl && s.live) { const t = s.live(x); if (liveEl.textContent !== t) liveEl.textContent = t || ''; }
      if (s.check && s.check(x)) this.advance();
    } catch (err) { console.warn('étape', err); }
  }

  state() {
    const l = this.lesson;
    if (!l) return { ouvert: !this.panel.hidden, cours: null };
    const s = l.steps[this.step];
    const txt = (h) => { const d = document.createElement('div'); d.innerHTML = h || ''; return d.textContent.replace(/\s+/g, ' ').trim(); };
    return { ouvert: !this.panel.hidden, cours: { id: l.id, titre: l.title, etape: this.finished ? 'terminé' : `${this.step + 1}/${l.steps.length}`, consigne: s ? txt(s.html) : null, suivi: s?.live ? s.live(this.ctx()) : undefined } };
  }

  list() { const d = getDone(); return LESSONS.map((l) => ({ id: l.id, chapitre: l.chap, titre: l.title, description: l.desc, termine: !!d[l.id] })); }

  ask() {
    const st = this.state();
    const c = st.cours;
    const q = c ? `Je suis dans le cours « ${c.titre} » d'IrisDJ, étape ${c.etape} : « ${c.consigne || ''} ». Je n'y arrive pas / je ne comprends pas. Peux-tu m'aider ?` : 'J\'apprends à mixer dans IrisDJ. Par quoi je commence ?';
    window.dj.ask(q, false);
  }
}
