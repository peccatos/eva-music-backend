mod app;
mod db;
mod telegram;

use app::AppCtx;
use axum::{
    routing::{get, post},
    Router,
};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite:///C:/dev/eva-music-backend/tracks.db?mode=rwc".to_string());
    let db = db::init_db(&database_url).await;
    let telegram_bot_token = std::env::var("TELEGRAM_BOT_TOKEN").ok();
    let port = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .unwrap_or(3001);

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
        .layer(CorsLayer::permissive())
        .with_state(ctx);

    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), port);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();

    println!("server running on http://{}", addr);

    axum::serve(listener, app).await.unwrap();
}

async fn health() -> &'static str {
    "ok"
}
