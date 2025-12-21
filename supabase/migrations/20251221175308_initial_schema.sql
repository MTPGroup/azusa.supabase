-- 启用扩展
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists vector with schema extensions;

-- 核心表 (用户资料与设置)
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  uid uuid unique references auth.users(id) on delete cascade,
  username varchar(50) not null,
  avatar text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists settings (
  owner_id uuid primary key references profiles(id) on delete cascade,
  theme varchar(30) not null default 'system',
  chat_models jsonb not null default '[]'::jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- 插件系统
create table if not exists plugins (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  version text not null,
  liked integer not null default 0,
  status varchar(20) not null default 'pending' check (status in ('pending', 'rejected', 'approved', 'archived')),
  schema jsonb not null,
  code text not null,
  author_id uuid references profiles(id) on delete cascade not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists plugin_subscriptions (
  user_id uuid not null references profiles(id) on delete cascade,
  plugin_id uuid not null references plugins(id) on delete cascade,
  is_active boolean not null default false,
  subscribed_at timestamp with time zone default now() not null,
  primary key (user_id, plugin_id)
);

-- AI 角色
create table if not exists characters (
  id uuid primary key default gen_random_uuid(),
  author_id uuid references profiles(id) on delete cascade not null,
  name varchar(100) not null,
  avatar text,
  bio text,
  origin_prompt text,
  is_public boolean not null default false,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

create table if not exists contacts (
  profile_id uuid not null references profiles(id) on delete cascade,
  contact_id uuid not null references characters(id) on delete cascade,
  nickname varchar(100),
  added_at timestamp with time zone default now() not null,
  primary key (profile_id, contact_id)
);

-- RAG / 知识库系统

-- 知识库 (数据集)
create table if not exists knowledge_bases (
  id uuid primary key default gen_random_uuid(),
  name varchar(100) not null,
  description text,
  author_id uuid references profiles(id) on delete cascade not null,
  is_public boolean not null default false,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- 知识文件 (上传到存储的源文件)
create table if not exists knowledge_files (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id uuid references knowledge_bases(id) on delete cascade not null,
  file_path text not null, -- 存储桶中的路径
  file_name text not null,
  file_size integer,
  file_type text,
  status varchar(20) not null default 'pending' check (status in ('pending', 'processing', 'completed', 'failed')),
  error_message text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- 知识文档 (切片/向量)
create table if not exists knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  knowledge_base_id uuid references knowledge_bases(id) on delete cascade not null,
  file_id uuid references knowledge_files(id) on delete cascade, -- 可选，如果切片来自文件
  content text not null,
  metadata jsonb default '{}'::jsonb, -- 存储页码、切片索引等
  embedding vector(1024), -- 允许为空，以便在生成嵌入前插入
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null
);

-- AI -> 知识库关联
create table if not exists knowledge_subscriptions (
  contact_id uuid not null references characters(id) on delete cascade,
  knowledge_base_id uuid not null references knowledge_bases(id) on delete cascade,
  priority integer not null default 0,
  primary key (contact_id, knowledge_base_id)
);

-- 存储设置
insert into storage.buckets (id, name, public)
values ('knowledge_files', 'knowledge_files', false)
on conflict (id) do nothing;

-- RLS 策略

-- 在所有表上启用 RLS
alter table profiles enable row level security;
alter table settings enable row level security;
alter table plugins enable row level security;
alter table plugin_subscriptions enable row level security;
alter table characters enable row level security;
alter table contacts enable row level security;
alter table knowledge_bases enable row level security;
alter table knowledge_files enable row level security;
alter table knowledge_documents enable row level security;
alter table knowledge_subscriptions enable row level security;

-- 用户资料策略
create policy "Public profiles are viewable by everyone" on profiles for select using (true);
create policy "Users can insert their own profile" on profiles for insert with check ((select auth.uid()) = uid);
create policy "Users can update their own profile" on profiles for update using ((select auth.uid()) = uid);

-- 设置策略
create policy "Users can view their own settings" on settings for select using ((select auth.uid()) = (select uid from profiles where id = owner_id));
create policy "Users can update their own settings" on settings for update using ((select auth.uid()) = (select uid from profiles where id = owner_id));
create policy "Users can insert their own settings" on settings for insert with check ((select auth.uid()) = (select uid from profiles where id = owner_id));

-- 知识库策略
create policy "Knowledge bases are viewable by everyone if public" on knowledge_bases for select to anon using (is_public = true);
create policy "Users can view their own knowledge bases" on knowledge_bases for select to authenticated using (is_public = true or author_id = (select id from profiles where uid = (select auth.uid())));
create policy "Users can insert their own knowledge bases" on knowledge_bases for insert to authenticated with check (author_id = (select id from profiles where uid = (select auth.uid())));
create policy "Users can update their own knowledge bases" on knowledge_bases for update to authenticated using (author_id = (select id from profiles where uid = (select auth.uid())));
create policy "Users can delete their own knowledge bases" on knowledge_bases for delete to authenticated using (author_id = (select id from profiles where uid = (select auth.uid())));

-- 知识文件策略 (继承自知识库)
create policy "Users can view files of accessible knowledge bases" on knowledge_files for select using (
  exists (
    select 1 from knowledge_bases kb
    where kb.id = knowledge_files.knowledge_base_id
    and (kb.is_public = true or kb.author_id = (select id from profiles where uid = (select auth.uid())))
  )
);
create policy "Users can insert files of their own knowledge bases" on knowledge_files for insert to authenticated with check (
  exists (
    select 1 from knowledge_bases kb
    where kb.id = knowledge_base_id
    and kb.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);
create policy "Users can update files of their own knowledge bases" on knowledge_files for update to authenticated using (
  exists (
    select 1 from knowledge_bases kb
    where kb.id = knowledge_files.knowledge_base_id
    and kb.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);
create policy "Users can delete files of their own knowledge bases" on knowledge_files for delete to authenticated using (
  exists (
    select 1 from knowledge_bases kb
    where kb.id = knowledge_base_id
    and kb.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);
create policy "Users can update documents of their own knowledge bases" on knowledge_documents for update to authenticated using (
  exists (
    select 1 from knowledge_bases kb
    where kb.id = knowledge_documents.knowledge_base_id
    and kb.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);
create policy "Users can delete documents of their own knowledge bases" on knowledge_documents for delete to authenticated using (
  exists (
    select 1 from knowledge_bases kb
    where kb.id = knowledge_documents.knowledge_base_id
    and kb.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);
create policy "Users can insert documents of their own knowledge bases" on knowledge_documents for insert to authenticated with check (
  exists (
    select 1 from knowledge_bases kb
    where kb.id = knowledge_base_id
    and kb.author_id = (select id from profiles where uid = (select auth.uid()))
  )
);

-- 知识文档策略 (继承自知识库)
create policy "Users can view documents of accessible knowledge bases" on knowledge_documents for select using (
  exists (
    select 1 from knowledge_bases kb
    where kb.id = knowledge_documents.knowledge_base_id
    and (kb.is_public = true or kb.author_id = (select id from profiles where uid = (select auth.uid())))
  )
);

-- 存储策略
create policy "Users can view their own knowledge files"
on storage.objects for select
to authenticated
using (
  bucket_id = 'knowledge_files'
  and (owner = (select auth.uid()))
);

create policy "Authenticated users can upload knowledge files"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'knowledge_files'
  and (owner = (select auth.uid()))
);

create policy "Users can update their own knowledge files"
on storage.objects for update
to authenticated
using (
  bucket_id = 'knowledge_files'
  and (owner = (select auth.uid()))
);

create policy "Users can delete their own knowledge files"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'knowledge_files'
  and (owner = (select auth.uid()))
);

-- 函数与触发器

-- 更新 updated_at 触发器
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql set search_path = '';

create trigger update_profiles_updated_at before update on profiles for each row execute function update_updated_at_column();
create trigger update_settings_updated_at before update on settings for each row execute function update_updated_at_column();
create trigger update_plugins_updated_at before update on plugins for each row execute function update_updated_at_column();
create trigger update_characters_updated_at before update on characters for each row execute function update_updated_at_column();
create trigger update_knowledge_bases_updated_at before update on knowledge_bases for each row execute function update_updated_at_column();
create trigger update_knowledge_files_updated_at before update on knowledge_files for each row execute function update_updated_at_column();
create trigger update_knowledge_documents_updated_at before update on knowledge_documents for each row execute function update_updated_at_column();

-- 匹配文档 RPC (向量搜索)
create or replace function match_knowledge_documents (
  query_embedding vector(1024),
  knowledge_base_ids uuid[],
  match_threshold float default 0.5,
  match_count int default 10
)
returns table (
  id uuid,
  knowledge_base_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    kd.id,
    kd.knowledge_base_id,
    kd.content,
    kd.metadata,
    1 - (kd.embedding <=> query_embedding) as similarity
  from public.knowledge_documents kd
  where 
    kd.knowledge_base_id = any(knowledge_base_ids)
    and 1 - (kd.embedding <=> query_embedding) > match_threshold
  order by kd.embedding <=> query_embedding
  limit match_count;
end;
$$ set search_path = '';
