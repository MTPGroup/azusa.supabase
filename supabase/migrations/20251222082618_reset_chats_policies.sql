-- 重新定义 chats 表的 RLS，允许已认证用户按 owner_id 创建聊天

-- 清理旧策略
DROP POLICY IF EXISTS "chats_select_by_member" ON chats;
DROP POLICY IF EXISTS "chats_insert_by_owner" ON chats;
DROP POLICY IF EXISTS "chats_insert_authenticated" ON chats;
DROP POLICY IF EXISTS "chats_update_by_owner" ON chats;
DROP POLICY IF EXISTS "chats_delete_by_owner" ON chats;

-- 查询：成员或角色作者可见
CREATE POLICY "chats_select_by_member_v2" ON chats
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM chat_members cm
    WHERE cm.chat_id = chats.id
      AND (
        (cm.member_type = 'user' AND cm.profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())))
        OR (
          cm.member_type = 'character' AND EXISTS (
            SELECT 1 FROM characters ch
            WHERE ch.id = cm.character_id AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
          )
        )
      )
  )
);

-- 插入：owner_id 必须等于当前用户的 profile id
CREATE POLICY "chats_insert_owner_v2" ON chats
FOR INSERT TO authenticated
WITH CHECK (
  owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
);

-- 更新：仅拥有者
CREATE POLICY "chats_update_owner_v2" ON chats
FOR UPDATE TO authenticated
USING (owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())))
WITH CHECK (owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())));

-- 删除：仅拥有者
CREATE POLICY "chats_delete_owner_v2" ON chats
FOR DELETE TO authenticated
USING (owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())));
