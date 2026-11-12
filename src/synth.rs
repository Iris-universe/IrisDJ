// Pistes d'entraînement générées (rendu hors-ligne) : libres de droits, toujours dispo, et avec une
// structure connue -> les cours peuvent vérifier ce que tu fais.
// 80 mesures de 4 temps : 1-16 intro (kick + charleston) · 17-32 couplet (+ clap, basse) ·
// 33-48 break (pas de kick, nappe, montée sur 41-48) · 49-64 drop (tout + lead) · 65-80 outro.

use crate::audio::dsp::{Biquad, Kind, Rng};
use crate::decode::Pcm;
use std::f64::consts::PI;

pub struct Practice {
    pub id: &'static str,
    pub style: &'static str,
    pub bpm: f64,
    pub root: i32,
}

pub const PRACTICE: [Practice; 8] = [
    Practice { id: "p-rawstorm", style: "hardcore", bpm: 175.0, root: 57 },
    Practice { id: "p-nightfall", style: "hardcore", bpm: 180.0, root: 62 },
    Practice { id: "p-overdrive", style: "uptempo", bpm: 200.0, root: 53 },
    Practice { id: "p-terminal", style: "uptempo", bpm: 210.0, root: 60 },
    Practice { id: "p-reverse", style: "hardstyle", bpm: 150.0, root: 52 },
    Practice { id: "p-sunday", style: "house", bpm: 124.0, root: 60 },
    Practice { id: "p-liquid", style: "dnb", bpm: 174.0, root: 62 },
    Practice { id: "p-boombap", style: "hiphop", bpm: 90.0, root: 55 },
];

const BARS: usize = 80;
fn mtof(m: f64) -> f64 {
    440.0 * 2f64.powf((m - 69.0) / 12.0)
}
// progression mineure i – VI – III – VII (2 mesures par accord -> 8 mesures = 1 phrase)
const PROG: [[i32; 3]; 4] = [[0, 3, 7], [-4, 0, 3], [3, 7, 10], [-2, 2, 5]];

struct Kick {
    f0: f64,
    f1: f64,
    f2: f64,
    hold: f64,
    decay: f64,
    drive: f64,
    gain: f64,
    lp: f64,
}
fn kick_params(style: &str) -> Kick {
    let k = |f0, f1, f2, hold, decay, drive, gain, lp| Kick { f0, f1, f2, hold, decay, drive, gain, lp };
    match style {
        "hardcore" => k(320.0, 62.0, 46.0, 0.16, 0.32, 14.0, 0.32, 7000.0),
        "uptempo" => k(380.0, 72.0, 54.0, 0.12, 0.25, 26.0, 0.3, 8000.0),
        "hardstyle" => k(300.0, 70.0, 52.0, 0.1, 0.2, 10.0, 0.34, 6000.0),
        "house" => k(160.0, 60.0, 48.0, 0.05, 0.32, 1.6, 0.85, 12000.0),
        "dnb" => k(170.0, 62.0, 50.0, 0.04, 0.22, 2.2, 0.8, 12000.0),
        _ => k(130.0, 55.0, 45.0, 0.06, 0.45, 1.8, 0.85, 9000.0),
    }
}

