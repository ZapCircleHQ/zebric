-- Application schema; ownership is assigned by the runtime, never client input.
CREATE TABLE Task (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX task_owner_created ON Task (userId, createdAt);
