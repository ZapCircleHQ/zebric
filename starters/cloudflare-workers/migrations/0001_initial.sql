-- Initial migration for Task Manager
-- This schema matches the blueprint.toml entities

CREATE TABLE IF NOT EXISTS Task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 0,
  dueDate TEXT,
  createdAt TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_task_status ON Task(status);
CREATE INDEX IF NOT EXISTS idx_task_priority ON Task(priority);
CREATE INDEX IF NOT EXISTS idx_task_due_date ON Task(dueDate);
