-- 将 messages.content 调整为 jsonb，用于存储 MessageContent（text/image_url 等）

ALTER TABLE messages
  ALTER COLUMN content DROP NOT NULL,
  ALTER COLUMN content TYPE jsonb USING content::jsonb,
  ALTER COLUMN content SET DEFAULT '[]'::jsonb;
