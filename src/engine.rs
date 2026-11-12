// Logique des platines (façon CDJ) et de la table, côté contrôle : c'est la référence de l'état.
// Le fil audio (audio::core) ne fait que jouer ; l'interface reçoit un instantané ~60 fois par seconde.

use crate::audio::core::{self, Cmd, MixParams, PhonesMode, XfAssign};
use crate::audio::player::{LoopRegion, Track};
use crate::audio::Audio;
use crate::store;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::Arc;

pub const TEMPO_RANGES: [f64; 4] = [6.0, 10.0, 16.0, 50.0];
pub const FX_BEATS: [f64; 8] = [0.125, 0.25, 0.5, 0.75, 1.0, 2.0, 4.0, 8.0];

#[derive(Clone, Copy, Default, Serialize)]
pub struct Loop {
    #[serde(rename = "in")]
    pub lin: Option<f64>,
    pub out: Option<f64>,
    pub active: bool,
    pub beats: Option<f64>,
}

pub struct Wave {
    pub pps: f64,
    pub low: Vec<u8>,
    pub mid: Vec<u8>,
    pub high: Vec<u8>,
}

#[derive(Serialize, Clone)]
pub struct Event {
    pub deck: &'static str,
    pub name: &'static str,
    pub beat: Option<f64>,
    #[serde(rename = "otherBeat")]
    pub other_beat: Option<f64>,
    pub arg: Option<f64>,
}

pub struct Deck {
    pub id: usize,
    pub track: Option<Map<String, Value>>,
    pub version: u64,
    pub bpm: f64,
    pub first_beat: f64,
    pub grid_edited: bool,
    pub fixed_grid: bool,
    pub duration: f64,
    pub playing: bool,
    pub scratching: bool,
    local_frame: f64,
    local_t: u64,
    last_seq: u64,
    last_ended: u32,
    pub tempo: f64,
    pub range: f64,
    pub bend: f64,
    pub keylock: bool,
    pub quantize: bool,
    pub sync: bool,
    pub cue_point: f64,
    pub hotcues: [Option<f64>; 8],
    pub lp: Loop,
    pub cue_held: bool,
    cue_play_from_hold: bool,
    scratch_pos: f64,
    pub wave: Option<Arc<Wave>>,
    pub wave_version: u64,
}

impl Deck {
    fn new(id: usize) -> Self {
        Deck {
            id,
            track: None,
            version: 0,
            bpm: 0.0,
            first_beat: 0.0,
            grid_edited: false,
            fixed_grid: false,
            duration: 0.0,
            playing: false,
            scratching: false,
            local_frame: 0.0,
            local_t: 0,
            last_seq: 0,
            last_ended: 0,
            tempo: 0.0,
            range: 10.0,
            bend: 0.0,
            keylock: false,
            quantize: true,
            sync: false,
            cue_point: 0.0,
            hotcues: [None; 8],
            lp: Loop::default(),
            cue_held: false,
            cue_play_from_hold: false,
            scratch_pos: 0.0,
            wave: None,
            wave_version: 0,
        }
    }
    pub fn loaded(&self) -> bool {
        self.track.is_some()
    }
    pub fn rate(&self) -> f64 {
        1.0 + self.tempo * self.range / 100.0 + self.bend
    }
    pub fn eff_bpm(&self) -> f64 {
        self.bpm * (1.0 + self.tempo * self.range / 100.0)
    }
    pub fn tempo_pct(&self) -> f64 {
        self.tempo * self.range
    }
    pub fn beat_len(&self) -> f64 {
        if self.bpm > 0.0 {
            60.0 / self.bpm
        } else {
            0.5
        }
    }
    pub fn beat_at(&self, sec: f64) -> f64 {
        if self.bpm > 0.0 {
            (sec - self.first_beat) / self.beat_len()
        } else {
            0.0
        }
    }
    pub fn sec_at_beat(&self, b: f64) -> f64 {
        self.first_beat + b * self.beat_len()
    }
    pub fn nearest_beat_sec(&self, sec: f64) -> f64 {
        self.sec_at_beat(self.beat_at(sec).round())
    }
    pub fn name(&self) -> &'static str {
        if self.id == 0 {
            "A"
        } else {
            "B"
        }
    }
    fn meta_key(&self) -> String {
        let t = self.track.as_ref().unwrap();
        let s = |k: &str| t.get(k).map(|v| match v {
            Value::String(s) => s.clone(),
            Value::Null => String::new(),
            o => o.to_string(),
        });
        let id = s("id").filter(|x| !x.is_empty()).or_else(|| s("title")).unwrap_or_default();
        format!("meta:{}:{}", s("source").unwrap_or_default(), id)
    }
}

