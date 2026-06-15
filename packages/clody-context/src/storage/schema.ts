/** Bump when SCHEMA_SQL changes shape — mismatched DBs are dropped and recreated (no migrations). */
export const SCHEMA_VERSION = 2

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL UNIQUE,
  hash TEXT NOT NULL,
  language TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);

CREATE TABLE IF NOT EXISTS symbols (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  line INTEGER NOT NULL,
  col INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  to_path TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_imports_from ON imports(from_file_id);

CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('repository', 'failure')),
  tier TEXT NOT NULL DEFAULT 'episodic' CHECK(tier IN ('working', 'episodic', 'semantic')),
  content TEXT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  session_id TEXT,
  content_hash TEXT,
  created_at INTEGER NOT NULL,
  last_accessed_at INTEGER,
  access_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);

CREATE TABLE IF NOT EXISTS embeddings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('file', 'memory')),
  vector BLOB NOT NULL,
  UNIQUE(entity_id, entity_type)
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`
