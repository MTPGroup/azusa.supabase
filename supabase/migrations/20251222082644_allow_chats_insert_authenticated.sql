-- 允许任何已认证用户插入 chats，用于自动化测试与开发
DROP POLICY IF EXISTS "chats_insert_any_authenticated" ON chats;
CREATE POLICY "chats_insert_any_authenticated" ON chats
FOR INSERT TO authenticated
WITH CHECK (true);
