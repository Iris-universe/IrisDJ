// IrisDJ — table de mix virtuelle pour apprendre à mixer. Moteur en Rust, interface HTML (WebView2).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod analysis;
mod audio;
mod decode;
mod engine;
mod irislink;
mod migrate;
mod recorder;
mod sources;
mod store;
mod synth;

use audio::player::Track;
use engine::{Engine, Snapshot};
use serde_json::{json, Map, Value};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::ipc::{Channel, InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct St {
    pub engine: Arc<Mutex<Engine>>,
    pub chan: Arc<Mutex<Option<Channel<Snapshot>>>>,
}

fn deck_idx(d: &str) -> Result<usize, String> {
    match d {
        "A" => Ok(0),
        "B" => Ok(1),
        _ => Err("platine A ou B".into()),
    }
}
fn toast(app: &AppHandle, msg: &str) {
    let _ = app.emit_to("main", "toast", msg);
}

// ------------------------------------------------------------ état temps réel
#[tauri::command]
fn subscribe(st: State<St>, channel: Channel<Snapshot>) {
    *st.chan.lock().unwrap() = Some(channel);
}

/// actions sur une platine ; renvoie l'état de la platine (et `ok` pour sync)
#[tauri::command]
fn deck(st: State<St>, d: String, cmd: String, v: Option<f64>, w: Option<f64>) -> Result<Value, String> {
    let i = deck_idx(&d)?;
    let mut e = st.engine.lock().unwrap();
    let n = v.unwrap_or(0.0);
    let mut ok = true;
    match cmd.as_str() {
        "play" => e.play(i),
        "pause" => e.pause(i),
        "togglePlay" => e.toggle_play(i),
        "seek" => e.seek(i, n),
        "cueDown" => e.cue_down(i),
        "cueUp" => e.cue_up(i),
        "setCueHere" => e.set_cue_here(i),
        "setCuePoint" => e.set_cue_point(i, n),
        "setTempo" => e.set_tempo(i, n, w.unwrap_or(0.0) > 0.0),
        "setRange" => e.set_range(i, n),
        "setRangeRaw" => e.set_range_raw(i, n),
        "setBend" => e.set_bend(i, n),
        "setKeylock" => e.set_keylock(i, n > 0.0),
        "setQuantize" => {
            e.decks[i].quantize = n > 0.0;
            e.emit(i, "change", None);
        }
        "setSync" => ok = e.set_sync(i, n > 0.0),
        "matchTempo" => ok = e.match_tempo(i),
        "alignPhase" => e.align_phase(i),
        "hotcue" => e.hotcue(i, n as usize),
        "deleteHotcue" => e.delete_hotcue(i, n as usize),
        "clearHotcues" => e.clear_hotcues(i),
        "loopIn" => e.loop_in(i),
        "loopOut" => e.loop_out(i),
        "autoLoop" => e.auto_loop(i, n),
        "resizeLoop" => e.resize_loop(i, n),
        "exitLoop" => e.exit_loop(i),
        "reloop" => e.reloop(i),
        "toggleLoop" => e.toggle_loop(i),
        "beatJump" => e.beat_jump(i, n),
        "scratchStart" => e.scratch_start(i),
        "scratchMove" => e.scratch_move(i, n),
        "scratchEnd" => e.scratch_end(i),
        "setGrid" => e.set_grid(i, v, w),
        "setDownbeatHere" => e.set_downbeat_here(i),
        "shiftGrid" => e.shift_grid(i, n),
        "unload" => e.unload(i),
        "resetState" => e.reset_deck_state(i),
        c => return Err(format!("action inconnue : {c}")),
    }
    let snap = e.deck_snap(i);
    Ok(json!({ "ok": ok, "deck": snap }))
}

#[tauri::command]
fn set_mix(st: State<St>, mix: Value) {
    st.engine.lock().unwrap().set_mix(mix);
}

#[tauri::command]
fn get_wave(st: State<St>, d: String) -> Result<Response, String> {
    let i = deck_idx(&d)?;
    let w = st.engine.lock().unwrap().decks[i].wave.clone().ok_or("pas de forme d'onde")?;
    let n = w.low.len() as u32;
    let mut b = Vec::with_capacity(8 + 3 * n as usize);
    b.extend_from_slice(&n.to_le_bytes());
    b.extend_from_slice(&(w.pps as u32).to_le_bytes());
    b.extend_from_slice(&w.low);
    b.extend_from_slice(&w.mid);
    b.extend_from_slice(&w.high);
    Ok(Response::new(b))
}

// ------------------------------------------------------------ chargement des morceaux
fn finish_load(app: &AppHandle, d: usize, mut track: Map<String, Value>, pcm: decode::Pcm) -> Result<Value, String> {
    let st = app.state::<St>();
    let sr = st.engine.lock().unwrap().sr;
    let pcm = decode::resample(pcm, sr);
    let dur = pcm.l.len() as f64 / sr;
    if dur > decode::MAX_MIN * 60.0 {
        return Err(format!("Morceau trop long ({} min) : c'est sûrement un mix entier. Choisis un morceau seul.", (dur / 60.0).round()));
    }
    if dur < 1.0 {
        return Err("Morceau vide ou illisible.".into());
    }
    if track.get("source").and_then(|s| s.as_str()) == Some("practice") {
        track.insert("fixedGrid".into(), json!(true));
        track.insert("firstBeat".into(), json!(0));
    }
    let data = Arc::new(Track { l: pcm.l, r: pcm.r });
    let version = {
        let mut e = st.engine.lock().unwrap();
        e.load(d, track, data.clone());
        e.decks[d].version
    };
    // analyse en arrière-plan : forme d'onde, BPM + grille, tonalité
    let eng = st.engine.clone();
    std::thread::spawn(move || {
        let r = analysis::analyse(&data.l, &data.r, sr);
        drop(data);
        eng.lock().unwrap().set_analysis(d, version, r.wave, r.bpm, r.first_beat, r.key);
    });
    Ok(json!({ "ok": true }))
}

#[tauri::command]
async fn load_track(app: AppHandle, d: String, track: Map<String, Value>) -> Result<Value, String> {
    let i = deck_idx(&d)?;
    let sr = app.state::<St>().engine.lock().unwrap().sr;
    let source = track.get("source").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let id = match track.get("id") {
        Some(Value::String(s)) => s.clone(),
        Some(v) => v.to_string(),
        None => String::new(),
    };
    let mut track = track;
    let mut path: Option<PathBuf> = None;
    let res = match source.as_str() {
        "practice" => tauri::async_runtime::spawn_blocking(move || synth::get(&id, sr)).await.map_err(|e| e.to_string())?,
        "audius" => {
            let bytes = sources::audius_get(&id).await?;
            tauri::async_runtime::spawn_blocking(move || decode::decode_bytes(bytes, Some("mp3"))).await.map_err(|e| e.to_string())?
        }
        "soundcloud" | "youtube" => {
            let meta = json!({ "title": track.get("title"), "artist": track.get("artist"), "art": track.get("art") });
            let a = app.clone();
            let p = sources::web_get(&source, &id, &meta, move |m| toast(&a, m)).await?;
            track.insert("downloaded".into(), json!(true));
            path = Some(p.clone());
            tauri::async_runtime::spawn_blocking(move || decode::decode_file(&p)).await.map_err(|e| e.to_string())?
        }
        _ => {
            let p = PathBuf::from(track.get("path").and_then(|v| v.as_str()).ok_or("chemin manquant")?);
            path = Some(p.clone());
            tauri::async_runtime::spawn_blocking(move || decode::decode_file(&p)).await.map_err(|e| e.to_string())?
        }
    };
    match res {
        Ok(pcm) => {
            let a = app.clone();
            tauri::async_runtime::spawn_blocking(move || finish_load(&a, i, track, pcm)).await.map_err(|e| e.to_string())?
        }
        // format que le moteur ne lit pas (ex. Opus/WebM) : l'interface le décode puis l'envoie (load_pcm)
        Err(e) if e == "UNSUPPORTED" => match path {
            Some(p) => Ok(json!({ "needDecode": p.to_string_lossy(), "track": track })),
            None => Err("Format audio non pris en charge.".into()),
        },
        Err(e) => Err(e),
    }
}

/// PCM décodé par l'interface : en-têtes `x-deck`, `x-track` (JSON encodé URI), `x-sr` ; corps = L puis R (f32)
#[tauri::command]
async fn load_pcm(app: AppHandle, request: Request<'_>) -> Result<Value, String> {
    let h = request.headers();
    let get = |k: &str| h.get(k).and_then(|v| v.to_str().ok()).map(String::from).ok_or(format!("en-tête {k} manquant"));
    let i = deck_idx(&get("x-deck")?)?;
    let tj = percent_decode(&get("x-track")?);
    let track: Map<String, Value> = serde_json::from_str(&tj).map_err(|e| e.to_string())?;
    let sr: f64 = get("x-sr")?.parse().map_err(|_| "x-sr")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("corps binaire attendu".into()) };
    let f: Vec<f32> = bytes.chunks_exact(4).map(|c| f32::from_le_bytes([c[0], c[1], c[2], c[3]])).collect();
    let half = f.len() / 2;
    let pcm = decode::Pcm { l: f[..half].to_vec(), r: f[half..].to_vec(), sr };
    let a = app.clone();
    tauri::async_runtime::spawn_blocking(move || finish_load(&a, i, track, pcm)).await.map_err(|e| e.to_string())?
}
fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 3 <= b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