pub struct Engine {
    pub audio: Arc<Audio>,
    pub sr: f64,
    pub decks: [Deck; 2],
    pub mix: MixParams,
    pub mix_json: Value,
    fx_beat: f64,
    pub events: Vec<Event>,
    pub meta: HashMap<String, Value>,
    pub rec: Option<crate::recorder::Recorder>,
    pub phones_mode: String,
    last_fx_sec: f64,
}

fn other(d: usize) -> usize {
    1 - d
}

impl Engine {
    pub fn new(audio: Arc<Audio>) -> Self {
        let sr = audio.sr;
        Engine {
            audio,
            sr,
            decks: [Deck::new(0), Deck::new(1)],
            mix: core::default_params(),
            mix_json: Value::Null,
            fx_beat: 1.0,
            events: vec![],
            meta: store::load_meta(),
            rec: None,
            phones_mode: "off".into(),
            last_fx_sec: 0.0,
        }
    }

    fn send(&mut self, d: usize, cmd: Cmd) {
        let seq = self.audio.tx.send(cmd);
        let k = &mut self.decks[d];
        k.last_seq = seq;
    }

    /// position (s) de la platine, extrapolée depuis le dernier passage du fil audio
    pub fn position(&self, d: usize) -> f64 {
        let k = &self.decks[d];
        if !k.loaded() {
            return 0.0;
        }
        let t = &self.audio.tele.decks[d];
        let fresh = self.audio.tele.ack.load(Relaxed) >= k.last_seq;
        let (frame, at, playing, scratching) = if fresh {
            (f64::from_bits(t.frame.load(Relaxed)), t.t_nanos.load(Relaxed), t.playing.load(Relaxed), t.scratch.load(Relaxed))
        } else {
            (k.local_frame, k.local_t, k.playing, false)
        };
        let mut p = frame / self.sr;
        if playing && !scratching {
            let now = self.audio.tele.nanos();
            p += (now.saturating_sub(at) as f64 / 1e9).min(0.1) * k.rate();
            let l = k.lp;
            if let (true, Some(i), Some(o)) = (l.active, l.lin, l.out) {
                if o > i && p >= o {
                    p = i + (p - i) % (o - i);
                }
            }
        }
        p.clamp(0.0, k.duration)
    }

    fn set_local(&mut self, d: usize, sec: f64) {
        let now = self.audio.tele.nanos();
        let k = &mut self.decks[d];
        k.local_frame = sec * self.sr;
        k.local_t = now;
    }

    pub fn emit(&mut self, d: usize, name: &'static str, arg: Option<f64>) {
        let k = &self.decks[d];
        let o = &self.decks[other(d)];
        let beat = if k.loaded() && k.bpm > 0.0 { Some(k.beat_at(self.position(d))) } else { None };
        let other_beat = if o.loaded() && o.bpm > 0.0 && o.playing { Some(o.beat_at(self.position(other(d)))) } else { None };
        self.events.push(Event { deck: k.name(), name, beat, other_beat, arg });
    }

    // ------------------------------------------------------------ chargement
    pub fn load(&mut self, d: usize, track: Map<String, Value>, data: Arc<Track>) {
        self.pause(d);
        let frames = data.len();
        self.send(d, Cmd::Load(d, data));
        let sr = self.sr;
        let k = &mut self.decks[d];
        k.version += 1;
        k.duration = frames as f64 / sr;
        k.wave = None;
        k.bpm = track.get("bpm").and_then(|v| v.as_f64()).unwrap_or(0.0);
        k.first_beat = track.get("firstBeat").and_then(|v| v.as_f64()).unwrap_or(0.0);
        k.fixed_grid = track.get("fixedGrid").and_then(|v| v.as_bool()).unwrap_or(false);
        k.grid_edited = false;
        k.track = Some(track);
        let key = k.meta_key();
        let saved = self.meta.get(&key).cloned();
        let k = &mut self.decks[d];
        k.cue_point = saved.as_ref().and_then(|m| m.get("cue")).and_then(|v| v.as_f64()).unwrap_or(k.first_beat);
        k.hotcues = [None; 8];
        if let Some(h) = saved.as_ref().and_then(|m| m.get("hotcues")).and_then(|v| v.as_array()) {
            for (i, v) in h.iter().take(8).enumerate() {
                k.hotcues[i] = v.as_f64();
            }
        }
        if let Some(b) = saved.as_ref().and_then(|m| m.get("bpm")).and_then(|v| v.as_f64()) {
            k.bpm = b;
            k.first_beat = saved.as_ref().and_then(|m| m.get("firstBeat")).and_then(|v| v.as_f64()).unwrap_or(0.0);
            k.grid_edited = true;
        }
        k.lp = Loop::default();
        k.sync = false;
        k.bend = 0.0;
        k.local_frame = 0.0;
        self.sync_track_fields(d);
        self.send_loop(d);
        self.send_rate(d);
        let cp = self.decks[d].cue_point;
        self.seek(d, cp);
        self.emit(d, "load", None);
        self.emit(d, "change", None);
    }

