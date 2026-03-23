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
