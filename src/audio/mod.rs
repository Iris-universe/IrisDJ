// Sorties audio (cpal / WASAPI) et canal de commandes vers le fil audio.
pub mod core;
pub mod dsp;
pub mod player;
pub mod wsola;

use self::core::{Cmd, Core, Garbage, Msg, Telemetry};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};

/// Envoi de commandes au fil audio (numérotées : la télémétrie dit lesquelles ont été appliquées).
pub struct CmdTx {
    inner: Mutex<(rtrb::Producer<Msg>, u64)>,
}
impl CmdTx {
    pub fn send(&self, cmd: Cmd) -> u64 {
        let mut g = self.inner.lock().unwrap();
        g.1 += 1;
        let seq = g.1;
        let mut m = Msg { seq, cmd };
        // file pleine (fil audio arrêté ?) : on réessaie un court instant
        for _ in 0..200 {
            match g.0.push(m) {
                Ok(()) => return seq,
                Err(rtrb::PushError::Full(back)) => {
                    m = back;
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            }
        }
        seq
    }
}

enum HostMsg {
    Master(String, mpsc::Sender<Result<(), String>>),
    Phones(Option<String>, mpsc::Sender<Result<(), String>>),
}

pub struct Audio {
    pub sr: f64,
    pub tx: Arc<CmdTx>,
    pub tele: Arc<Telemetry>,
    pub garbage: Mutex<rtrb::Consumer<Garbage>>,
    host: mpsc::Sender<HostMsg>,
}

pub fn list_outputs() -> Vec<String> {
    let host = cpal::default_host();
    let mut v = vec![];
    if let Ok(devs) = host.output_devices() {
        for d in devs {
            if let Ok(n) = d.name() {
                if !v.contains(&n) {
                    v.push(n);
                }
            }
        }
    }
    v
}

fn find_device(name: &str) -> Option<cpal::Device> {
    let host = cpal::default_host();
    if name.is_empty() {
        return host.default_output_device();
    }
    host.output_devices().ok()?.find(|d| d.name().map(|n| n == name).unwrap_or(false)).or_else(|| host.default_output_device())
}

/// Rééchantillonnage linéaire d'un flux (quand la carte son n'a pas la fréquence du moteur).
struct Resamp {
    ratio: f64, // images source par image de sortie
    pos: f64,
    fifo: Vec<[f32; 2]>,
    chunk: Vec<[f32; 2]>,
}
impl Resamp {
    fn new(ratio: f64) -> Self {
        Resamp { ratio, pos: 0.0, fifo: Vec::with_capacity(8192), chunk: vec![[0.0; 2]; 64] }
    }
    fn pull(&mut self, out: &mut [[f32; 2]], src: &mut dyn FnMut(&mut [[f32; 2]])) {
        for o in out.iter_mut() {
            let i = self.pos as usize;
            while i + 1 >= self.fifo.len() {
                src(&mut self.chunk);
                self.fifo.extend_from_slice(&self.chunk);
            }
            let f = (self.pos - i as f64) as f32;
            let (a, b) = (self.fifo[i], self.fifo[i + 1]);
            *o = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
            self.pos += self.ratio;
        }
        let k = (self.pos as usize).min(self.fifo.len());
        self.fifo.drain(..k);
        self.pos -= k as f64;
    }
}

fn write_out<T: cpal::SizedSample + cpal::FromSample<f32>>(data: &mut [T], ch: usize, frames: &[[f32; 2]]) {
    for (i, f) in frames.iter().enumerate() {
        let base = i * ch;
        if ch == 1 {
            data[base] = T::from_sample((f[0] + f[1]) * 0.5);
        } else {
            data[base] = T::from_sample(f[0]);
            data[base + 1] = T::from_sample(f[1]);
            for c in 2..ch {
                data[base + c] = T::from_sample(0.0);
            }
        }
    }
}

fn build_stream(
    dev: &cpal::Device,
    engine_sr: f64,
    src: Box<dyn FnMut(&mut [[f32; 2]]) + Send>,
) -> Result<cpal::Stream, String> {
    let cfg = dev.default_output_config().map_err(|e| e.to_string())?;
    let fmt = cfg.sample_format();
    let ch = cfg.channels() as usize;
    let dev_sr = cfg.sample_rate().0 as f64;
    let mut sc: cpal::StreamConfig = cfg.into();
    // tampon court : la latence compte pour caler
    sc.buffer_size = cpal::BufferSize::Default;
    struct Filler {
        same: bool,
        rs: Resamp,
        tmp: Vec<[f32; 2]>,
        src: Box<dyn FnMut(&mut [[f32; 2]]) + Send>,
    }
    impl Filler {
        fn fill(&mut self, frames: usize) -> &[[f32; 2]] {
            if self.tmp.len() < frames {
                self.tmp.resize(frames, [0.0; 2]);
            }
            if self.same {
                (self.src)(&mut self.tmp[..frames]);
            } else {
                self.rs.pull(&mut self.tmp[..frames], &mut *self.src);
            }
            &self.tmp[..frames]
        }
    }
    let mut fl = Filler { same: (dev_sr - engine_sr).abs() < 0.5, rs: Resamp::new(engine_sr / dev_sr), tmp: vec![[0.0; 2]; 8192], src };
    let err = |e| eprintln!("[audio] {e}");
    let stream = match fmt {
        cpal::SampleFormat::F32 => dev.build_output_stream(
            &sc,
            move |d: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let n = d.len() / ch;
                write_out(d, ch, fl.fill(n));
            },
            err,
            None,
        ),
        cpal::SampleFormat::I16 => dev.build_output_stream(
            &sc,
            move |d: &mut [i16], _: &cpal::OutputCallbackInfo| {
                let n = d.len() / ch;
                write_out(d, ch, fl.fill(n));
            },
            err,
            None,
        ),
        cpal::SampleFormat::I32 => dev.build_output_stream(
            &sc,
            move |d: &mut [i32], _: &cpal::OutputCallbackInfo| {
                let n = d.len() / ch;
                write_out(d, ch, fl.fill(n));
            },
            err,
            None,
        ),
        other => return Err(format!("format de sortie non géré : {other:?}")),
    }
    .map_err(|e| e.to_string())?;
    stream.play().map_err(|e| e.to_string())?;
    Ok(stream)
}

