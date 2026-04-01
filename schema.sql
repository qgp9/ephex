-- RelayX Database Schema

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'user',
    api_token TEXT UNIQUE,
    settings TEXT
);

CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    filename TEXT,
    original_name TEXT,
    user_id INTEGER,
    expires_at DATETIME,
    max_downloads INTEGER,
    current_downloads INTEGER DEFAULT 0,
    is_encrypted INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
);
