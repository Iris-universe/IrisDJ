// Fichiers de données : mêmes emplacements que l'ancienne version Electron (%APPDATA%\IrisDJ),
// pour garder la bibliothèque, les téléchargements et yt-dlp.
use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

pub fn data_dir() -> PathBuf {
    dirs::config_dir().unwrap_or_else(|| PathBuf::from(".")).join("IrisDJ")
}
pub fn lib_file() -> PathBuf {
    data_dir().join("library.json")
}
pub fn meta_file() -> PathBuf {
    data_dir().join("meta.json")
}
pub fn cache_dir() -> PathBuf {
    data_dir().join("cache")
}
pub fn bin_dir() -> PathBuf {
    data_dir().join("bin")
}
pub fn dl_index() -> PathBuf {
    data_dir().join("downloads.json")
}
pub fn music_dir() -> PathBuf {
    dirs::audio_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join("Music")).join("IrisDJ")
}
pub fn dl_dir() -> PathBuf {
    music_dir().join("Téléchargés")
}

pub use iris_store::{read_json, write_json};

pub fn load_meta() -> HashMap<String, Value> {
    match read_json(&meta_file()) {
        Some(Value::Object(m)) => m.into_iter().collect(),
        _ => HashMap::new(),
    }
}
pub fn save_meta(m: &HashMap<String, Value>) {
    let v = Value::Object(m.iter().map(|(k, v)| (k.clone(), v.clone())).collect());
    let _ = write_json(&meta_file(), &v);
}
