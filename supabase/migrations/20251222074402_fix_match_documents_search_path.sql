-- 修复 match_knowledge_documents 函数的 search_path 问题
-- 原函数设置 search_path = '' 导致 pgvector 的 <=> 操作符无法找到

CREATE OR REPLACE FUNCTION match_knowledge_documents (
  query_embedding extensions.vector(1024),
  knowledge_base_ids uuid[],
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  knowledge_base_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kd.id,
    kd.knowledge_base_id,
    kd.content,
    kd.metadata,
    1 - (kd.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_documents kd
  WHERE 
    kd.knowledge_base_id = ANY(knowledge_base_ids)
    AND 1 - (kd.embedding <=> query_embedding) > match_threshold
  ORDER BY kd.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
