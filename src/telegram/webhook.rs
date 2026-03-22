use axum::{
    extract::{Query, State},
    http::HeaderMap,
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::app::AppCtx;
use crate::db::repo::{get_track_by_id, get_tracks_by_user, insert_track};

#[derive(Debug, Deserialize)]
pub struct Update {
    pub message: Option<Message>,
}

#[derive(Debug, Deserialize)]
pub struct Message {
    pub from: Option<User>,
    pub audio: Option<Audio>,
    pub document: Option<Document>,
}

#[derive(Debug, Deserialize)]
pub struct User {
    pub id: i64,
}

#[derive(Debug, Deserialize)]
pub struct Audio {
    pub file_id: String,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub duration: Option<u32>,
}

#[derive(Debug, Deserialize)]
pub struct Document {
    pub file_id: String,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct TracksQuery {
    pub user_id: Option<i64>,
}

#[derive(Debug, Deserialize)]
pub struct TrackAudioQuery {
    pub track_id: String,
}

#[derive(Debug, Deserialize)]
struct TelegramGetFileResponse {
    ok: bool,
    result: Option<TelegramFile>,
}

#[derive(Debug, Deserialize)]
struct TelegramFile {
    file_path: Option<String>,
}

pub async fn handler(
    State(ctx): State<AppCtx>,
    Json(update): Json<Update>,
) -> Json<Value> {
    if let Some(msg) = update.message {
        let user_id = msg.from.map(|u| u.id);

        if let Some(audio) = msg.audio {
            if let Some(uid) = user_id {
                insert_track(
                    &ctx.db,
                    uid,
                    audio.file_id,
                    audio.file_name,
                )
                .await;
            }

            return Json(json!({ "ok": true }));
        }

        if let Some(doc) = msg.document {
            if let Some(uid) = user_id {
                insert_track(
                    &ctx.db,
                    uid,
                    doc.file_id,
                    doc.file_name,
                )
                .await;
            }

            return Json(json!({ "ok": true }));
        }
    }

    Json(json!({ "ok": true }))
}

pub async fn get_tracks(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<TracksQuery>,
) -> (StatusCode, Json<Value>) {
    let user_id = q.user_id.or_else(|| {
        headers
            .get("x-telegram-user-id")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<i64>().ok())
    });

    match user_id {
        Some(user_id) => {
            let tracks = get_tracks_by_user(&ctx.db, user_id).await;
            (StatusCode::OK, Json(json!(tracks)))
        }
        None => (
            StatusCode::BAD_REQUEST,
            Json(json!({
            "error": "missing user id",
            "hint": "pass ?user_id=... or X-Telegram-User-Id header"
            })),
        ),
    }
}

pub async fn get_track_audio(
    State(ctx): State<AppCtx>,
    Query(q): Query<TrackAudioQuery>,
) -> (StatusCode, Json<Value>) {
    let Some(track) = get_track_by_id(&ctx.db, &q.track_id).await else {
        return (
            StatusCode::NOT_FOUND,
            Json(json!({
                "error": "track not found"
            })),
        );
    };

    let Some(token) = ctx.telegram_bot_token.as_deref() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "missing TELEGRAM_BOT_TOKEN"
            })),
        );
    };

    let url = format!(
        "https://api.telegram.org/bot{}/getFile?file_id={}",
        token, track.telegram_file_id
    );

    let response = match reqwest::get(url).await {
        Ok(response) => response,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "failed to contact telegram"
                })),
            )
        }
    };

    let payload: TelegramGetFileResponse = match response.json().await {
        Ok(payload) => payload,
        Err(_) => {
            return (
                StatusCode::BAD_GATEWAY,
                Json(json!({
                    "error": "invalid telegram response"
                })),
            )
        }
    };

    let Some(file_path) = payload.result.and_then(|file| file.file_path) else {
        return (
            StatusCode::BAD_GATEWAY,
            Json(json!({
                "error": "telegram did not return file_path"
            })),
        );
    };

    let file_url = format!(
        "https://api.telegram.org/file/bot{}/{}",
        token, file_path
    );

    (
        StatusCode::OK,
        Json(json!({
            "track_id": track.id,
            "title": track.title,
            "telegram_user_id": track.telegram_user_id,
            "file_url": file_url
        })),
    )
}
