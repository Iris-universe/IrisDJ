// iris-link côté app, en Rust : rend IrisDJ pilotable par l'assistant d'Orbiz.
// Le protocole (pipe, manifeste, outils génériques, capture) est dans la brique iris-link.

use serde_json::{json, Value};

pub const ID: &str = "irisdj";
const NAME: &str = "IrisDJ";
const DESCRIPTION: &str = "Table de mix virtuelle pour apprendre à mixer (2 platines, table de mixage, effets), avec cours interactifs ; sources : Audius, SoundCloud, YouTube, fichiers locaux, pistes d'entraînement.";
const INSTRUCTIONS: &str = "Tu es le PROF DE DJ de l'utilisateur dans IrisDJ, une table de mix virtuelle (2 platines type CDJ + table 2 voies type DJM) faite pour apprendre avant d'acheter du vrai matériel. Adapte-toi au niveau et aux styles de l'utilisateur (voir son profil s'il y en a un).
- Commence par get_state pour voir ce qu'il a sous les yeux (morceaux, mesure/phrase, réglages, coach, cours en cours).
- Explique simplement, en français, avec le vocabulaire DJ (cue, phrase de 32 temps, bass swap, drop, echo out…) en le définissant la première fois, et dis à quoi correspond chaque bouton sur une vraie table (CDJ/DJM/contrôleur).
- Pour les transitions en hardcore/uptempo : jamais deux kicks/basses ensemble (couper LOW), caler sur les phrases, couper sur le drop, echo out, montées de tempo progressives.
- Tu peux agir dans l'app quand il le demande (charger un morceau, régler un contrôle, lancer un cours) ; sinon guide-le pour qu'il le fasse lui-même : c'est comme ça qu'il apprend.
- Réponses courtes (5 à 12 lignes), une idée à la fois.";

fn tools() -> Value {
    let obj = iris_link::obj;
    let deck = json!({ "type": "string", "enum": ["A", "B"] });
    let src = json!({ "type": "string", "enum": ["practice", "audius", "soundcloud", "youtube", "files"] });
    json!([
      { "name": "get_state", "description": "État complet de la table : morceaux chargés (titre, BPM, tonalité Camelot, position, mesure/phrase, section), lecture, tempo, sync, boucles, hot cues ; réglages de la table de mixage (trim, EQ, filtre, faders, crossfader, effets, niveaux en dB) ; écart de phase entre les platines ; cours en cours et étape ; conseils du coach.", "parameters": obj(json!({}), json!([])) },
      { "name": "list_controls", "description": "Liste les contrôles réglables (id, nom, plage, valeur actuelle, équivalent sur une vraie table).", "parameters": obj(json!({}), json!([])) },
      { "name": "set_control", "description": "Règle un contrôle de la table (voir list_controls). Ex. id \"A.low\" value -1 (kill des basses), \"xfader\" 0, \"fx.on\" true.",
        "parameters": obj(json!({ "id": { "type": "string" }, "value": { "description": "nombre, booléen ou texte selon le contrôle" } }), json!(["id", "value"])) },
      { "name": "deck_action", "description": "Action sur une platine. actions : play, pause, cue (retour au cue), set_cue, sync, unsync, keylock_on, keylock_off, hotcue (value = 1..8, pose ou saute), delete_hotcue, loop (value = nb de temps), exit_loop, beat_jump (value = temps, négatif = arrière), seek_bar (value = n° de mesure), seek (value = secondes), tempo (value = % ex. 2.5), range (value = 6/10/16/50), bpm_double, bpm_half, set_bpm (value), downbeat_here.",
        "parameters": obj(json!({ "deck": deck, "action": { "type": "string" }, "value": { "type": "number" } }), json!(["deck", "action"])) },
      { "name": "search_tracks", "description": "Cherche des morceaux. source : practice (pistes d'entraînement intégrées), audius (gratuit), soundcloud et youtube (gratuits, catalogue complet : artistes connus comme Noiseflow, Dr. Peacock…), files (fichiers de l'utilisateur). Renvoie des id à passer à load_track.",
        "parameters": obj(json!({ "source": src, "query": { "type": "string" } }), json!(["source"])) },
      { "name": "load_track", "description": "Charge un morceau sur une platine (id venant de search_tracks).",
        "parameters": obj(json!({ "deck": deck, "source": src, "id": { "type": "string" } }), json!(["deck", "source", "id"])) },
      { "name": "reset", "description": "Remet toute la table aux réglages par défaut et arrête les platines (les morceaux restent chargés).", "parameters": obj(json!({}), json!([])) },
      { "name": "list_lessons", "description": "Liste les cours (id, chapitre, titre, terminé ou non).", "parameters": obj(json!({}), json!([])) },
      { "name": "start_lesson", "description": "Ouvre un cours interactif dans le panneau « Apprendre ».", "parameters": obj(json!({ "id": { "type": "string" } }), json!(["id"])) },
      { "name": "show_tip", "description": "Affiche un message dans la barre du coach de l'app (et surligne éventuellement des contrôles, ids de list_controls).",
        "parameters": obj(json!({ "text": { "type": "string" }, "highlight": { "type": "array", "items": { "type": "string" } } }), json!(["text"])) },
      { "name": "screenshot", "description": "Capture d'écran de l'app (PNG) ; renvoie le chemin du fichier.", "parameters": obj(json!({}), json!([])) },
    ])
}
pub fn start(app: &tauri::AppHandle) {
    iris_link::start(app, iris_link::AppInfo { id: ID, name: NAME, description: DESCRIPTION, instructions: INSTRUCTIONS, tools: tools() });
}