#[tauri::command]
fn read_file(path: String) -> Result<Response, String> {
    std::fs::read(&path).map(Response::new).map_err(|e| e.to_string())
}

// ------------------------------------------------------------ bibliothèque et sources
#[tauri::command]
fn lib_list() -> Vec<Value> {
    sources::lib_list()
}
#[tauri::command]
async fn lib_add_files() -> Option<Vec<Value>> {
    let files = rfd::AsyncFileDialog::new().set_title("Ajouter des morceaux").add_filter("Audio", &sources::AUDIO_EXT).pick_files().await?;
    let paths: Vec<PathBuf> = files.iter().map(|f| f.path().to_path_buf()).collect();
    Some(sources::lib_add_paths(&paths))
}
#[tauri::command]
async fn lib_add_folder() -> Option<Vec<Value>> {
    let d = rfd::AsyncFileDialog::new().set_title("Ajouter un dossier de musique").pick_folder().await?;
    Some(sources::lib_add_paths(&[d.path().to_path_buf()]))
}
#[tauri::command]
fn lib_add_paths(paths: Vec<String>) -> Vec<Value> {
    sources::lib_add_paths(&paths.into_iter().map(PathBuf::from).collect::<Vec<_>>())
}
#[tauri::command]
fn lib_remove(id: String) -> Vec<Value> {
    sources::lib_remove(&id)
}
#[tauri::command]
fn lib_update(id: String, patch: Value) -> bool {
    sources::lib_update(&id, &patch);
    true
}
#[tauri::command]
async fn audius_search(query: Option<String>, genre: Option<String>, trending: Option<bool>) -> Result<Vec<Value>, String> {
    sources::audius_search(query, genre, trending.unwrap_or(false)).await
}
#[tauri::command]
async fn web_search(app: AppHandle, site: String, query: String) -> Result<Vec<Value>, String> {
    sources::web_search(&site, &query, move |m| toast(&app, m)).await
}
#[tauri::command]
fn dl_open_folder() {
    let d = store::dl_dir();
    let _ = std::fs::create_dir_all(&d);
    sources::open_path(&d);
}
#[tauri::command]
fn open_external(url: String) {
    sources::open_url(&url);
}

