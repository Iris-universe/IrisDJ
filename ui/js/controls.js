// Registre de tous les contrôles réglables : utilisé par l'interface, les cours, le coach et l'assistant (Orbiz).
import { DECKS, TEMPO_RANGES, FX_TYPES, FX_BEATS } from './engine.js';

export function buildControls(engine) {
  const C = new Map();
  const add = (id, o) => C.set(id, { id, type: 'range', min: -1, max: 1, def: 0, ...o });

  for (const d of DECKS) {
    const deck = engine.decks[d];
    const mix = (k, o) => add(`${d}.${k}`, { get: () => engine.mix[d][k], set: (v) => engine.set(`${d}.${k}`, v), ...o });
    mix('trim', { label: `TRIM ${d}`, hw: 'potard TRIM (ou GAIN) en haut de la voie', help: 'Volume d\'entrée de la voie (−12 à +12 dB). Sert à mettre tous les morceaux au même niveau sur le VU-mètre.' });
    mix('hi', { label: `HI ${d}`, hw: 'EQ HI', help: 'Aigus (charleston, cymbales). À fond à gauche = coupés.' });
    mix('mid', { label: `MID ${d}`, hw: 'EQ MID', help: 'Médiums (voix, leads, mélodies).' });
    mix('low', { label: `LOW ${d}`, hw: 'EQ LOW', help: 'Basses (kick, basse). À fond à gauche = « kill » : plus de basses du tout.' });
    mix('filter', { label: `COLOR ${d}`, hw: 'bouton COLOR / FILTER', help: 'Filtre : à gauche passe-bas (son étouffé), à droite passe-haut (son fin, sans basses), au centre = rien.' });
    mix('fader', { label: `Fader ${d}`, min: 0, max: 1, def: 0, hw: 'fader de voie (channel fader)', help: 'Volume de la voie dans le mix.' });
    mix('cue', { label: `CUE casque ${d}`, type: 'bool', def: false, hw: 'bouton CUE (casque) de la voie', help: 'Envoie cette voie dans le casque pour la pré-écouter sans que le public l\'entende.' });
    mix('xf', { label: `Assign crossfader ${d}`, type: 'enum', options: ['A', 'THRU', 'B'], def: d, hw: 'sélecteur CROSSFADER ASSIGN', help: 'A ou B : la voie passe par ce côté du crossfader. THRU : le crossfader ne l\'affecte pas.' });

    add(`${d}.tempo`, { label: `Tempo ${d}`, hw: 'pitch fader / TEMPO du CDJ', help: 'Vitesse du morceau. Comme sur un CDJ : vers le haut = plus lent (−), vers le bas = plus rapide (+).',
      get: () => deck.tempo, set: (v) => deck.setTempo(Number(v)), fmt: () => `${deck.tempoPct >= 0 ? '+' : ''}${deck.tempoPct.toFixed(2)} %` });
    add(`${d}.range`, { label: `Plage tempo ${d}`, type: 'enum', options: TEMPO_RANGES, hw: 'bouton TEMPO ±6/10/16/WIDE', help: 'Amplitude du fader de tempo. ±6 % = précis, WIDE (±50 %) = gros changements.',
      get: () => deck.range, set: (v) => deck.setRange(Number(v)) });
    add(`${d}.keylock`, { label: `Master Tempo ${d}`, type: 'bool', hw: 'MASTER TEMPO (CDJ) / KEY LOCK', help: 'Garde la même hauteur de note quand on change le tempo.',
      get: () => deck.keylock, set: (v) => deck.setKeylock(!!v) });
    add(`${d}.quantize`, { label: `Quantize ${d}`, type: 'bool', hw: 'QUANTIZE', help: 'Les cues, hot cues et boucles se calent automatiquement sur le temps le plus proche.',
      get: () => deck.quantize, set: (v) => { deck.quantize = !!v; deck.emit('change'); } });
    add(`${d}.sync`, { label: `Sync ${d}`, type: 'bool', hw: 'BEAT SYNC', help: 'Cale automatiquement le tempo et la phase sur l\'autre platine. Pratique, mais apprends d\'abord à caler à l\'oreille !',
      get: () => deck.sync, set: (v) => deck.setSync(!!v) });
    add(`${d}.vinyl`, { label: `Mode vinyle ${d}`, type: 'bool', hw: 'VINYL / JOG MODE', help: 'Jog en mode vinyle : toucher le dessus du jog arrête le disque et permet de scratcher. Sinon le jog sert seulement à pousser/freiner.',
      get: () => deck.vinyl !== false, set: (v) => { deck.vinyl = !!v; deck.emit('change'); } });
  }

  const m = (k, o) => add(k, { get: () => engine.get(k), set: (v) => engine.set(k, v), ...o });
  m('xfader', { label: 'Crossfader', hw: 'crossfader', help: 'Passe d\'une platine à l\'autre (gauche = A, droite = B).' });
  m('xfCurve', { label: 'Courbe du crossfader', type: 'enum', options: ['smooth', 'cut'], hw: 'CROSSFADER CURVE', help: 'smooth = fondu progressif (les deux à fond au centre), cut = coupe sèche aux extrémités (scratch, coupes rapides).' });
  m('master', { label: 'MASTER', min: 0, max: 1, def: 0.8, hw: 'MASTER LEVEL', help: 'Volume général. Le VU-mètre master ne doit pas rester dans le rouge.' });
  m('phonesMix', { label: 'MIX casque', hw: 'HEADPHONES MIXING (CUE ↔ MASTER)', help: 'Dans le casque : à gauche = seulement ce qui est en CUE, à droite = seulement le master.' });
  m('phonesLevel', { label: 'LEVEL casque', min: 0, max: 1, def: 0.8, hw: 'HEADPHONES LEVEL', help: 'Volume du casque.' });
  m('limiter', { label: 'Limiteur de sécurité', type: 'bool', hw: '(pas sur une vraie table : là-bas, ça sature vraiment !)', help: 'Empêche le son de saturer sur tes enceintes. Le VU-mètre master montre quand même quand tu dépasses.' });
  m('fx.type', { label: 'Effet', type: 'enum', options: Object.keys(FX_TYPES), hw: 'sélecteur BEAT FX', help: 'Echo (répète en rythme), Reverb (salle), Flanger (son « avion »).' });
  m('fx.beat', { label: 'Temps de l\'effet', type: 'enum', options: FX_BEATS, hw: 'BEAT ◀ ▶', help: 'Durée de l\'effet en temps (1 = un temps, 1/2 = un demi-temps…), calée sur le BPM.' });
  m('fx.channel', { label: 'Voie de l\'effet', type: 'enum', options: ['A', 'B', 'M'], hw: 'FX CH SELECT', help: 'Sur quelle voie agit l\'effet (M = master).' });
  m('fx.level', { label: 'LEVEL/DEPTH effet', min: 0, max: 1, def: 0.5, hw: 'LEVEL/DEPTH', help: 'Quantité d\'effet.' });
  m('fx.on', { label: 'Effet ON', type: 'bool', hw: 'bouton ON/OFF du BEAT FX', help: 'Active l\'effet. Quand on l\'éteint, l\'écho/la réverb finissent de s\'éteindre naturellement.' });
  return C;
}
