// Tonalités et roue de Camelot (mix harmonique).
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const MINOR = { 8: 1, 3: 2, 10: 3, 5: 4, 0: 5, 7: 6, 2: 7, 9: 8, 4: 9, 11: 10, 6: 11, 1: 12 };
const MAJOR = { 11: 1, 6: 2, 1: 3, 8: 4, 3: 5, 10: 6, 5: 7, 0: 8, 7: 9, 2: 10, 9: 11, 4: 12 };
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// "A minor", "G flat minor", "F#m", "Bbmaj", "Am", "C" -> { pc, minor }
export function parseKey(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.trim().match(/^([A-Ga-g])\s*(#|♯|b|♭|sharp|flat)?\s*(.*)$/i);
  if (!m) return null;
  let pc = PC[m[1].toUpperCase()];
  const acc = (m[2] || '').toLowerCase();
  if (acc === '#' || acc === '♯' || acc === 'sharp') pc += 1;
  if (acc === 'b' || acc === '♭' || acc === 'flat') pc -= 1;
  const rest = (m[3] || '').toLowerCase();
  const minor = /^(m(?!aj)|min)/.test(rest) || rest.includes('minor') || rest.includes('moll');
  return { pc: (pc + 12) % 12, minor };
}
export function camelot(key) {
  const k = typeof key === 'string' ? parseKey(key) : key;
  if (!k) return null;
  return (k.minor ? MINOR[k.pc] : MAJOR[k.pc]) + (k.minor ? 'A' : 'B');
}
export function keyName(key) { const k = typeof key === 'string' ? parseKey(key) : key; return k ? NAMES[k.pc] + (k.minor ? 'm' : '') : ''; }
export function compatible(c1, c2) {
  if (!c1 || !c2) return null;
  const n1 = parseInt(c1), n2 = parseInt(c2), l1 = c1.slice(-1), l2 = c2.slice(-1);
  if (n1 === n2) return true;                       // même chiffre (A <-> B = relatif mineur/majeur)
  if (l1 !== l2) return false;
  const d = (n1 - n2 + 12) % 12;
  return d === 1 || d === 11;                       // ±1 sur la roue
}
// transposition due au tempo sans Master Tempo : +x % de vitesse = 12*log2(1+x) demi-tons
export function shiftedCamelot(c, semitones) {
  if (!c || Math.abs(semitones) < 0.5) return c;
  const n = parseInt(c), l = c.slice(-1);
  const st = Math.round(semitones);
  // +1 demi-ton = +7 sur la roue de Camelot
  return (((n - 1 + st * 7) % 12) + 12) % 12 + 1 + l;
}
