// Bibliothèque locale, Audius (API ouverte), SoundCloud et YouTube (via yt-dlp, gratuit, sans compte).
use crate::store::{self, read_json, write_json};
use serde_json::{json, Value};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tokio::sync::Mutex as AsyncMutex;

pub const AUDIO_EXT: [&str; 10] = ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "aiff", "aif", "webm"];
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ------------------------------------------------------------ bibliothèque locale
pub fn lib_list() -> Vec<Value> {
    match read_json(&store::lib_file()) {
        Some(Value::Array(a)) => a,
        _ => vec![],
    }
}
fn lib_save(l: &[Value]) {
    let _ = write_json(&store::lib_file(), &Value::Array(l.to_vec()));
}

pub fn track_from_path(p: &Path) -> Value {
    let base = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
    let (artist, title) = match base.split_once(" - ") {
        Some((a, t)) if !a.trim().is_empty() && !t.trim().is_empty() => (a.trim().to_string(), t.trim().to_string()),
        _ => (String::new(), base.clone()),
    };
    let ps = p.to_string_lossy().to_string();
    let h = sha1_smol::Sha1::from(ps.as_bytes()).digest().to_string();
    let id = &h[..12];
    json!({ "id": id, "source": "files", "path": ps, "title": title, "artist": artist,
            "ext": p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase() })
}
fn is_audio(p: &Path) -> bool {
    p.extension().and_then(|e| e.to_str()).map(|e| AUDIO_EXT.contains(&e.to_lowercase().as_str())).unwrap_or(false)
}
fn scan_dir(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 6 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            scan_dir(&p, out, depth + 1);
        } else if is_audio(&p) {
            out.push(p);
        }
    }
}
pub fn lib_add_paths(paths: &[PathBuf]) -> Vec<Value> {
    let mut lib = lib_list();
    let mut have: std::collections::HashSet<String> = lib.iter().filter_map(|t| t["path"].as_str().map(String::from)).collect();
    for p in paths {
        let mut files = vec![];
        if p.is_dir() {
            scan_dir(p, &mut files, 0);
        } else if is_audio(p) {
            files.push(p.clone());
        }
        for f in files {
            let s = f.to_string_lossy().to_string();
            if have.insert(s) {
                lib.push(track_from_path(&f));
            }
        }
    }
    lib_save(&lib);
    lib
}
pub fn lib_remove(id: &str) -> Vec<Value> {
    let lib: Vec<Value> = lib_list().into_iter().filter(|t| t["id"].as_str() != Some(id)).collect();
    lib_save(&lib);
    lib
}
pub fn lib_update(id: &str, patch: &Value) {
    let mut lib = lib_list();
    if let Some(t) = lib.iter_mut().find(|t| t["id"].as_str() == Some(id)) {
        if let (Some(o), Some(p)) = (t.as_object_mut(), patch.as_object()) {
            for (k, v) in p {
                o.insert(k.clone(), v.clone());
            }
        }
    }
    lib_save(&lib);
}

// ------------------------------------------------------------ Audius
const AUDIUS: &str = "https://api.audius.co/v1";
const APP_NAME: &str = "IrisDJ";

pub fn http() -> reqwest::Client {
    reqwest::Client::builder().user_agent("IrisDJ/2.0").build().unwrap_or_default()
}

fn audius_track(t: &Value) -> Value {
    json!({
        "id": t["id"], "source": "audius", "title": t["title"], "artist": t["user"]["name"].as_str().unwrap_or(""),
        "duration": t["duration"], "genre": t["genre"],
        "hintBpm": t.get("bpm").cloned().unwrap_or(Value::Null), "key": t.get("musical_key").cloned().unwrap_or(Value::Null),
        "art": t["artwork"]["150x150"].clone(),
        "url": t["permalink"].as_str().map(|p| format!("https://audius.co{p}")),
    })
}
pub async fn audius_search(query: Option<String>, genre: Option<String>, trending: bool) -> Result<Vec<Value>, String> {
    let c = http();
    let req = if trending {
        let mut q = vec![("app_name", APP_NAME.to_string())];
        if let Some(g) = genre {
            q.push(("genre", g));
        }
        c.get(format!("{AUDIUS}/tracks/trending")).query(&q)
    } else {
        c.get(format!("{AUDIUS}/tracks/search")).query(&[("query", query.unwrap_or_default()), ("app_name", APP_NAME.into())])
    };
    let r = req.send().await.map_err(|e| format!("Audius : {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Audius : erreur {}", r.status().as_u16()));
    }
    let j: Value = r.json().await.map_err(|e| e.to_string())?;
    Ok(j["data"]
        .as_array()
        .cloned()
        .unwrap_or_default()
        .iter()
        .filter(|t| t["is_available"] != json!(false) && t["is_delete"] != json!(true) && t["is_streamable"] != json!(false))
        .map(audius_track)
        .collect())
}
pub async fn audius_get(id: &str) -> Result<Vec<u8>, String> {
    let r = http()
        .get(format!("{AUDIUS}/tracks/{}/stream", urlenc(id)))
        .query(&[("app_name", APP_NAME)])
        .send()
        .await
        .map_err(|e| format!("Audius : {e}"))?;
    if !r.status().is_success() {
        return Err(format!("Audius : morceau indisponible ({})", r.status().as_u16()));
    }
    Ok(r.bytes().await.map_err(|e| e.to_string())?.to_vec())
}
fn urlenc(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}

