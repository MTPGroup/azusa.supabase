-- 修复 SQL 函数的 search_path 以免找不到表
-- 这解决了 "relation knowledge_subscriptions does not exist" 等错误

ALTER FUNCTION update_updated_at_column() SET search_path = 'public';
ALTER FUNCTION link_knowledge_base_to_ai(uuid, uuid, integer) SET search_path = 'public';
ALTER FUNCTION unlink_knowledge_base_from_ai(uuid, uuid) SET search_path = 'public';
