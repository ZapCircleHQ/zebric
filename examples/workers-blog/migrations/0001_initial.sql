CREATE TABLE Post (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  userId TEXT NOT NULL,
  createdAt TEXT NOT NULL
);
CREATE INDEX post_owner_created ON Post (userId, createdAt);
CREATE INDEX post_public_created ON Post (published, createdAt);