    /// recopie bpm / grille dans l'objet morceau (lu par l'interface)
    fn sync_track_fields(&mut self, d: usize) {
        let k = &mut self.decks[d];
        let (bpm, fb, ge) = (k.bpm, k.first_beat, k.grid_edited);
        if let Some(t) = k.track.as_mut() {
            t.insert("bpm".into(), if bpm > 0.0 { json!(bpm) } else { Value::Null });
            t.insert("firstBeat".into(), json!(fb));
            if ge {
                t.insert("gridEdited".into(), json!(true));
            }
        }
    }

    pub fn set_analysis(&mut self, d: usize, version: u64, wave: Wave, bpm: f64, first_beat: f64, key: Option<String>) {
        if self.decks[d].version != version || !self.decks[d].loaded() {
            return;
        }
        let k = &mut self.decks[d];
        k.wave = Some(Arc::new(wave));
        k.wave_version += 1;
        if !k.grid_edited && !k.fixed_grid && bpm > 0.0 {
            k.bpm = bpm;
            k.first_beat = first_beat;
        }
        if let (Some(t), Some(key)) = (k.track.as_mut(), key) {
            let has = t.get("key").map(|v| v.is_string()).unwrap_or(false);
            if !has {
                t.insert("key".into(), json!(key));
                t.insert("keyEstimated".into(), json!(true));
            }
        }
        let key = self.decks[d].meta_key();
        let has_cue = self.meta.get(&key).and_then(|m| m.get("cue")).is_some();
        let k = &self.decks[d];
        if k.cue_point == 0.0 && !has_cue && k.first_beat > 0.0 {
            let fb = k.first_beat;
            self.decks[d].cue_point = fb;
            if !self.decks[d].playing {
                self.seek(d, fb);
            }
        }
        self.sync_track_fields(d);
        self.send_rate(d);
        self.emit(d, "analysis", None);
        self.emit(d, "change", None);
    }

    pub fn unload(&mut self, d: usize) {
        self.pause(d);
        let k = &mut self.decks[d];
        k.track = None;
        k.wave = None;
        k.version += 1;
        k.bpm = 0.0;
        self.send(d, Cmd::Unload(d));
        self.emit(d, "load", None);
        self.emit(d, "change", None);
    }

    pub fn save_meta(&mut self, d: usize) {
        let k = &self.decks[d];
        if !k.loaded() {
            return;
        }
        let mut m = json!({ "cue": k.cue_point, "hotcues": k.hotcues.to_vec() });
        if k.grid_edited {
            m["bpm"] = json!(k.bpm);
            m["firstBeat"] = json!(k.first_beat);
        }
        let key = k.meta_key();
        self.meta.insert(key, m);
        store::save_meta(&self.meta);
    }

    // ------------------------------------------------------------ transport
    pub fn play(&mut self, d: usize) {
        if !self.decks[d].loaded() {
            return;
        }
        if self.decks[d].sync {
            self.align_phase(d);
        }
        let p = self.position(d);
        self.send(d, Cmd::Play(d));
        self.decks[d].playing = true;
        self.set_local(d, p);
        self.emit(d, "play", None);
        self.emit(d, "change", None);
    }
    pub fn pause(&mut self, d: usize) {
        let p = self.position(d);
        self.send(d, Cmd::Pause(d));
        self.set_local(d, p);
        self.decks[d].playing = false;
        self.emit(d, "pause", None);
        self.emit(d, "change", None);
    }
    pub fn toggle_play(&mut self, d: usize) {
        if self.decks[d].cue_held {
            self.decks[d].cue_play_from_hold = true;
            return;
        }
        if self.decks[d].playing {
            self.pause(d)
        } else {
            self.play(d)
        }
    }
    pub fn seek(&mut self, d: usize, sec: f64) {
        if !self.decks[d].loaded() {
            return;
        }
        let sec = sec.clamp(0.0, (self.decks[d].duration - 0.01).max(0.0));
        self.set_local(d, sec);
        let f = sec * self.sr;
        self.send(d, Cmd::Seek(d, f));
        self.emit(d, "seek", None);
    }

