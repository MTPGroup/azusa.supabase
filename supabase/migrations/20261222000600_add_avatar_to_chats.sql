-- 为 chats 表添加头像字段
ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar text;
