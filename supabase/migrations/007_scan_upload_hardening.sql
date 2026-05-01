-- ============================================================
-- SCANNER MODULE UPLOAD HARDENING
-- ============================================================

-- Normalize any existing order before enforcing uniqueness. This keeps the
-- migration safe if concurrent page uploads already created duplicate indexes.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY scan_id
      ORDER BY page_index ASC, created_at ASC, id ASC
    ) - 1 AS next_page_index
  FROM scan_pages
)
UPDATE scan_pages p
SET page_index = ranked.next_page_index
FROM ranked
WHERE p.id = ranked.id
  AND p.page_index <> ranked.next_page_index;

CREATE UNIQUE INDEX IF NOT EXISTS idx_scan_pages_scan_page_index_unique
  ON scan_pages(scan_id, page_index);

CREATE OR REPLACE FUNCTION append_scan_page(
  p_scan_id UUID,
  p_owner_id UUID,
  p_original_drive_file_id TEXT,
  p_original_drive_file_name TEXT,
  p_original_mime_type TEXT,
  p_original_size_bytes BIGINT
)
RETURNS scan_pages
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_page_index INTEGER;
  v_page scan_pages;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_scan_id::text));

  SELECT COALESCE(MAX(page_index) + 1, 0)
  INTO v_page_index
  FROM scan_pages
  WHERE scan_id = p_scan_id;

  IF v_page_index >= 30 THEN
    RAISE EXCEPTION 'page_limit_reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO scan_pages (
    scan_id,
    owner_id,
    page_index,
    original_drive_file_id,
    original_drive_file_name,
    original_mime_type,
    original_size_bytes,
    adjustments
  )
  VALUES (
    p_scan_id,
    p_owner_id,
    v_page_index,
    p_original_drive_file_id,
    p_original_drive_file_name,
    p_original_mime_type,
    p_original_size_bytes,
    '{}'::jsonb
  )
  RETURNING * INTO v_page;

  UPDATE scan_documents
  SET
    status = 'DRAFT',
    page_count = (
      SELECT COUNT(*)::integer
      FROM scan_pages
      WHERE scan_id = p_scan_id
    ),
    updated_at = now()
  WHERE id = p_scan_id;

  RETURN v_page;
END;
$$;

REVOKE ALL ON FUNCTION append_scan_page(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION append_scan_page(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) FROM anon;
REVOKE ALL ON FUNCTION append_scan_page(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) FROM authenticated;
GRANT EXECUTE ON FUNCTION append_scan_page(UUID, UUID, TEXT, TEXT, TEXT, BIGINT) TO service_role;
