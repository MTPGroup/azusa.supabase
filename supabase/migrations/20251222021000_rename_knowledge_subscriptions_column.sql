-- 将 knowledge_subscriptions.contact_id 重命名为 character_id，并修复主键/外键/RLS/函数

-- 重命名列
alter table knowledge_subscriptions rename column contact_id to character_id;

-- 调整主键
alter table knowledge_subscriptions drop constraint if exists knowledge_subscriptions_pkey;
alter table knowledge_subscriptions add constraint knowledge_subscriptions_pkey primary key (character_id, knowledge_base_id);

-- 调整外键
alter table knowledge_subscriptions drop constraint if exists knowledge_subscriptions_contact_id_fkey;
alter table knowledge_subscriptions add constraint knowledge_subscriptions_character_id_fkey
  foreign key (character_id) references characters(id) on delete cascade;

-- 重建 RLS 策略，使用 character_id
drop policy if exists "作者可查看自己角色的知识库关联" on knowledge_subscriptions;
drop policy if exists "作者可创建知识库关联" on knowledge_subscriptions;
drop policy if exists "作者可更新知识库关联" on knowledge_subscriptions;
drop policy if exists "作者可删除知识库关联" on knowledge_subscriptions;

create policy "作者可查看自己角色的知识库关联" on knowledge_subscriptions
for select to authenticated
using (
  exists (
    select 1 from characters c
    where c.id = knowledge_subscriptions.character_id
    and c.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);

create policy "作者可创建知识库关联" on knowledge_subscriptions
for insert to authenticated
with check (
  exists (
    select 1 from characters c
    where c.id = knowledge_subscriptions.character_id
    and c.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);

create policy "作者可更新知识库关联" on knowledge_subscriptions
for update to authenticated
using (
  exists (
    select 1 from characters c
    where c.id = knowledge_subscriptions.character_id
    and c.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);

create policy "作者可删除知识库关联" on knowledge_subscriptions
for delete to authenticated
using (
  exists (
    select 1 from characters c
    where c.id = knowledge_subscriptions.character_id
    and c.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);

-- 重新定义 RPC 函数，改用 character_id 参数
drop function if exists link_knowledge_base_to_ai(uuid, uuid, integer);
drop function if exists unlink_knowledge_base_from_ai(uuid, uuid);

create or replace function link_knowledge_base_to_ai(
  p_character_id uuid,
  p_knowledge_base_id uuid,
  p_priority integer default 0
) returns void
language plpgsql
as $$
begin
  insert into knowledge_subscriptions (character_id, knowledge_base_id, priority)
  values (p_character_id, p_knowledge_base_id, coalesce(p_priority, 0))
  on conflict (character_id, knowledge_base_id)
  do update set priority = excluded.priority;
end;
$$ set search_path = '';

create or replace function unlink_knowledge_base_from_ai(
  p_character_id uuid,
  p_knowledge_base_id uuid
) returns void
language plpgsql
as $$
begin
  delete from knowledge_subscriptions
  where character_id = p_character_id
    and knowledge_base_id = p_knowledge_base_id;
end;
$$ set search_path = '';
