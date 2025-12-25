-- Allow service_role to bypass RLS for knowledge files/documents and storage bucket

-- knowledge_files: full access for service_role
create policy "Service role manage knowledge_files" on public.knowledge_files
  for all to service_role
  using (true)
  with check (true);

-- knowledge_documents: full access for service_role
create policy "Service role manage knowledge_documents" on public.knowledge_documents
  for all to service_role
  using (true)
  with check (true);

-- storage.objects for knowledge_files bucket: full access for service_role
create policy "Service role manage storage knowledge_files" on storage.objects
  for all to service_role
  using (bucket_id = 'knowledge_files')
  with check (bucket_id = 'knowledge_files');
