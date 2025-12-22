-- 通过移除在 chat_members 中引用 chats 的策略，修复 chat/chat_members 的 RLS 递归问题

-- 删除导致递归的策略
DROP POLICY IF EXISTS "chat_members_select_by_member" ON chat_members;
DROP POLICY IF EXISTS "chat_members_insert_by_owner" ON chat_members;
DROP POLICY IF EXISTS "chat_members_update_by_owner" ON chat_members;
DROP POLICY IF EXISTS "chat_members_delete_by_owner" ON chat_members;

-- 查询：允许成员本人或该角色的创建者访问
CREATE POLICY "chat_members_select_self_or_character_author" ON chat_members
FOR SELECT TO authenticated
USING (
  (member_type = 'user' AND profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())))
  OR
  (member_type = 'character' AND EXISTS (
    SELECT 1 FROM characters ch
    WHERE ch.id = chat_members.character_id
      AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  ))
);

-- 插入：允许插入自己的用户成员记录或自己创建的角色成员记录
CREATE POLICY "chat_members_insert_self_or_character_author" ON chat_members
FOR INSERT TO authenticated
WITH CHECK (
  (member_type = 'user' AND profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())))
  OR
  (member_type = 'character' AND EXISTS (
    SELECT 1 FROM characters ch
    WHERE ch.id = chat_members.character_id
      AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  ))
);

-- 更新：同样仅允许上述主体
CREATE POLICY "chat_members_update_self_or_character_author" ON chat_members
FOR UPDATE TO authenticated
USING (
  (member_type = 'user' AND profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())))
  OR
  (member_type = 'character' AND EXISTS (
    SELECT 1 FROM characters ch
    WHERE ch.id = chat_members.character_id
      AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  ))
)
WITH CHECK (
  (member_type = 'user' AND profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())))
  OR
  (member_type = 'character' AND EXISTS (
    SELECT 1 FROM characters ch
    WHERE ch.id = chat_members.character_id
      AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  ))
);

-- 删除：同样仅允许上述主体
CREATE POLICY "chat_members_delete_self_or_character_author" ON chat_members
FOR DELETE TO authenticated
USING (
  (member_type = 'user' AND profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())))
  OR
  (member_type = 'character' AND EXISTS (
    SELECT 1 FROM characters ch
    WHERE ch.id = chat_members.character_id
      AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  ))
);
