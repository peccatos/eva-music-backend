use std::collections::BTreeMap;

use axum::{
    extract::{Json, State},
    http::{HeaderMap, StatusCode},
};
use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::Sha256;
use urlencoding::decode;

use crate::{
    app::AppCtx,
    db::repo::{get_tracks_by_user, Track},
};

type HmacSha256 = Hmac<Sha256>;

const TELEGRAM_INIT_DATA_HEADER: &str = "x-telegram-init-data";

#[derive(Debug, Deserialize)]
pub struct TelegramBootstrapRequest {
    #[serde(alias = "initDataRaw", alias = "initData")]
    pub init_data: String,
}

#[allow(dead_code)]
#[derive(Debug, Deserialize)]
struct TelegramWebAppUser {
    pub id: i64,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub username: Option<String>,
    pub language_code: Option<String>,
    pub is_premium: Option<bool>,
    pub added_to_attachment_menu: Option<bool>,
    pub allows_write_to_pm: Option<bool>,
    pub photo_url: Option<String>,
}

#[derive(Debug, Serialize)]
struct BootstrapTrack {
    pub id: String,
    pub title: String,
    pub artist: Option<String>,
    #[serde(rename = "artworkUrl")]
    pub artwork_url: Option<String>,
}

#[derive(Debug)]
pub struct ValidatedTelegramWebApp {
    pub telegram_user_id: i64,
    pub auth_date: Option<i64>,
    user: TelegramWebAppUser,
}

#[derive(Debug, thiserror::Error)]
pub enum TelegramWebAppError {
    #[error("missing init_data")]
    MissingInitData,
    #[error("missing bot token")]
    MissingBotToken,
    #[error("invalid init_data")]
    InvalidInitData,
    #[error("missing hash")]
    MissingHash,
    #[error("missing user")]
    MissingUser,
    #[error("invalid user payload")]
    InvalidUserPayload,
    #[error("invalid signature")]
    InvalidSignature,
}

impl TelegramWebAppError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::MissingBotToken => StatusCode::INTERNAL_SERVER_ERROR,
            Self::InvalidSignature => StatusCode::UNAUTHORIZED,
            _ => StatusCode::BAD_REQUEST,
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::MissingInitData => "missing_init_data",
            Self::MissingBotToken => "missing_bot_token",
            Self::InvalidInitData => "invalid_init_data",
            Self::MissingHash => "missing_hash",
            Self::MissingUser => "missing_user",
            Self::InvalidUserPayload => "invalid_user_payload",
            Self::InvalidSignature => "invalid_signature",
        }
    }

    pub fn message(&self) -> &'static str {
        match self {
            Self::MissingInitData => "missing init_data",
            Self::MissingBotToken => "missing bot token",
            Self::InvalidInitData => "invalid init_data",
            Self::MissingHash => "missing hash",
            Self::MissingUser => "missing user",
            Self::InvalidUserPayload => "invalid user payload",
            Self::InvalidSignature => "invalid signature",
        }
    }
}

fn decode_component(value: &str) -> Result<String, TelegramWebAppError> {
    let normalized = value.replace('+', " ");
    decode(&normalized)
        .map(|decoded| decoded.into_owned())
        .map_err(|_| TelegramWebAppError::InvalidInitData)
}

fn parse_init_data_fields(init_data: &str) -> Result<BTreeMap<String, String>, TelegramWebAppError> {
    let trimmed = init_data.trim();

    if trimmed.is_empty() {
        return Err(TelegramWebAppError::MissingInitData);
    }

    let mut fields = BTreeMap::new();

    for pair in trimmed.split('&') {
        let (raw_key, raw_value) = pair
            .split_once('=')
            .ok_or(TelegramWebAppError::InvalidInitData)?;

        let key = decode_component(raw_key)?;
        let value = decode_component(raw_value)?;
        fields.insert(key, value);
    }

    Ok(fields)
}

