// Analyse d'un morceau : forme d'onde 3 bandes, BPM + position du premier temps, tonalité.
use crate::engine::Wave;
use std::f64::consts::PI;

pub const WAVE_PPS: f64 = 150.0;

pub struct Result {
    pub wave: Wave,
    pub bpm: f64,
    pub first_beat: f64,
    pub key: Option<String>,
}

fn one_pole(f: f64, sr: f64) -> f64 {
    1.0 - (-2.0 * PI * f / sr).exp()
}

pub fn analyse(l: &[f32], r: &[f32], sr: f64) -> Result {
    let mono: Vec<f32> = l.iter().zip(r).map(|(a, b)| (a + b) * 0.5).collect();
    let wave = waveform(&mono, sr);
    let (bpm, first_beat) = tempo(&mono, sr, 65.0, 235.0);
    let key = detect_key(&mono, sr);
    Result { wave, bpm, first_beat, key }
}

fn waveform(x: &[f32], sr: f64) -> Wave {
    let step = sr / WAVE_PPS;
    let n = (x.len() as f64 / step).ceil() as usize;
    let (mut low, mut mid, mut high) = (vec![0f32; n], vec![0f32; n], vec![0f32; n]);
    let (al, ah) = (one_pole(220.0, sr) as f32, one_pole(2800.0, sr) as f32);
    let (mut lp, mut lp2, mut hl) = (0f32, 0f32, 0f32);
    for k in 0..n {
        let s0 = (k as f64 * step) as usize;
        let s1 = (((k + 1) as f64 * step) as usize).min(x.len());
        let (mut ml, mut mm, mut mh) = (0f32, 0f32, 0f32);
        for &v in &x[s0.min(s1)..s1] {
            lp += al * (v - lp);
            lp2 += al * (lp - lp2);
            hl += ah * (v - hl);
            let hi = v - hl;
            let md = hl - lp2;
            ml = ml.max(lp2.abs());
            mm = mm.max(md.abs());
            mh = mh.max(hi.abs());
        }
        low[k] = ml;
        mid[k] = mm;
        high[k] = mh;
    }
    let mut mx = 1e-6f32;
    for k in 0..n {
        mx = mx.max(low[k]).max(mid[k]).max(high[k]);
    }
    let q = |v: &Vec<f32>| v.iter().map(|x| ((x / mx).clamp(0.0, 1.0) * 255.0).round() as u8).collect();
    Wave { pps: WAVE_PPS, low: q(&low), mid: q(&mid), high: q(&high) }
}

// Tempo : enveloppe d'attaques (basses + large bande), puis « DFT » de l'enveloppe à chaque tempo
// candidat : l'amplitude dit à quel point les attaques tombent sur une grille régulière, la phase
// donne la position des temps.
fn tempo(x: &[f32], sr: f64, min_bpm: f64, max_bpm: f64) -> (f64, f64) {
    let hop = (sr / 200.0).round() as usize;
    let fr = sr / hop as f64;
    let n = x.len() / hop;
    if (n as f64) < fr * 4.0 {
        return (0.0, 0.0);
    }
    let al = one_pole(150.0, sr) as f32;
    let (mut lp, mut lp2) = (0f32, 0f32);
    let mut e_low = vec![0f32; n];
    let mut e_all = vec![0f32; n];
    for k in 0..n {
        let (mut sl, mut sa) = (0f32, 0f32);
        for &v in &x[k * hop..k * hop + hop] {
            lp += al * (v - lp);
            lp2 += al * (lp - lp2);
            sl += lp2 * lp2;
            sa += v * v;
        }
        e_low[k] = (1e-9 + sl).ln();
        e_all[k] = (1e-9 + sa).ln();
    }
    let mut on = vec![0f32; n];
    let mut on_b = vec![0f32; n];
    for k in 1..n {
        on_b[k] = (e_all[k] - e_all[k - 1]).max(0.0);
    }
    for k in 2..n {
        let dl = e_low[k] - e_low[k - 2];
        let da = e_all[k] - e_all[k - 2];
        on[k] = dl.max(0.0) + da.max(0.0) * 0.6;
    }
    // retirer la moyenne locale (garde les pics)
    let w = (fr * 0.25).round() as usize;
    let mut cs = vec![0f64; n + 1];
    for k in 0..n {
        cs[k + 1] = cs[k] + on[k] as f64;
    }
    let mut o = vec![0f32; n];
    for k in 0..n {
        let a = k.saturating_sub(w);
        let b = (k + w).min(n);
        o[k] = (on[k] as f64 - (cs[b] - cs[a]) / (b - a) as f64).max(0.0) as f32;
    }
    let amp = |bpm: f64| -> (f64, f64) {
        let omega = 2.0 * PI * (bpm / 60.0) / fr;
        let (c, s) = (omega.cos(), omega.sin());
        let (mut re, mut im) = (0f64, 0f64);
        let (mut cr, mut ci) = (1f64, 0f64);
        for (k, &v) in o.iter().enumerate() {
            if v != 0.0 {
                re += v as f64 * cr;
                im -= v as f64 * ci;
            }
            let nr = cr * c - ci * s;
            ci = cr * s + ci * c;
            cr = nr;
            if k & 1023 == 0 {
                let m = cr.hypot(ci);
                cr /= m;
                ci /= m;
            }
        }
        (re.hypot(im), im.atan2(re))
    };
    let prior = |b: f64| (-0.5 * ((b / 145.0).log2() / 1.1).powi(2)).exp();
    let mut best = (min_bpm, -1.0);
    let mut b = min_bpm;
    while b <= max_bpm {
        let m = (amp(b).0 + 0.5 * amp(b * 2.0).0 + 0.3 * amp(b / 2.0).0) * prior(b);
        if m > best.1 {
            best = (b, m);
        }
        b += 0.25;
    }
    let mut fine = (best.0, -1.0);
    let mut b = best.0 - 0.3;
    while b <= best.0 + 0.3 {
        let m = amp(b).0;
        if m > fine.1 {
            fine = (b, m);
        }
        b += 0.01;
    }
    let mut bpm = fine.0;
    // tempo entier ou au demi si c'est proche
    let r1 = bpm.round();
    let r2 = (bpm * 2.0).round() / 2.0;
    if (bpm - r1).abs() < 0.06 {
        bpm = r1;
    } else if (bpm - r2).abs() < 0.04 {
        bpm = r2;
    }
    let (_, phase) = amp(bpm);
    let period = 60.0 / bpm;
    let omega = 2.0 * PI * (bpm / 60.0) / fr;
    let mut k0 = (-phase / omega) % (fr * period);
    if k0 < 0.0 {
        k0 += fr * period;
    }
    // affinage : attaque large bande la plus forte juste avant / autour de chaque temps (médiane)
    let mut offs = vec![];
    let mut kb = k0;
    while kb < (n as f64) - 8.0 {
        let c = kb.round() as i64;
        let (mut best, mut bk) = (-1f32, 0i64);
        let lo = (c - 14).max(1);
        let hi = (c + 4).min(n as i64 - 1);
        for k in lo..=hi {
            if on_b[k as usize] > best {
                best = on_b[k as usize];
                bk = k;
            }
        }
        if best > 0.0 {
            offs.push(bk - c);
        }
        kb += fr * period;
    }
    offs.sort();
    let med = if offs.is_empty() { 0 } else { offs[offs.len() / 2] };
    let mut first = ((k0 + med as f64 - 1.0) * hop as f64) / sr;
    first %= period;
    if first < 0.0 {
        first += period;
    }
    ((bpm * 100.0).round() / 100.0, first)
}

