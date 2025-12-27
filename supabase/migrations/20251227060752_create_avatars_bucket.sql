INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "avatars_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars');

CREATE POLICY "avatars_select" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'avatars');

CREATE POLICY "avatars_delete" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'avatars');

CREATE POLICY "Service role manage storage avatars" ON storage.objects
FOR ALL TO service_role
USING (bucket_id = 'avatars')
WITH CHECK (bucket_id = 'avatars');