    // CUE façon CDJ : à l'arrêt -> pose le cue ici et le fait entendre tant qu'on maintient ;
    // en lecture -> revient au cue et s'arrête.
    pub fn cue_down(&mut self, d: usize) {
        if !self.decks[d].loaded() {
            return;
        }
        if self.decks[d].playing {
            self.pause(d);
            let c = self.decks[d].cue_point;
            self.seek(d, c);
            return;
        }
        let mut p = self.position(d);
        let k = &self.decks[d];
        if k.quantize && k.bpm > 0.0 {
            p = k.nearest_beat_sec(p);
        }
        if (p - k.cue_point).abs() > 0.005 {
            self.decks[d].cue_point = p;
            self.save_meta(d);
        }
        let c = self.decks[d].cue_point;
        self.seek(d, c);
        self.decks[d].cue_held = true;
        self.decks[d].cue_play_from_hold = false;
        self.send(d, Cmd::Play(d));
        self.decks[d].playing = true;
        self.set_local(d, c);
        self.emit(d, "cue", None);
        self.emit(d, "change", None);
    }
    pub fn cue_up(&mut self, d: usize) {
        if !self.decks[d].cue_held {
            return;
        }
        self.decks[d].cue_held = false;
        if self.decks[d].cue_play_from_hold {
            self.emit(d, "play", None);
            self.emit(d, "change", None);
            return;
        }
        self.pause(d);
        let c = self.decks[d].cue_point;
        self.seek(d, c);
        self.emit(d, "change", None);
    }
    fn quantized_pos(&self, d: usize) -> f64 {
        let p = self.position(d);
        let k = &self.decks[d];
        if k.quantize && k.bpm > 0.0 {
            k.nearest_beat_sec(p)
        } else {
            p
        }
    }
    pub fn set_cue_here(&mut self, d: usize) {
        if !self.decks[d].loaded() {
            return;
        }
        self.decks[d].cue_point = self.quantized_pos(d);
        self.save_meta(d);
        self.emit(d, "cue", None);
        self.emit(d, "change", None);
    }
    pub fn set_cue_point(&mut self, d: usize, sec: f64) {
        self.decks[d].cue_point = sec;
        self.save_meta(d);
        self.emit(d, "change", None);
    }

    // ------------------------------------------------------------ tempo
    fn send_rate(&mut self, d: usize) {
        let r = self.decks[d].rate().max(0.05);
        self.send(d, Cmd::Rate(d, r));
    }
    pub fn set_tempo(&mut self, d: usize, v: f64, from_sync: bool) {
        self.decks[d].tempo = v.clamp(-1.0, 1.0);
        if !from_sync && self.decks[d].sync {
            self.decks[d].sync = false;
        }
        self.send_rate(d);
        self.emit(d, "change", None);
        // les platines en SYNC suivent l'autre
        let o = other(d);
        if self.decks[o].sync {
            self.match_tempo(o);
        }
        self.update_fx();
    }
    pub fn set_range(&mut self, d: usize, r: f64) {
        let bpm = self.decks[d].eff_bpm();
        let k = &mut self.decks[d];
        k.range = r;
        if k.bpm > 0.0 {
            k.tempo = ((bpm / k.bpm - 1.0) * 100.0 / r).clamp(-1.0, 1.0);
        }
        self.send_rate(d);
        self.emit(d, "change", None);
    }
    pub fn set_range_raw(&mut self, d: usize, r: f64) {
        self.decks[d].range = r;
        self.send_rate(d);
        self.emit(d, "change", None);
    }
    pub fn set_bend(&mut self, d: usize, b: f64) {
        self.decks[d].bend = b;
        self.send_rate(d);
    }
    pub fn set_keylock(&mut self, d: usize, on: bool) {
        self.decks[d].keylock = on;
        self.send(d, Cmd::Keylock(d, on));
        self.emit(d, "change", None);
    }

