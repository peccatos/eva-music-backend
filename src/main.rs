mod app;
mod db;
mod telegram;

use app::AppCtx;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    // 🔥 ЖЁСТКО: используем абсолютный путь, без магии
    let db = db::init_db("sqlite:///C:/dev/eva-music-backend/tracks.db?mode=rwc").await;
    let telegram_bot_token = std::env::var("TELEGRAM_BOT_TOKEN").ok();

    // создаём таблицу
    sqlx::query(include_str!("../schema.sql"))
        .execute(&db)
        .await
        .unwrap();

    let ctx = AppCtx {
        db,
        telegram_bot_token,
    };

    let app = Router::new()
        .route("/", get(health))
        .route("/health", get(health))
        .route("/telegram/webhook", post(telegram::webhook::handler))
        .route("/tracks/me", get(telegram::webhook::get_tracks))
        .route("/tracks/audio", get(telegram::webhook::get_track_audio))
        .with_state(ctx);

    let addr = SocketAddr::from(([127, 0, 0, 1], 3001));
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    println!("server running on http://{}", addr);

    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "ok"
}