const NOTE: [&str; 12] = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

fn detect_key(x: &[f32], sr: f64) -> Option<String> {
    use rustfft::{num_complex::Complex, FftPlanner};
    let nn = 8192usize;
    if x.len() < nn * 2 {
        return None;
    }
    let frames = 360.min((x.len() - nn) / (nn / 2));
    if frames < 8 {
        return None;
    }
    let step = (x.len() - nn) / frames;
    let win: Vec<f32> = (0..nn).map(|i| 0.5 - 0.5 * (2.0 * PI * i as f64 / nn as f64).cos() as f32).collect();
    let mut pc_of = vec![-1i8; nn / 2];
    for k in 1..nn / 2 {
        let f = k as f64 * sr / nn as f64;
        if !(100.0..=2500.0).contains(&f) {
            continue;
        }
        pc_of[k] = ((((69.0 + 12.0 * (f / 440.0).log2()).round() as i64 % 12) + 12) % 12) as i8;
    }
    let fft = FftPlanner::<f32>::new().plan_fft_forward(nn);
    let mut buf = vec![Complex::new(0f32, 0f32); nn];
    let mut chroma = [0f64; 12];
    for fi in 0..frames {
        let o = fi * step;
        for i in 0..nn {
            buf[i] = Complex::new(x[o + i] * win[i], 0.0);
        }
        fft.process(&mut buf);
        let mut c = [0f64; 12];
        let mut tot = 0.0;
        for k in 1..nn / 2 {
            let p = pc_of[k];
            if p < 0 {
                continue;
            }
            let m = (100.0 * buf[k].norm() as f64).ln_1p();
            c[p as usize] += m;
            tot += m;
        }
        if tot > 0.0 {
            for p in 0..12 {
                chroma[p] += c[p] / tot;
            }
        }
    }
    const MAJ: [f64; 12] = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    const MIN: [f64; 12] = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
    let corr = |a: &[f64; 12], b: &[f64; 12]| {
        let ma = a.iter().sum::<f64>() / 12.0;
        let mb = b.iter().sum::<f64>() / 12.0;
        let (mut n, mut da, mut db) = (0.0, 0.0, 0.0);
        for i in 0..12 {
            n += (a[i] - ma) * (b[i] - mb);
            da += (a[i] - ma).powi(2);
            db += (b[i] - mb).powi(2);
        }
        n / (da * db).sqrt()
    };
    let mut best: Option<(f64, usize, bool)> = None;
    for t in 0..12 {
        for (prof, minor) in [(&MAJ, false), (&MIN, true)] {
            let mut rot = [0f64; 12];
            for i in 0..12 {
                rot[i] = prof[(i + 12 - t) % 12];
            }
            let r = corr(&chroma, &rot);
            if best.map(|b| r > b.0).unwrap_or(true) {
                best = Some((r, t, minor));
            }
        }
    }
    best.map(|(_, t, m)| format!("{}{}", NOTE[t], if m { " minor" } else { " major" }))
}