    // ------------------------------------------------------------ sync
    pub fn match_tempo(&mut self, d: usize) -> bool {
        let o = &self.decks[other(d)];
        let k = &self.decks[d];
        if !o.loaded() || o.bpm <= 0.0 || k.bpm <= 0.0 {
            return false;
        }
        let mut target = o.eff_bpm();
        // demi / double tempo si c'est plus proche (ex. 87 <-> 174)
        for c in [target * 2.0, target / 2.0] {
            if (c - k.bpm).abs() < (target - k.bpm).abs() {
                target = c;
            }
        }
        let need = (target / k.bpm - 1.0) * 100.0;
        let mut range = k.range;
        if need.abs() > range {
            match TEMPO_RANGES.iter().find(|&&x| x >= need.abs()) {
                Some(&r) => range = r,
                None => return false,
            }
        }
        let t = (need / range).clamp(-1.0, 1.0);
        let k = &mut self.decks[d];
        k.range = range;
        if (t - k.tempo).abs() > 1e-7 {
            k.tempo = t;
            self.send_rate(d);
            self.emit(d, "change", None);
        }
        true
    }
    pub fn align_phase(&mut self, d: usize) {
        let o = other(d);
        let (ko, k) = (&self.decks[o], &self.decks[d]);
        if !ko.loaded() || !ko.playing || k.bpm <= 0.0 || ko.bpm <= 0.0 {
            return;
        }
        let ratio = k.eff_bpm() / ko.eff_bpm();
        let mult = if ratio > 1.5 { 2.0 } else if ratio < 0.67 { 0.5 } else { 1.0 };
        let o_phase = (ko.beat_at(self.position(o)) * mult).rem_euclid(1.0);
        let b = k.beat_at(self.position(d));
        let mut diff = o_phase - b.rem_euclid(1.0);
        if diff > 0.5 {
            diff -= 1.0;
        }
        if diff < -0.5 {
            diff += 1.0;
        }
        let s = k.sec_at_beat(b + diff);
        self.seek(d, s);
    }
    pub fn set_sync(&mut self, d: usize, on: bool) -> bool {
        if on {
            if !self.match_tempo(d) {
                self.decks[d].sync = false;
                self.emit(d, "change", None);
                return false;
            }
            self.decks[d].sync = true;
            if self.decks[d].playing {
                self.align_phase(d);
            }
        } else {
            self.decks[d].sync = false;
        }
        self.emit(d, "change", None);
        self.decks[d].sync
    }

    // ------------------------------------------------------------ hot cues
    pub fn hotcue(&mut self, d: usize, i: usize) {
        if !self.decks[d].loaded() || i > 7 {
            return;
        }
        let Some(h) = self.decks[d].hotcues[i] else {
            self.decks[d].hotcues[i] = Some(self.quantized_pos(d));
            self.save_meta(d);
            self.emit(d, "change", None);
            return;
        };
        let mut target = h;
        let k = &self.decks[d];
        if k.playing && k.quantize && k.bpm > 0.0 {
            let b = k.beat_at(self.position(d));
            target += b.rem_euclid(1.0) * k.beat_len();
            if target - h > k.beat_len() / 2.0 {
                target -= k.beat_len();
            }
        }
        self.seek(d, target);
        if !self.decks[d].playing {
            self.play(d);
        }
        self.emit(d, "hotcue", Some(i as f64));
        self.emit(d, "change", None);
    }
    pub fn delete_hotcue(&mut self, d: usize, i: usize) {
        if i < 8 {
            self.decks[d].hotcues[i] = None;
            self.save_meta(d);
            self.emit(d, "change", None);
        }
    }
    pub fn clear_hotcues(&mut self, d: usize) {
        self.decks[d].hotcues = [None; 8];
        self.save_meta(d);
        self.emit(d, "change", None);
    }

