-- Computer Vision presentation manager.
-- Timestamps are UTC ISO-8601. Presentation wall-clock values are Asia/Tehran.
-- D1 enforces foreign keys by default. Local tests enable them explicitly.

CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL UNIQUE,
  first_name TEXT NOT NULL,
  last_name TEXT,
  username TEXT,
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  has_started_bot INTEGER NOT NULL DEFAULT 0 CHECK (has_started_bot IN (0, 1)),
  blocked_bot INTEGER NOT NULL DEFAULT 0 CHECK (blocked_bot IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chapters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_number INTEGER NOT NULL UNIQUE CHECK (chapter_number > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  presentation_date TEXT CHECK (presentation_date IS NULL OR length(presentation_date) = 10),
  presentation_time TEXT CHECK (presentation_time IS NULL OR length(presentation_time) = 5),
  registration_open INTEGER NOT NULL DEFAULT 1 CHECK (registration_open IN (0, 1)),
  closed_by TEXT CHECK (closed_by IS NULL OR closed_by IN ('admin', 'auto')),
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  registered_at TEXT NOT NULL,
  UNIQUE (user_id, chapter_id)
);

CREATE INDEX idx_registrations_chapter ON registrations (chapter_id);

CREATE TRIGGER registrations_capacity_guard
BEFORE INSERT ON registrations
FOR EACH ROW
WHEN (SELECT COUNT(*) FROM registrations WHERE chapter_id = NEW.chapter_id) >= 3
BEGIN
  SELECT RAISE(ABORT, 'CHAPTER_FULL');
END;

CREATE TABLE telegram_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  message_id INTEGER NOT NULL,
  message_type TEXT NOT NULL UNIQUE,
  updated_at TEXT NOT NULL
);

CREATE TABLE reminder_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL CHECK (reminder_type IN ('three_days', 'one_day', 'same_day')),
  scheduled_at TEXT NOT NULL,
  sent_at TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'blocked', 'skipped')),
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_retry_at TEXT,
  claimed_at TEXT,
  UNIQUE (user_id, chapter_id, reminder_type)
);

CREATE INDEX idx_reminder_logs_status ON reminder_logs (status, next_retry_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE sessions (
  telegram_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  payload TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('course_title', 'بینایی کامپیوتر'),
  ('professor_name', ''),
  ('book_name', ''),
  ('semester_name', ''),
  ('group_chat_id', ''),
  ('same_day_reminder_enabled', 'false'),
  ('timezone', 'Asia/Tehran');
