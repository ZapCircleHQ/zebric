-- Blog database schema for CloudFlare D1

CREATE TABLE IF NOT EXISTS post (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  content TEXT NOT NULL,
  published INTEGER DEFAULT 0,
  publishedAt TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_post_slug ON post(slug);
CREATE INDEX IF NOT EXISTS idx_post_published ON post(published);
CREATE INDEX IF NOT EXISTS idx_post_publishedAt ON post(publishedAt);

CREATE TABLE IF NOT EXISTS comment (
  id TEXT PRIMARY KEY,
  postId TEXT NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  approved INTEGER DEFAULT 0,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL,
  FOREIGN KEY (postId) REFERENCES post(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comment_postId ON comment(postId);
CREATE INDEX IF NOT EXISTS idx_comment_approved ON comment(approved);

-- Insert sample data
INSERT INTO post (id, title, slug, content, published, publishedAt, createdAt, updatedAt)
VALUES
  ('post-1', 'Welcome to Zebric on CloudFlare Workers', 'welcome', 'This is a sample blog post running on CloudFlare Workers Edge network!', 1, datetime('now'), datetime('now'), datetime('now')),
  ('post-2', 'Building Serverless Apps', 'serverless-apps', 'Learn how to build serverless applications with Zebric and CloudFlare Workers.', 1, datetime('now'), datetime('now'), datetime('now'))
ON CONFLICT(id) DO NOTHING;

INSERT INTO comment (id, postId, author, content, approved, createdAt, updatedAt)
VALUES
  ('comment-1', 'post-1', 'Jane Developer', 'Great post! Loving the performance.', 1, datetime('now'), datetime('now'))
ON CONFLICT(id) DO NOTHING;