    // ------------------------------------------------------------ boucles
    fn send_loop(&mut self, d: usize) {
        let l = self.decks[d].lp;
        let sr = self.sr;
        let active = l.active && l.lin.is_some() && l.out.unwrap_or(0.0) > l.lin.unwrap_or(0.0);
        let r = LoopRegion { start: l.lin.unwrap_or(0.0) * sr, end: l.out.unwrap_or(0.0) * sr, active };
        self.send(d, Cmd::Loop(d, r));
    }
    pub fn loop_in(&mut self, d: usize) {
        if !self.decks[d].loaded() {
            return;
        }
        let p = self.quantized_pos(d);
        self.decks[d].lp = Loop { lin: Some(p), out: None, active: false, beats: None };
        self.send_loop(d);
        self.emit(d, "loopin", None);
        self.emit(d, "change", None);
    }
    pub fn loop_out(&mut self, d: usize) {
        if !self.decks[d].loaded() || self.decks[d].lp.lin.is_none() {
            return;
        }
        let mut p = self.quantized_pos(d);
        let k = &mut self.decks[d];
        let lin = k.lp.lin.unwrap();
        if p <= lin {
            p = lin + k.beat_len();
        }
        k.lp.out = Some(p);
        k.lp.active = true;
        k.lp.beats = if k.bpm > 0.0 { Some(((p - lin) / k.beat_len() * 100.0).round() / 100.0) } else { None };
        self.send_loop(d);
        self.emit(d, "change", None);
    }
    pub fn auto_loop(&mut self, d: usize, beats: f64) {
        if !self.decks[d].loaded() || self.decks[d].bpm <= 0.0 {
            return;
        }
        if self.decks[d].lp.active && self.decks[d].lp.beats == Some(beats) {
            return self.exit_loop(d);
        }
        let mut start = self.position(d);
        let k = &mut self.decks[d];
        if k.quantize {
            start = k.sec_at_beat((k.beat_at(start) + 0.02).floor());
        }
        k.lp = Loop { lin: Some(start), out: Some(start + beats * k.beat_len()), active: true, beats: Some(beats) };
        self.send_loop(d);
        self.emit(d, "change", None);
    }
    pub fn resize_loop(&mut self, d: usize, f: f64) {
        let l = self.decks[d].lp;
        let (Some(i), Some(o)) = (l.lin, l.out) else { return };
        let len = (o - i) * f;
        if len < 0.01 {
            return;
        }
        self.decks[d].lp.out = Some(i + len);
        self.decks[d].lp.beats = l.beats.map(|b| b * f);
        let p = self.position(d);
        if p > i + len {
            self.seek(d, i + (p - i) % len);
        }
        self.send_loop(d);
        self.emit(d, "change", None);
    }
    pub fn exit_loop(&mut self, d: usize) {
        self.decks[d].lp.active = false;
        self.send_loop(d);
        self.emit(d, "change", None);
    }
    pub fn reloop(&mut self, d: usize) {
        let l = self.decks[d].lp;
        let (Some(i), Some(_)) = (l.lin, l.out) else { return };
        self.decks[d].lp.active = true;
        self.send_loop(d);
        self.seek(d, i);
        if !self.decks[d].playing {
            self.play(d);
        }
        self.emit(d, "change", None);
    }
    pub fn toggle_loop(&mut self, d: usize) {
        if self.decks[d].lp.active {
            self.exit_loop(d)
        } else {
            self.reloop(d)
        }
    }
    pub fn beat_jump(&mut self, d: usize, beats: f64) {
        if !self.decks[d].loaded() {
            return;
        }
        let bl = self.decks[d].beat_len();
        let p = self.position(d);
        self.seek(d, p + beats * bl);
        if self.decks[d].lp.active {
            let l = &mut self.decks[d].lp;
            l.lin = l.lin.map(|x| x + beats * bl);
            l.out = l.out.map(|x| x + beats * bl);
            self.send_loop(d);
        }
    }

    // ------------------------------------------------------------ jog
    pub fn scratch_start(&mut self, d: usize) {
        self.decks[d].scratch_pos = self.position(d);
        self.decks[d].scratching = true;
        self.send(d, Cmd::Scratch(d, true, None));
    }
    pub fn scratch_move(&mut self, d: usize, dsec: f64) {
        let k = &mut self.decks[d];
        k.scratch_pos = (k.scratch_pos + dsec).clamp(0.0, k.duration);
        let t = k.scratch_pos * self.sr;
        self.send(d, Cmd::Scratch(d, true, Some(t)));
    }
    pub fn scratch_end(&mut self, d: usize) {
        self.decks[d].scratching = false;
        self.send(d, Cmd::Scratch(d, false, None));
    }

