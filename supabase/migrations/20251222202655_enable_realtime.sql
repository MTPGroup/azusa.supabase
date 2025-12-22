-- 开启 知识库表 的 Realtime
alter publication supabase_realtime add table knowledge_bases;

-- 开启 知识库文件表 的 Realtime
alter publication supabase_realtime add table knowledge_files;

-- 开启 插件表 的 Realtime
alter publication supabase_realtime add table plugins;