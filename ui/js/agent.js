// API de pilotage par l'assistant (Orbiz, via iris-link). Chaque fonction reçoit un objet d'arguments
// et renvoie un objet sérialisable. Voir TOOLS dans main.js.
import { phaseDiff, sectionAt } from './deckui.js';
import { camelot } from './keys.js';
import { PRACTICE } from './synth.js';

export function installAgent(app) {
  const { engine, controls: C } = app;
  const r2 = (v) => Math.round(v * 100) / 100;

  const deckState = (d) => {
    const k = engine.decks[d];
    if (!k.loaded) return { charge: false };
    const pos = k.position(), bi = k.bpm ? k.barInfo(pos) : null;
    return {
      charge: true, titre: k.track.title, artiste: k.track.artist, source: k.track.source, genre: k.track.genre,
      bpm_original: r2(k.bpm), bpm_actuel: r2(k.effBpm), tempo_pct: r2(k.tempoPct), plage_tempo: k.range, master_tempo: k.keylock, sync: k.sync, quantize: k.quantize,
      tonalite: k.track.key || null, camelot: k.track.key ? camelot(k.track.key) : null,
      lecture: k.playing, position_s: r2(pos), duree_s: r2(k.duration),
      mesure: bi?.bar, temps: bi?.beatInBar, phrase: bi?.phrase, mesure_dans_phrase: bi?.barInPhrase, section: bi ? sectionAt(k, bi.bar) : undefined,
      point_cue_mesure: k.bpm ? k.barInfo(k.cuePoint).bar : undefined,
      hot_cues: k.hotcues.map((h, i) => (h == null ? null : { pad: 'ABCDEFGH'[i], mesure: k.bpm ? k.barInfo(h).bar : undefined, s: r2(h) })).filter(Boolean),
      boucle: k.loop.active ? { temps: k.loop.beats } : null,
      audible: r2(engine.audible(d)),
    };
  };

  const api = {
    get_state() {
      const lv = engine.lastLevels || engine.levels();
      const ph = phaseDiff(engine);
      const mix = JSON.parse(JSON.stringify(engine.mix));
      return {
        platines: { A: deckState('A'), B: deckState('B') },
        table: mix,
        niveaux_db: { A: r2(lv.A.peak), B: r2(lv.B.peak), master: r2(Math.max(lv.L.peak, lv.R.peak)) },
        phase: ph ? { ecart_ms: r2(ph.ms), rapport_tempo: ph.ratio, ecart_bpm: r2(ph.tempoDiff) } : null,
        coach: app.coach.messages(),
        cours: app.learn.state(),
        sortie_casque: engine.phonesMode,
        enregistrement: !!engine.recorder,
        aide: 'Valeurs des potards : -1..1 (0 = centre ; EQ -1 = kill), faders 0..1, crossfader -1 (A) .. 1 (B).',
      };
    },

    list_controls() {
      return [...C.values()].map((c) => ({ id: c.id, nom: c.label, type: c.type, plage: c.type === 'range' ? [c.min, c.max] : undefined, options: c.options, valeur: c.fmt ? c.fmt() : c.get(), sur_vraie_table: c.hw, role: c.help }));
    },

    async set_control({ id, value }) {
      const c = C.get(id);
      if (!c) return { error: `Contrôle inconnu : ${id}. Utilise list_controls.` };
      let v = value;
      if (c.type === 'range') { v = Number(value); if (!isFinite(v)) return { error: 'valeur numérique attendue' }; v = Math.max(c.min, Math.min(c.max, v)); }
      else if (c.type === 'bool') v = value === true || value === 'true' || value === 1 || value === 'on';
      else if (c.type === 'enum') { v = c.options.find((o) => String(o) === String(value)); if (v === undefined) return { error: `valeurs possibles : ${c.options.join(', ')}` }; }
      c.set(v);
      if (id.startsWith('A.') || id.startsWith('B.')) await engine.decks[id[0]].idle();
      return { ok: true, id, valeur: c.fmt ? c.fmt() : c.get() };
    },

    async deck_action({ deck, action, value }) {
      const k = engine.decks[deck];
      if (!k) return { error: 'deck = A ou B' };
      if (!k.loaded && !['range'].includes(action)) return { error: `La platine ${deck} est vide : charge d'abord un morceau (search_tracks + load_track).` };
      const n = Number(value);
      switch (action) {
        case 'play': k.play(); break;
        case 'pause': k.pause(); break;
        case 'cue': k.pause(); k.seek(k.cuePoint); break;
        case 'set_cue': k.setCueHere(); break;
        case 'sync': if (!(await k.setSync(true))) return { error: 'Sync impossible (autre platine vide ou écart de tempo trop grand).' }; break;
        case 'unsync': k.setSync(false); break;
        case 'keylock_on': k.setKeylock(true); break;
        case 'keylock_off': k.setKeylock(false); break;
        case 'hotcue': k.hotcue(Math.max(0, Math.min(7, (n || 1) - 1))); break;
        case 'delete_hotcue': k.deleteHotcue(Math.max(0, Math.min(7, (n || 1) - 1))); break;
        case 'loop': k.autoLoop(n || 4); break;
        case 'exit_loop': k.exitLoop(); break;
        case 'beat_jump': k.beatJump(n || 16); break;
        case 'seek_bar': k.seek(k.secAtBeat(((n || 1) - 1) * 4)); break;
        case 'seek': k.seek(n || 0); break;
        case 'tempo': k.setTempo((n || 0) / k.range); break;
        case 'range': k.setRange([6, 10, 16, 50].includes(n) ? n : 10); break;
        case 'bpm_double': k.setGrid(k.bpm * 2, k.track.firstBeat); break;
        case 'bpm_half': k.setGrid(k.bpm / 2, k.track.firstBeat); break;
        case 'set_bpm': if (n > 30) k.setGrid(n, k.track.firstBeat); break;
        case 'downbeat_here': k.setDownbeatHere(); break;
        default: return { error: `action inconnue : ${action}` };
      }
      await k.idle();
      return { ok: true, platine: deckState(deck) };
    },

    async search_tracks({ source, query = '' }) {
      const list = await app.library.searchFor(source, query);
      app.library.lastAgent ||= {};
      app.library.lastAgent[source] = list;
      return list.slice(0, 25).map((t) => ({ id: String(t.id), titre: t.title, artiste: t.artist, genre: t.genre, bpm: t.bpm || t.hintBpm || null, tonalite: t.key || null, duree_s: t.duration ? Math.round(t.duration) : null }));
    },

    async load_track({ deck, source, id }) {
      let t = (app.library.lastAgent?.[source] || []).find((x) => String(x.id) === String(id));
      if (!t && source === 'practice') t = PRACTICE.find((x) => x.id === id || x.title.toLowerCase() === String(id).toLowerCase());
      if (!t && source === 'files') t = (await window.dj.lib.list()).find((x) => x.id === id);
      if (!t) return { error: 'Morceau introuvable : fais d\'abord search_tracks avec la même source.' };
      const ok = await app.loadTrack(deck, t, { force: true });
      return ok ? { ok: true, platine: deckState(deck) } : { error: 'Chargement impossible (voir le message dans l\'app).' };
    },

    async reset() { app.resetAll(); await engine.decks.A.idle(); await engine.decks.B.idle(); return { ok: true }; },
    list_lessons() { return app.learn.list(); },
    async start_lesson({ id }) { const ok = await app.learn.start(id); return ok ? { ok: true, cours: app.learn.state() } : { error: 'cours inconnu (list_lessons)' }; },
    show_tip({ text, highlight }) { app.coach.say(text, 'warn', 12000); if (highlight?.length) { app.learn.highlight(highlight); setTimeout(() => app.learn.highlight(), 12000); } return { ok: true }; },
  };

  window.irisAgent = api;
}
