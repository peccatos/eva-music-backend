use crate::{app::AppCtx, config::AppConfig, db, telegram};
use axum::{
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use sqlx::{Pool, Sqlite};
use std::error::Error;
use tower_http::cors::CorsLayer;

const SCHEMA_SQL: &str = include_str!("../schema.sql");

pub async fn run() -> Result<(), Box<dyn Error>> {
    let config = AppConfig::from_env();
    let db = db::init_db(&config.database_url).await;
    let addr = config.bind_addr();

    ensure_schema(&db).await?;

    let state = AppCtx {
        db,
        telegram_bot_token: config.telegram_bot_token,
        telegram_api_base: config.telegram_api_base,
    };

    let app = build_router(state);
    let listener = tokio::net::TcpListener::bind(addr).await?;

    println!("server running on http://{addr}");

    axum::serve(listener, app).await?;
    Ok(())
}

async fn ensure_schema(db: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    sqlx::query(SCHEMA_SQL).execute(db).await?;
    Ok(())
}

fn build_router(state: AppCtx) -> Router {
    Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .route("/telegram/webhook", post(telegram::webhook::handler))
        .route("/tracks/me", get(telegram::webhook::get_tracks))
        .route("/tracks/audio", get(telegram::webhook::get_track_audio))
        .layer(CorsLayer::permissive())
        .with_state(state)
}

async fn health() -> Json<Value> {
    Json(json!({
        "status": "ok"
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::db;
    use axum::{routing::get, Json as AxumJson, Router};
    use reqwest::StatusCode;
    use serde_json::{json, Value};
    use sqlx::{Pool, Sqlite};
    use std::{net::SocketAddr, path::PathBuf};
    use tokio::net::TcpListener;
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
        ensure_schema(&pool).await.unwrap();
        pool
    }

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("eva-music-backend-test-{}.sqlite", Uuid::new_v4()))
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

    #[tokio::test]
    async fn root_and_health_return_ok_json() {
        let pool = create_test_db().await;
        let state = AppCtx {
            db: pool,
            telegram_bot_token: None,
            telegram_api_base: "http://127.0.0.1:9999".to_string(),
        };
        let addr = spawn_app(build_router(state)).await;
        let client = reqwest::Client::new();

        for path in ["/", "/health"] {
            let response = client
                .get(format!("http://{addr}{path}"))
                .send()
                .await
                .unwrap();

            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.json::<Value>().await.unwrap(), json!({ "status": "ok" }));
        }
    }

    #[tokio::test]
    async fn tracks_me_returns_raw_db_rows() {
        let pool = create_test_db().await;
        seed_track(
            &pool,
            "track-1",
            123,
            "telegram-file-1",
            Some("Song A"),
        )
        .await;

        let state = AppCtx {
            db: pool,
            telegram_bot_token: None,
            telegram_api_base: "http://127.0.0.1:9999".to_string(),
        };
        let addr = spawn_app(build_router(state)).await;
        let response = reqwest::get(format!("http://{addr}/tracks/me?user_id=123"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = response.json::<Value>().await.unwrap();
        let tracks = body.as_array().expect("tracks payload should be an array");
        let first = tracks.first().expect("tracks array should contain one row");

        assert_eq!(first["id"], "track-1");
        assert_eq!(first["telegram_user_id"], 123);
        assert_eq!(first["telegram_file_id"], "telegram-file-1");
        assert_eq!(first["title"], "Song A");
        assert_eq!(first["created_at"], "2026-03-23T00:00:00Z");
    }

    #[tokio::test]
    async fn tracks_audio_returns_file_url() {
        let pool = create_test_db().await;
        seed_track(
            &pool,
            "track-1",
            123,
            "telegram-file-1",
            Some("Song A"),
        )
        .await;

        let telegram_addr = spawn_telegram_mock().await;
        let telegram_api_base = format!("http://{telegram_addr}");
        let state = AppCtx {
            db: pool,
            telegram_bot_token: Some("test-token".to_string()),
            telegram_api_base,
        };
        let addr = spawn_app(build_router(state)).await;
        let response = reqwest::get(format!("http://{addr}/tracks/audio?track_id=track-1"))
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = response.json::<Value>().await.unwrap();
        assert_eq!(body["track_id"], "track-1");
        assert_eq!(body["title"], "Song A");
        assert_eq!(body["telegram_user_id"], 123);
        assert_eq!(
            body["file_url"],
            format!("http://{telegram_addr}/file/bottest-token/files/sample.mp3")
        );
    }
}
