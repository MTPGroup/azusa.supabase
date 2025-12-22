-- contacts 表 RLS 策略：仅联系人拥有者可读写

-- 若已有旧策略，先移除
DROP POLICY IF EXISTS "contacts_select_by_owner" ON contacts;
DROP POLICY IF EXISTS "contacts_insert_by_owner" ON contacts;
DROP POLICY IF EXISTS "contacts_update_by_owner" ON contacts;
DROP POLICY IF EXISTS "contacts_delete_by_owner" ON contacts;

-- 启用 RLS（如已启用则无影响）
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;

-- 仅联系人拥有者可查看
CREATE POLICY "contacts_select_by_owner" ON contacts
FOR SELECT TO authenticated
USING (
  profile_id = (
    SELECT id FROM profiles WHERE uid = (SELECT auth.uid())
  )
);

-- 仅联系人拥有者可插入
CREATE POLICY "contacts_insert_by_owner" ON contacts
FOR INSERT TO authenticated
WITH CHECK (
  profile_id = (
    SELECT id FROM profiles WHERE uid = (SELECT auth.uid())
  )
);

-- 仅联系人拥有者可更新
CREATE POLICY "contacts_update_by_owner" ON contacts
FOR UPDATE TO authenticated
USING (
  profile_id = (
    SELECT id FROM profiles WHERE uid = (SELECT auth.uid())
  )
)
WITH CHECK (
  profile_id = (
    SELECT id FROM profiles WHERE uid = (SELECT auth.uid())
  )
);

-- 仅联系人拥有者可删除
CREATE POLICY "contacts_delete_by_owner" ON contacts
FOR DELETE TO authenticated
USING (
  profile_id = (
    SELECT id FROM profiles WHERE uid = (SELECT auth.uid())
  )
);
