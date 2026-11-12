// Pistes d'entraînement générées par le moteur Rust (src/synth.rs) : libres de droits, toujours dispo,
// et avec une structure connue -> les cours peuvent vérifier ce que tu fais.
// Structure (80 mesures de 4 temps, phrases de 8 mesures) :
//   mesures 1-16 intro (kick + charleston) · 17-32 couplet (+ clap, basse) · 33-48 break (pas de kick, nappe,
//   montée sur 41-48) · 49-64 drop (tout + lead) · 65-80 outro (kick + charleston)

export const SECTIONS = [
  { name: 'Intro', from: 1, to: 16 },
  { name: 'Couplet', from: 17, to: 32 },
  { name: 'Break', from: 33, to: 48 },
  { name: 'Drop', from: 49, to: 64 },
  { name: 'Outro', from: 65, to: 80 },
];

export const PRACTICE = [
  { id: 'p-rawstorm', title: 'Rawstorm', style: 'hardcore', genre: 'Hardcore', bpm: 175, key: 'A minor', root: 57 },
  { id: 'p-nightfall', title: 'Nightfall', style: 'hardcore', genre: 'Hardcore', bpm: 180, key: 'D minor', root: 62 },
  { id: 'p-overdrive', title: 'Overdrive', style: 'uptempo', genre: 'Uptempo', bpm: 200, key: 'F minor', root: 53 },
  { id: 'p-terminal', title: 'Terminal', style: 'uptempo', genre: 'Uptempo', bpm: 210, key: 'C minor', root: 60 },
  { id: 'p-reverse', title: 'Reverse Gate', style: 'hardstyle', genre: 'Hardstyle', bpm: 150, key: 'E minor', root: 52 },
  { id: 'p-sunday', title: 'Sunday Groove', style: 'house', genre: 'House', bpm: 124, key: 'C minor', root: 60 },
  { id: 'p-liquid', title: 'Liquid Edge', style: 'dnb', genre: 'Drum & Bass', bpm: 174, key: 'D minor', root: 62 },
  { id: 'p-boombap', title: 'Boom Bap', style: 'hiphop', genre: 'Hip-hop', bpm: 90, key: 'G minor', root: 55 },
].map((t) => ({ ...t, artist: 'IrisDJ Training', source: 'practice', firstBeat: 0 }));
