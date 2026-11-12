# IrisDJ (version Rust)

Table de mix virtuelle pour apprendre à mixer (orientée hardcore/uptempo, mais tous les styles). **Rust + Tauri 2** : tout le moteur est en Rust, l'interface HTML/CSS/JS tourne dans WebView2. Pilotable par Orbiz via iris-link (id `irisdj`). Lancement : `IrisDJ.vbs` (lance `target\release\irisdj.exe`).
L'ancienne version Electron est archivée dans `../IrisDJ-electron` (ne plus la modifier).

## Compiler
`cargo build --release` (Rust dans `%USERPROFILE%\.cargo\bin`, MSVC de VS 2022). **Les fichiers de `ui/` sont intégrés au binaire** : après toute modification de l'interface, recompiler (F5 ne suffit pas). `cargo build` (debug, déjà optimisé pour le DSP) pour tester : `target\debug\irisdj.exe`.

## Rust (`src/`)
- `audio/core.rs` : fil temps réel. 2 lecteurs -> table DJM (TRIM avec 6 dB de marge, EQ -26..+6 dB / kill, COLOR, fader, crossfader smooth/cut) -> Beat FX en envoi (echo, reverb FDN, flanger) -> master -> VU (avant limiteur) -> limiteur -> sortie ; casque (CUE/MASTER, split ou 2e carte) ; enregistrement. Commandes reçues par une file sans verrou (`rtrb`), télémétrie par atomiques (position, crêtes).
- `audio/player.rs` : lecture d'une platine (vitesse, boucles, scratch, interpolation Hermite) ; `audio/wsola.rs` : Master Tempo (WSOLA maison, remplace SoundTouch) ; `audio/dsp.rs` : biquads (formules Web Audio : Q en dB pour passe-bas/haut), lissage, limiteur, effets ; `audio/mod.rs` : sorties cpal/WASAPI, changement de carte, rééchantillonnage si la carte n'a pas la fréquence du moteur.
- `engine.rs` : **la référence de l'état** : logique CDJ (CUE, play, sync/phase, hot cues, boucles, beat jump, grille éditable), métadonnées par morceau (`meta.json`), instantané envoyé à l'interface ~60×/s.
- `decode.rs` (symphonia : mp3, m4a/aac, flac, wav, ogg, aiff ; rubato pour rééchantillonner), `analysis.rs` (forme d'onde 3 bandes, BPM + grille, tonalité « estimée »), `synth.rs` (pistes d'entraînement, 80 mesures : intro 1-16, couplet 17-32, break 33-48, drop 49-64, outro 65-80 ; cache WAV).
- `sources.rs` : bibliothèque, Audius, SoundCloud/YouTube via yt-dlp (téléchargé dans `%APPDATA%\IrisDJ\bin`, mis à jour une fois par lancement ; fichiers dans `Musique\IrisDJ\Téléchargés`, retrouvés par leur tag `[sc-123]`). Opus/WebM n'est pas lu par symphonia : `load_track` renvoie `needDecode` et l'interface décode avec WebView2 puis envoie le PCM (`load_pcm`).
- `irislink.rs` : iris-link en Rust (même protocole que `../iris-link` : pipe `\\.\pipe\iris-link-irisdj`, manifeste, outils + INSTRUCTIONS pour Orbiz). Outils `page` -> évènement `agent-call` -> `window.irisAgent` -> `agent_reply`. (le protocole et la capture sont dans la brique iris-link).
- `recorder.rs` : mix en WAV 24 bits dans `Musique\IrisDJ`. `migrate.rs` : reprise du localStorage de l'ancienne version (cours terminés, BPM/tonalités, cues).
- Données : `%APPDATA%\IrisDJ` (library.json, downloads.json, meta.json, cache, bin) — les mêmes que l'ancienne version.

## Interface (`ui/`)
- `js/engine.js` : **façade** du moteur Rust avec l'ancienne API (Deck/Engine : `deck.play()`, `position()`, `barInfo()`, `engine.set('A.low', -1)`…) ; les actions sont asynchrones (`invoke('deck', …)`, `deck.idle()` attend la dernière). La table (`engine.mix`) est envoyée entière à Rust (`set_mix`).
- `js/bridge.js` : `window.dj` (bibliothèque, sources, assistant), outils génériques d'Orbiz, F5/F11/F12.
- `controls.js`, `deckui.js`, `mixerui.js`, `widgets.js`, `library.js`, `lessons.js` (cours, étapes avec `check(x)`), `learn.js`, `coach.js`, `agent.js` (`window.irisAgent`) : inchangés sur le fond.
- Glisser-déposer : bibliothèque -> platine en pointeur (`app.startDrag`) ; fichiers Windows via `onDragDropEvent` de Tauri (le glisser HTML5 est désactivé par Tauri).

## Tester
Lancer l'exe, puis via le pipe : `require('../iris-link/pipe').request('irisdj', { cmd: 'call', tool: 'get_state', args: {} })`. Outils : `load_track`, `deck_action`, `set_control`, `start_lesson`, `execute_javascript` (`window.__app` = app), `screenshot` (PNG à lire).

## Briques partagées
Dépend de `../iris-briques` (workspace Rust, publié sur github.com/Iris-universe/iris-briques) : `iris-decode` (`src/decode.rs` la ré-exporte), `iris-store` (`read_json`/`write_json`…), `iris-link` (pipe, manifeste, outils génériques, capture d'écran ; `src/irislink.rs` ne contient plus que ID/NOM/INSTRUCTIONS/outils). Tout outil déclaré (sauf `screenshot`) est exécuté dans la page. Modifier une brique = la modifier dans `iris-briques` (elle sert aux autres apps).

## Briques partagées : où elles sont prises
`Cargo.toml` les prend sur GitHub (`github.com/Iris-universe/iris-briques`) ; `.cargo/config.toml` (local, non versionné) les redirige vers `../iris-briques` pour développer. Modifier une brique = la modifier dans `iris-briques`, puis la pousser.
