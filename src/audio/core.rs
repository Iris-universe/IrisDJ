// Cœur audio (fil temps réel) : 2 lecteurs -> table de mixage 2 voies type DJM -> master / casque.
//
// Voie : platine -> TRIM -> EQ (LOW/MID/HI) -> COLOR (filtre) -> [pré-fader : VU, CUE casque]
//        -> fader -> crossfader -> bus de mix (+ envoi Beat FX)
// Master : bus de mix + retour FX -> MASTER -> [VU] -> limiteur (option) -> sortie (+ enregistreur)
// Casque : CUE (pré-fader) mélangé au master (MIX) -> LEVEL -> 2e sortie ou oreille gauche (split)

use super::dsp::*;
use super::player::{LoopRegion, Player, Track};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering::Relaxed};
use std::sync::Arc;
use std::time::Instant;

#[derive(Clone, Copy, Serialize, Deserialize, Debug, PartialEq)]
pub enum XfAssign {
    A,
    THRU,
    B,
}

#[derive(Clone, Copy, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChanParams {
    pub trim: f64,
    pub hi: f64,
    pub mid: f64,
    pub low: f64,
    pub filter: f64,
    pub fader: f64,
    pub cue: bool,
    pub xf: XfAssign,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum PhonesMode {
    Off,
    Split,
    Device,
}

/// Réglages de la table (copiés tels quels dans le fil audio)
#[derive(Clone, Copy, Debug)]
pub struct MixParams {
    pub ch: [ChanParams; 2],
    pub xfader: f64,
    pub xf_cut: bool,
    pub master: f64,
    pub phones_mix: f64,
    pub phones_level: f64,
    pub limiter: bool,
    pub fx_type: u8, // 0 echo, 1 reverb, 2 flanger
    pub fx_on: bool,
    pub fx_channel: u8, // 0 A, 1 B, 2 master
    pub fx_level: f64,
    pub fx_sec: f64, // durée de l'effet (s), calée sur le BPM
    pub phones: PhonesMode,
}

pub fn xf_gain(p: &MixParams, d: usize) -> f64 {
    let c = &p.ch[d];
    let x = p.xfader;
    let pos = match c.xf {
        XfAssign::THRU => return 1.0,
        XfAssign::A => x,
        XfAssign::B => -x,
    };
    if p.xf_cut {
        return if pos > 0.92 { ((1.0 - pos) / 0.08).max(0.0) } else { 1.0 };
    }
    if pos <= 0.0 {
        1.0
    } else {
        (pos * std::f64::consts::PI / 2.0).cos()
    }
}
pub fn fader_gain(f: f64) -> f64 {
    if f <= 0.0 {
        0.0
    } else {
        f.powf(2.2)
    }
}

pub enum Cmd {
    Load(usize, Arc<Track>),
    Unload(usize),
    Play(usize),
    Pause(usize),
    Seek(usize, f64),
    Rate(usize, f64),
    Keylock(usize, bool),
    Loop(usize, LoopRegion),
    Scratch(usize, bool, Option<f64>),
    Mix(MixParams),
    Rec(Option<rtrb::Producer<f32>>),
    PhonesOut(Option<rtrb::Producer<f32>>),
}
pub struct Msg {
    pub seq: u64,
    pub cmd: Cmd,
}
/// objets à libérer hors du fil audio
pub enum Garbage {
    Track(Arc<Track>),
    Ring(rtrb::Producer<f32>),
}