    // ------------------------------------------------------------ grille éditable
    pub fn set_grid(&mut self, d: usize, bpm: Option<f64>, first_beat: Option<f64>) {
        if !self.decks[d].loaded() {
            return;
        }
        let k = &mut self.decks[d];
        if let Some(b) = bpm.filter(|b| *b > 0.0) {
            k.bpm = (b * 100.0).round() / 100.0;
        }
        if let Some(f) = first_beat {
            k.first_beat = f;
        }
        k.grid_edited = true;
        self.sync_track_fields(d);
        self.save_meta(d);
        self.send_rate(d);
        self.emit(d, "change", None);
        self.emit(d, "grid", None);
    }
    /// « ce temps est le 1 »
    pub fn set_downbeat_here(&mut self, d: usize) {
        if self.decks[d].bpm <= 0.0 {
            return;
        }
        let p = self.position(d);
        let k = &self.decks[d];
        let s = k.sec_at_beat(k.beat_at(p).round());
        let l = k.beat_len();
        let fb = s - (s / (4.0 * l)).floor() * 4.0 * l;
        let bpm = k.bpm;
        self.set_grid(d, Some(bpm), Some(fb));
    }
    pub fn shift_grid(&mut self, d: usize, ms: f64) {
        if self.decks[d].bpm <= 0.0 {
            return;
        }
        let (b, f) = (self.decks[d].bpm, self.decks[d].first_beat);
        self.set_grid(d, Some(b), Some(f + ms / 1000.0));
    }

    // ------------------------------------------------------------ table
    pub fn set_mix(&mut self, v: Value) {
        let num = |v: &Value, k: &str, def: f64| v.get(k).and_then(|x| x.as_f64()).unwrap_or(def);
        let mut p = self.mix;
        for (i, n) in ["A", "B"].iter().enumerate() {
            let c = &v[*n];
            if c.is_null() {
                continue;
            }
            let ch = &mut p.ch[i];
            ch.trim = num(c, "trim", 0.0);
            ch.hi = num(c, "hi", 0.0);
            ch.mid = num(c, "mid", 0.0);
            ch.low = num(c, "low", 0.0);
            ch.filter = num(c, "filter", 0.0);
            ch.fader = num(c, "fader", 0.0);
            ch.cue = c.get("cue").and_then(|x| x.as_bool()).unwrap_or(false);
            ch.xf = match c.get("xf").and_then(|x| x.as_str()).unwrap_or(n) {
                "THRU" => XfAssign::THRU,
                "B" => XfAssign::B,
                _ => XfAssign::A,
            };
        }
        p.xfader = num(&v, "xfader", 0.0);
        p.xf_cut = v.get("xfCurve").and_then(|x| x.as_str()) == Some("cut");
        p.master = num(&v, "master", 0.8);
        p.phones_mix = num(&v, "phonesMix", 0.0);
        p.phones_level = num(&v, "phonesLevel", 0.8);
        p.limiter = v.get("limiter").and_then(|x| x.as_bool()).unwrap_or(true);
        let fx = &v["fx"];
        p.fx_type = match fx.get("type").and_then(|x| x.as_str()).unwrap_or("echo") {
            "reverb" => 1,
            "flanger" => 2,
            _ => 0,
        };
        p.fx_on = fx.get("on").and_then(|x| x.as_bool()).unwrap_or(false);
        p.fx_channel = match fx.get("channel").and_then(|x| x.as_str()).unwrap_or("A") {
            "B" => 1,
            "M" => 2,
            _ => 0,
        };
        p.fx_level = num(fx, "level", 0.5);
        self.fx_beat = num(fx, "beat", 1.0);
        self.mix = p;
        self.mix_json = v;
        self.update_fx_force();
    }

    pub fn set_phones_mode(&mut self, mode: &str) {
        self.phones_mode = mode.into();
        self.mix.phones = match mode {
            "split" => PhonesMode::Split,
            "device" => PhonesMode::Device,
            _ => PhonesMode::Off,
        };
        self.update_fx_force();
    }

    pub fn audible(&self, d: usize) -> f64 {
        let c = &self.mix.ch[d];
        core::fader_gain(c.fader) * core::xf_gain(&self.mix, d) * crate::audio::dsp::db_to_gain(c.trim * 12.0)
    }
    /// la platine « qu'on entend le plus »
    pub fn master_deck(&self) -> Option<usize> {
        let mut best = None;
        let mut bv = -1.0;
        for d in 0..2 {
            if !self.decks[d].loaded() {
                continue;
            }
            let v = (if self.decks[d].playing { 1.0 } else { 0.01 }) * self.audible(d);
            if v > bv {
                bv = v;
                best = Some(d);
            }
        }
        best
    }
    pub fn fx_bpm(&self) -> f64 {
        let d = match self.mix.fx_channel {
            2 => self.master_deck(),
            c => Some(c as usize),
        };
        match d {
            Some(d) if self.decks[d].loaded() && self.decks[d].bpm > 0.0 => self.decks[d].eff_bpm(),
            _ => 128.0,
        }
    }
    fn update_fx_force(&mut self) {
        self.last_fx_sec = -1.0;
        self.update_fx();
    }
    pub fn update_fx(&mut self) {
        let sec = (self.fx_beat * 60.0 / self.fx_bpm()).min(7.9);
        if (sec - self.last_fx_sec).abs() < 1e-6 {
            return;
        }
        self.last_fx_sec = sec;
        self.mix.fx_sec = sec;
        self.audio.tx.send(Cmd::Mix(self.mix));
    }

