ALTER TABLE media ADD COLUMN content_hash TEXT;

CREATE UNIQUE INDEX media_content_hash_idx
ON media(content_hash)
WHERE content_hash IS NOT NULL;
