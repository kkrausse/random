CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('media', 'workout')),
  source_type TEXT NOT NULL CHECK (source_type IN ('browser', 'local-backfill', 'workout-archive')),
  source_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'completed', 'completed-with-errors', 'failed')),
  original_relative_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE import_items (
  id TEXT PRIMARY KEY,
  import_id TEXT NOT NULL REFERENCES imports(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('media', 'workout')),
  entity_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  original_filename TEXT NOT NULL,
  error_message TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (import_id, source_key)
);

CREATE TABLE media (
  id TEXT PRIMARY KEY,
  import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('processing', 'ready', 'failed')),
  kind TEXT CHECK (kind IN ('photo', 'video')),
  original_filename TEXT NOT NULL,
  original_relative_path TEXT NOT NULL,
  original_mime_type TEXT,
  original_byte_size INTEGER NOT NULL CHECK (original_byte_size > 0),
  storage_mode TEXT NOT NULL CHECK (storage_mode IN ('copy', 'move', 'hardlink', 'upload')),
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  captured_at TEXT,
  captured_at_override TEXT,
  latitude REAL,
  longitude REAL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  processing_version TEXT NOT NULL,
  failure_code TEXT,
  failure_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE media_derivatives (
  id TEXT PRIMARY KEY,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('thumbnail', 'viewer', 'poster', 'proxy')),
  relative_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  processing_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (media_id, kind, processing_version)
);

CREATE TABLE trip_media (
  trip_id TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (trip_id, media_id)
);

CREATE TABLE workouts (
  id TEXT PRIMARY KEY,
  import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
  trip_id TEXT REFERENCES trips(id) ON DELETE SET NULL,
  title TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  activity_type TEXT,
  distance_meters REAL,
  original_relative_path TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workout_points (
  workout_id TEXT NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  recorded_at TEXT NOT NULL,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  elevation_meters REAL,
  metadata_json TEXT,
  PRIMARY KEY (workout_id, sequence)
);

CREATE INDEX imports_status_idx ON imports(status);
CREATE INDEX import_items_import_idx ON import_items(import_id, status);
CREATE INDEX media_status_capture_idx ON media(status, captured_at);
CREATE INDEX media_import_idx ON media(import_id);
CREATE INDEX media_derivatives_media_idx ON media_derivatives(media_id);
CREATE INDEX workouts_trip_idx ON workouts(trip_id, started_at);
CREATE INDEX workouts_import_idx ON workouts(import_id);
CREATE INDEX workout_points_recorded_idx ON workout_points(recorded_at);
CREATE INDEX workout_points_workout_idx ON workout_points(workout_id);
