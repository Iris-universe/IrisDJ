// Cours interactifs. Chaque étape : html (consigne), hl (contrôles à surligner), check(x) -> true quand c'est réussi,
// live(x) -> petit texte de suivi. Sans check : bouton « Suivant ».
// x = { e, A, B, m (réglages table), lv (niveaux dB), ph (phase), t (ms depuis le début de l'étape), ev(nom), hold(clé, cond, ms), mem }
import { camelot, compatible } from './keys.js';

const RAW = 'p-rawstorm', NIGHT = 'p-nightfall', OVER = 'p-overdrive', REV = 'p-reverse', SUN = 'p-sunday', LIQ = 'p-liquid', BOOM = 'p-boombap';
// vrais morceaux (SoundCloud, téléchargés une fois dans Musique\IrisDJ\Téléchargés)
const NOISEFLOW = { source: 'soundcloud', id: '1781279889', title: 'This is Uptempo', artist: 'NoiseFlow' };
const PEACOCK = { source: 'soundcloud', id: '2418091050', title: 'Trip to New Zealand', artist: 'Dr. Peacock, Partyraiser & Bulletproof' };
const bpmEq =(x, tol = 0.05) => x.A.loaded && x.B.loaded && Math.abs(x.A.effBpm - x.B.effBpm) < tol;
const aud = (x, d) => x[d].playing && x.e.audible(d) > 0.08;
const near32 = (beat) => { const r = Math.round(beat / 32) * 32; return Math.abs(beat - r) < 0.5 && r > 0; };
const bpmTxt = (x) => `A ${x.A.effBpm.toFixed(2)} · B ${x.B.effBpm.toFixed(2)} BPM (écart ${(x.B.effBpm - x.A.effBpm).toFixed(2)})`;
const phTxt = (x) => (x.ph ? `phase : ${x.ph.ms >= 0 ? '+' : ''}${x.ph.ms.toFixed(0)} ms` : 'phase : les deux platines doivent jouer');
const posTxt = (d, x) => { if (!x[d].loaded || !x[d].bpm) return ''; const b = x[d].barInfo(); return `${d} : mesure ${b.bar}, temps ${b.beatInBar} (phrase ${b.phrase})`; };

