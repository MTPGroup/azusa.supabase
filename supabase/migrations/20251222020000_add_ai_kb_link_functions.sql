-- 用于角色与知识库关联的 RPC 辅助函数

create or replace function link_knowledge_base_to_ai(
  p_ai_contact_id uuid,
  p_knowledge_base_id uuid,
  p_priority integer default 0
) returns void
language plpgsql
as $$
begin
  -- 如果已存在则更新优先级，否则插入新关联
  insert into knowledge_subscriptions (ai_contact_id, knowledge_base_id, priority)
  values (p_ai_contact_id, p_knowledge_base_id, coalesce(p_priority, 0))
  on conflict (ai_contact_id, knowledge_base_id)
  do update set priority = excluded.priority;
end;
$$ set search_path = '';

create or replace function unlink_knowledge_base_from_ai(
  p_ai_contact_id uuid,
  p_knowledge_base_id uuid
) returns void
language plpgsql
as $$
begin
  -- 删除角色与知识库的关联
  delete from knowledge_subscriptions
  where ai_contact_id = p_ai_contact_id
    and knowledge_base_id = p_knowledge_base_id;
end;
$$ set search_path = '';

create policy "公开或作者可查看角色" on characters
for select
using (is_public = true or author_id = (select id from profiles where uid = (select auth.uid())));

create policy "作者可以创建角色" on characters
for insert to authenticated
with check (author_id = (select id from profiles where uid = (select auth.uid())));

create policy "作者可以更新角色" on characters
for update to authenticated
using (author_id = (select id from profiles where uid = (select auth.uid())));

create policy "作者可以删除角色" on characters
for delete to authenticated
using (author_id = (select id from profiles where uid = (select auth.uid())));

-- RLS 策略：knowledge_subscriptions 表（角色与知识库关联）
create policy "作者可查看自己角色的知识库关联" on knowledge_subscriptions
for select to authenticated
using (
  exists (
    select 1 from characters c
    where c.id = knowledge_subscriptions.contact_id
    and c.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);

create policy "作者可创建知识库关联" on knowledge_subscriptions
for insert to authenticated
with check (
  exists (
    select 1 from characters c
    where c.id = knowledge_subscriptions.contact_id
    and c.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);

create policy "作者可更新知识库关联" on knowledge_subscriptions
for update to authenticated
using (
  exists (
    select 1 from characters c
    where c.id = knowledge_subscriptions.contact_id
    and c.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);

create policy "作者可删除知识库关联" on knowledge_subscriptions
for delete to authenticated
using (
  exists (
    select 1 from characters c
    where c.id = knowledge_subscriptions.contact_id
    and c.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);