// ------------------------------------------------------------ SoundCloud / YouTube (yt-dlp)
// yt-dlp.exe est téléchargé au premier usage dans %APPDATA%\IrisDJ\bin et mis à jour une fois par lancement.
static YTDLP_READY: AsyncMutex<bool> = AsyncMutex::const_new(false);

fn ytdlp_path() -> PathBuf {
    store::bin_dir().join("yt-dlp.exe")
}

pub async fn ensure_ytdlp(toast: impl Fn(&str)) -> Result<(), String> {
    let mut ready = YTDLP_READY.lock().await;
    if *ready {
        return Ok(());
    }
    let exe = ytdlp_path();
    if !exe.exists() {
        toast("Première utilisation : téléchargement de yt-dlp (≈ 25 Mo)…");
        let r = http()
            .get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe")
            .send()
            .await
            .map_err(|e| format!("Téléchargement de yt-dlp impossible : {e}"))?;
        if !r.status().is_success() {
            return Err(format!("Téléchargement de yt-dlp impossible ({})", r.status().as_u16()));
        }
        let b = r.bytes().await.map_err(|e| e.to_string())?;
        std::fs::create_dir_all(store::bin_dir()).map_err(|e| e.to_string())?;
        let part = exe.with_extension("exe.part");
        std::fs::write(&part, &b).map_err(|e| e.to_string())?;
        std::fs::rename(&part, &exe).map_err(|e| e.to_string())?;
    } else {
        // mise à jour (rapide si déjà à jour) : YouTube change souvent
        let e = exe.clone();
        let _ = tokio::task::spawn_blocking(move || Command::new(e).arg("-U").creation_flags(CREATE_NO_WINDOW).output()).await;
    }
    *ready = true;
    Ok(())
}

