use std::{
    env,
    net::{IpAddr, Ipv4Addr, SocketAddr},
};

#[cfg(windows)]
const DEFAULT_DATABASE_URL: &str = "sqlite:///C:/dev/eva-music-backend/tracks.db?mode=rwc";
#[cfg(not(windows))]
const DEFAULT_DATABASE_URL: &str = "sqlite:///var/data/tracks.db?mode=rwc";
const DEFAULT_PORT: u16 = 3001;
const DEFAULT_TELEGRAM_API_BASE: &str = "https://api.telegram.org";

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub database_url: String,
    pub telegram_bot_token: Option<String>,
    pub telegram_api_base: String,
    pub port: u16,
}

impl AppConfig {
    pub fn from_env() -> Self {
        dotenvy::dotenv().ok();

        Self {
            database_url: env::var("DATABASE_URL")
                .unwrap_or_else(|_| DEFAULT_DATABASE_URL.to_string()),
            telegram_bot_token: env::var("TELEGRAM_BOT_TOKEN").ok(),
            telegram_api_base: env::var("TELEGRAM_API_BASE")
                .unwrap_or_else(|_| DEFAULT_TELEGRAM_API_BASE.to_string()),
            port: env::var("PORT")
                .ok()
                .and_then(|value| value.parse::<u16>().ok())
                .unwrap_or(DEFAULT_PORT),
        }
    }

    pub fn bind_addr(&self) -> SocketAddr {
        SocketAddr::new(IpAddr::V4(Ipv4Addr::UNSPECIFIED), self.port)
    }
}