    /// appelé régulièrement par le fil d'affichage
    pub fn tick(&mut self, sync_step: bool) {
        let ack = self.audio.tele.ack.load(Relaxed);
        for d in 0..2 {
            let t = &self.audio.tele.decks[d];
            let ended = t.ended.load(Relaxed);
            if ack >= self.decks[d].last_seq && !self.decks[d].cue_held {
                let p = t.playing.load(Relaxed);
                if p != self.decks[d].playing {
                    self.decks[d].playing = p;
                    self.emit(d, "change", None);
                }
            }
            if ended != self.decks[d].last_ended {
                self.decks[d].last_ended = ended;
                self.decks[d].playing = false;
                self.emit(d, "change", None);
                self.emit(d, "ended", None);
            }
        }
        if sync_step {
            for d in 0..2 {
                if self.decks[d].sync && self.decks[other(d)].loaded() {
                    self.match_tempo(d);
                }
            }
        }
        if self.mix.fx_on {
            self.update_fx();
        }
        self.audio.collect_garbage();
    }

    pub fn reset_deck_state(&mut self, d: usize) {
        self.pause(d);
        self.set_sync(d, false);
        self.set_keylock(d, false);
        self.decks[d].quantize = true;
        self.exit_loop(d);
        self.set_bend(d, 0.0);
        self.decks[d].range = 10.0;
        self.set_tempo(d, 0.0, true);
    }
}

// ------------------------------------------------------------ instantané pour l'interface
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeckSnap {
    pub loaded: bool,
    pub track: Option<Map<String, Value>>,
    pub version: u64,
    pub duration: f64,
    pub playing: bool,
    pub scratching: bool,
    pub pos: f64,
    pub rate: f64,
    pub tempo: f64,
    pub range: f64,
    pub bend: f64,
    pub keylock: bool,
    pub quantize: bool,
    pub sync: bool,
    pub cue_point: f64,
    pub hotcues: Vec<Option<f64>>,
    #[serde(rename = "loop")]
    pub lp: Loop,
    pub cue_held: bool,
    pub bpm: f64,
    pub first_beat: f64,
    pub wave_version: u64,
    pub rev: u64,
}

static REV: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[derive(Serialize)]
pub struct Level {
    pub peak: f64,
    pub rms: f64,
}

#[derive(Serialize)]
pub struct Snapshot {
    pub decks: [DeckSnap; 2],
    pub levels: HashMap<&'static str, Level>,
    pub events: Vec<Event>,
    pub rec: Option<f64>,
    pub sr: f64,
}

impl Engine {
    pub fn deck_snap(&self, d: usize) -> DeckSnap {
        let k = &self.decks[d];
        DeckSnap {
            loaded: k.loaded(),
            track: k.track.clone(),
            version: k.version,
            duration: k.duration,
            playing: k.playing,
            scratching: k.scratching,
            pos: self.position(d),
            rate: k.rate(),
            tempo: k.tempo,
            range: k.range,
            bend: k.bend,
            keylock: k.keylock,
            quantize: k.quantize,
            sync: k.sync,
            cue_point: k.cue_point,
            hotcues: k.hotcues.to_vec(),
            lp: k.lp,
            cue_held: k.cue_held,
            bpm: k.bpm,
            first_beat: k.first_beat,
            wave_version: k.wave_version,
            rev: REV.fetch_add(1, Relaxed),
        }
    }
    pub fn snapshot(&mut self, levels: [f64; 4]) -> Snapshot {
        let lv = |g: f64| {
            let db = crate::audio::dsp::gain_to_db(g);
            Level { peak: db, rms: db }
        };
        let mut l = HashMap::new();
        l.insert("A", lv(levels[0]));
        l.insert("B", lv(levels[1]));
        l.insert("L", lv(levels[2]));
        l.insert("R", lv(levels[3]));
        Snapshot {
            decks: [self.deck_snap(0), self.deck_snap(1)],
            levels: l,
            events: std::mem::take(&mut self.events),
            rec: self.rec.as_ref().map(|r| r.started.elapsed().as_secs_f64()),
            sr: self.sr,
        }
    }
}
