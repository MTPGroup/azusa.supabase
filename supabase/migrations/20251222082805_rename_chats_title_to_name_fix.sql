-- 安全地将 chats.title 重命名为 chats.name（兼容不支持 IF EXISTS 的语法）
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'chats'
      AND column_name = 'title'
  ) THEN
    ALTER TABLE chats RENAME COLUMN title TO name;
  END IF;
END $$;
