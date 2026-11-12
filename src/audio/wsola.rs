// Master Tempo : étirement temporel sans changer la hauteur (WSOLA, même principe que SoundTouch).
// Séquences de ~40 ms recollées avec un fondu de 8 ms, à l'endroit (fenêtre de ±15 ms) où les
// deux morceaux se ressemblent le plus.

pub struct Wsola {
    seq: usize,
    seek: usize,
    ov: usize,
    inp: Vec<[f32; 2]>,
    start: usize,
    mid: Vec<[f32; 2]>,
    out: Vec<[f32; 2]>,
    out_start: usize,
    skip_frac: f64,
    pub tempo: f64,
    primed: bool,
}

impl Wsola {
    pub fn new(sr: f64) -> Self {
        let ms = |m: f64| ((sr * m / 1000.0) as usize).max(8);
        Wsola {
            seq: ms(40.0),
            seek: ms(15.0),
            ov: ms(8.0),
            inp: Vec::with_capacity(16384),
            start: 0,
            mid: vec![],
            out: Vec::with_capacity(16384),
            out_start: 0,
            skip_frac: 0.0,
            tempo: 1.0,
            primed: false,
        }
    }

    pub fn clear(&mut self) {
        self.inp.clear();
        self.start = 0;
        self.mid.clear();
        self.out.clear();
        self.out_start = 0;
        self.skip_frac = 0.0;
        self.primed = false;
    }

    pub fn in_len(&self) -> usize {
        self.inp.len() - self.start
    }
    pub fn out_len(&self) -> usize {
        self.out.len() - self.out_start
    }

    #[inline]
    pub fn put(&mut self, s: [f32; 2]) {
        self.inp.push(s);
    }

    pub fn pop(&mut self) -> Option<[f32; 2]> {
        if self.out_start < self.out.len() {
            let v = self.out[self.out_start];
            self.out_start += 1;
            Some(v)
        } else {
            None
        }
    }

    fn best_offset(&self) -> usize {
        let inp = &self.inp[self.start..];
        let ov = self.ov;
        let mut best = 0;
        let mut best_c = f64::MIN;
        let mid: Vec<f32> = self.mid.iter().map(|s| s[0] + s[1]).collect();
        // pondération : le milieu du fondu compte plus
        for off in (0..self.seek).step_by(2) {
            let mut c = 0f64;
            let mut e = 1e-9f64;
            for i in (0..ov).step_by(2) {
                let x = (inp[off + i][0] + inp[off + i][1]) as f64;
                c += x * mid[i] as f64;
                e += x * x;
            }
            let v = c / e.sqrt();
            if v > best_c {
                best_c = v;
                best = off;
            }
        }
        // affinage à l'échantillon près
        let lo = best.saturating_sub(1);
        let hi = (best + 1).min(self.seek - 1);
        for off in lo..=hi {
            let mut c = 0f64;
            let mut e = 1e-9f64;
            for i in 0..ov {
                let x = (inp[off + i][0] + inp[off + i][1]) as f64;
                c += x * mid[i] as f64;
                e += x * x;
            }
            let v = c / e.sqrt();
            if v > best_c {
                best_c = v;
                best = off;
            }
        }
        best
    }

    /// traite tout ce qui peut l'être avec l'entrée disponible
    pub fn process(&mut self) {
        if self.out_start > 8192 {
            self.out.drain(..self.out_start);
            self.out_start = 0;
        }
        let (seq, ov) = (self.seq, self.ov);
        while self.in_len() >= self.seek + seq + 1 {
            let off = if self.primed { self.best_offset() } else { 0 };
            let base = self.start + off;
            if self.primed {
                for i in 0..ov {
                    let t = i as f32 / ov as f32;
                    let a = self.mid[i];
                    let b = self.inp[base + i];
                    self.out.push([a[0] * (1.0 - t) + b[0] * t, a[1] * (1.0 - t) + b[1] * t]);
                }
                for i in ov..seq - ov {
                    self.out.push(self.inp[base + i]);
                }
            } else {
                for i in 0..seq - ov {
                    self.out.push(self.inp[base + i]);
                }
                self.primed = true;
            }
            self.mid.clear();
            self.mid.extend_from_slice(&self.inp[base + seq - ov..base + seq]);
            // avance nominale dans l'entrée
            let skip = (seq - ov) as f64 * self.tempo + self.skip_frac;
            let n = skip.floor() as usize;
            self.skip_frac = skip - n as f64;
            self.start += n.min(self.in_len());
        }
        if self.start > 16384 {
            self.inp.drain(..self.start);
            self.start = 0;
        }
    }
}