export const LESSONS = [
  // =====================================================================================================
  {
    id: 'decouverte', chap: '1 · Les bases', title: 'Découvrir la table de mix', desc: 'Platines, table de mixage, formes d\'onde : à quoi sert chaque partie.',
    setup: { A: RAW, B: NIGHT, faders: { A: 0, B: 0 } },
    intro: `<p>Un setup de DJ, c'est toujours la même chose, que ce soit en club ou sur un petit contrôleur :</p>
      <ul><li><b>2 platines</b> (ou plus) qui lisent chacune un morceau : des <b>CDJ</b> en club, ou les deux côtés d'un contrôleur ;</li>
      <li>une <b>table de mixage</b> au milieu qui mélange les deux ;</li>
      <li>un <b>casque</b> pour préparer le morceau suivant sans que le public l'entende.</li></ul>
      <p>IrisDJ reproduit exactement cette disposition. Ce que tu apprends ici marche sur du vrai matériel.</p>`,
    steps: [
      { html: '<b>Les platines A et B.</b> Chacune a un <b>jog</b> (la grande roue), les boutons <b>CUE</b> et <b>PLAY</b>, un <b>fader de tempo</b> à droite et des <b>hot cues</b> (les 8 pads colorés). C\'est la disposition d\'un CDJ.', hl: ['deck-A', 'deck-B'] },
      { html: '<b>La table de mixage.</b> Une colonne par platine : <b>TRIM</b> (volume d\'entrée), l\'<b>égaliseur</b> HI/MID/LOW, le filtre <b>COLOR</b>, le bouton <b>CUE 🎧</b> (casque) et le <b>fader de voie</b>. En bas, le <b>crossfader</b>. Au centre : master, casque et effets.', hl: ['mixer'] },
      { html: '<b>Les formes d\'onde.</b> En haut, les deux morceaux défilent. <span style="color:#1f6cff">Bleu</span> = basses (le kick), <span style="color:#ff9d1a">orange</span> = médiums, blanc = aigus. Les traits fins sont les temps, les traits plus clairs les mesures, et les <b style="color:#ff6b6b">lignes rouges</b> le début de chaque phrase (32 temps). On en reparle au chapitre 2.', hl: ['waves'] },
      { html: '<b>La bibliothèque</b> (en bas). L\'onglet <b>Entraînement</b> contient des morceaux faits pour les exercices (hardcore, uptempo, hardstyle, house, DnB, hip-hop). Dans <b>Audius</b>, tu trouves de la vraie musique gratuite. Dans <b>Mes fichiers</b>, tu ajoutes tes MP3.<br><br>Charge <b>Rawstorm</b> sur la platine A : bouton <span class="k">A</span> sur sa ligne (ou glisse-le sur la platine).', hl: ['library'],
        check: (x) => x.A.loaded && x.A.track.id === RAW },
      { html: 'Monte le <b>fader de la voie A</b> (sur la table, colonne A, en bas).', hl: ['A.fader'], check: (x) => x.m.A.fader > 0.7 },
      { html: 'Appuie sur <b>PLAY</b> sur la platine A (ou la touche <span class="k">W</span>).', hl: ['A.play'], check: (x) => x.A.playing },
      { html: 'Regarde le <b>VU-mètre</b> de la voie A (la colonne de petites barres à côté de la tranche A) et celui du <b>master</b>. Ils montrent le niveau du son. Vert = bien, jaune = fort, <b style="color:#ff3d3d">rouge = ça sature</b>. On règle ça au cours 3.', hl: ['A.vu', 'master.vu'] },
    ],
    outro: '<p>Tu connais maintenant la disposition. <b>Sur une vraie table</b> : les CDJ sont à gauche et à droite et la table de mixage au milieu. Sur un contrôleur (Pioneer DDJ, Hercules, Numark…), c\'est la même chose dans un seul boîtier.</p>',
  },
  // =====================================================================================================
  {
    id: 'cue', chap: '1 · Les bases', title: 'Lire, CUE et hot cues', desc: 'Le bouton CUE façon CDJ, lancer un morceau pile, mémoriser des endroits.',
    setup: { A: RAW, faders: { A: 1, B: 0 } },
    intro: `<p>Le bouton <b>CUE</b> est le bouton le plus important d'un CDJ. Il marque <b>l'endroit d'où tu veux lancer le morceau</b> (le « point de cue »), en général le premier kick ou le début d'une phrase.</p>
      <ul><li><b>En lecture</b> : CUE renvoie au point de cue et arrête la lecture.</li>
      <li><b>À l'arrêt</b> : CUE pose le point de cue à l'endroit actuel. Tant que tu le maintiens, tu entends le morceau ; quand tu le relâches, la lecture y revient.</li></ul>`,
    steps: [
      { html: 'Appuie sur <b>PLAY</b>.', hl: ['A.play'], check: (x) => x.A.playing },
      { html: 'Appuie sur <b>CUE</b> pendant la lecture : la platine revient au point de cue (le début) et s\'arrête.', hl: ['A.cuebtn'],
        check: (x) => { if (x.A.playing) x.mem.was = true; return x.mem.was && !x.A.playing && Math.abs(x.A.position() - x.A.cuePoint) < 0.05; } },
      { html: 'Place un nouveau point de cue sur le <b>drop</b> :<br>1. clique sur la <b>vue d\'ensemble</b> (la petite forme d\'onde de la platine) au niveau de « Drop » ;<br>2. tourne le <b>jog</b> pour arriver pile sur le trait rouge « PHRASE 7 » (mesure 49) ;<br>3. appuie une fois sur <b>CUE</b>.<br><i>QUANTIZE est allumé : le cue se cale tout seul sur le temps le plus proche.</i>', hl: ['A.overview', 'A.jog', 'A.cuebtn'],
        check: (x) => x.ev('A.cue') && Math.abs(x.A.beatAt(x.A.cuePoint) - 192) < 0.6,
        live: (x) => `point de cue : mesure ${x.A.barInfo(x.A.cuePoint).bar}, temps ${x.A.barInfo(x.A.cuePoint).beatInBar} (objectif : mesure 49, temps 1)` },
      { html: '<b>Lancer pile</b> : maintiens <b>CUE</b> (tu entends le drop), puis appuie sur <b>PLAY</b> sans lâcher CUE, et relâche CUE : la lecture continue. Les DJ s\'en servent pour lancer un morceau au bon moment.', hl: ['A.cuebtn', 'A.play'],
        check: (x) => x.ev('A.play') && x.A.playing },
      { html: '<b>Hot cues</b> : ce sont des points de cue en plus, un par pad. Pendant la lecture, appuie sur le pad <b>A</b> (vide) pour mémoriser l\'endroit, puis un peu plus tard sur le pad <b>B</b>.', hl: ['A.hc1', 'A.hc2'],
        check: (x) => x.A.hotcues[0] != null && x.A.hotcues[1] != null },
      { html: 'Appuie sur le pad <b>A</b> : tu sautes directement à cet endroit, sans t\'arrêter et en gardant le rythme (QUANTIZE). Clic droit sur un pad = l\'effacer.', hl: ['A.hc1'], check: (x) => x.ev('A.hotcue') },
    ],
    outro: `<p>Les hot cues servent à marquer les endroits importants d'un morceau : fin de l'intro, break, <b>drop</b>, outro. En hardcore, on marque presque toujours le drop pour pouvoir <b>couper dessus</b> (cours 8).</p>
      <div class="hw"><b>Sur du vrai matériel</b> : les CDJ-3000 ont 8 hot cues (A–H) au-dessus du jog, et les contrôleurs ont 8 pads en mode « Hot Cue ». Les cues sont enregistrés sur la clé USB quand tu prépares tes morceaux dans rekordbox (ou équivalent).</div>`,
  },
  // =====================================================================================================
  {
    id: 'niveaux', chap: '1 · Les bases', title: 'Volume, VU-mètres et égaliseur', desc: 'TRIM, ne pas saturer, couper les basses, le filtre COLOR.',
    setup: { A: RAW, faders: { A: 1, B: 0 }, seekA: 49, trim: { A: 0.75 } },
    intro: `<p>Règle n°1 du DJ : <b>ne jamais être dans le rouge</b>. Ça sature et ça abîme les enceintes, et en club l'ingé son va venir te voir.</p>
      <p>Le <b>TRIM</b> (ou GAIN) règle le volume d'entrée de chaque voie. Le but : que tous tes morceaux arrivent <b>au même niveau</b> sur le VU-mètre. Comme ça, quand tu passes de l'un à l'autre, le volume ne saute pas. Les faders, eux, servent à <b>mixer</b>.</p>`,
    steps: [
      { html: 'Lance la lecture : on est sur le drop.', hl: ['A.play'], check: (x) => x.A.playing },
      { html: 'Le TRIM de A est trop haut : le VU-mètre A touche le <b style="color:#ff3d3d">rouge</b>. Baisse le <b>TRIM</b> (glisse vers le bas) jusqu\'à ce que les pics arrivent dans le <b style="color:#ffd23d">jaune</b> sans toucher le rouge, et reste-y 3 secondes.', hl: ['A.trim', 'A.vu'],
        check: (x) => x.A.playing && x.peakHold('A', 2500, -10, -0.5),
        live: (x) => `pic voie A : ${x.peakMax('A', 2500).toFixed(1)} dB (objectif : entre −10 et −0,5)` },
      { html: '<b>L\'égaliseur (EQ)</b> : tourne <b>LOW</b> de A à fond à gauche. Le kick disparaît : c\'est le « kill ».', hl: ['A.low'], check: (x) => x.m.A.low <= -0.98 },
      { html: 'Remets <b>LOW</b> au milieu (double-clic dessus = retour au centre).', hl: ['A.low'], check: (x) => Math.abs(x.m.A.low) < 0.05 },
      { html: 'Coupe les aigus (<b>HI</b> à fond à gauche) : les charlestons et le haut des leads disparaissent. Puis remets HI au milieu.', hl: ['A.hi'],
        check: (x) => { if (x.m.A.hi < -0.8) x.mem.cut = true; return x.mem.cut && Math.abs(x.m.A.hi) < 0.05; } },
      { html: '<b>Le filtre COLOR</b> : tourne-le à <b>gauche</b> (passe-bas : son étouffé, comme à travers un mur), puis à <b>droite</b> (passe-haut : plus de basses, son fin), puis remets-le au centre.', hl: ['A.filter'],
        check: (x) => { const f = x.m.A.filter; if (f < -0.5) x.mem.l = true; if (f > 0.5) x.mem.r = true; return x.mem.l && x.mem.r && Math.abs(f) < 0.05; } },
    ],
    outro: `<p><b>À retenir :</b></p><ul><li>TRIM = mettre les morceaux au même niveau (avant de mixer) ;</li><li>EQ = faire de la place : <b>jamais deux basses à fond en même temps</b> ;</li><li>COLOR = filtre pour les effets de montée et de sortie.</li></ul>
      <div class="hw"><b>Sur du vrai matériel</b> : sur une DJM, l'EQ va de −26 dB à +6 dB. Évite de pousser au-dessus du centre : on mixe en <b>coupant</b>, pas en boostant. Le <b>limiteur</b> d'IrisDJ protège tes enceintes, mais une vraie table n'en a pas : prends l'habitude de regarder le VU-mètre master.</div>`,
  },
  // =====================================================================================================
  {
    id: 'casque', chap: '1 · Les bases', title: 'Le casque : pré-écouter', desc: 'Préparer le morceau suivant sans que le public l\'entende.',
    setup: { A: RAW, B: NIGHT, faders: { A: 1, B: 0 }, seekA: 17 },
    intro: `<p>Le DJ écoute <b>deux choses</b> : ce que joue la salle (les enceintes) et, dans son casque, <b>le prochain morceau</b>, pour le caler avant de le faire entendre.</p>
      <p>Pour pratiquer chez toi, ouvre <b>Sortie audio</b> en haut :</p>
      <ul><li>si tu as <b>deux sorties</b> (carte son DJ, ou casque USB + enceintes), choisis-en une pour le casque ;</li>
      <li>sinon, prends le mode <b>Split</b> : l'oreille gauche du casque reçoit la pré-écoute (CUE) et l'oreille droite le master. C'est ce que font beaucoup de DJ débutants avec un simple casque.</li></ul>`,
    steps: [
      { html: 'Ouvre les réglages <b>Sortie audio</b> et choisis un mode pour le casque (Split si tu n\'as qu\'une sortie). Ferme, puis clique sur Suivant.', hl: ['btn-audio'] },
      { html: 'Lance <b>A</b> : c\'est ce que « le public » entend (fader A en haut).', hl: ['A.play'], check: (x) => x.A.playing && x.m.A.fader > 0.7 },
      { html: 'Active <b>CUE 🎧</b> sur la voie B, puis lance <b>B</b> en laissant son <b>fader en bas</b> : B est dans ton casque, mais pas dans les enceintes.', hl: ['B.cue', 'B.play', 'B.fader'],
        check: (x) => x.m.B.cue && x.B.playing && x.m.B.fader < 0.1 },
      { html: 'Le potard <b>CUE↔MST</b> (casque) dose le mélange dans le casque : à gauche, seulement la pré-écoute ; à droite, seulement le master. Beaucoup de DJ le laissent à gauche et écoutent le master avec l\'autre oreille, dans la salle. Tourne-le pour entendre la différence.', hl: ['phonesMix'] },
      { html: 'Coupe la pré-écoute de B (<b>CUE 🎧</b>) et arrête B (<b>CUE</b> de la platine B).', hl: ['B.cue', 'B.cuebtn'], check: (x) => !x.m.B.cue && !x.B.playing },
    ],
    outro: `<div class="hw"><b>Sur du vrai matériel</b> : chaque voie a son bouton CUE (souvent lumineux). Le casque se branche en façade de la table, avec ses potards MIXING (cue/master) et LEVEL. En club, il y a aussi une sortie <b>BOOTH</b> : l'enceinte de retour à côté de toi. Avec un contrôleur : une sortie pour les enceintes, une prise casque.</div>`,
  },
  // =====================================================================================================
  {
    id: 'phrases', chap: '2 · Le rythme', title: 'Temps, mesures et phrases', desc: 'Compter la musique : la base de toutes les transitions.',
    setup: { A: RAW, faders: { A: 1, B: 0 } },
    intro: `<p>La musique électronique se compte toujours de la même façon :</p>
      <ul><li><b>1 temps</b> = 1 kick (en hardcore : « boum ») ;</li>
      <li><b>1 mesure</b> = 4 temps : 1-2-3-4 ;</li>
      <li><b>1 phrase</b> = 8 mesures = <b>32 temps</b>.</li></ul>
      <p>Les morceaux changent presque toujours <b>au début d'une phrase</b> : un nouvel instrument, un break, un drop… Un bon mix <b>respecte les phrases</b>. Tu lances le morceau suivant au début d'une phrase, et tu fais tes changements (swap des basses, coupe) au début d'une phrase.</p>
      <p>Un morceau hardcore/uptempo typique : <b>intro</b> (16-32 mesures, kick seul, faite pour mixer) → <b>couplet</b> → <b>break</b> (pas de kick, mélodie) → <b>build-up</b> (la montée) → <b>drop</b> (le moment fort) → … → <b>outro</b> (faite pour mixer).</p>`,
    steps: [
      { html: 'Lance Rawstorm et <b>compte à voix haute</b> 1-2-3-4 avec le kick. Regarde l\'anneau au centre du jog et l\'indicateur de phase entre les formes d\'onde : ils montrent le temps de la mesure. Clique sur Suivant quand tu le sens.', hl: ['A.play', 'A.jog', 'phase'] },
      { html: '<b>Mesure le tempo à l\'oreille</b> : appuie sur <b>TAP</b> en rythme avec le kick, au moins 8 fois de suite.', hl: ['A.tap'],
        check: (x) => x.ev('A.tap') && Math.abs((x.A.tapBpm || 0) - 175) / 175 < 0.03, live: (x) => (x.A.tapBpm ? `ton tempo : ${x.A.tapBpm.toFixed(1)} BPM (Rawstorm : 175)` : '') },
      { html: 'Écoute ce qui se passe à la <b>mesure 17</b> (début de la phrase 3) : le clap et un petit lead arrivent. Tu peux avancer avec ▶▶ (saut de 4 mesures). Les changements tombent pile sur les <b style="color:#ff6b6b">lignes rouges</b>.', hl: ['A.jumpFwd', 'waves'],
        check: (x) => x.A.playing && x.A.barInfo().bar >= 18, live: (x) => posTxt('A', x) },
      { html: '<b>Exercice</b> : arrête la lecture et pose le <b>CUE</b> au début du <b>break</b> (phrase 5 = mesure 33). Utilise la vue d\'ensemble, puis le jog.', hl: ['A.overview', 'A.cuebtn'],
        check: (x) => !x.A.playing && Math.abs(x.A.beatAt(x.A.cuePoint) - 128) < 0.6,
        live: (x) => `point de cue : mesure ${x.A.barInfo(x.A.cuePoint).bar}, temps ${x.A.barInfo(x.A.cuePoint).beatInBar} (objectif : 33.1)` },
      { html: 'Sur tes propres morceaux, IrisDJ détecte le tempo et la grille tout seul, mais il peut se tromper :<ul><li>le BPM est le double ou la moitié du vrai → <b>BPM ÷2 / ×2</b> ;</li><li>les mesures sont décalées (la ligne rouge n\'est pas sur le vrai début de phrase) → mets la lecture sur un vrai « 1 » et clique sur <b>1er temps ici</b>.</li></ul>', hl: ['A.bpmHalf', 'A.downbeat'] },
    ],
    outro: '<p>Retiens : <b>32 temps = une phrase</b>. En hardcore, on lance presque toujours le morceau suivant au début d\'une phrase du morceau en cours. Les autres styles (house, techno, DnB) fonctionnent pareil.</p>',
  },
  // =====================================================================================================
  {
    id: 'beatmatch', chap: '2 · Le rythme', title: 'Caler à l\'oreille (beatmatching)', desc: 'Mettre deux morceaux au même tempo et en phase, sans SYNC.',
    setup: { A: RAW, B: NIGHT, faders: { A: 1, B: 0.6 }, cueB: true, rangeB: 10 },
    intro: `<p>Pour mixer deux morceaux, il faut qu'ils aient <b>le même tempo</b> (BPM) et que leurs kicks tombent <b>en même temps</b> (la phase). Sinon, on entend un « flam » : un double kick, comme un galop.</p>
      <p>Le bouton SYNC le fait tout seul, mais tous les bons DJ savent le faire <b>à l'oreille</b>. Ça sert quand la grille est fausse, quand le SYNC n'est pas dispo, et ça t'apprend à entendre si c'est calé.</p>`,
    steps: [
      { html: 'Lance <b>A</b> (Rawstorm, 175 BPM).', hl: ['A.play'], check: (x) => x.A.playing },
      { html: 'B (Nightfall) est à <b>180 BPM</b>. Règle le <b>fader de tempo de B</b> pour qu\'il affiche le même BPM que A. <b>Attention</b>, comme sur un CDJ : vers le <b>haut</b> = plus lent. Maj + glisser = réglage fin.', hl: ['B.tempo'],
        check: (x) => bpmEq(x, 0.03), live: bpmTxt },
      { html: 'Lance <b>B</b> sur le <b>1</b> d\'une mesure de A : regarde l\'anneau du jog de A (ou l\'indicateur de phase) et appuie sur PLAY de B quand A est sur le premier temps.', hl: ['B.play', 'phase'],
        check: (x) => x.B.playing && x.A.playing, live: (x) => posTxt('A', x) },
      { html: 'Corrige le décalage avec le <b>jog de B</b> : tourne le <b>bord</b> du jog pour pousser ou freiner, ou maintiens les boutons <b>−/+</b> sous le fader de tempo (clavier : <span class="k">K</span>/<span class="k">L</span>). L\'indicateur PHASE doit passer au <b style="color:#38d97a">vert</b> (moins de 10 ms) et y rester 4 secondes. Écoute bien : quand c\'est calé, les deux kicks n\'en font plus qu\'un.', hl: ['B.jog', 'phase'],
        check: (x) => x.hold('ok', x.ph && bpmEq(x, 0.05) && Math.abs(x.ph.ms) < 10, 4000), live: (x) => `${phTxt(x)} · ${bpmTxt(x)}` },
      { html: '<b>Mode oreille</b> : on cache les BPM et les millisecondes. Clique sur le bouton ci-dessous, décale B exprès avec le jog (tu dois entendre le galop), puis recale-le <b>uniquement à l\'oreille</b>.', hl: ['B.jog'],
        action: { label: 'Cacher les BPM (mode oreille)', run: (app) => app.setHideBpm(true) },
        check: (x) => { if (x.ph && Math.abs(x.ph.ms) > 30) x.mem.off = true; return x.view.hideBpm && x.mem.off && x.hold('ok2', x.ph && Math.abs(x.ph.ms) < 12, 4000); },
        live: (x) => (x.mem.off ? 'Décalé ! Maintenant recale à l\'oreille…' : 'Décale B avec le jog…') },
    ],
    onExit: (app) => app.setHideBpm(false),
    outro: `<p>Bravo ! Tu viens de faire ce que les DJ vinyle font depuis 40 ans. Sur un vrai mix, les tempos <b>dérivent</b> doucement si le fader n'est pas parfait : on corrige en permanence avec le jog.</p>
      <div class="hw"><b>Sur du vrai matériel</b> : sur un CDJ, le fader de tempo marche dans le même sens (vers soi = plus rapide). On pousse le <b>bord</b> du jog pour corriger la phase. En vinyle, on pousse ou freine le disque avec le doigt. Avec <b>SYNC</b>, tout ça est automatique, mais garde l'habitude d'écouter.</div>`,
  },
  // =====================================================================================================
  {
    id: 'bassswap', chap: '3 · Les transitions', title: 'Première transition : le bass swap', desc: 'La transition de base : on échange les basses au début d\'une phrase.',
    setup: { A: RAW, B: NIGHT, faders: { A: 1, B: 0 }, seekA: 49, cueB: true },
    intro: `<p>Le principe le plus important du mix : <b>jamais deux kicks/basses en même temps</b>. Les basses de deux morceaux s'additionnent et font de la bouillie : ça sature, et en hardcore deux kicks distordus ensemble sonnent horriblement.</p>
      <p>Le <b>bass swap</b> :</p><ol><li>tu lances B, basses coupées (LOW à gauche), au début d'une phrase de A ;</li><li>tu montes B : on entend ses aigus et médiums, mais le kick reste celui de A ;</li><li>au début d'une phrase, <b>d'un coup</b> : LOW de A coupé, LOW de B remis ;</li><li>tu fais sortir A.</li></ol>`,
    steps: [
      { html: 'Prépare B : <b>LOW de B à fond à gauche</b> (kill) et fader B en bas.', hl: ['B.low', 'B.fader'], check: (x) => x.m.B.low <= -0.98 && x.m.B.fader < 0.1 },
      { html: 'Mets B au même tempo que A (175) : à l\'oreille comme au cours précédent, ou avec <b>SYNC</b> sur B.', hl: ['B.tempo', 'B.sync'], check: (x) => bpmEq(x), live: bpmTxt },
      { html: 'Lance <b>A</b> (il est au drop, mesure 49). Puis lance <b>B</b> (son intro) <b>pile au début d\'une phrase de A</b>, sur une ligne rouge : mesure 57, 65 ou 73. Si tu rates, appuie sur CUE de B et attends la phrase suivante.', hl: ['A.play', 'B.play', 'waves'],
        check: (x) => { const p = x.evData('B.play'); return x.B.playing && x.A.playing && p && p.otherBeat != null && near32(p.otherBeat); },
        live: (x) => { const p = x.evData('B.play'); return p && p.otherBeat != null && !near32(p.otherBeat) && x.B.playing ? `B lancé à la mesure ${Math.floor(p.otherBeat / 4) + 1}, temps ${(Math.floor(p.otherBeat) % 4) + 1} de A : pas sur une phrase. CUE sur B et réessaie.` : posTxt('A', x); } },
      { html: 'Monte le <b>fader B</b> progressivement (en 4 à 8 mesures) : les charlestons de B arrivent, les basses restent celles de A. Garde la phase calée (jog de B) si ça dérive.', hl: ['B.fader', 'phase'],
        check: (x) => x.m.B.fader > 0.8 && aud(x, 'A'), live: phTxt },
      { html: '<b>LE SWAP</b> : au début de la prochaine phrase (ligne rouge), <b>en même temps</b> : coupe LOW de A et remets LOW de B au centre (double-clic). Astuce : une main sur chaque potard.', hl: ['A.low', 'B.low'],
        check: (x) => x.m.A.low <= -0.9 && Math.abs(x.m.B.low) < 0.1, live: (x) => posTxt('B', x) },
      { html: 'Fais sortir A : baisse son fader en douceur (2 à 4 mesures), puis arrête-le.', hl: ['A.fader'], check: (x) => x.m.A.fader < 0.05 || !x.A.playing },
    ],
    outro: `<p>🎉 <b>Ta première vraie transition !</b> C'est la base de presque tous les mix, dans tous les styles. Après, on varie la durée (8 mesures en hardcore, 32 en techno), on utilise le filtre, les effets…</p>
      <p>Pense à remettre l'EQ de A au centre avant d'y charger le morceau suivant.</p>`,
  },
  // =====================================================================================================
  {
    id: 'dropcut', chap: '3 · Les transitions', title: 'Hardcore : couper sur le drop', desc: 'La transition reine du hardcore et de l\'uptempo.',
    setup: { A: RAW, B: NIGHT, faders: { A: 1, B: 1 }, seekA: 33, seekB: 49, matchB: true, xfader: -1 },
    intro: `<p>En hardcore et en uptempo, la transition la plus utilisée est la plus simple : on laisse le <b>break</b> et la <b>montée</b> du morceau A, et <b>au moment où le drop de A devrait tomber</b>, on lance <b>le drop de B</b> à la place et on coupe A.</p>
      <p>Le public attend un drop… et en reçoit un nouveau. Ça garde toute l'énergie. Ça marche parce que les deux morceaux sont <b>calés sur les phrases</b> : le break de A dure exactement 16 mesures.</p>`,
    steps: [
      { html: 'La platine B est sur le début de son drop (mesure 49). Pose-y un <b>hot cue</b> : pad <b>A</b> de la platine B.', hl: ['B.hc1'],
        check: (x) => x.B.hotcues[0] != null && Math.abs(x.B.beatAt(x.B.hotcues[0]) - 192) < 0.6 },
      { html: 'Vérifie que B est au tempo de A (175). Ici, B est déjà calé : crossfader à gauche, donc on n\'entend que A.', hl: ['B.tempo', 'xfader'], check: (x) => bpmEq(x) },
      { html: 'Lance <b>A</b> : on est au début du <b>break</b> (mesure 33). Le break dure 16 mesures, avec une montée à la fin. Le drop de A arriverait <b>mesure 49</b>. Compte les mesures (affichées sous la platine).', hl: ['A.play'], check: (x) => x.A.playing, live: (x) => posTxt('A', x) },
      { html: 'Au moment exact où le drop de A devrait tomber (<b>mesure 49, temps 1</b>), appuie sur le <b>pad A de B</b> ET passe le <b>crossfader à fond à droite</b> d\'un coup. Ou bien baisse le fader A et monte le crossfader. Si tu rates : recommence avec CUE sur B, ◀◀ sur A…', hl: ['B.hc1', 'xfader'],
        check: (x) => { const p = x.evData('B.play') || x.evData('B.hotcue'); return p && p.otherBeat != null && Math.abs(p.otherBeat - 192) < 0.5 && x.B.playing && !aud(x, 'A') && x.e.audible('B') > 0.3; },
        live: (x) => { const p = x.evData('B.play') || x.evData('B.hotcue'); if (!p || p.otherBeat == null) return posTxt('A', x); const d = (p.otherBeat - 192) * 60000 / x.A.effBpm; return Math.abs(p.otherBeat - 192) < 0.5 ? (aud(x, 'A') ? 'Bien lancé ! Maintenant coupe A (crossfader à droite).' : '') : `Décalé de ${d > 0 ? '+' : ''}${d.toFixed(0)} ms par rapport au drop de A : réessaie.`; } },
    ],
    outro: `<p>🔥 C'est <b>LA</b> technique hardcore. Variantes :</p>
      <ul><li><b>Echo out + drop</b> : sur le dernier temps de la montée de A, on lance un écho sur A, on coupe A et on lance le drop de B (cours 10).</li>
      <li><b>Build-up de B</b> : on passe dans la montée de B pendant le break de A, puis le drop de B arrive tout seul.</li>
      <li><b>Double drop</b> : les deux drops en même temps (A et B). Spectaculaire mais risqué : coupe les basses de l'un des deux !</li></ul>
      <div class="hw"><b>Sur du vrai matériel</b> : sur CDJ, on prépare B sur le drop (hot cue ou CUE) et on appuie sur PLAY/CUE au bon moment. QUANTIZE aide : le lancement se cale sur le temps.</div>`,
  },
  // =====================================================================================================
  {
    id: 'tempoup', chap: '3 · Les transitions', title: 'Monter en tempo : hardcore → uptempo', desc: 'Passer de 175 à 200 BPM sans que ça s\'entende.',
    setup: { A: RAW, B: OVER, faders: { A: 1, B: 0 }, seekA: 49, cueB: true },
    intro: `<p>Un set hardcore/uptempo <b>monte souvent en tempo</b> : on commence vers 160-175 et on finit à 200-230. Pour passer d'un morceau à 175 BPM à un morceau à 200 BPM, on ne peut pas juste les superposer.</p>
      <p>La méthode : on <b>ralentit B</b> au tempo de A pour la transition, puis, une fois A sorti, on <b>remonte B doucement</b> jusqu'à son tempo d'origine.</p>`,
    steps: [
      { html: 'B (Overdrive) est à <b>200 BPM</b>. Pour descendre à 175, il faut −12,5 % : plus que ±10 %. Passe le <b>TEMPO RANGE</b> de B sur <b>±16 %</b> (bouton au-dessus du fader), puis cale B sur 175.', hl: ['B.range', 'B.tempo'],
        check: (x) => x.B.range >= 16 && bpmEq(x, 0.05), live: bpmTxt },
      { html: 'Active <b>M.TEMPO</b> (Master Tempo) sur B. Sans lui, ralentir de 12,5 % fait baisser le son de plus de 2 demi-tons : les leads deviennent graves et le kick tout mou. Lance B dans le casque et active/désactive M.TEMPO pour entendre la différence.', hl: ['B.keylock'], check: (x) => x.B.keylock },
      { html: 'Fais la transition comme tu veux (bass swap ou coupe sur le drop), jusqu\'à ce qu\'on n\'entende plus que B.', hl: ['B.play', 'A.low', 'B.low', 'A.fader', 'B.fader'],
        check: (x) => x.B.playing && aud(x, 'B') && !aud(x, 'A') },
      { html: 'Maintenant <b>remonte le tempo de B</b> jusqu\'à 0 % (200 BPM), <b>doucement</b> : en 8 mesures ou plus (au moins 10 secondes). Le public ne doit pas sentir le changement.', hl: ['B.tempo'],
        check: (x) => { if (x.B.tempoPct > -11.5 && !x.mem.t0) x.mem.t0 = x.now; return Math.abs(x.B.tempoPct) < 0.3 && x.mem.t0 && x.now - x.mem.t0 > 10000; },
        live: (x) => `B : ${x.B.effBpm.toFixed(1)} BPM (${x.B.tempoPct.toFixed(1)} %)${x.mem.t0 ? ` · ${((x.now - x.mem.t0) / 1000).toFixed(0)} s` : ''}` },
    ],
    outro: `<p>Autres façons de changer de tempo :</p><ul><li><b>Dans un break</b> (pas de kick) : on peut changer le tempo plus vite, personne n'a de repère ;</li><li><b>Echo out</b> : on sort A avec un écho et on lance B directement à son tempo ;</li><li><b>Coupe sèche sur le drop</b> : un saut de 10-15 BPM passe très bien sur un drop d'uptempo.</li></ul>
      <div class="hw"><b>Sur du vrai matériel</b> : sur CDJ, le bouton TEMPO règle ±6/±10/±16/WIDE et le bouton MASTER TEMPO garde la tonalité. Évite WIDE pour caler : le fader devient trop sensible.</div>`,
  },
  // =====================================================================================================
  {
    id: 'effets', chap: '3 · Les transitions', title: 'Effets : echo out, reverb, filtre', desc: 'Les sorties propres et les effets de montée.',
    setup: { A: RAW, faders: { A: 1, B: 0 }, seekA: 57 },
    intro: `<p>Les effets servent surtout à <b>faire sortir un morceau</b> proprement, ou à <b>faire monter</b> la tension. Le plus utilisé en hardcore : l'<b>echo out</b>. On met un écho calé sur le tempo, on coupe le morceau d'un coup sur le 1 d'une phrase, et l'écho continue tout seul en s'éteignant.</p>`,
    steps: [
      { html: 'Dans <b>BEAT FX</b> (au centre de la table) : choisis <b>ECHO</b>, règle le temps sur <b>1</b> avec ◀ ▶ et la voie <b>CH A</b>.', hl: ['fx.type', 'fx.beat', 'fx.channel'],
        check: (x) => x.m.fx.type === 'echo' && x.m.fx.beat === 1 && x.m.fx.channel === 'A' },
      { html: 'Lance A. Sur la <b>dernière mesure</b> avant une ligne rouge (fin de phrase), allume <b>ON</b>. Puis, pile sur le 1 de la phrase suivante, <b>coupe le fader A d\'un coup</b> : l\'écho continue tout seul et s\'éteint en rythme.', hl: ['A.play', 'fx.on', 'A.fader'],
        check: (x) => x.m.fx.on && x.m.A.fader < 0.05 && x.A.playing, live: (x) => posTxt('A', x) },
      { html: 'Éteins l\'effet (ON) et remonte le fader A.', hl: ['fx.on', 'A.fader'], check: (x) => !x.m.fx.on && x.m.A.fader > 0.7 },
      { html: '<b>Reverb</b> : choisis REVERB et allume-le quelques secondes. Ça éloigne le son, comme dans une grande salle. Utile sur un break ou pour finir un set.', hl: ['fx.type', 'fx.on'], check: (x) => x.m.fx.type === 'reverb' && x.m.fx.on },
      { html: 'Éteins l\'effet. <b>Sortie au filtre</b> : tourne <b>COLOR</b> de A vers la droite (passe-haut), lentement, sur 4 à 8 mesures : les basses disparaissent petit à petit. C\'est une sortie douce, très utilisée en house et en techno.', hl: ['A.filter'], check: (x) => !x.m.fx.on && x.m.A.filter > 0.6 },
      { html: 'Remets COLOR au centre.', hl: ['A.filter'], check: (x) => Math.abs(x.m.A.filter) < 0.05 },
    ],
    outro: `<div class="hw"><b>Sur du vrai matériel</b> : les DJM ont une section BEAT FX (sélecteur d'effet, BEAT ◀▶, choix de voie, LEVEL/DEPTH, bouton ON). Les contrôleurs ont des « FX » plus simples, mais l'écho est presque toujours là. Le COLOR FX des DJM (filtre, etc.) correspond au potard COLOR d'ici.</div>`,
  },
  // =====================================================================================================
  {
    id: 'boucles', chap: '3 · Les transitions', title: 'Boucles : gagner du temps', desc: 'Rallonger une intro ou un break, faire une montée en boucle.',
    setup: { A: RAW, faders: { A: 1, B: 0 } },
    intro: '<p>Une <b>boucle</b> répète un passage à l\'infini, calé sur le tempo. Ça sert à <b>rallonger une intro</b> quand le morceau suivant n\'est pas prêt, à tenir un break plus longtemps, ou à créer une montée en divisant la boucle.</p>',
    steps: [
      { html: 'Lance A et active une boucle de <b>16 temps</b> (4 mesures) : bouton <b>16</b>, sur le début d\'une mesure. QUANTIZE cale la boucle sur le temps.', hl: ['A.play', 'A.loop16'], check: (x) => x.A.loop.active && x.A.loop.beats === 16 },
      { html: 'La boucle tourne : l\'intro ne s\'arrête plus. Divise-la avec <b>½</b> jusqu\'à <b>1 temps</b> : ça crée une montée (un « loop roll »).', hl: ['A.loopHalf'],
        check: (x) => x.A.loop.active && x.A.loop.beats <= 1, live: (x) => (x.A.loop.active ? `boucle : ${x.A.loop.beats} temps` : '') },
      { html: 'Sors de la boucle avec <b>⟲</b> sur un début de mesure : la lecture reprend normalement.', hl: ['A.reloop'], check: (x) => !x.A.loop.active },
      { html: 'Boucle manuelle : appuie sur <b>IN</b> au début d\'une mesure, puis sur <b>OUT</b> au début de la mesure suivante.', hl: ['A.loopIn', 'A.loopOut'], check: (x) => x.A.loop.active && x.ev('A.loopin') },
    ],
    outro: `<div class="hw"><b>Sur du vrai matériel</b> : sur CDJ, boutons 4 BEAT/8 BEAT LOOP, IN/OUT, RELOOP/EXIT et ½ / ×2. Sur contrôleur : potard ou pads « Auto Loop ».</div>`,
  },
  // =====================================================================================================
  {
    id: 'styles', chap: '4 · Tous les styles', title: 'Mixer tous les styles', desc: 'Les techniques de chaque genre et comment passer de l\'un à l\'autre.',
    setup: { A: BOOM, B: LIQ, faders: { A: 1, B: 0 }, cueB: true },
    intro: `<p>Chaque style a son tempo et ses habitudes de mix :</p>
      <table><tr><th>Style</th><th>BPM</th><th>Transitions typiques</th></tr>
      <tr><td>Hip-hop</td><td>85-100</td><td>coupes nettes, echo out, scratch ; peu de longs mélanges</td></tr>
      <tr><td>House / tech house</td><td>120-128</td><td>longs mélanges (16-64 mesures), EQ progressif, filtre</td></tr>
      <tr><td>Techno</td><td>125-150</td><td>très longues superpositions, boucles, filtres</td></tr>
      <tr><td>Trance</td><td>130-140</td><td>mix harmonique, sur les breaks</td></tr>
      <tr><td>Dubstep</td><td>140 (ressenti 70)</td><td>coupes sur le drop, double drops</td></tr>
      <tr><td>Hardstyle</td><td>145-160</td><td>bass swap net (la reverse bass prend tout le bas), coupe sur le drop</td></tr>
      <tr><td>Drum &amp; Bass</td><td>170-176</td><td>mix rapides (16 mesures), bass swap, double drops</td></tr>
      <tr><td>Hardcore</td><td>160-190</td><td>coupe sur le drop, echo out, transitions courtes</td></tr>
      <tr><td>Uptempo / Frenchcore</td><td>190-230</td><td>idem, montées de tempo, coupes sèches</td></tr></table>
      <p><b>Changer de tempo</b> entre deux styles, 5 techniques :</p>
      <ol><li><b>Echo out</b> de A, puis B lancé à son tempo ;</li><li>passer <b>pendant un break</b> (pas de kick, donc pas de repère) ;</li><li><b>demi / double tempo</b> : 87 ↔ 174, 75 ↔ 150, 100 ↔ 200 ;</li><li><b>monter le tempo progressivement</b> (cours 9) ;</li><li><b>coupe sèche</b> sur un drop.</li></ol>`,
    steps: [
      { html: '<b>Double tempo</b> : A = hip-hop à 90 BPM, B = drum &amp; bass à 174. Or 2 × 87 = 174 : un morceau de DnB « tombe » sur un hip-hop ralenti de 90 à 87. Ralentis <b>A</b> à <b>87 BPM</b> (fader de tempo de A).', hl: ['A.tempo'],
        check: (x) => Math.abs(x.A.effBpm - 87) < 0.1, live: (x) => `A : ${x.A.effBpm.toFixed(2)} BPM` },
      { html: 'Lance A, puis lance B (dans le casque) sur un <b>1</b> de A et cale la phase : l\'indicateur affiche « tempo ×2 ». Deux temps de B tombent sur un temps de A.', hl: ['A.play', 'B.play', 'phase'],
        check: (x) => x.hold('ok', x.ph && x.ph.ratio === 2 && Math.abs(x.ph.ms) < 15, 2000), live: phTxt },
      { html: 'Fais la transition : coupe LOW de B, monte B, et au début d\'une phrase : swap des basses et sortie de A. On passe du hip-hop à la DnB sans coupure !', hl: ['B.low', 'B.fader', 'A.low', 'A.fader'],
        check: (x) => aud(x, 'B') && !aud(x, 'A') },
      { html: '<b>Echo out entre deux tempos</b> : charge <b>Sunday Groove</b> (house, 124) sur A et <b>Reverse Gate</b> (hardstyle, 150) sur B (bibliothèque, onglet Entraînement). Fais jouer A, mets B sur son drop (mesure 49), puis à la fin d\'une phrase de A : <b>ECHO</b> sur A + coupe A, et lance le drop de B à son tempo d\'origine.', hl: ['library', 'fx.on'],
        check: (x) => { if (x.m.fx.on && x.m.fx.channel === 'A') x.mem.echo = true; return x.A.track?.id === SUN && x.B.track?.id === REV && x.mem.echo && aud(x, 'B') && !aud(x, 'A') && Math.abs(x.B.tempoPct) < 1.5; } },
    ],
    outro: '<p>Avec ces techniques, tu peux passer d\'à peu près n\'importe quel style à n\'importe quel autre. Le secret : <b>respecter les phrases</b> et ne <b>jamais laisser deux basses ensemble</b>. Le reste, c\'est du goût et de l\'entraînement.</p>',
  },
  // =====================================================================================================
  {
    id: 'harmonique', chap: '4 · Tous les styles', title: 'Le mix harmonique (Camelot)', desc: 'Enchaîner des morceaux dont les notes vont ensemble.',
    setup: { A: RAW, faders: { A: 1, B: 0 } },
    intro: `<p>Chaque morceau a une <b>tonalité</b> (ex. la mineur). Si deux tonalités ne vont pas ensemble, les mélodies « frottent » pendant la transition. La <b>roue de Camelot</b> simplifie tout : chaque tonalité a un code (ex. <b>8A</b>).</p>
      <p>Deux morceaux sont <b>compatibles</b> si :</p><ul><li>même code (8A → 8A) ;</li><li>±1 avec la même lettre (8A → 7A ou 9A) ;</li><li>même chiffre, autre lettre (8A → 8B).</li></ul>
      <p>IrisDJ affiche le code à côté du BPM : <b style="color:#8ff0b9">vert</b> = compatible avec l'autre platine, <b style="color:#ffb0b0">rouge</b> = pas compatible.</p>`,
    steps: [
      { html: 'A = Rawstorm (<b>8A</b>, la mineur). Dans l\'onglet <b>Entraînement</b>, charge sur <b>B</b> un morceau <b>compatible</b> (regarde la colonne « Clé »).', hl: ['library'],
        check: (x) => x.B.loaded && x.B.track.id !== RAW && compatible(camelot(x.A.track.key), camelot(x.B.track.key)) },
      { html: 'Charge maintenant <b>Overdrive</b> (4A) sur B, mets-le au même tempo et joue les deux ensemble pendant le break (pas de kick) : écoute comme les mélodies frottent. L\'étiquette est rouge.', hl: ['library', 'B.key'],
        check: (x) => x.B.track?.id === OVER && x.A.playing && x.B.playing && x.e.audible('B') > 0.1 && x.e.audible('A') > 0.1 },
      { html: '<b>Le tempo change la tonalité</b> : sans Master Tempo, accélérer de 6 % monte le morceau d\'environ un demi-ton (+7 sur la roue). Bouge beaucoup le tempo de B : une <b>*</b> apparaît sur son code. Active <b>M.TEMPO</b> : le code d\'origine revient.', hl: ['B.tempo', 'B.keylock', 'B.key'] },
    ],
    outro: '<p>En hardcore/uptempo, le mix harmonique compte surtout pour les <b>breaks mélodiques</b> et les longs mélanges. Sur une coupe sèche, on peut s\'en passer. Ne t\'enferme pas dedans : c\'est un outil, pas une règle absolue.</p><div class="hw">rekordbox, Serato et la plupart des logiciels affichent la tonalité. Il suffit d\'activer l\'affichage « Camelot » (ou « Alphanumeric »).</div>',
  },
  // =====================================================================================================
  {
    id: 'materiel', chap: '5 · Le vrai matériel', title: 'Passer sur une vraie table', desc: 'Ce qui change quand tu achètes un contrôleur ou que tu joues sur CDJ.',
    intro: `<p>Tout ce que tu as appris ici se retrouve sur du vrai matériel. Correspondance des contrôles :</p>
      <table><tr><th>IrisDJ</th><th>CDJ / DJM (club)</th><th>Contrôleur (DDJ, etc.)</th></tr>
      <tr><td>Jog, CUE, PLAY</td><td>identiques sur le CDJ</td><td>identiques</td></tr>
      <tr><td>Fader de tempo, ±%</td><td>TEMPO + TEMPO RANGE</td><td>TEMPO (plage dans le logiciel)</td></tr>
      <tr><td>M.TEMPO</td><td>MASTER TEMPO</td><td>KEY LOCK</td></tr>
      <tr><td>Pads A–H</td><td>HOT CUE A–H</td><td>pads en mode HOT CUE</td></tr>
      <tr><td>Boucles, ½ ×2</td><td>4/8 BEAT LOOP, IN/OUT, RELOOP</td><td>AUTO LOOP + pads</td></tr>
      <tr><td>TRIM, EQ, COLOR</td><td>TRIM, EQ, COLOR FX</td><td>TRIM, EQ, FILTER</td></tr>
      <tr><td>CUE 🎧, CUE↔MST</td><td>CUE, HEADPHONES MIXING</td><td>CUE, MIX</td></tr>
      <tr><td>BEAT FX</td><td>BEAT FX</td><td>FX (simplifiés)</td></tr></table>
      <h3>Ce qui change</h3>
      <ul><li><b>Les deux mains en même temps</b> : sur le vrai matériel, tu tournes deux potards à la fois (le swap !). Ici, entraîne-toi avec les raccourcis clavier.</li>
      <li><b>Le jog</b> est bien plus précis sous les doigts qu'à la souris.</li>
      <li><b>Le son</b> : en club, l'enceinte de retour (booth) a un petit retard et la salle résonne. Fie-toi au casque pour caler.</li>
      <li><b>Pas de limiteur</b> : regarde ton VU-mètre master.</li>
      <li><b>Préparer ses morceaux</b> : sur CDJ, on prépare ses morceaux (cues, grille, playlists) dans <b>rekordbox</b> et on les exporte sur une clé USB.</li></ul>
      <h3>Pour commencer</h3>
      <p>Un <b>contrôleur 2 voies</b> d'entrée de gamme (Pioneer DDJ-FLX4, Hercules Inpulse, Numark Mixtrack…) avec rekordbox ou Serato, c'est la même disposition qu'IrisDJ. Si tu vises les clubs hardcore, entraîne-toi aussi sur des <b>XDJ/CDJ</b> dès que tu peux, beaucoup de soirées n'ont que ça.</p>`,
    steps: [],
    outro: '<p>Tu as fait le tour ! Maintenant, la clé, c\'est la <b>pratique</b> : enchaîne de vrais morceaux depuis Audius ou tes fichiers, enregistre-toi (bouton REC) et réécoute-toi. Si tu bloques, demande à Orbiz : il voit ce que tu fais dans IrisDJ.</p>',
  },
  // =====================================================================================================
  {
    id: 'vrais-sons', chap: '6 · Avec tes sons', title: 'Noiseflow → Dr. Peacock : drop sur drop', desc: 'Une vraie transition uptempo sur deux vrais morceaux (SoundCloud).',
    setup: {
      A: NOISEFLOW, B: PEACOCK,
      faders: { A: 1, B: 1 }, xfader: -1, cueB: true,
    },
    intro: `<p>On passe aux vrais morceaux ! Sur la platine A : <b>Noiseflow – This is Uptempo</b> (≈195 BPM). Sur la B : <b>Dr. Peacock, Partyraiser &amp; Bulletproof – Trip to New Zealand</b> (≈200 BPM).</p>
      <p>Avec de vrais morceaux, <b>personne ne te dit où sont le break et le drop</b> : c'est à toi de les trouver, comme un vrai DJ qui prépare son set. Ensuite, tu fais la transition reine de l'uptempo : <b>couper sur le drop</b> (cours 8), puis tu remontes au tempo de Dr. Peacock.</p>
      <p><i>Premier chargement : les deux morceaux sont téléchargés dans ton dossier « Téléchargés » (une seule fois).</i></p>`,
    steps: [
      { html: '<b>Lis la vue d\'ensemble</b> (la petite forme d\'onde de chaque platine). Les gros blocs <span style="color:#1f6cff">bleus</span> et denses = kick à fond (<b>drops</b>). Les parties fines ou orange sans bleu = <b>breaks</b> (pas de kick, souvent une voix ou une mélodie). Le drop arrive juste <b>après</b> un break. Repère-les sur A et sur B.', hl: ['A.overview', 'B.overview'] },
      { html: '<b>Trouve le drop de Dr. Peacock</b> (platine B). Le CUE 🎧 de B est allumé : tu l\'entends au casque, pas en façade. Clique sur la vue d\'ensemble de B juste après le premier break, lance B pour écouter et trouve le <b>premier temps du drop</b> (le premier gros kick). Arrête B et pose le <b>pad A</b> de la platine B pile dessus (le jog aide à être précis).', hl: ['B.overview', 'B.jog', 'B.hc1', 'B.cuebtn'],
        check: (x) => x.B.hotcues[0] != null && !x.B.playing,
        live: (x) => (x.B.hotcues[0] != null ? `pad A de B : mesure ${x.B.barInfo(x.B.hotcues[0]).bar}. Arrête B pour continuer.` : posTxt('B', x)) },
      { html: '<b>Trouve le drop de Noiseflow</b> (platine A) de la même façon : un drop qui arrive après un break. Pose le <b>pad A de la platine A</b> sur son premier temps. C\'est <b>là</b> que tu couperas sur Dr. Peacock.', hl: ['A.overview', 'A.jog', 'A.hc1'],
        check: (x) => x.A.hotcues[0] != null,
        live: (x) => (x.A.hotcues[0] != null ? `pad A de A : mesure ${x.A.barInfo(x.A.hotcues[0]).bar}` : '') },
      { html: '<b>Le tempo</b> : Noiseflow est vers 195 BPM, Dr. Peacock vers 200. Ralentis B au tempo de A (−2,5 % environ) : à l\'oreille, ou avec <b>SYNC</b> sur B. Le BPM détecté peut être faux sur un vrai morceau : vérifie à l\'oreille que les kicks tombent ensemble.', hl: ['B.tempo', 'B.sync'],
        check: (x) => bpmEq(x, 0.1), live: bpmTxt },
      { html: 'B attend, arrêté, sur son drop (s\'il a bougé : pad A de B puis pause). <b>Ne touche plus B.</b> Sur A, <b>recule de 16 mesures</b> avant ton pad A (clique sur la vue d\'ensemble ou ◀◀ plusieurs fois) et lance <b>A</b>. Le crossfader est à gauche : on n\'entend que Noiseflow.', hl: ['B.hc1', 'B.cuebtn', 'A.overview', 'A.play', 'xfader'],
        check: (x) => x.A.playing && x.A.hotcues[0] != null && x.A.position() < x.A.hotcues[0] - 2 && x.B.hotcues[0] != null && !x.B.playing,
        live: (x) => { if (!x.A.hotcues[0]) return ''; const left = x.A.beatAt(x.A.hotcues[0]) - x.A.beatAt(x.A.position()); return left > 0 ? `encore ${Math.ceil(left / 4)} mesures avant le drop de A` : 'tu es déjà après le drop : recule A'; } },
      { html: '<b>LA COUPE</b> 🔥 : compte les mesures. Pile au moment où le drop de Noiseflow tombe (ton pad A de A), appuie sur le <b>pad A de B</b> ET passe le <b>crossfader à fond à droite</b> d\'un coup. Raté ? Crossfader à gauche, remets B sur son drop (pad A puis pause), recule A et retente : c\'est en répétant que ça rentre.', hl: ['B.hc1', 'xfader'],
        check: (x) => { const p = x.evData('B.hotcue') || x.evData('B.play'); if (!p || p.otherBeat == null || x.A.hotcues[0] == null) return false; const target = x.A.beatAt(x.A.hotcues[0]); return Math.abs(p.otherBeat - target) < 0.5 && x.B.playing && !aud(x, 'A') && x.e.audible('B') > 0.3; },
        live: (x) => {
          if (x.A.hotcues[0] == null) return 'pose d\'abord le pad A de A sur son drop';
          const target = x.A.beatAt(x.A.hotcues[0]);
          const p = x.evData('B.hotcue') || x.evData('B.play');
          if (!p || p.otherBeat == null) { const left = target - x.A.beatAt(x.A.position()); return x.A.playing && left > 0 ? `drop de A dans ${Math.floor(left / 4)} mesures + ${Math.ceil(left % 4)} temps` : posTxt('A', x); }
          const d = (p.otherBeat - target) * 60000 / x.A.effBpm;
          return Math.abs(p.otherBeat - target) < 0.5 ? (aud(x, 'A') ? 'Pile dessus ! Maintenant coupe A : crossfader à droite.' : '') : `Décalé de ${d > 0 ? '+' : ''}${d.toFixed(0)} ms (${d > 0 ? 'trop tard' : 'trop tôt'}) : réessaie.`;
        } },
      { html: 'Tu es sur Dr. Peacock, ralenti à 195. <b>Remonte son tempo</b> jusqu\'à 0 % (200 BPM), <b>doucement</b> : sur 8 mesures au moins. Une montée de 5 BPM bien faite, personne ne la sent… et ça fait monter l\'énergie.', hl: ['B.tempo'],
        check: (x) => { if (x.B.tempoPct > -2.2 && !x.mem.t0) x.mem.t0 = x.now; return Math.abs(x.B.tempoPct) < 0.3 && x.mem.t0 && x.now - x.mem.t0 > 8000 && aud(x, 'B'); },
        live: (x) => `B : ${x.B.effBpm.toFixed(1)} BPM (${x.B.tempoPct.toFixed(1)} %)${x.mem.t0 ? ` · ${((x.now - x.mem.t0) / 1000).toFixed(0)} s` : ''}` },
    ],
    outro: `<p>🔥 <b>Ta première vraie transition uptempo</b>, sur des morceaux que tu kiffes. Pour progresser :</p>
      <ul><li><b>Refais-la</b> en lançant B sur d'autres drops (et coupe sur d'autres moments de A).</li>
      <li>Essaie un <b>echo out</b> sur A juste avant de couper (BEAT FX → ECHO, 1 temps, sur CH A).</li>
      <li>Charge tes propres morceaux depuis les onglets <b>SoundCloud</b> ou <b>YouTube</b> : repère toujours les drops et pose tes hot cues <b>avant</b> de mixer, c'est ce que font les pros dans rekordbox.</li></ul>
      <div class="hw">Les morceaux sont gardés dans <b>Musique\\IrisDJ\\Téléchargés</b> : ils apparaissent aussi dans « Mes fichiers ».</div>`,
  },
];
