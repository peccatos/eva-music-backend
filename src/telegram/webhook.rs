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
use crate::telegram::webapp::{error_response, resolve_trusted_telegram_user_id};

const PLAYER_WEBAPP_URL: &str = "https://ssmusicfront.onrender.com/player";

#[derive(Debug, Deserialize)]
pub struct Update {
    pub message: Option<Message>,
}

#[derive(Debug, Deserialize)]
pub struct Message {
    pub from: Option<User>,
    pub text: Option<String>,
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
}

#[derive(Debug, Deserialize)]
pub struct Document {
    pub file_id: String,
    pub file_name: Option<String>,
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
        let chat_id = msg.from.as_ref().map(|u| u.id);
        let user_id = chat_id;

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

        if let Some(text) = msg.text.as_deref() {
            let command = text.trim();

            if matches!(command, "/start" | "/player") {
                if let Some(chat_id) = chat_id {
                    let _ = send_webapp_button(chat_id, &ctx).await;
                }
            }
        }
    }

    Json(json!({ "ok": true }))
}

async fn send_webapp_button(chat_id: i64, ctx: &AppCtx) -> Result<(), ()> {
    let Some(token) = ctx.telegram_bot_token.as_deref() else {
        return Err(());
    };

    let telegram_base = ctx.telegram_api_base.trim_end_matches('/');
    let url = format!("{telegram_base}/bot{}/sendMessage", token);

    let body = json!({
        "chat_id": chat_id,
        "text": "Открыть плеер",
        "reply_markup": {
            "keyboard": [[
                {
                    "text": "Слушай",
                    "web_app": {
                        "url": PLAYER_WEBAPP_URL
                    }
                }
            ]],
            "resize_keyboard": true
        }
    });

    let _ = reqwest::Client::new()
        .post(url)
        .json(&body)
        .send()
        .await;

    Ok(())
}