// ------------------------------------------------------------ sorties audio et enregistrement
#[tauri::command]
fn audio_outputs() -> Vec<String> {
    audio::list_outputs()
}
#[tauri::command]
async fn audio_set(st: State<'_, St>, master: String, phones: String, phones_device: String) -> Result<Value, String> {
    let audio = st.engine.lock().unwrap().audio.clone();
    let mut errs = vec![];
    if let Err(e) = audio.set_master(&master) {
        errs.push(format!("master : {e}"));
    }
    let dev = if phones == "device" { Some(phones_device) } else { None };
    if let Err(e) = audio.set_phones(dev) {
        errs.push(format!("casque : {e}"));
    }
    st.engine.lock().unwrap().set_phones_mode(&phones);
    Ok(json!({ "ok": errs.is_empty(), "errors": errs }))
}
#[tauri::command]
fn rec_start(st: State<St>) -> Result<bool, String> {
    let mut e = st.engine.lock().unwrap();
    if e.rec.is_none() {
        let r = recorder::Recorder::start(&e.audio.tx, e.sr)?;
        e.rec = Some(r);
    }
    Ok(true)
}
#[tauri::command]
async fn rec_stop(st: State<'_, St>) -> Result<Option<String>, String> {
    let (rec, audio) = {
        let mut e = st.engine.lock().unwrap();
        (e.rec.take(), e.audio.clone())
    };
    let Some(r) = rec else { return Ok(None) };
    let p = tauri::async_runtime::spawn_blocking(move || r.finish(&audio.tx)).await.map_err(|e| e.to_string())??;
    sources::show_in_folder(&p);
    Ok(Some(p.to_string_lossy().to_string()))
}

