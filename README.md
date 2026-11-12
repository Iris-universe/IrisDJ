# IrisDJ

Table de mix virtuelle pour **apprendre à mixer** avant d'acheter du matériel : 2 platines type CDJ (cue, hot cues, boucles, sync, Master Tempo), table 2 voies type DJM (EQ, filtre, effets), forme d'onde, BPM et tonalité, enregistrement du mix, et des **cours interactifs** avec un coach (orientés hardcore/uptempo, mais pour tous les styles).

Sources : fichiers locaux, pistes d'entraînement générées, Audius, SoundCloud/YouTube (via yt-dlp).

Moteur audio en Rust (cpal, symphonia, rubato, WSOLA maison), interface HTML/JS dans [Tauri 2](https://tauri.app). Windows. Compiler : `cargo build --release`.
