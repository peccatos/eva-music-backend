use sqlx::{Pool, Sqlite};

#[derive(Clone)]
pub struct AppCtx {
    pub db: Pool<Sqlite>,
    pub telegram_bot_token: Option<String>,
}