// ------------------------------------------------------------ assistant (Orbiz)
#[tauri::command]
fn migrated_storage(st: State<St>) -> Value {
    let v = migrate::run();
    st.engine.lock().unwrap().meta = store::load_meta();
    v
}
#[tauri::command]
fn win_action(app: AppHandle, action: String) {
    let Some(w) = app.get_webview_window("main") else { return };
    match action.as_str() {
        "fullscreen" => {
            let f = w.is_fullscreen().unwrap_or(false);
            let _ = w.set_fullscreen(!f);
        }
        "devtools" => {
            if w.is_devtools_open() {
                w.close_devtools()
            } else {
                w.open_devtools()
            }
        }
        _ => {}
    }
}

fn set_app_id() {
    use windows_sys::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let w: Vec<u16> = "iris.irisdj".encode_utf16().chain(Some(0)).collect();
    unsafe {
        SetCurrentProcessExplicitAppUserModelID(w.as_ptr());
    }
}

fn main() {
    set_app_id();
    let audio = match audio::Audio::start() {
        Ok(a) => Arc::new(a),
        Err(e) => {
            rfd::MessageDialog::new().set_title("IrisDJ").set_description(format!("Impossible d'ouvrir la sortie audio : {e}")).show();
            return;
        }
    };
    let engine = Arc::new(Mutex::new(Engine::new(audio)));
    let chan: Arc<Mutex<Option<Channel<Snapshot>>>> = Arc::new(Mutex::new(None));

    // fil d'état : ~60 instantanés par seconde vers l'interface
    {
        let (engine, chan) = (engine.clone(), chan.clone());
        std::thread::Builder::new()
            .name("etat".into())
            .spawn(move || {
                let mut n = 0u64;
                loop {
                    std::thread::sleep(Duration::from_millis(16));
                    n += 1;
                    let snap = {
                        let mut e = engine.lock().unwrap();
                        e.tick(n % 3 == 0);
                        let lv = e.audio.tele.take_peaks();
                        e.snapshot(lv)
                    };
                    if let Some(c) = chan.lock().unwrap().as_ref() {
                        let _ = c.send(snap);
                    }
                }
            })
            .unwrap();
    }

    let st = St { engine: engine.clone(), chan };
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .manage(st)
        .invoke_handler(tauri::generate_handler![
            subscribe, deck, set_mix, get_wave, load_track, load_pcm, read_file, lib_list, lib_add_files, lib_add_folder, lib_add_paths,
            lib_remove, lib_update, audius_search, web_search, dl_open_folder, open_external, audio_outputs, audio_set, rec_start, rec_stop,
            iris_link::commands::assistant_ask, iris_link::commands::agent_reply, migrated_storage, win_action
        ])
        .setup(|app| {
            let w = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("IrisDJ")
                .inner_size(1500.0, 940.0)
                .min_inner_size(1180.0, 720.0)
                .background_color(tauri::window::Color(11, 13, 16, 255))
                .visible(false)
                .build()?;
            let _ = w.maximize();
            let _ = w.show();
            let _ = w.set_focus();
            irislink::start(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("démarrage d'IrisDJ");
    app.run(move |_app, ev| {
        if let tauri::RunEvent::Exit = ev {
            // un mix en cours d'enregistrement est toujours sauvegardé
            let rec = engine.lock().unwrap().rec.take();
            if let Some(r) = rec {
                let tx = engine.lock().unwrap().audio.clone();
                let _ = r.finish(&tx.tx);
            }
        }
    });
}
