use serde::Serialize;
use sqlx::{Pool, Sqlite};
use uuid::Uuid;
use chrono::Utc;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Track {
    pub id: String,
    pub telegram_user_id: i64,
    pub telegram_file_id: String,
    pub title: Option<String>,
    pub created_at: String,
}

pub async fn insert_track(
    pool: &Pool<Sqlite>,
    telegram_user_id: i64,
    file_id: String,
    title: Option<String>,
) {
    let id = Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();

    sqlx::query(
        r#"
        INSERT INTO tracks (id, telegram_user_id, telegram_file_id, title, created_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#
    )
    .bind(id)
    .bind(telegram_user_id)
    .bind(file_id)
    .bind(title)
    .bind(now)
    .execute(pool)
    .await
    .unwrap();
}

pub async fn get_tracks_by_user(
    pool: &Pool<Sqlite>,
    telegram_user_id: i64,
) -> Vec<Track> {
    sqlx::query_as::<_, Track>(
        r#"
        SELECT id, telegram_user_id, telegram_file_id, title, created_at
        FROM tracks
        WHERE telegram_user_id = ?1
        ORDER BY created_at DESC
        "#
    )
    .bind(telegram_user_id)
    .fetch_all(pool)
    .await
    .unwrap()
}

pub async fn get_track_by_id(
    pool: &Pool<Sqlite>,
    track_id: &str,
) -> Option<Track> {
    sqlx::query_as::<_, Track>(
        r#"
        SELECT id, telegram_user_id, telegram_file_id, title, created_at
        FROM tracks
        WHERE id = ?1
        "#,
    )
    .bind(track_id)
    .fetch_optional(pool)
    .await
    .unwrap()
}
