-- Create table for storing tags and their associated paths
CREATE TABLE IF NOT EXISTS tags (
    tag TEXT NOT NULL,
    path TEXT NOT NULL,
    UNIQUE(tag, path) ON CONFLICT REPLACE
);

-- Create table for storing revalidation timestamps
CREATE TABLE IF NOT EXISTS revalidations (
    tag TEXT NOT NULL,
    revalidatedAt INTEGER NOT NULL,
    UNIQUE(tag) ON CONFLICT REPLACE
);
