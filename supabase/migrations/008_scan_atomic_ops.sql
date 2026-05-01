-- ============================================================
-- SCANNER MODULE: ATOMIC OPS + DEFENSE-IN-DEPTH RLS
-- ============================================================

-- The unique index on (scan_id, page_index) is checked per-row, which conflicts
-- with reorder/delete operations that swap indexes within one transaction.
-- Replace it with a deferrable UNIQUE constraint so the check fires at COMMIT.
DROP INDEX IF EXISTS idx_scan_pages_scan_page_index_unique;
ALTER TABLE scan_pages
  ADD CONSTRAINT scan_pages_scan_page_index_key
  UNIQUE (scan_id, page_index) DEFERRABLE INITIALLY DEFERRED;

-- ----------------------------------------------------------------
-- create_scan_document: atomic quota check + insert
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_scan_document(
  p_owner_id UUID,
  p_title TEXT,
  p_max INTEGER
)
RETURNS scan_documents
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_doc scan_documents;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('scan_quota:' || p_owner_id::text));
  SELECT COUNT(*)::INTEGER INTO v_count FROM scan_documents WHERE owner_id = p_owner_id;
  IF v_count >= p_max THEN
    RAISE EXCEPTION 'scan_limit_reached' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO scan_documents (owner_id, title, status)
  VALUES (p_owner_id, p_title, 'DRAFT')
  RETURNING * INTO v_doc;
  RETURN v_doc;
END;
$$;
REVOKE ALL ON FUNCTION create_scan_document(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_scan_document(UUID, TEXT, INTEGER) FROM anon;
REVOKE ALL ON FUNCTION create_scan_document(UUID, TEXT, INTEGER) FROM authenticated;
GRANT EXECUTE ON FUNCTION create_scan_document(UUID, TEXT, INTEGER) TO service_role;

-- ----------------------------------------------------------------
-- append_scan_page: derive owner_id from scan_documents (do not trust caller)
-- ----------------------------------------------------------------
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
  v_owner UUID;
  v_page scan_pages;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_scan_id::text));

  SELECT owner_id INTO v_owner FROM scan_documents WHERE id = p_scan_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'scan_not_found' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(MAX(page_index) + 1, 0) INTO v_page_index
  FROM scan_pages WHERE scan_id = p_scan_id;

  IF v_page_index >= 30 THEN
    RAISE EXCEPTION 'page_limit_reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO scan_pages (
    scan_id, owner_id, page_index,
    original_drive_file_id, original_drive_file_name,
    original_mime_type, original_size_bytes, adjustments
  )
  VALUES (
    p_scan_id, v_owner, v_page_index,
    p_original_drive_file_id, p_original_drive_file_name,
    p_original_mime_type, p_original_size_bytes, '{}'::jsonb
  )
  RETURNING * INTO v_page;

  UPDATE scan_documents
  SET status = 'DRAFT',
      page_count = (SELECT COUNT(*)::integer FROM scan_pages WHERE scan_id = p_scan_id),
      updated_at = now()
  WHERE id = p_scan_id;

  RETURN v_page;
END;
$$;

-- ----------------------------------------------------------------
-- reorder_scan_pages: atomic reorder using deferred constraint
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION reorder_scan_pages(
  p_scan_id UUID,
  p_ordered_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
  v_updated INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_scan_id::text));

  SELECT COUNT(*)::INTEGER INTO v_count FROM scan_pages WHERE scan_id = p_scan_id;
  IF v_count <> COALESCE(array_length(p_ordered_ids, 1), 0) THEN
    RAISE EXCEPTION 'invalid_page_order' USING ERRCODE = 'P0001';
  END IF;

  WITH src AS (
    SELECT u.id AS page_id, (u.idx - 1)::INTEGER AS new_index
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS u(id, idx)
  ), upd AS (
    UPDATE scan_pages p
    SET page_index = src.new_index
    FROM src
    WHERE p.id = src.page_id AND p.scan_id = p_scan_id
    RETURNING 1
  )
  SELECT COUNT(*)::INTEGER INTO v_updated FROM upd;

  IF v_updated <> v_count THEN
    RAISE EXCEPTION 'invalid_page_order' USING ERRCODE = 'P0001';
  END IF;

  UPDATE scan_documents SET updated_at = now() WHERE id = p_scan_id;
END;
$$;
REVOKE ALL ON FUNCTION reorder_scan_pages(UUID, UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION reorder_scan_pages(UUID, UUID[]) FROM anon;
REVOKE ALL ON FUNCTION reorder_scan_pages(UUID, UUID[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION reorder_scan_pages(UUID, UUID[]) TO service_role;

-- ----------------------------------------------------------------
-- delete_scan_page: atomic delete + reindex + page_count update
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_scan_page(
  p_scan_id UUID,
  p_page_id UUID
)
RETURNS TABLE(original_drive_file_id TEXT, processed_drive_file_id TEXT)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_index INTEGER;
  v_original TEXT;
  v_processed TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_scan_id::text));

  SELECT sp.page_index, sp.original_drive_file_id, sp.processed_drive_file_id
  INTO v_index, v_original, v_processed
  FROM scan_pages sp WHERE sp.id = p_page_id AND sp.scan_id = p_scan_id;
  IF v_index IS NULL THEN
    RAISE EXCEPTION 'page_not_found' USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM scan_pages WHERE id = p_page_id;
  UPDATE scan_pages SET page_index = page_index - 1
    WHERE scan_id = p_scan_id AND page_index > v_index;

  UPDATE scan_documents
  SET page_count = (SELECT COUNT(*)::integer FROM scan_pages WHERE scan_id = p_scan_id),
      updated_at = now()
  WHERE id = p_scan_id;

  original_drive_file_id := v_original;
  processed_drive_file_id := v_processed;
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION delete_scan_page(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_scan_page(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION delete_scan_page(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION delete_scan_page(UUID, UUID) TO service_role;

-- ----------------------------------------------------------------
-- Defense-in-depth RLS: owner-only SELECT.
-- All mutations continue through the service role (which bypasses RLS).
-- ----------------------------------------------------------------
CREATE POLICY scan_documents_owner_select ON scan_documents
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_project_roles upr
      WHERE upr.user_id = auth.uid() AND upr.role = 'SUPER_ADMIN'
    )
  );

CREATE POLICY scan_pages_owner_select ON scan_pages
  FOR SELECT
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_project_roles upr
      WHERE upr.user_id = auth.uid() AND upr.role = 'SUPER_ADMIN'
    )
  );
