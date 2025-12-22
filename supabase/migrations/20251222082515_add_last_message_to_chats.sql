-- 为会话列表添加摘要字段
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message text;