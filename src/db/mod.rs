use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite};

pub mod repo;

pub async fn init_db(database_url: &str) -> Pool<Sqlite> {
    SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .expect("failed to connect to sqlite")
}