pub async fn get_tracks(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Query(q): Query<TracksQuery>,
) -> (StatusCode, Json<Value>) {
    let trusted_user_id = match resolve_trusted_telegram_user_id(&headers, &ctx) {
        Ok(user_id) => user_id,
        Err(error) => return error_response(error),
    };

    let user_id = trusted_user_id.or_else(|| {
        q.user_id.or_else(|| {
            headers
                .get("x-telegram-user-id")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<i64>().ok())
        })
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
    headers: HeaderMap,
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

    let trusted_user_id = match resolve_trusted_telegram_user_id(&headers, &ctx) {
        Ok(user_id) => user_id,
        Err(error) => return error_response(error),
    };

    if let Some(user_id) = trusted_user_id {
        if track.telegram_user_id != user_id {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({
                    "error": "forbidden",
                    "code": "forbidden"
                })),
            );
        }
    }

    let Some(token) = ctx.telegram_bot_token.as_deref() else {
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({
                "error": "missing TELEGRAM_BOT_TOKEN"
            })),
        );
    };

    let telegram_base = ctx.telegram_api_base.trim_end_matches('/');
    let url = format!(
        "{telegram_base}/bot{}/getFile?file_id={}",
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
        "{telegram_base}/file/bot{}/{}",
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

#[cfg(test)]
mod tests {
    use super::*;

    use crate::db;
    use axum::{
        extract::State as AxumState,
        routing::{get, post},
        Json as AxumJson,
        Router,
    };
    use hmac::{Hmac, Mac};
    use serde_json::Value;
    use sqlx::{Pool, Sqlite};
    use sha2::Sha256;
    use std::{net::SocketAddr, path::PathBuf, sync::Arc};
    use tokio::{net::TcpListener, sync::Mutex};
    use urlencoding::encode;
    use uuid::Uuid;

    async fn spawn_app(app: Router) -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        tokio::task::yield_now().await;
        addr
    }

    async fn create_test_db() -> Pool<Sqlite> {
        let db_path = temp_db_path();
        let database_url = format!(
            "sqlite:///{}?mode=rwc",
            db_path.to_string_lossy().replace('\\', "/")
        );
        let pool = db::init_db(&database_url).await;
        sqlx::query(include_str!("../../schema.sql"))
            .execute(&pool)
            .await
            .unwrap();
        pool
    }

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("eva-music-backend-webhook-test-{}.sqlite", Uuid::new_v4()))
    }

    async fn capture_send_message(
        AxumState(captured): AxumState<Arc<Mutex<Option<Value>>>>,
        AxumJson(body): AxumJson<Value>,
    ) -> AxumJson<Value> {
        *captured.lock().await = Some(body);
        AxumJson(json!({ "ok": true }))
    }

    async fn spawn_send_message_mock(captured: Arc<Mutex<Option<Value>>>) -> SocketAddr {
        let app = Router::new()
            .route("/bottest-token/sendMessage", post(capture_send_message))
            .with_state(captured);

        spawn_app(app).await
    }

    async fn spawn_telegram_mock() -> SocketAddr {
        let app = Router::new().fallback(get(|| async {
            AxumJson(json!({
                "result": {
                    "file_path": "files/sample.mp3"
                }
            }))
        }));

        spawn_app(app).await
    }

    async fn seed_track(
        pool: &Pool<Sqlite>,
        id: &str,
        telegram_user_id: i64,
        telegram_file_id: &str,
        title: Option<&str>,
    ) {
        sqlx::query(
            r#"
            INSERT INTO tracks (id, telegram_user_id, telegram_file_id, title, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            "#,
        )
        .bind(id)
        .bind(telegram_user_id)
        .bind(telegram_file_id)
        .bind(title)
        .bind("2026-03-23T00:00:00Z")
        .execute(pool)
        .await
        .unwrap();
    }

    fn sign_init_data(fields: &[(&str, &str)], bot_token: &str) -> String {
        type HmacSha256 = Hmac<Sha256>;

        let mut data_fields = fields
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>();
        data_fields.sort();
        let data_check_string = data_fields.join("\n");

        let mut encoded_fields = fields
            .iter()
            .map(|(key, value)| format!("{}={}", encode(key), encode(value)))
            .collect::<Vec<_>>();
        encoded_fields.sort();

        let mut mac = HmacSha256::new_from_slice(b"WebAppData").unwrap();
        mac.update(bot_token.as_bytes());
        let secret_key = mac.finalize().into_bytes();

        let mut mac = HmacSha256::new_from_slice(&secret_key).unwrap();
        mac.update(data_check_string.as_bytes());
        let hash = hex::encode(mac.finalize().into_bytes());

        let mut init_data = encoded_fields;
        init_data.push(format!("hash={hash}"));
        init_data.join("&")
    }

    #[tokio::test]
    async fn start_and_player_commands_send_webapp_button() {
        let captured = Arc::new(Mutex::new(None));
        let telegram_addr = spawn_send_message_mock(captured.clone()).await;
        let ctx = AppCtx {
            db: create_test_db().await,
            telegram_bot_token: Some("test-token".to_string()),
            telegram_api_base: format!("http://{telegram_addr}"),
        };

        for command in ["/start", "/player"] {
            let update = Update {
                message: Some(Message {
                    from: Some(User { id: 777 }),
                    text: Some(command.to_string()),
                    audio: None,
                    document: None,
                }),
            };

            let response = handler(State(ctx.clone()), Json(update)).await;
            assert_eq!(response.0, json!({ "ok": true }));

            let body = captured.lock().await.take().expect("expected sendMessage payload");
            assert_eq!(body["chat_id"], 777);
            assert_eq!(body["text"], "Открыть плеер");
            assert_eq!(body["reply_markup"]["keyboard"][0][0]["text"], "Слушай");
            assert_eq!(body["reply_markup"]["resize_keyboard"], true);
            assert_eq!(
                body["reply_markup"]["keyboard"][0][0]["web_app"]["url"],
                PLAYER_WEBAPP_URL
            );
        }
    }

    #[tokio::test]
    async fn handler_keeps_audio_and_document_ingestion_working() {
        let pool = create_test_db().await;
        let ctx = AppCtx {
            db: pool.clone(),
            telegram_bot_token: None,
            telegram_api_base: "http://127.0.0.1:9999".to_string(),
        };

        let audio_update = Update {
            message: Some(Message {
                from: Some(User { id: 888 }),
                text: None,
                audio: Some(Audio {
                    file_id: "audio-file-1".to_string(),
                    file_name: Some("Song A".to_string()),
                }),
                document: None,
            }),
        };
        let document_update = Update {
            message: Some(Message {
                from: Some(User { id: 888 }),
                text: None,
                audio: None,
                document: Some(Document {
                    file_id: "document-file-2".to_string(),
                    file_name: Some("Doc B".to_string()),
                }),
            }),
        };

        let _ = handler(State(ctx.clone()), Json(audio_update)).await;
        let _ = handler(State(ctx), Json(document_update)).await;

        let tracks = get_tracks_by_user(&pool, 888).await;
        assert_eq!(tracks.len(), 2);
        let file_ids: Vec<_> = tracks.iter().map(|track| track.telegram_file_id.as_str()).collect();
        assert!(file_ids.contains(&"audio-file-1"));
        assert!(file_ids.contains(&"document-file-2"));
    }

    #[tokio::test]
    async fn tracks_audio_requires_valid_telegram_context_when_present() {
        let pool = create_test_db().await;
        seed_track(
            &pool,
            "track-1",
            1124976403,
            "telegram-file-1",
            Some("Song A"),
        )
        .await;

        let telegram_addr = spawn_telegram_mock().await;
        let telegram_api_base = format!("http://{telegram_addr}");
        let ctx = AppCtx {
            db: pool,
            telegram_bot_token: Some("test-token".to_string()),
            telegram_api_base,
        };
        let addr = spawn_app(axum::Router::new().route(
            "/tracks/audio",
            axum::routing::get(get_track_audio),
        ).with_state(ctx)).await;

        let valid_init_data = sign_init_data(
            &[
                ("auth_date", "1711234567"),
                ("query_id", "AAHdFf12345"),
                ("user", r#"{"id":1124976403,"first_name":"Test"}"#),
            ],
            "test-token",
        );

        let client = reqwest::Client::new();
        let response = client
            .get(format!("http://{addr}/tracks/audio?track_id=track-1"))
            .header("X-Telegram-Init-Data", valid_init_data)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let invalid_response = client
            .get(format!("http://{addr}/tracks/audio?track_id=track-1"))
            .header(
                "X-Telegram-Init-Data",
                "auth_date=1711234567&query_id=AAHdFf12345&user=%7B%22id%22%3A1124976403%7D&hash=deadbeef",
            )
            .send()
            .await
            .unwrap();
        assert_eq!(invalid_response.status(), StatusCode::UNAUTHORIZED);
    }
}