impl Audio {
    pub fn start() -> Result<Audio, String> {
        let dev = cpal::default_host().default_output_device().ok_or("aucune sortie audio")?;
        let sr = dev.default_output_config().map(|c| c.sample_rate().0 as f64).unwrap_or(48000.0);
        let (prod, cons) = rtrb::RingBuffer::<Msg>::new(4096);
        let (gprod, gcons) = rtrb::RingBuffer::<Garbage>::new(256);
        let tele = Arc::new(Telemetry::new());
        let core = Arc::new(Mutex::new(Core::new(sr, cons, gprod, tele.clone())));
        let tx = Arc::new(CmdTx { inner: Mutex::new((prod, 0)) });
        let (htx, hrx) = mpsc::channel::<HostMsg>();

        // fil qui possède les flux cpal (ils ne peuvent pas changer de fil)
        let tx2 = tx.clone();
        let (ready_tx, ready_rx) = mpsc::channel();
        std::thread::Builder::new()
            .name("audio-host".into())
            .spawn(move || {
                let open_master = |name: &str| -> Result<cpal::Stream, String> {
                    let dev = find_device(name).ok_or("sortie introuvable")?;
                    let c = core.clone();
                    build_stream(&dev, sr, Box::new(move |buf| c.lock().unwrap().render(buf)))
                };
                let mut master = match open_master("") {
                    Ok(s) => Some(s),
                    Err(e) => {
                        let _ = ready_tx.send(Err(e));
                        return;
                    }
                };
                let _ = ready_tx.send(Ok(()));
                let mut phones: Option<cpal::Stream> = None;
                while let Ok(m) = hrx.recv() {
                    match m {
                        HostMsg::Master(name, reply) => {
                            drop(master.take());
                            match open_master(&name) {
                                Ok(s) => {
                                    master = Some(s);
                                    let _ = reply.send(Ok(()));
                                }
                                Err(e) => {
                                    master = open_master("").ok();
                                    let _ = reply.send(Err(e));
                                }
                            }
                        }
                        HostMsg::Phones(name, reply) => {
                            drop(phones.take());
                            tx2.send(Cmd::PhonesOut(None));
                            let Some(name) = name else {
                                let _ = reply.send(Ok(()));
                                continue;
                            };
                            let r = (|| {
                                let dev = find_device(&name).ok_or("sortie introuvable")?;
                                let (p, mut c) = rtrb::RingBuffer::<f32>::new((sr as usize) * 2);
                                let lat = (sr * 0.06) as usize * 2; // ≈ 60 ms max dans le tampon
                                let s = build_stream(
                                    &dev,
                                    sr,
                                    Box::new(move |buf| {
                                        while c.slots() > lat * 2 {
                                            let _ = c.pop();
                                        }
                                        for f in buf.iter_mut() {
                                            if c.slots() >= 2 {
                                                *f = [c.pop().unwrap_or(0.0), c.pop().unwrap_or(0.0)];
                                            } else {
                                                *f = [0.0; 2];
                                            }
                                        }
                                    }),
                                )?;
                                tx2.send(Cmd::PhonesOut(Some(p)));
                                Ok::<_, String>(s)
                            })();
                            match r {
                                Ok(s) => {
                                    phones = Some(s);
                                    let _ = reply.send(Ok(()));
                                }
                                Err(e) => {
                                    let _ = reply.send(Err(e));
                                }
                            }
                        }
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        ready_rx.recv().map_err(|e| e.to_string())??;
        Ok(Audio { sr, tx, tele, garbage: Mutex::new(gcons), host: htx })
    }

    pub fn set_master(&self, name: &str) -> Result<(), String> {
        let (t, r) = mpsc::channel();
        self.host.send(HostMsg::Master(name.to_string(), t)).map_err(|e| e.to_string())?;
        r.recv().map_err(|e| e.to_string())?
    }
    pub fn set_phones(&self, name: Option<String>) -> Result<(), String> {
        let (t, r) = mpsc::channel();
        self.host.send(HostMsg::Phones(name, t)).map_err(|e| e.to_string())?;
        r.recv().map_err(|e| e.to_string())?
    }
    /// libère (hors fil audio) ce que le fil audio a rendu
    pub fn collect_garbage(&self) {
        if let Ok(mut g) = self.garbage.try_lock() {
            while let Ok(x) = g.pop() {
                drop(x);
            }
        }
    }
}
