#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    env,
    fs,
    path::{Path, PathBuf},
};
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
struct DesktopTrack {
    id: String,
    title: String,
    artist: Option<String>,
}

#[derive(Debug, Serialize)]
struct DebugInfo {
    mode: &'static str,
    cwd: String,
    library_path: String,
    track_count: usize,
    current_track_id: Option<String>,
    user_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct TrackListResponse {
    tracks: Vec<DesktopTrack>,
}

#[derive(Debug, Serialize)]
struct PlayableResponse {
    url: String,
    kind: &'static str,
}

#[derive(Debug, Serialize)]
struct DebugInfoResponse {
    info: DebugInfo,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WidgetStatePayload {
    user_id: Option<String>,
    index: usize,
    tracks: Vec<WidgetTrackPayload>,
}

#[derive(Debug, Deserialize)]
struct WidgetTrackPayload {
    id: String,
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            library_list_tracks,
            library_resolve_track_url,
            app_get_debug_info
        ])
        .run(tauri::generate_context!())
        .expect("failed to run tauri desktop app");
}

#[tauri::command]
fn library_list_tracks(app: AppHandle, user_id: Option<String>) -> Result<TrackListResponse, String> {
    let _ = user_id;
    Ok(TrackListResponse {
        tracks: load_tracks(&app)?,
    })
}

#[tauri::command]
fn library_resolve_track_url(
    app: AppHandle,
    track_id: String,
    user_id: Option<String>,
) -> Result<PlayableResponse, String> {
    let _ = user_id;

    let tracks = load_tracks(&app)?;
    let _track = tracks
        .into_iter()
        .find(|track| track.id == track_id)
        .ok_or_else(|| format!("track not found: {track_id}"))?;

    Ok(PlayableResponse {
        url: public_asset_url(Path::new(&track_id)),
        kind: "asset",
    })
}

#[tauri::command]
fn app_get_debug_info(
    app: AppHandle,
    state: WidgetStatePayload,
) -> Result<DebugInfoResponse, String> {
    let cwd = env::current_dir()
        .map(|path| path.display().to_string())
        .unwrap_or_else(|_| "<unknown>".to_string());
    let library_path = resolve_music_dir(&app)?
        .display()
        .to_string();

    Ok(DebugInfoResponse {
        info: DebugInfo {
            mode: "tauri",
            cwd,
            library_path,
            track_count: state.tracks.len(),
            current_track_id: state.tracks.get(state.index).map(|track| track.id.clone()),
            user_id: state.user_id,
        },
    })
}

fn load_tracks(app: &AppHandle) -> Result<Vec<DesktopTrack>, String> {
    let music_dir = resolve_music_dir(app)?;

    let mut tracks = Vec::new();

    for entry in fs::read_dir(&music_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if !is_supported_audio_file(&path) {
            continue;
        }

        tracks.push(track_from_path(path));
    }

    tracks.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(tracks)
}

fn resolve_music_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let _ = app;

    env::current_dir()
        .map_err(|error| error.to_string())?
        .join("music")
        .canonicalize()
        .map_err(|error| error.to_string())
}

fn is_supported_audio_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase()),
        Some(extension)
            if matches!(extension.as_str(), "mp3" | "wav" | "ogg" | "m4a" | "flac")
    )
}

fn track_from_path(path: PathBuf) -> DesktopTrack {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_string();
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let normalized = normalize_track_name(stem);
    let (artist, title) = split_artist_and_title(&normalized);

    DesktopTrack {
        id: file_name.to_ascii_lowercase(),
        title,
        artist,
    }
}

fn normalize_track_name(value: &str) -> String {
    let mut trimmed = value.trim();

    while let Some(first) = trimmed.chars().next() {
        if first.is_ascii_digit() || matches!(first, ' ' | '-' | '_' | '.') {
            trimmed = &trimmed[first.len_utf8()..];
            continue;
        }
        break;
    }

    trimmed.trim().to_string()
}

fn split_artist_and_title(value: &str) -> (Option<String>, String) {
    if let Some((artist, title)) = value.split_once(" - ") {
        let artist = artist.trim();
        let title = title.trim();

        if !artist.is_empty() && !title.is_empty() {
            return (Some(artist.to_string()), title.to_string());
        }
    }

    (None, value.to_string())
}

fn public_asset_url(path: &Path) -> String {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    format!("/{}", urlencoding::encode(file_name))
}
