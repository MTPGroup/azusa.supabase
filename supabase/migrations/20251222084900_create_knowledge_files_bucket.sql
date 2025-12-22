-- 创建 knowledge_files storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'knowledge_files',
  'knowledge_files',
  false,
  52428800, -- 50MB
  ARRAY['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain', 'text/markdown', 'text/csv', 'text/html', 'application/json']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: 允许认证用户上传/读取自己知识库的文件
CREATE POLICY "knowledge_files_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'knowledge_files');

CREATE POLICY "knowledge_files_select" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'knowledge_files');

CREATE POLICY "knowledge_files_delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'knowledge_files');
