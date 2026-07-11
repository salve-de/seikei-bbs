CREATE TABLE IF NOT EXISTS thread_counters (
  thread_id TEXT PRIMARY KEY,
  next_comment_no INTEGER NOT NULL
);
