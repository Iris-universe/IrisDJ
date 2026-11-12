// Briques DSP : lissage de paramètres, filtres biquad (formules de Web Audio), limiteur,
// effets (echo, reverb, flanger).

use std::f64::consts::PI;

pub fn db_to_gain(db: f64) -> f64 {
    10f64.powf(db / 20.0)
}
pub fn gain_to_db(g: f64) -> f64 {
    if g <= 1e-6 {
        -120.0
    } else {
        20.0 * g.log10()
    }
}

/// Lissage exponentiel d'un paramètre (équivalent de `setTargetAtTime`).
#[derive(Clone, Copy)]
pub struct Smooth {
    pub v: f64,
    pub target: f64,
    k: f64,
}
impl Smooth {
    pub fn new(v: f64, tau: f64, sr: f64) -> Self {
        Smooth { v, target: v, k: 1.0 - (-1.0 / (tau.max(1e-5) * sr)).exp() }
    }
    #[inline]
    pub fn set(&mut self, t: f64) {
        self.target = t;
    }
    /// avance de `n` échantillons
    #[inline]
    pub fn step_n(&mut self, n: usize) -> f64 {
        if (self.v - self.target).abs() < 1e-9 {
            self.v = self.target;
        } else {
            let a = (1.0 - self.k).powi(n as i32);
            self.v = self.target + (self.v - self.target) * a;
        }
        self.v
    }
    #[inline]
    pub fn step(&mut self) -> f64 {
        self.v += (self.target - self.v) * self.k;
        self.v
    }
    pub fn settled(&self) -> bool {
        (self.v - self.target).abs() < 1e-7
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    LowPass,
    HighPass,
    BandPass,
    Peaking,
    LowShelf,
    HighShelf,
}

/// Biquad stéréo (forme transposée II, état en f64).
#[derive(Clone)]
pub struct Biquad {
    kind: Kind,
    b0: f64,
    b1: f64,
    b2: f64,
    a1: f64,
    a2: f64,
    z: [[f64; 2]; 2],
    last: (f64, f64, f64),
}
impl Biquad {
    pub fn new(kind: Kind) -> Self {
        Biquad { kind, b0: 1.0, b1: 0.0, b2: 0.0, a1: 0.0, a2: 0.0, z: [[0.0; 2]; 2], last: (-1.0, -1.0, -1.0) }
    }
    /// fréquence (Hz), Q (comme Web Audio : en dB pour passe-bas/passe-haut), gain (dB)
    pub fn set(&mut self, sr: f64, f: f64, q: f64, gain_db: f64) {
        if self.last == (f, q, gain_db) {
            return;
        }
        self.last = (f, q, gain_db);
        let f = f.clamp(1.0, sr * 0.499);
        let w0 = 2.0 * PI * f / sr;
        let (s, c) = w0.sin_cos();
        let a = 10f64.powf(gain_db / 40.0);
        let (b0, b1, b2, a0, a1, a2);
        match self.kind {
            Kind::LowPass | Kind::HighPass => {
                let alpha = s / (2.0 * 10f64.powf(q / 20.0));
                if self.kind == Kind::LowPass {
                    b0 = (1.0 - c) / 2.0;
                    b1 = 1.0 - c;
                    b2 = (1.0 - c) / 2.0;
                } else {
                    b0 = (1.0 + c) / 2.0;
                    b1 = -(1.0 + c);
                    b2 = (1.0 + c) / 2.0;
                }
                a0 = 1.0 + alpha;
                a1 = -2.0 * c;
                a2 = 1.0 - alpha;
            }
            Kind::BandPass => {
                let alpha = s / (2.0 * q.max(1e-4));
                b0 = alpha;
                b1 = 0.0;
                b2 = -alpha;
                a0 = 1.0 + alpha;
                a1 = -2.0 * c;
                a2 = 1.0 - alpha;
            }
            Kind::Peaking => {
                let alpha = s / (2.0 * q.max(1e-4));
                b0 = 1.0 + alpha * a;
                b1 = -2.0 * c;
                b2 = 1.0 - alpha * a;
                a0 = 1.0 + alpha / a;
                a1 = -2.0 * c;
                a2 = 1.0 - alpha / a;
            }
            Kind::LowShelf | Kind::HighShelf => {
                let alpha = s / 2.0 * 2f64.sqrt();
                let sa = 2.0 * a.sqrt() * alpha;
                if self.kind == Kind::LowShelf {
                    b0 = a * ((a + 1.0) - (a - 1.0) * c + sa);
                    b1 = 2.0 * a * ((a - 1.0) - (a + 1.0) * c);
                    b2 = a * ((a + 1.0) - (a - 1.0) * c - sa);
                    a0 = (a + 1.0) + (a - 1.0) * c + sa;
                    a1 = -2.0 * ((a - 1.0) + (a + 1.0) * c);
                    a2 = (a + 1.0) + (a - 1.0) * c - sa;
                } else {
                    b0 = a * ((a + 1.0) + (a - 1.0) * c + sa);
                    b1 = -2.0 * a * ((a - 1.0) + (a + 1.0) * c);
                    b2 = a * ((a + 1.0) + (a - 1.0) * c - sa);
                    a0 = (a + 1.0) - (a - 1.0) * c + sa;
                    a1 = 2.0 * ((a - 1.0) - (a + 1.0) * c);
                    a2 = (a + 1.0) - (a - 1.0) * c - sa;
                }
            }
        }
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
    }
    #[inline]
    pub fn tick(&mut self, ch: usize, x: f64) -> f64 {
        let z = &mut self.z[ch];
        let y = self.b0 * x + z[0];
        z[0] = self.b1 * x - self.a1 * y + z[1];
        z[1] = self.b2 * x - self.a2 * y;
        y
    }
    pub fn reset(&mut self) {
        self.z = [[0.0; 2]; 2];
    }
}

/// Limiteur crête avec anticipation (≈ DynamicsCompressor seuil -0,8 dB, ratio 20, attaque 1 ms, relâche 80 ms).
pub struct Limiter {
    look: usize,
    buf: Vec<[f32; 2]>,
    peaks: Vec<f32>,
    w: usize,
    gain: f64,
    thr: f64,
    att: f64,
    rel: f64,
}
impl Limiter {
    pub fn new(sr: f64) -> Self {
        let look = ((sr * 0.0015) as usize).max(1);
        Limiter {
            look,
            buf: vec![[0.0; 2]; look],
            peaks: vec![0.0; look],
            w: 0,
            gain: 1.0,
            thr: db_to_gain(-0.8),
            att: 1.0 - (-1.0 / (0.0004 * sr)).exp(),
            rel: 1.0 - (-1.0 / (0.08 * sr)).exp(),
        }
    }
    #[inline]
    pub fn tick(&mut self, l: f32, r: f32) -> (f32, f32) {
        let pk = l.abs().max(r.abs());
        let i = self.w;
        let out = self.buf[i];
        self.buf[i] = [l, r];
        self.peaks[i] = pk;
        self.w = (i + 1) % self.look;
        // crête max sur la fenêtre d'anticipation
        let mut m = 0f32;
        for &p in &self.peaks {
            if p > m {
                m = p;
            }
        }
        let want = if (m as f64) > self.thr { self.thr / m as f64 } else { 1.0 };
        let k = if want < self.gain { self.att } else { self.rel };
        self.gain += (want - self.gain) * k;
        // la crête qui sort maintenant ne doit jamais dépasser le seuil
        let opk = out[0].abs().max(out[1].abs()) as f64;
        let mut g = self.gain;
        if opk * g > self.thr {
            g = self.thr / opk;
        }
        ((out[0] as f64 * g) as f32, (out[1] as f64 * g) as f32)
    }
}

/// Ligne à retard stéréo avec lecture fractionnaire.
pub struct DelayLine {
    buf: Vec<[f32; 2]>,
    w: usize,
}
impl DelayLine {
    pub fn new(len: usize) -> Self {
        DelayLine { buf: vec![[0.0; 2]; len.max(4)], w: 0 }
    }
    #[inline]
    pub fn read(&self, delay: f64) -> [f32; 2] {
        let n = self.buf.len();
        let d = delay.clamp(1.0, (n - 2) as f64);
        let p = self.w as f64 + n as f64 - d;
        let i = p.floor() as usize;
        let f = (p - p.floor()) as f32;
        let a = self.buf[i % n];
        let b = self.buf[(i + 1) % n];
        [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
    }
    #[inline]
    pub fn write(&mut self, v: [f32; 2]) {
        self.buf[self.w] = v;
        self.w = (self.w + 1) % self.buf.len();
    }
    pub fn clear(&mut self) {
        for v in self.buf.iter_mut() {
            *v = [0.0; 2];
        }
    }
}

/// Echo calé sur le tempo : retard + réinjection filtrée (passe-haut 120 Hz).
pub struct Echo {
    line: DelayLine,
    hp: Biquad,
    pub delay: Smooth, // en échantillons
    pub fb: Smooth,
}
impl Echo {
    pub fn new(sr: f64) -> Self {
        let mut hp = Biquad::new(Kind::HighPass);
        hp.set(sr, 120.0, 0.0, 0.0);
        Echo { line: DelayLine::new((sr * 8.1) as usize), hp, delay: Smooth::new(sr * 0.5, 0.02, sr), fb: Smooth::new(0.55, 0.02, sr) }
    }
    #[inline]
    pub fn tick(&mut self, x: [f32; 2]) -> [f32; 2] {
        let d = self.delay.step();
        let fb = self.fb.step() as f32;
        let y = self.line.read(d);
        let h = [self.hp.tick(0, y[0] as f64) as f32, self.hp.tick(1, y[1] as f64) as f32];
        self.line.write([x[0] + h[0] * fb, x[1] + h[1] * fb]);
        y
    }
}

/// Réverbération : réseau de retards rebouclés (FDN 8 lignes) + diffusion, ≈ 3 s de queue.
pub struct Reverb {
    lines: Vec<(Vec<f32>, usize)>,
    damp: [f32; 8],
    g: [f32; 8],
    ap: Vec<(Vec<f32>, usize)>,
    lp: f32,
}
impl Reverb {
    pub fn new(sr: f64) -> Self {
        let lens_ms = [29.7, 37.1, 41.1, 43.7, 53.3, 59.9, 67.7, 73.1];
        let t60 = 2.6;
        let mut lines = vec![];
        let mut g = [0f32; 8];
        for (i, ms) in lens_ms.iter().enumerate() {
            let n = (sr * ms / 1000.0) as usize;
            lines.push((vec![0f32; n], 0));
            g[i] = 10f64.powf(-3.0 * (n as f64 / sr) / t60) as f32;
        }
        let ap = [5.3, 7.7, 11.3, 13.1].iter().map(|ms| (vec![0f32; (sr * ms / 1000.0) as usize], 0usize)).collect();
        Reverb { lines, damp: [0.0; 8], g, ap, lp: 1.0 - (-2.0 * std::f32::consts::PI * 7000.0 / sr as f32).exp() }
    }
    #[inline]
    pub fn tick(&mut self, x: [f32; 2]) -> [f32; 2] {
        // diffusion d'entrée (passe-tout en série) sur le mono
        let mut s = (x[0] + x[1]) * 0.5;
        for (buf, w) in self.ap.iter_mut() {
            let d = buf[*w];
            let v = s + d * 0.6;
            buf[*w] = v;
            *w = (*w + 1) % buf.len();
            s = d - v * 0.6;
        }
        let mut o = [0f32; 8];
        for (i, (buf, w)) in self.lines.iter().enumerate() {
            o[i] = buf[*w];
        }
        // matrice de Hadamard 8x8 (normalisée)
        let mut h = o;
        let mut len = 1;
        while len < 8 {
            for i in (0..8).step_by(len * 2) {
                for j in i..i + len {
                    let (a, b) = (h[j], h[j + len]);
                    h[j] = a + b;
                    h[j + len] = a - b;
                }
            }
            len *= 2;
        }
        let norm = 1.0 / (8f32).sqrt();
        for i in 0..8 {
            let v = h[i] * norm * self.g[i];
            self.damp[i] += (v - self.damp[i]) * self.lp;
            let (buf, w) = &mut self.lines[i];
            buf[*w] = self.damp[i] + s * if i % 2 == 0 { 1.0 } else { -1.0 };
            *w = (*w + 1) % buf.len();
        }
        let l = (o[0] + o[2] + o[4] + o[6]) * 0.35;
        let r = (o[1] + o[3] + o[5] + o[7]) * 0.35;
        [l, r]
    }
}

/// Flanger : retard court modulé par un LFO, avec réinjection.
pub struct Flanger {
    line: DelayLine,
    phase: f64,
    pub rate: Smooth, // Hz
    sr: f64,
}
impl Flanger {
    pub fn new(sr: f64) -> Self {
        Flanger { line: DelayLine::new((sr * 0.05) as usize), phase: 0.0, rate: Smooth::new(0.25, 0.05, sr), sr }
    }
    #[inline]
    pub fn tick(&mut self, x: [f32; 2]) -> [f32; 2] {
        let r = self.rate.step();
        self.phase = (self.phase + r / self.sr) % 1.0;
        let d = (0.004 + 0.0035 * (2.0 * PI * self.phase).sin()) * self.sr;
        let y = self.line.read(d.max(1.0));
        self.line.write([x[0] + y[0] * 0.7, x[1] + y[1] * 0.7]);
        y
    }
}

/// Générateur pseudo-aléatoire rapide (bruit).
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }
    #[inline]
    pub fn next_f32(&mut self) -> f32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        ((self.0 >> 40) as f32 / (1u64 << 24) as f32) * 2.0 - 1.0
    }
}
