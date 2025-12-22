-- 聊天相关表：chats, chat_members, messages

-- 更新 updated_at 的触发器函数（若已存在则覆盖即可）
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS trigger AS $_$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$_$ LANGUAGE plpgsql SET search_path = '';

-- chats 表：会话信息
CREATE TABLE IF NOT EXISTS chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text,
  is_group boolean NOT NULL DEFAULT false,
  owner_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

-- chat_members 表：会话成员（支持真人用户或 AI 角色）
CREATE TABLE IF NOT EXISTS chat_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  member_type varchar(20) NOT NULL CHECK (member_type IN ('user','character')),
  profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  character_id uuid REFERENCES characters(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT chat_members_member_ck CHECK (
    (member_type = 'user' AND profile_id IS NOT NULL AND character_id IS NULL)
    OR (member_type = 'character' AND character_id IS NOT NULL AND profile_id IS NULL)
  )
);

-- 去重：同一会话内，同一真人或同一角色仅出现一次
CREATE UNIQUE INDEX IF NOT EXISTS chat_members_user_unique
  ON chat_members(chat_id, profile_id)
  WHERE member_type = 'user';

CREATE UNIQUE INDEX IF NOT EXISTS chat_members_character_unique
  ON chat_members(chat_id, character_id)
  WHERE member_type = 'character';

-- messages 表：聊天消息（支持真人用户或 AI 角色发送）
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id uuid NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_type varchar(20) NOT NULL CHECK (sender_type IN ('user','character')),
  sender_profile_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  sender_character_id uuid REFERENCES characters(id) ON DELETE CASCADE,
  message_type varchar(20) NOT NULL DEFAULT 'text',
  content text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT messages_sender_ck CHECK (
    (sender_type = 'user' AND sender_profile_id IS NOT NULL AND sender_character_id IS NULL)
    OR (sender_type = 'character' AND sender_character_id IS NOT NULL AND sender_profile_id IS NULL)
  )
);

-- 启用 RLS
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chats_select_by_member" ON chats
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

CREATE POLICY "chats_insert_by_owner" ON chats
FOR INSERT TO authenticated
WITH CHECK (owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())));

CREATE POLICY "chats_update_by_owner" ON chats
FOR UPDATE TO authenticated
USING (owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())));

CREATE POLICY "chats_delete_by_owner" ON chats
FOR DELETE TO authenticated
USING (owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())));

CREATE POLICY "chat_members_select_by_member" ON chat_members
FOR SELECT TO authenticated
USING (
  -- 真人用户成员自己可见
  (member_type = 'user' AND profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid())))
  OR
  -- 角色作者可见自己的角色成员记录
  (member_type = 'character' AND EXISTS (
    SELECT 1 FROM characters ch
    WHERE ch.id = chat_members.character_id
      AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  ))
  OR
  -- 会话拥有者可见所有成员
  EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_members.chat_id
      AND c.owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  )
);

CREATE POLICY "chat_members_insert_by_owner" ON chat_members
FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_members.chat_id
      AND c.owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  )
);

CREATE POLICY "chat_members_update_by_owner" ON chat_members
FOR UPDATE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_members.chat_id
      AND c.owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_members.chat_id
      AND c.owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  )
);

CREATE POLICY "chat_members_delete_by_owner" ON chat_members
FOR DELETE TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM chats c
    WHERE c.id = chat_members.chat_id
      AND c.owner_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  )
);

CREATE POLICY "messages_select_by_member" ON messages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM chat_members cm
    WHERE cm.chat_id = messages.chat_id
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

CREATE POLICY "messages_insert_by_member" ON messages
FOR INSERT TO authenticated
WITH CHECK (
  (
    sender_type = 'user'
    AND sender_profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = messages.chat_id
        AND cm.member_type = 'user'
        AND cm.profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
    )
  )
  OR
  (
    sender_type = 'character'
    AND EXISTS (
      SELECT 1 FROM characters ch
      WHERE ch.id = sender_character_id
        AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
    )
    AND EXISTS (
      SELECT 1 FROM chat_members cm
      WHERE cm.chat_id = messages.chat_id
        AND cm.member_type = 'character'
        AND cm.character_id = sender_character_id
    )
  )
);

CREATE POLICY "messages_update_by_sender" ON messages
FOR UPDATE TO authenticated
USING (
  (
    sender_type = 'user' AND sender_profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  )
  OR (
    sender_type = 'character' AND EXISTS (
      SELECT 1 FROM characters ch
      WHERE ch.id = sender_character_id AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
    )
  )
)
WITH CHECK (
  (
    sender_type = 'user' AND sender_profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  )
  OR (
    sender_type = 'character' AND EXISTS (
      SELECT 1 FROM characters ch
      WHERE ch.id = sender_character_id AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
    )
  )
);

CREATE POLICY "messages_delete_by_sender" ON messages
FOR DELETE TO authenticated
USING (
  (
    sender_type = 'user' AND sender_profile_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
  )
  OR (
    sender_type = 'character' AND EXISTS (
      SELECT 1 FROM characters ch
      WHERE ch.id = sender_character_id AND ch.author_id = (SELECT id FROM profiles WHERE uid = (SELECT auth.uid()))
    )
  )
);

-- updated_at 触发器
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_chats_updated_at') THEN
    CREATE TRIGGER update_chats_updated_at
    BEFORE UPDATE ON chats
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_chat_members_updated_at') THEN
    CREATE TRIGGER update_chat_members_updated_at
    BEFORE UPDATE ON chat_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_messages_updated_at') THEN
    CREATE TRIGGER update_messages_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;
