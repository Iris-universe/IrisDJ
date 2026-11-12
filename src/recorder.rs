// Enregistrement du mix (sortie master) en WAV 24 bits dans Musique\IrisDJ.
use crate::audio::core::Cmd;
use crate::audio::CmdTx;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

pub struct Recorder {
    pub started: Instant,
    stop: Arc<AtomicBool>,
    handle: Option<std::thread::JoinHandle<Result<PathBuf, String>>>,
}

impl Recorder {
    pub fn start(tx: &CmdTx, sr: f64) -> Result<Recorder, String> {
        let dir = crate::store::music_dir();
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let name = chrono::Local::now().format("mix-%Y-%m-%d_%Hh%M-%S.wav").to_string();
        let path = dir.join(name);
        let spec = hound::WavSpec { channels: 2, sample_rate: sr as u32, bits_per_sample: 24, sample_format: hound::SampleFormat::Int };
        let mut w = hound::WavWriter::create(&path, spec).map_err(|e| e.to_string())?;
        let (p, mut c) = rtrb::RingBuffer::<f32>::new((sr as usize) * 2 * 4);
        let stop = Arc::new(AtomicBool::new(false));
        let st = stop.clone();
        let handle = std::thread::spawn(move || {
            let scale = 8_388_607.0f32;
            loop {
                let done = st.load(Ordering::Relaxed);
                let n = c.slots();
                if n > 0 {
                    if let Ok(chunk) = c.read_chunk(n) {
                        for v in chunk {
                            w.write_sample((v.clamp(-1.0, 1.0) * scale) as i32).map_err(|e| e.to_string())?;
                        }
                    }
                } else if done {
                    break;
                } else {
                    std::thread::sleep(std::time::Duration::from_millis(20));
                }
            }
            w.finalize().map_err(|e| e.to_string())?;
            Ok(path)
        });
        tx.send(Cmd::Rec(Some(p)));
        Ok(Recorder { started: Instant::now(), stop, handle: Some(handle) })
    }

    pub fn finish(mut self, tx: &CmdTx) -> Result<PathBuf, String> {
        tx.send(Cmd::Rec(None));
        std::thread::sleep(std::time::Duration::from_millis(60));
        self.stop.store(true, Ordering::Relaxed);
        self.handle.take().unwrap().join().map_err(|_| "enregistrement interrompu".to_string())?
    }
}
