-- 允许聊天拥有者或成员查询 chats，以便 INSERT RETURNING 不因无成员而被拒
DROP POLICY IF EXISTS "chats_select_by_member_v2" ON chats;
DROP POLICY IF EXISTS "chats_select_owner_or_member" ON chats;

CREATE POLICY "chats_select_owner_or_member" ON chats
FOR SELECT TO authenticated
USING (
  owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  OR EXISTS (
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
