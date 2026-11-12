// Lecteur d'une platine, exécuté dans le fil audio : vitesse, boucles, scratch, Master Tempo.
use super::wsola::Wsola;
use std::sync::Arc;

pub struct Track {
    pub l: Vec<f32>,
    pub r: Vec<f32>,
}
impl Track {
    pub fn len(&self) -> usize {
        self.l.len()
    }
}

#[derive(Clone, Copy, Default)]
pub struct LoopRegion {
    pub start: f64,
    pub end: f64,
    pub active: bool,
}

pub struct Player {
    pub track: Option<Arc<Track>>,
    len: usize,
    pub pos: f64,
    pub rate: f64,
    pub playing: bool,
    gain: f32,
    pub keylock: bool,
    pub lp: LoopRegion,
    pub scratch: bool,
    target: f64,
    vel: f64,
    st: Wsola,
    st_on: bool,
    read_pos: f64,
    sr: f64,
    pub ended: bool,
}

impl Player {
    pub fn new(sr: f64) -> Self {
        Player {
            track: None,
            len: 0,
            pos: 0.0,
            rate: 1.0,
            playing: false,
            gain: 0.0,
            keylock: false,
            lp: LoopRegion::default(),
            scratch: false,
            target: 0.0,
            vel: 0.0,
            st: Wsola::new(sr),
            st_on: false,
            read_pos: 0.0,
            sr,
            ended: false,
        }
    }

    pub fn load(&mut self, t: Arc<Track>) -> Option<Arc<Track>> {
        self.len = t.len();
        let old = self.track.replace(t);
        self.pos = 0.0;
        self.playing = false;
        self.gain = 0.0;
        self.lp.active = false;
        self.st_on = false;
        old
    }
    pub fn unload(&mut self) -> Option<Arc<Track>> {
        self.len = 0;
        self.playing = false;
        self.track.take()
    }
    pub fn play(&mut self) {
        if self.track.is_some() {
            self.playing = true;
        }
    }
    pub fn seek(&mut self, frame: f64) {
        self.pos = frame.clamp(0.0, (self.len as f64 - 1.0).max(0.0));
        self.st_on = false;
    }
    pub fn set_rate(&mut self, r: f64) {
        self.rate = r;
        self.st.tempo = r.max(0.25);
    }
    pub fn set_keylock(&mut self, on: bool) {
        self.keylock = on;
        self.st_on = false;
    }
    pub fn set_scratch(&mut self, active: bool, target: Option<f64>) {
        if active && !self.scratch {
            self.target = self.pos;
            self.vel = if self.playing { self.rate } else { 0.0 };
        }
        self.scratch = active;
        if let Some(t) = target {
            self.target = t;
        }
        if !active {
            self.st_on = false;
        }
    }

    // échantillon interpolé (Hermite 4 points)
    #[inline]
    fn sample(buf: &[f32], len: usize, p: f64) -> f32 {
        if p < 1.0 || p >= (len as f64) - 3.0 {
            if p < 0.0 || p >= len as f64 - 1.0 {
                return 0.0;
            }
            let i = p as usize;
            let f = (p - i as f64) as f32;
            return buf[i] + (buf[(i + 1).min(len - 1)] - buf[i]) * f;
        }
        let i = p as usize;
        let t = (p - i as f64) as f32;
        let (xm1, x0, x1, x2) = (buf[i - 1], buf[i], buf[i + 1], buf[i + 2]);
        let c = (x1 - xm1) * 0.5;
        let v = x0 - x1;
        let w = c + v;
        let a = w + v + (x2 - x0) * 0.5;
        let b = w + a;
        (((a * t) - b) * t + c) * t + x0
    }

    #[inline]
    fn wrap(&self, p: f64) -> f64 {
        let lp = self.lp;
        if lp.active && lp.end > lp.start && p >= lp.end {
            lp.start + ((p - lp.start) % (lp.end - lp.start))
        } else {
            p
        }
    }

    /// remplit `l` et `r` (même longueur)
    pub fn render(&mut self, l: &mut [f32], r: &mut [f32]) {
        let n = l.len();
        let Some(t) = self.track.clone() else {
            l.fill(0.0);
            r.fill(0.0);
            return;
        };
        let (bl, br, len) = (&t.l[..], &t.r[..], self.len);
        let target_gain = if self.playing || self.scratch { 1.0f32 } else { 0.0 };
        let g_step = 1.0 / 96.0;

        if self.scratch {
            // la position suit la main sur le jog (vitesse lissée)
            let desired = ((self.target - self.pos) / (self.sr * 0.012)).clamp(-12.0, 12.0);
            for i in 0..n {
                self.vel += (desired - self.vel) * 0.004;
                self.pos += self.vel;
                if self.pos < 0.0 {
                    self.pos = 0.0;
                    self.vel = 0.0;
                }
                if self.pos > len as f64 - 2.0 {
                    self.pos = len as f64 - 2.0;
                    self.vel = 0.0;
                }
                self.gain += (1.0 - self.gain) * 0.05;
                l[i] = Self::sample(bl, len, self.pos) * self.gain;
                r[i] = Self::sample(br, len, self.pos) * self.gain;
            }
        } else if self.keylock && (self.rate - 1.0).abs() > 0.0005 && (self.playing || self.gain > 0.001) {
            // Master Tempo
            if !self.st_on {
                self.st.clear();
                self.st.tempo = self.rate.max(0.25);
                self.read_pos = self.pos;
                self.st_on = true;
            }
            let mut guard = 0;
            while self.st.out_len() < n && guard < 64 {
                guard += 1;
                for _ in 0..512 {
                    self.read_pos = self.wrap(self.read_pos);
                    let j = self.read_pos as usize;
                    let s = if j < len { [bl[j], br[j]] } else { [0.0, 0.0] };
                    self.st.put(s);
                    self.read_pos += 1.0;
                }
                self.st.process();
            }
            for i in 0..n {
                self.gain = (self.gain + if target_gain > self.gain { g_step } else { -g_step }).clamp(0.0, 1.0);
                let s = self.st.pop().unwrap_or([0.0, 0.0]);
                l[i] = s[0] * self.gain;
                r[i] = s[1] * self.gain;
            }
            // position « audible » ≈ pointeur de lecture moins ce qui attend dans l'étireur
            let mut p = self.read_pos - self.st.in_len() as f64 - self.st.out_len() as f64 * self.rate;
            let lp = self.lp;
            if lp.active && lp.end > lp.start && p < lp.start {
                p += lp.end - lp.start;
            }
            self.pos = p.max(0.0);
            if !self.playing && self.gain <= 0.0 {
                self.st_on = false;
            }
        } else {
            self.st_on = false;
            let adv = self.rate;
            for i in 0..n {
                self.gain = (self.gain + if target_gain > self.gain { g_step } else { -g_step }).clamp(0.0, 1.0);
                if self.gain > 0.0 {
                    l[i] = Self::sample(bl, len, self.pos) * self.gain;
                    r[i] = Self::sample(br, len, self.pos) * self.gain;
                    self.pos = self.wrap(self.pos + adv);
                } else {
                    l[i] = 0.0;
                    r[i] = 0.0;
                }
            }
        }

        if self.pos >= len as f64 - 2.0 && self.playing {
            self.playing = false;
            self.pos = (len as f64 - 2.0).max(0.0);
            self.ended = true;
        }
    }
}
