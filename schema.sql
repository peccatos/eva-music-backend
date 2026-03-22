CREATE TABLE IF NOT EXISTS tracks (
    id TEXT PRIMARY KEY,
    telegram_user_id INTEGER NOT NULL,
    telegram_file_id TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL
);