pub struct DeckTele {
    pub frame: AtomicU64,
    pub playing: AtomicBool,
    pub scratch: AtomicBool,
    pub ended: AtomicU32,
    pub t_nanos: AtomicU64,
}
pub struct Telemetry {
    pub decks: [DeckTele; 2],
    pub ack: AtomicU64,
    pub peaks: [AtomicU32; 4], // A, B, master L, master R (crête max depuis la dernière lecture)
    pub start: Instant,
    pub callbacks: AtomicU64,
}
impl Telemetry {
    pub fn new() -> Self {
        let d = || DeckTele {
            frame: AtomicU64::new(0f64.to_bits()),
            playing: AtomicBool::new(false),
            scratch: AtomicBool::new(false),
            ended: AtomicU32::new(0),
            t_nanos: AtomicU64::new(0),
        };
        Telemetry {
            decks: [d(), d()],
            ack: AtomicU64::new(0),
            peaks: [AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0), AtomicU32::new(0)],
            start: Instant::now(),
            callbacks: AtomicU64::new(0),
        }
    }
    pub fn nanos(&self) -> u64 {
        self.start.elapsed().as_nanos() as u64
    }
    pub fn take_peaks(&self) -> [f64; 4] {
        let mut o = [0.0; 4];
        for i in 0..4 {
            o[i] = f32::from_bits(self.peaks[i].swap(0, Relaxed)) as f64;
        }
        o
    }
}

struct Strip {
    trim: Smooth,
    low_g: Smooth,
    low: Biquad,
    kill_f: Smooth,
    kill: Biquad,
    mid_g: Smooth,
    mid: Biquad,
    hi_g: Smooth,
    hi: Biquad,
    hp_f: Smooth,
    hp_q: Smooth,
    hpf: Biquad,
    lp_f: Smooth,
    lp_q: Smooth,
    lpf: Biquad,
    fader: Smooth,
    cue: Smooth,
    xf: Smooth,
    send: Smooth,
}
impl Strip {
    fn new(sr: f64) -> Self {
        let s = |v, tau| Smooth::new(v, tau, sr);
        Strip {
            trim: s(db_to_gain(-6.0), 0.012),
            low_g: s(0.0, 0.012),
            low: Biquad::new(Kind::LowShelf),
            kill_f: s(10.0, 0.012),
            kill: Biquad::new(Kind::HighPass),
            mid_g: s(0.0, 0.012),
            mid: Biquad::new(Kind::Peaking),
            hi_g: s(0.0, 0.012),
            hi: Biquad::new(Kind::HighShelf),
            hp_f: s(10.0, 0.012),
            hp_q: s(0.7, 0.012),
            hpf: Biquad::new(Kind::HighPass),
            lp_f: s(22000.0, 0.012),
            lp_q: s(0.7, 0.012),
            lpf: Biquad::new(Kind::LowPass),
            fader: s(0.0, 0.006),
            cue: s(0.0, 0.012),
            xf: s(1.0, 0.005),
            send: s(0.0, 0.005),
        }
    }
    fn apply(&mut self, c: &ChanParams, xf: f64, send: bool) {
        self.trim.set(db_to_gain(c.trim * 12.0 - 6.0)); // TRIM -12..+12 dB avec 6 dB de marge
        let eq = |v: f64| if v >= 0.0 { v * 6.0 } else if v <= -0.98 { -40.0 } else { v * 26.0 };
        self.low_g.set(eq(c.low));
        self.kill_f.set(if c.low <= -0.98 { 180.0 } else { 10.0 });
        self.mid_g.set(eq(c.mid));
        self.hi_g.set(eq(c.hi));
        let f = c.filter;
        let lp = if f < -0.03 { 20000.0 * (70.0f64 / 20000.0).powf((-f - 0.03) / 0.97) } else { 22000.0 };
        let hp = if f > 0.03 { 15.0 * (9000.0f64 / 15.0).powf((f - 0.03) / 0.97) } else { 10.0 };
        self.lp_f.set(lp);
        self.hp_f.set(hp);
        self.lp_q.set(if f < -0.03 { 4.0 } else { 0.7 });
        self.hp_q.set(if f > 0.03 { 4.0 } else { 0.7 });
        self.fader.set(fader_gain(c.fader));
        self.cue.set(if c.cue { 1.0 } else { 0.0 });
        self.xf.set(xf.min(1.0));
        self.send.set(if send { 1.0 } else { 0.0 });
    }
    // met à jour les coefficients des filtres (une fois par bloc)
    fn update(&mut self, sr: f64, n: usize) {
        let lg = self.low_g.step_n(n);
        self.low.set(sr, 180.0, 0.0, lg);
        let kf = self.kill_f.step_n(n);
        self.kill.set(sr, kf, 0.0, 0.0);
        let mg = self.mid_g.step_n(n);
        self.mid.set(sr, 1000.0, 0.7, mg);
        let hg = self.hi_g.step_n(n);
        self.hi.set(sr, 3500.0, 0.0, hg);
        let (hf, hq) = (self.hp_f.step_n(n), self.hp_q.step_n(n));
        self.hpf.set(sr, hf, hq, 0.0);
        let (lf, lq) = (self.lp_f.step_n(n), self.lp_q.step_n(n));
        self.lpf.set(sr, lf, lq, 0.0);
    }
}

