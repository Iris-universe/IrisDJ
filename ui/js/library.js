// Bibliothèque : pistes d'entraînement, Audius, SoundCloud, fichiers locaux.
import { PRACTICE } from './synth.js';
import { camelot } from './keys.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dur = (s) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '');
const infoKey = (t) => `info:${t.source}:${t.id}`;
export const trackInfo = (t) => { try { return JSON.parse(localStorage.getItem(infoKey(t)) || 'null'); } catch { return null; } };
export const saveTrackInfo = (t, info) => { try { localStorage.setItem(infoKey(t), JSON.stringify(info)); } catch {} };

// raccourcis SoundCloud / YouTube : artistes hardcore / uptempo connus
const WEB_CHIPS = ['Noiseflow', 'Dr. Peacock', 'Sefa', 'Partyraiser', 'Barber', 'Dimitri K', 'Unproven', 'Major Conspiracy', 'Revolution DJ', 'Spitnoise', 'Uptempo', 'Frenchcore', 'Hardcore'];
const WEB_NAME = { soundcloud: 'SoundCloud', youtube: 'YouTube' };

const AUDIUS_CHIPS = [
  { label: 'Uptempo', q: 'uptempo' }, { label: 'Hardcore', q: 'hardcore' }, { label: 'Frenchcore', q: 'frenchcore' }, { label: 'Gabber', q: 'gabber' },
  { label: '🔥 Hardstyle', genre: 'Hardstyle' }, { label: '🔥 Techno', genre: 'Techno' }, { label: '🔥 House', genre: 'House' }, { label: '🔥 Drum & Bass', genre: 'Drum & Bass' }, { label: '🔥 Dubstep', genre: 'Dubstep' }, { label: '🔥 Trance', genre: 'Trance' }, { label: '🔥 Hip-hop', genre: 'Hip-Hop/Rap' },
];

