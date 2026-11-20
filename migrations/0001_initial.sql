CREATE TABLE IF NOT EXISTS app_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO app_state (id, state_json, revision)
VALUES (
  1,
  '{"players":[],"matches":[],"seq":1,"session":"Club Open Play","courtCount":2}',
  1
);
