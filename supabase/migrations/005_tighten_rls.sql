-- ============================================================
-- Tighten open write policies for API-only writes
-- ============================================================
--
-- Server API routes use the Supabase service role client for writes.
-- Authenticated browser clients should not be able to write these
-- workflow/admin tables directly with the anon key.

DROP POLICY IF EXISTS "tasks_insert" ON tasks;
DROP POLICY IF EXISTS "tasks_update" ON tasks;

DROP POLICY IF EXISTS "standards_insert" ON standards;
DROP POLICY IF EXISTS "standards_update" ON standards;
DROP POLICY IF EXISTS "standards_delete" ON standards;

DROP POLICY IF EXISTS "files_insert" ON uploaded_files;
DROP POLICY IF EXISTS "files_update" ON uploaded_files;

DROP POLICY IF EXISTS "upr_insert" ON user_project_roles;
DROP POLICY IF EXISTS "upr_delete" ON user_project_roles;