async fn ytdlp(args: Vec<String>) -> Result<String, String> {
    let exe = ytdlp_path();
    let out = tokio::task::spawn_blocking(move || {
        let mut c = Command::new(exe);
        c.args(["--no-warnings", "--no-playlist", "--encoding", "utf-8"]);
        if which_node() {
            c.args(["--js-runtimes", "node"]);
        }
        c.args(&args).env("PYTHONIOENCODING", "utf-8").creation_flags(CREATE_NO_WINDOW).output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("yt-dlp : {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let line = err.lines().filter(|l| l.contains("ERROR")).last().unwrap_or("échec de yt-dlp");
        return Err(line.trim_start_matches("ERROR:").trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}
fn which_node() -> bool {
    static N: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *N.get_or_init(|| Command::new("node").arg("-v").creation_flags(CREATE_NO_WINDOW).output().map(|o| o.status.success()).unwrap_or(false))
}

struct Site {
    search: &'static str,
    format: &'static str,
    tag: &'static str,
}
fn site(s: &str) -> Result<Site, String> {
    match s {
        // m4a (AAC) en priorité : décodé directement par le moteur Rust
        "soundcloud" => Ok(Site { search: "scsearch", format: "bestaudio[ext=mp3]/bestaudio[ext=m4a]/bestaudio", tag: "sc" }),
        "youtube" => Ok(Site { search: "ytsearch", format: "bestaudio[ext=m4a]/bestaudio", tag: "yt" }),
        _ => Err("source inconnue".into()),
    }
}
fn site_url(s: &str, id: &str) -> String {
    if s == "youtube" {
        format!("https://www.youtube.com/watch?v={id}")
    } else {
        format!("https://api.soundcloud.com/tracks/soundcloud%3Atracks%3A{id}")
    }
}
fn dl_key(s: &str, id: &str) -> String {
    format!("{s}:{id}")
}
fn dl_find(s: &str, id: &str) -> Option<PathBuf> {
    let idx = read_json(&store::dl_index())?;
    let p = PathBuf::from(idx.get(dl_key(s, id))?.as_str()?);
    p.exists().then_some(p)
}
fn thumb(e: &Value) -> Value {
    let t: Vec<&Value> = e["thumbnails"].as_array().map(|a| a.iter().filter(|x| x["url"].is_string()).collect()).unwrap_or_default();
    let url = |x: &&Value| x["url"].as_str().unwrap_or("").to_string();
    let pick = t
        .iter()
        .find(|x| ["-t300x300", "-large", "mqdefault", "hqdefault"].iter().any(|k| url(x).contains(k)))
        .or_else(|| t.iter().find(|x| x["width"].as_f64().unwrap_or(0.0) >= 100.0))
        .or(t.last());
    pick.map(|x| json!(url(x))).unwrap_or(Value::Null)
}

pub async fn web_search(s: &str, query: &str, toast: impl Fn(&str)) -> Result<Vec<Value>, String> {
    let w = site(s)?;
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    ensure_ytdlp(toast).await?;
    let out = ytdlp(vec!["--flat-playlist".into(), "-J".into(), format!("{}40:{}", w.search, query)]).await?;
    let j: Value = serde_json::from_str(&out).map_err(|e| e.to_string())?;
    let idx = read_json(&store::dl_index()).unwrap_or(json!({}));
    let mut v = vec![];
    for e in j["entries"].as_array().cloned().unwrap_or_default() {
        let id = match &e["id"] {
            Value::String(x) => x.clone(),
            Value::Number(n) => n.to_string(),
            _ => continue,
        };
        // YouTube renvoie aussi des chaînes et playlists : on garde les vidéos (id de 11 caractères)
        if s == "youtube" && !(id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')) {
            continue;
        }
        let full = e["title"].as_str().unwrap_or("").to_string();
        let split = if s == "youtube" {
            ["-", "–", "—"].iter().find_map(|sep| full.split_once(&format!(" {sep} ")))
        } else {
            None
        };
        let (artist, title) = match split {
            Some((a, t)) => (a.trim().to_string(), t.trim().to_string()),
            None => (e["uploader"].as_str().or(e["channel"].as_str()).unwrap_or("").to_string(), full.clone()),
        };
        v.push(json!({
            "id": id, "source": s, "title": title, "artist": artist,
            "duration": e["duration"].as_f64().map(|d| d.round()),
            "art": thumb(&e),
            "url": e["webpage_url"].as_str().map(String::from).unwrap_or_else(|| if s == "youtube" { site_url(s, &id) } else { e["url"].as_str().unwrap_or("").to_string() }),
            "downloaded": idx.get(dl_key(s, &id)).is_some(),
        }));
    }
    Ok(v)
}

fn clean_name(s: &str) -> String {
    let c: String = s.chars().map(|c| if "<>:\"/\\|?*".contains(c) || (c as u32) < 32 { ' ' } else { c }).collect();
    let c = c.split_whitespace().collect::<Vec<_>>().join(" ");
    let c: String = c.chars().take(110).collect();
    c.trim_end_matches(['.', ' ']).to_string()
}

fn dl_register(s: &str, id: &str, file: &Path, meta: &Value) {
    let mut idx = read_json(&store::dl_index()).unwrap_or(json!({}));
    idx[dl_key(s, id)] = json!(file.to_string_lossy());
    let _ = write_json(&store::dl_index(), &idx);
    let mut lib = lib_list();
    let fs = file.to_string_lossy().to_string();
    if !lib.iter().any(|t| t["path"].as_str() == Some(&fs)) {
        let mut t = track_from_path(file);
        t["title"] = json!(meta["title"].as_str().filter(|x| !x.is_empty()).map(String::from).unwrap_or_else(|| file.file_name().unwrap().to_string_lossy().to_string()));
        t["artist"] = json!(meta["artist"].as_str().unwrap_or(""));
        t["from"] = json!(s);
        t["art"] = meta["art"].clone();
        lib.push(t);
        lib_save(&lib);
    }
}

/// télécharge (une seule fois) le morceau dans Musique\IrisDJ\Téléchargés et renvoie son chemin
pub async fn web_get(s: &str, id: &str, meta: &Value, toast: impl Fn(&str)) -> Result<PathBuf, String> {
    let w = site(s)?;
    if let Some(p) = dl_find(s, id) {
        return Ok(p);
    }
    let dir = store::dl_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe_id: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
    let tag = format!("[{}-{}]", w.tag, safe_id);
    let artist = meta["artist"].as_str().unwrap_or("");
    let base = clean_name(&format!("{}{}", if artist.is_empty() { String::new() } else { format!("{artist} - ") }, meta["title"].as_str().unwrap_or("")));
    let base = if base.is_empty() { s.to_string() } else { base };
    // on retrouve le fichier par son tag (la sortie de yt-dlp peut abîmer les accents)
    let by_tag = || -> Option<PathBuf> {
        std::fs::read_dir(&dir).ok()?.flatten().map(|e| e.path()).find(|p| {
            let n = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            n.contains(&tag) && !n.ends_with(".part") && !n.ends_with(".ytdl") && !n.ends_with(".temp")
        })
    };
    let f = match by_tag() {
        Some(f) => f,
        None => {
            ensure_ytdlp(toast).await?;
            let out = dir.join(format!("{} {}.%(ext)s", base.replace('%', "%%"), tag));
            ytdlp(vec!["-q".into(), "-f".into(), w.format.into(), "-o".into(), out.to_string_lossy().to_string(), site_url(s, id)]).await?;
            by_tag().ok_or("Téléchargement raté.")?
        }
    };
    dl_register(s, id, &f, meta);
    Ok(f)
}

pub fn open_path(p: &Path) {
    let _ = Command::new("explorer").arg(p).spawn();
}
pub fn show_in_folder(p: &Path) {
    let _ = Command::new("explorer").arg(format!("/select,{}", p.display())).spawn();
}
pub fn open_url(url: &str) {
    if url.starts_with("http://") || url.starts_with("https://") {
        let _ = Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    }
}