fn build_data_check_string(fields: &BTreeMap<String, String>) -> Result<String, TelegramWebAppError> {
    let mut data_fields = Vec::new();

    for (key, value) in fields {
        if key == "hash" || key == "signature" {
            continue;
        }

        data_fields.push(format!("{key}={value}"));
    }

    if data_fields.is_empty() {
        return Err(TelegramWebAppError::InvalidInitData);
    }

    Ok(data_fields.join("\n"))
}

fn compute_secret_key(bot_token: &str) -> Result<Vec<u8>, TelegramWebAppError> {
    let mut mac = HmacSha256::new_from_slice(b"WebAppData")
        .map_err(|_| TelegramWebAppError::MissingBotToken)?;
    mac.update(bot_token.as_bytes());
    Ok(mac.finalize().into_bytes().to_vec())
}

pub fn validate_init_data(
    init_data: &str,
    bot_token: &str,
) -> Result<ValidatedTelegramWebApp, TelegramWebAppError> {
    let fields = parse_init_data_fields(init_data)?;

    let received_hash = fields
        .get("hash")
        .cloned()
        .ok_or(TelegramWebAppError::MissingHash)?;
    let data_check_string = build_data_check_string(&fields)?;
    let secret_key = compute_secret_key(bot_token)?;

    let mut mac = HmacSha256::new_from_slice(&secret_key)
        .map_err(|_| TelegramWebAppError::MissingBotToken)?;
    mac.update(data_check_string.as_bytes());
    let calculated_hash = hex::encode(mac.finalize().into_bytes());

    if !calculated_hash.eq_ignore_ascii_case(&received_hash) {
        return Err(TelegramWebAppError::InvalidSignature);
    }

    let user_payload = fields
        .get("user")
        .ok_or(TelegramWebAppError::MissingUser)?;
    let user: TelegramWebAppUser = serde_json::from_str(user_payload)
        .map_err(|_| TelegramWebAppError::InvalidUserPayload)?;

    Ok(ValidatedTelegramWebApp {
        telegram_user_id: user.id,
        auth_date: fields.get("auth_date").and_then(|value| value.parse::<i64>().ok()),
        user,
    })
}

fn bootstrap_track(track: Track) -> BootstrapTrack {
    BootstrapTrack {
        id: track.id,
        title: track.title.unwrap_or_else(|| "Без названия".to_string()),
        artist: None,
        artwork_url: None,
    }
}

pub fn error_response(error: TelegramWebAppError) -> (StatusCode, Json<Value>) {
    (
        error.status(),
        Json(json!({
            "error": error.message(),
            "code": error.code(),
        })),
    )
}

