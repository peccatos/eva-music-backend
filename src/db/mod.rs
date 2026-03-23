use sqlx::{sqlite::SqlitePoolOptions, Pool, Sqlite};
use std::{fs, path::PathBuf};

pub mod repo;

pub async fn init_db(database_url: &str) -> Pool<Sqlite> {
    if let Some(path) = sqlite_file_path(database_url) {
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                fs::create_dir_all(parent).expect("failed to create sqlite database directory");
            }
        }
    }

    SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await
        .expect("failed to connect to sqlite")
}

fn sqlite_file_path(database_url: &str) -> Option<PathBuf> {
    let raw = database_url.strip_prefix("sqlite://")?;
    let raw = raw.split('?').next().unwrap_or(raw);

    if matches!(raw, ":memory:" | "/:memory:" | "file::memory:") {
        return None;
    }

    let path = if raw.starts_with('/') {
        let bytes = raw.as_bytes();
        let looks_like_windows_drive = bytes
            .get(1)
            .map(|byte| byte.is_ascii_alphabetic())
            .unwrap_or(false)
            && bytes.get(2) == Some(&b':');

        if looks_like_windows_drive {
            &raw[1..]
        } else {
            raw
        }
    } else {
        raw
    };

    Some(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use super::sqlite_file_path;

    #[test]
    fn parses_linux_sqlite_path() {
        let path = sqlite_file_path("sqlite:///var/data/tracks.db?mode=rwc").unwrap();
        assert_eq!(path, std::path::PathBuf::from("/var/data/tracks.db"));
    }

    #[test]
    fn parses_windows_sqlite_path() {
        let path = sqlite_file_path("sqlite:///C:/dev/eva-music-backend/tracks.db?mode=rwc").unwrap();
        assert_eq!(path, std::path::PathBuf::from("C:/dev/eva-music-backend/tracks.db"));
    }

    #[test]
    fn ignores_in_memory_sqlite() {
        assert!(sqlite_file_path("sqlite::memory:").is_none());
        assert!(sqlite_file_path("sqlite:///:memory:").is_none());
    }
}