pub const BLOCK: usize = 32;

pub struct Core {
    pub sr: f64,
    players: [Player; 2],
    strips: [Strip; 2],
    echo: Echo,
    reverb: Reverb,
    flanger: Flanger,
    fx_wet: Smooth,
    master_send: Smooth,
    master_g: Smooth,
    ph_cue: Smooth,
    ph_master: Smooth,
    ph_level: Smooth,
    lim_mix: Smooth, // 1 = limiteur, 0 = contourné
    limiter: Limiter,
    p: MixParams,
    cmds: rtrb::Consumer<Msg>,
    garbage: rtrb::Producer<Garbage>,
    pub tele: Arc<Telemetry>,
    rec: Option<rtrb::Producer<f32>>,
    phones_out: Option<rtrb::Producer<f32>>,
    dl: [[f32; BLOCK]; 2],
    dr: [[f32; BLOCK]; 2],
}

pub fn default_params() -> MixParams {
    let ch = |xf| ChanParams { trim: 0.0, hi: 0.0, mid: 0.0, low: 0.0, filter: 0.0, fader: 0.0, cue: false, xf };
    MixParams {
        ch: [ch(XfAssign::A), ch(XfAssign::B)],
        xfader: 0.0,
        xf_cut: false,
        master: 0.8,
        phones_mix: 0.0,
        phones_level: 0.8,
        limiter: true,
        fx_type: 0,
        fx_on: false,
        fx_channel: 0,
        fx_level: 0.5,
        fx_sec: 0.5,
        phones: PhonesMode::Off,
    }
}

impl Core {
    pub fn new(sr: f64, cmds: rtrb::Consumer<Msg>, garbage: rtrb::Producer<Garbage>, tele: Arc<Telemetry>) -> Self {
        let s = |v, tau| Smooth::new(v, tau, sr);
        let mut c = Core {
            sr,
            players: [Player::new(sr), Player::new(sr)],
            strips: [Strip::new(sr), Strip::new(sr)],
            echo: Echo::new(sr),
            reverb: Reverb::new(sr),
            flanger: Flanger::new(sr),
            fx_wet: s(0.45, 0.01),
            master_send: s(0.0, 0.005),
            master_g: s(0.8f64.powi(2) * 1.6, 0.01),
            ph_cue: s(0.0, 0.01),
            ph_master: s(0.0, 0.01),
            ph_level: s(0.0, 0.01),
            lim_mix: s(1.0, 0.003),
            limiter: Limiter::new(sr),
            p: default_params(),
            cmds,
            garbage,
            tele,
            rec: None,
            phones_out: None,
            dl: [[0.0; BLOCK]; 2],
            dr: [[0.0; BLOCK]; 2],
        };
        let p = c.p;
        c.apply(p);
        c
    }

