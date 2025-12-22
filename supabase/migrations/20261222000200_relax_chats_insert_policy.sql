-- 放宽 chats 的插入策略，避免递归错误并允许已认证用户创建聊天

DROP POLICY IF EXISTS "chats_insert_by_owner" ON chats;

CREATE POLICY "chats_insert_authenticated" ON chats
FOR INSERT TO authenticated
WITH CHECK (true);