pub fn extract_init_data_header(headers: &HeaderMap) -> Option<String> {
    headers
        .get(TELEGRAM_INIT_DATA_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .map(str::to_string)
        .filter(|value| !value.is_empty())
}

pub fn resolve_trusted_telegram_user_id(
    headers: &HeaderMap,
    ctx: &AppCtx,
) -> Result<Option<i64>, TelegramWebAppError> {
    let Some(init_data) = extract_init_data_header(headers) else {
        return Ok(None);
    };

    let Some(token) = ctx.telegram_bot_token.as_deref() else {
        return Err(TelegramWebAppError::MissingBotToken);
    };

    let validated = validate_init_data(&init_data, token)?;
    Ok(Some(validated.telegram_user_id))
}

pub async fn bootstrap_telegram(
    State(ctx): State<AppCtx>,
    Json(payload): Json<TelegramBootstrapRequest>,
) -> (StatusCode, Json<Value>) {
    let Some(token) = ctx.telegram_bot_token.as_deref() else {
        return error_response(TelegramWebAppError::MissingBotToken);
    };

    let validated = match validate_init_data(&payload.init_data, token) {
        Ok(validated) => validated,
        Err(error) => return error_response(error),
    };

    let tracks = get_tracks_by_user(&ctx.db, validated.telegram_user_id).await;
    let tracks = tracks.into_iter().map(bootstrap_track).collect::<Vec<_>>();

    (
        StatusCode::OK,
        Json(json!({
            "telegram_user_id": validated.telegram_user_id,
            "tracks": tracks,
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::db;
    use axum::Router;
    use serde_json::json;
    use sqlx::{Pool, Sqlite};
    use tokio::net::TcpListener;
    use urlencoding::encode;
    use uuid::Uuid;

    fn sign_init_data(fields: &[(&str, &str)], bot_token: &str) -> String {
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

    async fn spawn_app(app: Router) -> std::net::SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });

        tokio::task::yield_now().await;
        addr
    }

    async fn create_test_db() -> Pool<Sqlite> {
        let db_path = std::env::temp_dir().join(format!("eva-music-backend-webapp-test-{}.sqlite", Uuid::new_v4()));
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

    #[test]
    fn validate_init_data_accepts_signed_payload() {
        let init_data = sign_init_data(
            &[
                ("auth_date", "1711234567"),
                ("query_id", "AAHdFf12345"),
                ("user", r#"{"id":1124976403,"first_name":"Test","username":"tester"}"#),
            ],
            "test-token",
        );

        let validated = validate_init_data(&init_data, "test-token").unwrap();
        assert_eq!(validated.telegram_user_id, 1124976403);
        assert_eq!(validated.auth_date, Some(1711234567));
        assert_eq!(validated.user.first_name.as_deref(), Some("Test"));
    }

    #[test]
    fn validate_init_data_rejects_bad_signature() {
        let init_data = "auth_date=1711234567&query_id=AAHdFf12345&user=%7B%22id%22%3A1124976403%7D&hash=deadbeef";
        let error = validate_init_data(init_data, "test-token").unwrap_err();
        assert!(matches!(error, TelegramWebAppError::InvalidSignature));
    }

    #[tokio::test]
    async fn bootstrap_endpoint_returns_user_library() {
        let pool = create_test_db().await;
        seed_track(&pool, "track-1", 1124976403, "telegram-file-1", Some("Song A")).await;
        let app = Router::new().route("/auth/telegram", axum::routing::post(bootstrap_telegram));
        let addr = spawn_app(app.with_state(AppCtx {
            db: pool,
            telegram_bot_token: Some("test-token".to_string()),
            telegram_api_base: "http://127.0.0.1:9999".to_string(),
        }))
        .await;

        let init_data = sign_init_data(
            &[
                ("auth_date", "1711234567"),
                ("query_id", "AAHdFf12345"),
                ("user", r#"{"id":1124976403,"first_name":"Test","username":"tester"}"#),
            ],
            "test-token",
        );

        let response = reqwest::Client::new()
            .post(format!("http://{addr}/auth/telegram"))
            .json(&json!({ "init_data": init_data }))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = response.json::<Value>().await.unwrap();
        assert_eq!(body["telegram_user_id"], 1124976403);
        assert_eq!(body["tracks"].as_array().unwrap().len(), 1);
        assert_eq!(body["tracks"][0]["id"], "track-1");
        assert_eq!(body["tracks"][0]["title"], "Song A");
        assert_eq!(body["tracks"][0]["artist"], Value::Null);
        assert_eq!(body["tracks"][0]["artworkUrl"], Value::Null);
    }

    #[tokio::test]
    async fn bootstrap_endpoint_rejects_invalid_signature() {
        let pool = create_test_db().await;
        let app = Router::new().route("/auth/telegram", axum::routing::post(bootstrap_telegram));
        let addr = spawn_app(app.with_state(AppCtx {
            db: pool,
            telegram_bot_token: Some("test-token".to_string()),
            telegram_api_base: "http://127.0.0.1:9999".to_string(),
        }))
        .await;

        let response = reqwest::Client::new()
            .post(format!("http://{addr}/auth/telegram"))
            .json(&json!({
                "init_data": "auth_date=1711234567&query_id=AAHdFf12345&user=%7B%22id%22%3A1124976403%7D&hash=deadbeef"
            }))
            .send()
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        let body = response.json::<Value>().await.unwrap();
        assert_eq!(body["code"], "invalid_signature");
    }
}