    fn apply(&mut self, p: MixParams) {
        self.p = p;
        for d in 0..2 {
            let send = p.fx_on && p.fx_channel as usize == d;
            self.strips[d].apply(&p.ch[d], xf_gain(&p, d), send);
        }
        self.master_send.set(if p.fx_on && p.fx_channel == 2 { 1.0 } else { 0.0 });
        self.master_g.set(p.master.powi(2) * 1.6);
        let a = (p.phones_mix + 1.0) / 2.0 * std::f64::consts::PI / 2.0;
        self.ph_cue.set(a.cos());
        self.ph_master.set(a.sin());
        self.ph_level.set(p.phones_level.powi(2) * 1.4);
        self.lim_mix.set(if p.limiter { 1.0 } else { 0.0 });
        let sec = p.fx_sec.min(7.9);
        self.echo.delay.set(sec * self.sr);
        self.echo.fb.set(0.35 + p.fx_level * 0.35);
        self.flanger.rate.set(1.0 / (sec * 4.0).max(0.2));
        self.fx_wet.set(match p.fx_type {
            0 => p.fx_level * 0.9,
            1 => p.fx_level * 1.2,
            _ => p.fx_level,
        });
    }

    fn drain_cmds(&mut self) {
        let mut last = None;
        while let Ok(m) = self.cmds.pop() {
            last = Some(m.seq);
            match m.cmd {
                Cmd::Load(d, t) => {
                    if let Some(old) = self.players[d].load(t) {
                        let _ = self.garbage.push(Garbage::Track(old));
                    }
                }
                Cmd::Unload(d) => {
                    if let Some(old) = self.players[d].unload() {
                        let _ = self.garbage.push(Garbage::Track(old));
                    }
                }
                Cmd::Play(d) => self.players[d].play(),
                Cmd::Pause(d) => self.players[d].playing = false,
                Cmd::Seek(d, f) => self.players[d].seek(f),
                Cmd::Rate(d, r) => self.players[d].set_rate(r),
                Cmd::Keylock(d, on) => self.players[d].set_keylock(on),
                Cmd::Loop(d, l) => self.players[d].lp = l,
                Cmd::Scratch(d, a, t) => self.players[d].set_scratch(a, t),
                Cmd::Mix(p) => self.apply(p),
                Cmd::Rec(r) => {
                    if let Some(old) = std::mem::replace(&mut self.rec, r) {
                        let _ = self.garbage.push(Garbage::Ring(old));
                    }
                }
                Cmd::PhonesOut(r) => {
                    if let Some(old) = std::mem::replace(&mut self.phones_out, r) {
                        let _ = self.garbage.push(Garbage::Ring(old));
                    }
                }
            }
        }
        if let Some(s) = last {
            self.tele.ack.store(s, Relaxed);
        }
    }