export class Library {
  constructor(app) {
    this.app = app;
    this.tab = 'practice';
    this.results = { practice: PRACTICE, audius: null, soundcloud: null, youtube: null, files: null };
    this.queries = { practice: '', audius: '', soundcloud: '', youtube: '', files: '' };
    this.hideMixes = true;
    this.listEl = document.getElementById('lib-list');
    this.q = document.getElementById('lib-q');
    this.extra = document.getElementById('lib-extra');
    document.querySelectorAll('#lib-tabs > button').forEach((b) => (b.onclick = () => this.setTab(b.dataset.tab)));
    this.q.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.search(); e.stopPropagation(); });
    this.q.addEventListener('input', () => { this.queries[this.tab] = this.q.value; if (this.tab === 'practice' || this.tab === 'files') this.render(); });
    // redimensionnement
    const lib = document.getElementById('library');
    try { const h = Number(localStorage.getItem('libH')); if (h > 80) lib.style.height = h + 'px'; } catch {}
    const rz = document.getElementById('lib-resize');
    rz.addEventListener('pointerdown', (e) => {
      rz.setPointerCapture(e.pointerId); const y0 = e.clientY, h0 = lib.offsetHeight;
      const mv = (ev) => { lib.style.height = Math.max(90, Math.min(window.innerHeight * 0.6, h0 - (ev.clientY - y0))) + 'px'; };
      rz.addEventListener('pointermove', mv);
      rz.addEventListener('pointerup', () => { rz.removeEventListener('pointermove', mv); try { localStorage.setItem('libH', lib.offsetHeight); } catch {} }, { once: true });
    });
    for (const id of ['A', 'B']) app.engine.decks[id].on('load', () => this.render());
    this.setTab('practice');
  }

  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll('#lib-tabs > button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    this.q.value = this.queries[tab];
    this.q.placeholder = { practice: 'Filtrer…', audius: 'Rechercher sur Audius (Entrée)…', soundcloud: 'Artiste ou titre sur SoundCloud (Entrée)…', youtube: 'Artiste ou titre sur YouTube (Entrée)…', files: 'Filtrer mes fichiers…' }[tab];
    this.renderExtra();
    if (tab === 'files' && !this.results.files) this.loadFiles();
    else if (tab === 'audius' && !this.results.audius) this.searchAudius({ q: 'uptempo' });
    else if (WEB_NAME[tab] && !this.results[tab]) this.searchWeb(tab, this.queries[tab] || 'Noiseflow');
    else this.render();
  }

  renderExtra() {
    const t = this.tab;
    if (t === 'audius') {
      this.extra.innerHTML = AUDIUS_CHIPS.map((c, i) => `<button class="chip" data-i="${i}">${c.label}</button>`).join('') + `<label class="chip"><input type="checkbox" id="hide-mix" ${this.hideMixes ? 'checked' : ''} style="vertical-align:-2px"> sans les mixes</label>`;
      this.extra.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { const c = AUDIUS_CHIPS[b.dataset.i]; this.extra.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); b.classList.add('on'); if (c.q) { this.q.value = this.queries.audius = c.q; } this.searchAudius(c); }));
      this.extra.querySelector('#hide-mix').onchange = (e) => { this.hideMixes = e.target.checked; this.render(); };
    } else if (t === 'files') {
      this.extra.innerHTML = '<button class="chip" data-a="files">+ Fichiers</button><button class="chip" data-a="folder">+ Dossier</button><button class="chip" data-a="dl">📁 Téléchargés</button><span class="chip" style="border:0">ou glisse-dépose tes morceaux</span>';
      this.extra.querySelector('[data-a=dl]').onclick = () => window.dj.web.openFolder();
      this.extra.querySelector('[data-a=files]').onclick = async () => { const l = await window.dj.lib.addFiles(); if (l) { this.results.files = l; this.render(); } };
      this.extra.querySelector('[data-a=folder]').onclick = async () => { const l = await window.dj.lib.addFolder(); if (l) { this.results.files = l; this.render(); } };
    } else if (WEB_NAME[t]) {
      this.extra.innerHTML = WEB_CHIPS.map((c) => `<button class="chip" data-q="${esc(c)}">${esc(c)}</button>`).join('') + `<label class="chip"><input type="checkbox" id="hide-mix" ${this.hideMixes ? 'checked' : ''} style="vertical-align:-2px"> sans les mixes</label><button class="chip" data-a="dl" title="Les morceaux chargés y sont gardés : jamais retéléchargés">📁 Téléchargés</button>`;
      this.extra.querySelector('[data-a=dl]').onclick = () => window.dj.web.openFolder();
      this.extra.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => { this.q.value = this.queries[t] = b.dataset.q; this.searchWeb(t, b.dataset.q); }));
      this.extra.querySelector('#hide-mix').onchange = (e) => { this.hideMixes = e.target.checked; this.render(); };
    } else this.extra.innerHTML = '<span class="chip" style="border:0">Pistes générées par IrisDJ · 80 mesures : intro 1-16 · couplet 17-32 · break 33-48 · drop 49-64 · outro 65-80</span>';
  }

  search() {
    const q = this.q.value.trim(); this.queries[this.tab] = q;
    if (this.tab === 'audius') this.searchAudius({ q });
    else if (WEB_NAME[this.tab]) this.searchWeb(this.tab, q);
    else this.render();
  }

  // utilisé aussi par l'assistant
  async searchFor(source, query) {
    const q = (query || '').toLowerCase();
    if (source === 'practice') return PRACTICE.filter((t) => !q || `${t.title} ${t.genre} ${t.style}`.toLowerCase().includes(q)).map((t) => ({ ...t, duration: (80 * 4 * 60) / t.bpm }));
    if (source === 'files') { const l = await window.dj.lib.list(); return l.filter((t) => !q || `${t.title} ${t.artist}`.toLowerCase().includes(q)).map((t) => ({ ...t, ...(trackInfo(t) || {}) })); }
    if (source === 'audius') return (await window.dj.audius.search({ query })).filter((t) => t.duration < 900);
    if (WEB_NAME[source]) return (await window.dj.web.search(source, query)).filter((t) => !t.duration || t.duration < 900);
    return [];
  }

  async loadFiles() { this.results.files = await window.dj.lib.list(); this.render(); }

  async searchAudius({ q, genre } = {}) {
    this.msg('Recherche sur Audius…');
    try { this.results.audius = await window.dj.audius.search(genre ? { trending: true, genre } : { query: q || '' }); this.render(); }
    catch (e) { this.msg(`Audius ne répond pas : ${esc(e.message)}`); }
  }

  async searchWeb(site, q) {
    if (!q) return;
    this.queries[site] = q;
    this.msg(`Recherche de <b>${esc(q)}</b> sur ${WEB_NAME[site]}…`);
    try { this.results[site] = await window.dj.web.search(site, q); if (this.tab === site) this.render(); }
    catch (e) { if (this.tab === site) this.msg(`${WEB_NAME[site]} ne répond pas : ${esc(e.message)}`); }
  }

  msg(html) { this.listEl.innerHTML = `<div class="msg">${html}</div>`; }

  rows() {
    const t = this.tab, q = (this.queries[t] || '').toLowerCase();
    let list = this.results[t] || [];
    if (t === 'practice') list = list.map((x) => ({ ...x, duration: (80 * 4 * 60) / x.bpm }));
    if ((t === 'practice' || t === 'files') && q) list = list.filter((x) => `${x.title} ${x.artist} ${x.genre || ''} ${x.style || ''}`.toLowerCase().includes(q));
    if ((t === 'audius' || WEB_NAME[t]) && this.hideMixes) list = list.filter((x) => !x.duration || x.duration < 900);
    return list;
  }

  render() {
    if (WEB_NAME[this.tab] && this.results[this.tab] === null) return;
    const list = this.rows();
    this.current = list;
    if (!list.length) {
      if (this.tab === 'files') return this.msg('Aucun fichier. Ajoute tes MP3/WAV/FLAC avec <b>+ Fichiers</b> ou <b>+ Dossier</b>, ou glisse-les dans la fenêtre.');
      return this.msg('Aucun résultat.');
    }
    const { A, B } = this.app.engine.decks;
    const art = this.tab === 'audius' || !!WEB_NAME[this.tab];
    const rows = list.map((x, i) => {
      const info = trackInfo(x) || {};
      const bpm = x.source === 'practice' ? x.bpm : info.bpm || x.bpm;
      const key = info.key || x.key;
      const cls = (A.track && A.track.source === x.source && String(A.track.id) === String(x.id) ? ' loaded-A' : '') + (B.track && B.track.source === x.source && String(B.track.id) === String(x.id) ? ' loaded-B' : '');
      return `<tr data-i="${i}" class="${cls}" title="Double-clic : charger sur la platine libre · glisser sur une platine pour l'y charger">
        ${art ? `<td style="width:36px">${x.art ? `<img class="art" src="${esc(x.art)}" loading="lazy">` : '<div class="art"></div>'}</td>` : ''}
        <td><b>${esc(x.title)}</b>${x.access === 'preview' ? ' <span class="dim">(extrait)</span>' : ''}${x.downloaded ? ' <span class="dim" title="Déjà téléchargé (dossier Téléchargés) : chargement instantané">✓</span>' : ''}${x.from ? ` <span class="dim" title="Téléchargé depuis ${esc(WEB_NAME[x.from] || x.from)}">⬇</span>` : ''}</td><td class="dim">${esc(x.artist)}</td><td class="genre">${esc(x.genre || '')}</td>
        <td class="num">${bpm ? Number(bpm).toFixed(bpm % 1 ? 1 : 0) : x.hintBpm ? `<span class="dim" title="BPM annoncé par la plateforme (souvent faux) : IrisDJ l'analysera au chargement">~${Math.round(x.hintBpm)}</span>` : ''}</td>
        <td class="num" title="${esc(key || '')}">${key ? camelot(key) || '' : ''}</td><td class="num dim">${dur(x.duration)}</td>
        <td style="width:96px"><button class="ld a" data-d="A">A</button><button class="ld b" data-d="B">B</button>${this.tab === 'files' ? '<button class="ld" data-rm title="Retirer de la liste">×</button>' : ''}</td></tr>`;
    }).join('');
    this.listEl.innerHTML = `<table><thead><tr>${art ? '<th></th>' : ''}<th>Titre</th><th>Artiste</th><th>Genre</th><th>BPM</th><th>Clé</th><th>Durée</th><th>Charger</th></tr></thead><tbody>${rows}</tbody></table>`;
    this.listEl.querySelectorAll('tr[data-i]').forEach((tr) => {
      const x = list[tr.dataset.i];
      tr.querySelectorAll('[data-d]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); this.app.loadTrack(b.dataset.d, x); }));
      const rm = tr.querySelector('[data-rm]'); if (rm) rm.onclick = async (e) => { e.stopPropagation(); this.results.files = await window.dj.lib.remove(x.id); this.render(); };
      tr.ondblclick = () => this.app.loadTrack(this.app.freeDeck(), x);
      tr.addEventListener('pointerdown', (e) => { if (!e.target.closest('button')) this.app.startDrag(e, x); });
    });
  }
}
