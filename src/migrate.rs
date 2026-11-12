// Reprise des données de l'ancienne version Electron (localStorage de Chromium, stocké en LevelDB) :
// cours terminés, BPM/tonalités analysés, cues / hot cues / grilles corrigées.
// On lit le journal LevelDB (*.log) directement : format simple, et aucune dépendance.
use serde_json::{Map, Value};
use std::collections::BTreeMap;

const ORIGIN: &[u8] = b"_app://irisdj\x00";

fn varint(b: &[u8], i: &mut usize) -> Option<usize> {
    let mut v = 0usize;
    let mut shift = 0;
    loop {
        let c = *b.get(*i)?;
        *i += 1;
        v |= ((c & 0x7f) as usize) << shift;
        if c & 0x80 == 0 {
            return Some(v);
        }
        shift += 7;
        if shift > 35 {
            return None;
        }
    }
}

fn decode_str(b: &[u8]) -> Option<String> {
    match b.first()? {
        0 => {
            let u: Vec<u16> = b[1..].chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            String::from_utf16(&u).ok()
        }
        1 => Some(b[1..].iter().map(|&c| c as char).collect()),
        _ => None,
    }
}

/// enregistrements du journal (blocs de 32 Ko, morceaux FULL/FIRST/MIDDLE/LAST)
fn records(data: &[u8]) -> Vec<Vec<u8>> {
    let mut out = vec![];
    let mut cur = vec![];
    let mut block = 0;
    while block < data.len() {
        let end = (block + 32768).min(data.len());
        let mut i = block;
        while i + 7 <= end {
            let len = u16::from_le_bytes([data[i + 4], data[i + 5]]) as usize;
            let typ = data[i + 6];
            if typ == 0 && len == 0 {
                break;
            }
            let s = i + 7;
            if s + len > end {
                break;
            }
            let frag = &data[s..s + len];
            match typ {
                1 => out.push(frag.to_vec()),
                2 => cur = frag.to_vec(),
                3 => cur.extend_from_slice(frag),
                4 => {
                    cur.extend_from_slice(frag);
                    out.push(std::mem::take(&mut cur));
                }
                _ => {}
            }
            i = s + len;
        }
        block += 32768;
    }
    out
}

/// toutes les clés localStorage de l'ancienne app
pub fn read_old() -> BTreeMap<String, String> {
    let mut kv = BTreeMap::new();
    let dir = crate::store::data_dir().join("Local Storage").join("leveldb");
    let Ok(rd) = std::fs::read_dir(&dir) else { return kv };
    let mut logs: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().map(|e| e == "log").unwrap_or(false)).collect();
    logs.sort();
    for f in logs {
        let Ok(data) = std::fs::read(&f) else { continue };
        for rec in records(&data) {
            if rec.len() < 12 {
                continue;
            }
            let mut i = 12; // séquence (8) + nombre d'entrées (4)
            while i < rec.len() {
                let tag = rec[i];
                i += 1;
                let Some(kl) = varint(&rec, &mut i) else { break };
                if i + kl > rec.len() {
                    break;
                }
                let key = rec[i..i + kl].to_vec();
                i += kl;
                let val = if tag == 1 {
                    let Some(vl) = varint(&rec, &mut i) else { break };
                    if i + vl > rec.len() {
                        break;
                    }
                    let v = rec[i..i + vl].to_vec();
                    i += vl;
                    Some(v)
                } else {
                    None
                };
                if !key.starts_with(ORIGIN) {
                    continue;
                }
                let Some(k) = decode_str(&key[ORIGIN.len()..]) else { continue };
                match val.and_then(|v| decode_str(&v)) {
                    Some(v) => {
                        kv.insert(k, v);
                    }
                    None => {
                        kv.remove(&k);
                    }
                }
            }
        }
    }
    kv
}

/// première ouverture (l'interface ne le demande qu'une fois) : métadonnées des morceaux -> meta.json,
/// le reste est rendu à l'interface pour son localStorage
pub fn run() -> Value {
    let kv = read_old();
    let mut meta = crate::store::load_meta();
    let mut ui = Map::new();
    for (k, v) in kv {
        if k.starts_with("meta:") {
            if let Ok(j) = serde_json::from_str::<Value>(&v) {
                meta.entry(k).or_insert(j);
            }
        } else if k != "audio" {
            ui.insert(k, Value::String(v));
        }
    }
    crate::store::save_meta(&meta);
    Value::Object(ui)
}