    /// rend `out.len()` images stéréo (sortie principale : master, ou casque/master en split)
    pub fn render(&mut self, out: &mut [[f32; 2]]) {
        self.drain_cmds();
        let sr = self.sr;
        let mut peaks = [0f32; 4];
        let mut done = 0;
        while done < out.len() {
            let n = (out.len() - done).min(BLOCK);
            for d in 0..2 {
                let (l, r) = (&mut self.dl[d][..n], &mut self.dr[d][..n]);
                self.players[d].render(l, r);
                self.strips[d].update(sr, n);
            }
            for i in 0..n {
                let mut mix = [0f64; 2];
                let mut cue = [0f64; 2];
                let mut fx_in = [0f64; 2];
                for d in 0..2 {
                    let s = &mut self.strips[d];
                    let tg = s.trim.step();
                    let fg = s.fader.step();
                    let xg = s.xf.step();
                    let cg = s.cue.step();
                    let sg = s.send.step();
                    for c in 0..2 {
                        let x = if c == 0 { self.dl[d][i] } else { self.dr[d][i] } as f64 * tg;
                        let mut y = s.low.tick(c, x);
                        y = s.kill.tick(c, y);
                        y = s.mid.tick(c, y);
                        y = s.hi.tick(c, y);
                        y = s.hpf.tick(c, y);
                        y = s.lpf.tick(c, y);
                        let a = y.abs() as f32;
                        if a > peaks[d] {
                            peaks[d] = a;
                        }
                        cue[c] += y * cg;
                        let post = y * fg * xg;
                        mix[c] += post;
                        fx_in[c] += post * sg;
                    }
                }
                let ms = self.master_send.step();
                let fxi = [(fx_in[0] + mix[0] * ms) as f32, (fx_in[1] + mix[1] * ms) as f32];
                let z = [0f32; 2];
                let t = self.p.fx_type;
                let e = self.echo.tick(if t == 0 { fxi } else { z });
                let rv = self.reverb.tick(if t == 1 { fxi } else { z });
                let fl = self.flanger.tick(if t == 2 { fxi } else { z });
                let wet = self.fx_wet.step();
                let mg = self.master_g.step();
                let mut m = [0f64; 2];
                for c in 0..2 {
                    m[c] = (mix[c] + (e[c] + rv[c] + fl[c]) as f64 * wet) * mg;
                }
                peaks[2] = peaks[2].max(m[0].abs() as f32);
                peaks[3] = peaks[3].max(m[1].abs() as f32);
                let (ll, lr) = self.limiter.tick(m[0] as f32, m[1] as f32);
                let lm = self.lim_mix.step() as f32;
                // le limiteur retarde de 1,5 ms : en le contournant on garde le même retard
                let mo = if lm >= 0.999 { [ll, lr] } else {
                    // contourné : signal non limité mais toujours borné à ±1 (comme une sortie réelle)
                    let a = [(m[0] as f32).clamp(-1.0, 1.0), (m[1] as f32).clamp(-1.0, 1.0)];
                    [a[0] * (1.0 - lm) + ll * lm, a[1] * (1.0 - lm) + lr * lm]
                };
                // casque
                let pc = self.ph_cue.step();
                let pm = self.ph_master.step();
                let pl = self.ph_level.step();
                let ph = [((cue[0] * pc + mo[0] as f64 * pm) * pl) as f32, ((cue[1] * pc + mo[1] as f64 * pm) * pl) as f32];
                let o = &mut out[done + i];
                match self.p.phones {
                    PhonesMode::Split => {
                        // oreille gauche = casque (CUE), oreille droite = master
                        *o = [((ph[0] + ph[1]) * 0.5).clamp(-1.0, 1.0), (mo[0] + mo[1]) * 0.5];
                    }
                    _ => *o = mo,
                }
                if let Some(r) = self.rec.as_mut() {
                    if r.slots() >= 2 {
                        let _ = r.push(mo[0]);
                        let _ = r.push(mo[1]);
                    }
                }
                if self.p.phones == PhonesMode::Device {
                    if let Some(r) = self.phones_out.as_mut() {
                        if r.slots() >= 2 {
                            let _ = r.push(ph[0].clamp(-1.0, 1.0));
                            let _ = r.push(ph[1].clamp(-1.0, 1.0));
                        }
                    }
                }
            }
            done += n;
        }
        // télémétrie
        let now = self.tele.nanos();
        for d in 0..2 {
            let p = &mut self.players[d];
            let t = &self.tele.decks[d];
            t.frame.store(p.pos.to_bits(), Relaxed);
            t.playing.store(p.playing, Relaxed);
            t.scratch.store(p.scratch, Relaxed);
            t.t_nanos.store(now, Relaxed);
            if p.ended {
                p.ended = false;
                t.ended.fetch_add(1, Relaxed);
            }
        }
        for i in 0..4 {
            self.tele.peaks[i].fetch_max(peaks[i].to_bits(), Relaxed);
        }
        self.tele.callbacks.fetch_add(1, Relaxed);
    }
}