// ---------------------------------------------------------------- automation façon AudioParam
#[derive(Clone, Copy)]
enum Ev {
    Set(f64, f64),
    Lin(f64, f64),
    Exp(f64, f64),
}
impl Ev {
    fn t(&self) -> f64 {
        match *self {
            Ev::Set(t, _) | Ev::Lin(t, _) | Ev::Exp(t, _) => t,
        }
    }
    fn v(&self) -> f64 {
        match *self {
            Ev::Set(_, v) | Ev::Lin(_, v) | Ev::Exp(_, v) => v,
        }
    }
}
struct Param {
    evs: Vec<Ev>,
    def: f64,
    i: usize,
}
impl Param {
    fn new(def: f64) -> Self {
        Param { evs: vec![], def, i: 0 }
    }
    fn set(mut self, t: f64, v: f64) -> Self {
        self.evs.push(Ev::Set(t, v));
        self
    }
    fn lin(mut self, t: f64, v: f64) -> Self {
        self.evs.push(Ev::Lin(t, v));
        self
    }
    fn exp(mut self, t: f64, v: f64) -> Self {
        self.evs.push(Ev::Exp(t, v));
        self
    }
    fn prep(mut self) -> Self {
        self.evs.sort_by(|a, b| a.t().partial_cmp(&b.t()).unwrap());
        self
    }
    /// valeur à l'instant t (t croissant d'un appel à l'autre)
    fn at(&mut self, t: f64) -> f64 {
        let e = &self.evs;
        if e.is_empty() {
            return self.def;
        }
        while self.i < e.len() && e[self.i].t() <= t {
            self.i += 1;
        }
        // i = premier évènement dans le futur
        let (pt, pv) = if self.i == 0 { (0.0, self.def) } else { (e[self.i - 1].t(), e[self.i - 1].v()) };
        if self.i < e.len() {
            match e[self.i] {
                Ev::Lin(t1, v1) => return pv + (v1 - pv) * ((t - pt) / (t1 - pt).max(1e-12)),
                Ev::Exp(t1, v1) => {
                    if pv > 0.0 && v1 > 0.0 {
                        return pv * (v1 / pv).powf((t - pt) / (t1 - pt).max(1e-12));
                    }
                    return pv;
                }
                Ev::Set(..) => {}
            }
        }
        pv
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Wav {
    Sine,
    Saw,
}
struct Osc {
    wav: Wav,
    phase: f64,
}
impl Osc {
    #[inline]
    fn tick(&mut self, f: f64, sr: f64) -> f64 {
        let dt = (f / sr).min(0.49);
        let p = self.phase;
        self.phase += dt;
        if self.phase >= 1.0 {
            self.phase -= 1.0;
        }
        match self.wav {
            Wav::Sine => (2.0 * PI * p).sin(),
            Wav::Saw => {
                // dent de scie à bande limitée (polyBLEP)
                let mut v = 2.0 * p - 1.0;
                if p < dt {
                    let t = p / dt;
                    v -= t + t - t * t - 1.0;
                } else if p > 1.0 - dt {
                    let t = (p - 1.0) / dt;
                    v -= t * t + t + t + 1.0;
                }
                v
            }
        }
    }
}

struct R {
    sr: f64,
    len: usize,
    kick_bus: Vec<f32>,
    master: Vec<f32>,
    synth: Vec<f32>,
    verb_in: Vec<f32>,
    rng: Rng,
}
impl R {
    fn span(&self, t0: f64, t1: f64) -> (usize, usize) {
        let a = ((t0 * self.sr).ceil().max(0.0) as usize).min(self.len);
        let b = ((t1 * self.sr).ceil().max(0.0) as usize).min(self.len);
        (a, b)
    }

    fn kick(&mut self, t: f64, k: &Kick) {
        let mut f = Param::new(440.0).set(t, k.f0).exp(t + 0.03, k.f1).exp(t + k.hold + k.decay, k.f2).prep();
        let mut g = Param::new(1.0).set(t, 0.0).lin(t + 0.002, 1.0).set(t + k.hold, 1.0).exp(t + k.hold + k.decay, 0.001).prep();
        let mut o = Osc { wav: Wav::Sine, phase: 0.0 };
        let (a, b) = self.span(t, t + k.hold + k.decay + 0.02);
        for i in a..b {
            let ts = i as f64 / self.sr;
            self.kick_bus[i] += (o.tick(f.at(ts), self.sr) * g.at(ts)) as f32;
        }
    }
    fn reverse_bass(&mut self, t: f64, midi: f64, spb: f64) {
        let len = spb * 0.48;
        let mut g = Param::new(1.0).set(t, 0.0001).exp(t + len * 0.9, 0.9).lin(t + len, 0.0).prep();
        let mut o = Osc { wav: Wav::Sine, phase: 0.0 };
        let f = mtof(midi);
        let (a, b) = self.span(t, t + len + 0.01);
        for i in a..b {
            let ts = i as f64 / self.sr;
            self.kick_bus[i] += (o.tick(f, self.sr) * g.at(ts)) as f32;
        }
    }
    /// bruit -> filtre -> enveloppe, ajouté au master (et à la réverb si `send`)
    fn noise(&mut self, t: f64, dur: f64, kind: Kind, freq: Param, q: f64, mut g: Param, send: bool) {
        let mut flt = Biquad::new(kind);
        let mut freq = freq;
        let (a, b) = self.span(t, t + dur);
        for i in a..b {
            let ts = i as f64 / self.sr;
            if (i - a) % 16 == 0 {
                flt.set(self.sr, freq.at(ts), q, 0.0);
            }
            let x = self.rng.next_f32() as f64;
            let y = (flt.tick(0, x) * g.at(ts)) as f32;
            self.master[i] += y;
            if send {
                self.verb_in[i] += y;
            }
        }
    }
    fn hat(&mut self, t: f64, open: bool, vol: f64) {
        let g = Param::new(1.0).set(t, vol).exp(t + if open { 0.2 } else { 0.045 }, 0.001).prep();
        self.noise(t, if open { 0.25 } else { 0.06 }, Kind::HighPass, Param::new(7500.0), 1.0, g, false);
    }
    fn clap(&mut self, t: f64, vol: f64) {
        let mut g = Param::new(1.0).set(t, 0.0);
        for d in [0.0, 0.011, 0.022] {
            g = g.set(t + d, vol).exp(t + d + 0.009, vol * 0.2);
        }
        let g = g.set(t + 0.033, vol * 0.8).exp(t + 0.2, 0.001).prep();
        self.noise(t, 0.3, Kind::BandPass, Param::new(1300.0), 0.9, g, true);
    }
    fn snare(&mut self, t: f64, vol: f64) {
        self.clap(t, vol * 0.8);
        let mut f = Param::new(440.0).set(t, 220.0).exp(t + 0.08, 160.0).prep();
        let mut g = Param::new(1.0).set(t, vol * 0.7).exp(t + 0.12, 0.001).prep();
        let mut o = Osc { wav: Wav::Sine, phase: 0.0 };
        let (a, b) = self.span(t, t + 0.13);
        for i in a..b {
            let ts = i as f64 / self.sr;
            self.master[i] += (o.tick(f.at(ts), self.sr) * g.at(ts)) as f32;
        }
    }
    fn bass(&mut self, t: f64, midi: f64, len: f64, vol: f64, wav: Wav, cutoff: f64) {
        let mut flt = Biquad::new(Kind::LowPass);
        flt.set(self.sr, cutoff, 2.0, 0.0);
        let mut g = Param::new(1.0).set(t, 0.0).lin(t + 0.008, vol).set(t + len * 0.7, vol).lin(t + len, 0.0).prep();
        let mut o = Osc { wav, phase: 0.0 };
        let f = mtof(midi);
        let (a, b) = self.span(t, t + len + 0.01);
        for i in a..b {
            let ts = i as f64 / self.sr;
            self.master[i] += (flt.tick(0, o.tick(f, self.sr)) * g.at(ts)) as f32;
        }
    }
    fn lead(&mut self, t: f64, midis: &[f64], len: f64, vol: f64, cutoff: f64, attack: f64) {
        let mut flt = Biquad::new(Kind::LowPass);
        flt.set(self.sr, cutoff, 1.5, 0.0);
        let mut g = Param::new(1.0).set(t, 0.0).lin(t + attack, vol).set(t + attack.max(len * 0.75), vol).lin(t + len, 0.0).prep();
        let mut oscs: Vec<(Osc, f64)> = vec![];
        for &m in midis {
            for det in [-12.0, 0.0, 11.0] {
                oscs.push((Osc { wav: Wav::Saw, phase: 0.0 }, mtof(m) * 2f64.powf(det / 1200.0)));
            }
        }
        let (a, b) = self.span(t, t + len + 0.02);
        for i in a..b {
            let ts = i as f64 / self.sr;
            let mut s = 0.0;
            for (o, f) in oscs.iter_mut() {
                s += o.tick(*f, self.sr);
            }
            self.synth[i] += (flt.tick(0, s) * g.at(ts)) as f32;
        }
    }
    fn riser(&mut self, t: f64, len: f64) {
        let f = Param::new(350.0).set(t, 300.0).exp(t + len, 9000.0).prep();
        let g = Param::new(1.0).set(t, 0.001).exp(t + len, 0.25).prep();
        self.noise(t, len, Kind::BandPass, f, 2.0, g, false);
    }
    fn crash(&mut self, t: f64) {
        let g = Param::new(1.0).set(t, 0.18).exp(t + 1.8, 0.001).prep();
        self.noise(t, 2.0, Kind::HighPass, Param::new(3500.0), 1.0, g, true);
    }
}

/// convolution (FFT, recouvrement-addition) d'un signal mono par une réponse impulsionnelle
fn convolve(x: &[f32], ir: &[f32]) -> Vec<f32> {
    use rustfft::{num_complex::Complex, FftPlanner};
    let block = 1 << 16;
    let n = (block + ir.len()).next_power_of_two();
    let mut planner = FftPlanner::<f32>::new();
    let fwd = planner.plan_fft_forward(n);
    let inv = planner.plan_fft_inverse(n);
    let mut h: Vec<Complex<f32>> = ir.iter().map(|&v| Complex::new(v, 0.0)).collect();
    h.resize(n, Complex::new(0.0, 0.0));
    fwd.process(&mut h);
    let mut out = vec![0f32; x.len() + ir.len()];
    let mut buf = vec![Complex::new(0f32, 0f32); n];
    let scale = 1.0 / n as f32;
    let mut s = 0;
    while s < x.len() {
        let e = (s + block).min(x.len());
        for v in buf.iter_mut() {
            *v = Complex::new(0.0, 0.0);
        }
        for i in s..e {
            buf[i - s] = Complex::new(x[i], 0.0);
        }
        fwd.process(&mut buf);
        for i in 0..n {
            buf[i] *= h[i];
        }
        inv.process(&mut buf);
        for i in 0..(e - s + ir.len()).min(out.len() - s) {
            out[s + i] += buf[i].re * scale;
        }
        s = e;
    }
    out.truncate(x.len());
    out
}

/// compresseur du bus master (≈ DynamicsCompressor : seuil -10 dB, genou 30 dB, ratio 4, 3 ms / 120 ms)
fn compress(l: &mut [f32], r: &mut [f32], sr: f64) {
    let (thr, knee, ratio) = (-10.0f64, 30.0f64, 4.0f64);
    let curve = |x: f64| -> f64 {
        // genou placé au-dessus du seuil, comme Chrome
        if x <= thr {
            x
        } else if x <= thr + knee {
            let u = (x - thr) / knee;
            x - (1.0 - 1.0 / ratio) * knee * u * u / 2.0
        } else {
            thr + knee * (1.0 + 1.0 / ratio) / 2.0 + (x - thr - knee) / ratio
        }
    };
    let makeup = -(curve(0.0)) * 0.6;
    let att = 1.0 - (-1.0 / (0.003 * sr)).exp();
    let rel = 1.0 - (-1.0 / (0.12 * sr)).exp();
    let mut env = -120.0f64;
    for i in 0..l.len() {
        let pk = (l[i].abs().max(r[i].abs()) as f64).max(1e-6);
        let x = 20.0 * pk.log10();
        env += (x - env) * if x > env { att } else { rel };
        let g_db = curve(env) - env + makeup;
        let g = 10f64.powf(g_db / 20.0) as f32;
        l[i] *= g;
        r[i] *= g;
    }
}

fn shaper(x: f64, drive: f64) -> f64 {
    (drive * x.clamp(-1.0, 1.0)).tanh() / drive.tanh()
}

pub fn render(p: &Practice, sr: f64) -> Pcm {
    let spb = 60.0 / p.bpm;
    let dur = BARS as f64 * 4.0 * spb + 2.5;
    let len = (dur * sr).ceil() as usize;
    let k = kick_params(p.style);
    let mut r = R { sr, len, kick_bus: vec![0.0; len], master: vec![0.0; len], synth: vec![0.0; len], verb_in: vec![0.0; len], rng: Rng::new(0x9E3779B97F4A7C15 ^ p.bpm as u64) };
    let at = |bar: usize, beat: f64| (bar as f64 * 4.0 + beat) * spb;
    let style = p.style;
    let root = p.root as f64;
    let hard = matches!(style, "hardcore" | "uptempo" | "hardstyle");

    for bar in 0..BARS {
        let sec = match bar {
            0..=15 => "intro",
            16..=31 => "verse",
            32..=47 => "break",
            48..=63 => "drop",
            _ => "outro",
        };
        let ch = PROG[(bar % 8) / 2];
        let drums = sec != "break";
        let full = sec == "verse" || sec == "drop";
        if bar == 48 || bar == 64 || bar == 16 {
            r.crash(at(bar, 0.0));
        }
        // --- batterie ---
        if drums {
            if style == "dnb" {
                r.kick(at(bar, 0.0), &k);
                r.kick(at(bar, 2.5), &k);
                if sec != "intro" || bar >= 8 {
                    r.snare(at(bar, 1.0), 0.4);
                    r.snare(at(bar, 3.0), 0.4);
                }
                for i in 0..8 {
                    r.hat(at(bar, i as f64 * 0.5), false, if i % 2 == 1 { 0.08 } else { 0.12 });
                }
            } else if style == "hiphop" {
                for b in [0.0, 1.75, 2.5] {
                    r.kick(at(bar, b), &k);
                }
                r.snare(at(bar, 1.0), 0.4);
                r.snare(at(bar, 3.0), 0.4);
                for i in 0..8 {
                    r.hat(at(bar, i as f64 * 0.5 + if i % 2 == 1 { 0.08 } else { 0.0 }), false, if i % 2 == 1 { 0.06 } else { 0.1 });
                }
            } else {
                for b in 0..4 {
                    r.kick(at(bar, b as f64), &k);
                }
                for b in 0..4 {
                    r.hat(at(bar, b as f64 + 0.5), style == "house", if style == "house" { 0.1 } else { 0.13 });
                }
                if full || (sec == "intro" && bar >= 8) {
                    r.clap(at(bar, 1.0), 0.35);
                    r.clap(at(bar, 3.0), 0.35);
                }
                if style == "hardstyle" && sec != "intro" {
                    for b in 0..4 {
                        r.reverse_bass(at(bar, b as f64 + 0.5), root - 24.0 + ch[0] as f64, spb);
                    }
                }
                if style == "uptempo" && full {
                    for b in 0..4 {
                        r.hat(at(bar, b as f64 + 0.25), false, 0.06);
                        r.hat(at(bar, b as f64 + 0.75), false, 0.06);
                    }
                }
            }
        }
        // --- basse ---
        let bn = root - 24.0 + ch[0] as f64;
        if full {
            match style {
                "house" => {
                    for b in 0..4 {
                        r.bass(at(bar, b as f64 + 0.5), bn, spb * 0.4, 0.35, Wav::Saw, 380.0);
                    }
                }
                "dnb" => r.bass(at(bar, 0.0), bn, spb * 4.0, 0.45, Wav::Sine, 200.0),
                "hiphop" => {
                    r.bass(at(bar, 0.0), bn, spb * 1.5, 0.4, Wav::Sine, 300.0);
                    r.bass(at(bar, 2.5), bn, spb, 0.35, Wav::Sine, 300.0);
                }
                _ => {}
            }
        }
        // --- harmonies / lead ---
        let notes: Vec<f64> = ch.iter().map(|x| root + *x as f64).collect();
        if sec == "break" {
            if bar % 2 == 0 {
                let low: Vec<f64> = notes.iter().map(|m| m - 12.0).collect();
                r.lead(at(bar, 0.0), &low, spb * 8.0, 0.035, 1400.0, spb * 2.0);
            }
            if bar >= 40 {
                for s in 0..4 {
                    r.lead(at(bar, s as f64), &[notes[s % 3] + 12.0], spb * 0.9, 0.04, 2400.0, 0.005);
                }
                if bar == 40 {
                    r.riser(at(40, 0.0), spb * 32.0);
                }
                if bar >= 46 {
                    let (cnt, step) = if bar == 47 { (16, 0.25) } else { (8, 0.5) };
                    for s in 0..cnt {
                        r.snare(at(bar, s as f64 * step), 0.12 + 0.02 * s as f64);
                    }
                }
            }
        }
        if sec == "drop" {
            if hard {
                let step = if style == "uptempo" { 0.5 } else { 0.75 };
                let mut b = 0.0;
                while b < 4.0 {
                    let ch3 = [notes[0] + 12.0, notes[1] + 12.0, notes[2] + 12.0];
                    r.lead(at(bar, b), &ch3, spb * step * 0.85, 0.045, if style == "uptempo" { 4200.0 } else { 3400.0 }, 0.005);
                    b += step;
                }
            } else if style == "house" {
                for b in [0.5, 1.75, 2.5, 3.5] {
                    r.lead(at(bar, b), &notes, spb * 0.3, 0.05, 2200.0, 0.005);
                }
            } else if style == "dnb" {
                if bar % 2 == 0 {
                    r.lead(at(bar, 0.0), &notes, spb * 8.0, 0.035, 1800.0, 0.1);
                }
            } else if bar % 2 == 0 {
                r.lead(at(bar, 0.0), &notes, spb * 8.0, 0.03, 1500.0, 0.05);
            }
        }
        if sec == "verse" && hard && bar % 4 == 3 {
            r.lead(at(bar, 2.0), &[notes[0] + 12.0], spb * 2.0, 0.04, 2600.0, 0.005);
        }
    }

    // ---------- bus ----------
    // kick : saturation (suréchantillonnée x2) -> passe-bas -> passe-haut 30 Hz -> gain
    let mut klp = Biquad::new(Kind::LowPass);
    klp.set(sr, k.lp, 1.0, 0.0);
    let mut khp = Biquad::new(Kind::HighPass);
    khp.set(sr, 30.0, 1.0, 0.0);
    let mut prev = 0.0f64;
    for i in 0..len {
        let x = r.kick_bus[i] as f64;
        let y = 0.5 * (shaper((x + prev) * 0.5, k.drive) + shaper(x, k.drive));
        prev = x;
        let y = khp.tick(0, klp.tick(0, y)) * k.gain;
        r.master[i] += y as f32;
    }
    for i in 0..len {
        r.master[i] += r.synth[i];
        r.verb_in[i] += r.synth[i];
    }
    // réverb : convolution par 2,2 s de bruit qui décroît (normalisée comme un ConvolverNode)
    let ir_len = (sr * 2.2) as usize;
    let mut irs = vec![vec![0f32; ir_len], vec![0f32; ir_len]];
    let mut rng = Rng::new(12345);
    let mut pow = 0f64;
    for c in 0..2 {
        for i in 0..ir_len {
            let v = rng.next_f32() * (1.0 - i as f32 / ir_len as f32).powi(3);
            irs[c][i] = v;
            pow += (v * v) as f64;
        }
    }
    let rms = (pow / (2 * ir_len) as f64).sqrt().max(0.000125);
    let scale = (1.0 / rms) * 10f64.powf(-58.0 * 0.05) * 44100.0 / sr;
    for c in 0..2 {
        for v in irs[c].iter_mut() {
            *v *= scale as f32;
        }
    }
    let wl = convolve(&r.verb_in, &irs[0]);
    let wr = convolve(&r.verb_in, &irs[1]);
    let mut l = vec![0f32; len];
    let mut rr = vec![0f32; len];
    for i in 0..len {
        l[i] = (r.master[i] + wl[i] * 0.35) * 0.9;
        rr[i] = (r.master[i] + wr[i] * 0.35) * 0.9;
    }
    compress(&mut l, &mut rr, sr);
    Pcm { l, r: rr, sr }
}

pub fn find(id: &str) -> Option<&'static Practice> {
    PRACTICE.iter().find(|p| p.id == id)
}

/// piste rendue (cache WAV dans %APPDATA%\IrisDJ\cache)
pub fn get(id: &str, sr: f64) -> Result<Pcm, String> {
    let p = find(id).ok_or("piste d'entraînement inconnue")?;
    let f = crate::store::cache_dir().join(format!("practice-{}-{}.wav", id, sr as u32));
    if let Ok(mut rd) = hound::WavReader::open(&f) {
        let spec = rd.spec();
        if spec.channels == 2 && spec.sample_rate == sr as u32 {
            let s: Vec<i16> = rd.samples::<i16>().filter_map(|x| x.ok()).collect();
            let (mut l, mut r) = (Vec::with_capacity(s.len() / 2), Vec::with_capacity(s.len() / 2));
            for c in s.chunks_exact(2) {
                l.push(c[0] as f32 / 32768.0);
                r.push(c[1] as f32 / 32768.0);
            }
            if !l.is_empty() {
                return Ok(Pcm { l, r, sr });
            }
        }
    }
    let pcm = render(p, sr);
    let _ = std::fs::create_dir_all(crate::store::cache_dir());
    let spec = hound::WavSpec { channels: 2, sample_rate: sr as u32, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
    if let Ok(mut w) = hound::WavWriter::create(&f, spec) {
        for i in 0..pcm.l.len() {
            let q = |v: f32| (v.clamp(-1.0, 1.0) * if v < 0.0 { 32768.0 } else { 32767.0 }) as i16;
            let _ = w.write_sample(q(pcm.l[i]));
            let _ = w.write_sample(q(pcm.r[i]));
        }
        let _ = w.finalize();
    }
    Ok(pcm)
}
