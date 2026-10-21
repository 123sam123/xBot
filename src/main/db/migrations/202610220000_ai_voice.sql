-- T6 (XBOT-4BCGOR): the user's voice preferences for local AI. One profile row
-- (id = 1, seeded here) and the posts the user explicitly approved as
-- examples. Independent of every other domain's migrations.
CREATE TABLE voice_profile (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  casual_polished      INTEGER NOT NULL CHECK (casual_polished BETWEEN 0 AND 100),
  dry_playful          INTEGER NOT NULL CHECK (dry_playful BETWEEN 0 AND 100),
  technical_accessible INTEGER NOT NULL CHECK (technical_accessible BETWEEN 0 AND 100),
  emoji                TEXT NOT NULL CHECK (emoji IN ('none', 'sparingly', 'freely')),
  profanity            TEXT NOT NULL CHECK (profanity IN ('none', 'mild', 'ok')),
  banned_phrases       TEXT NOT NULL CHECK (json_valid(banned_phrases) AND json_type(banned_phrases) = 'array'),
  style_brief          TEXT NOT NULL CHECK (length(style_brief) <= 1200),
  updated_at           TEXT NOT NULL
);

INSERT INTO voice_profile (id, casual_polished, dry_playful, technical_accessible, emoji, profanity, banned_phrases, style_brief, updated_at)
VALUES (1, 25, 55, 50, 'sparingly', 'none', '[]', '', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

CREATE TABLE voice_examples (
  id         TEXT PRIMARY KEY,
  text       TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL
);

CREATE INDEX voice_examples_created ON voice_examples (created_at);
