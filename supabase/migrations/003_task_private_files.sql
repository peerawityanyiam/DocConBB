-- ============================================================
-- TASK PRIVATE DRAFT FILES (per uploader, per task)
-- ============================================================

CREATE TABLE task_private_files (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploader_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  drive_file_id      TEXT NOT NULL,
  drive_file_name    TEXT NOT NULL,
  original_file_name TEXT NOT NULL,
  normalized_name    TEXT NOT NULL,
  file_type          TEXT,
  file_size_bytes    BIGINT,
  is_deleted         BOOLEAN DEFAULT false,
  deleted_by         UUID REFERENCES users(id),
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_task_private_files_task_uploader
  ON task_private_files(task_id, uploader_id, created_at DESC)
  WHERE is_deleted = false;

CREATE INDEX idx_task_private_files_drive_file_id
  ON task_private_files(drive_file_id);

CREATE TRIGGER task_private_files_updated_at
  BEFORE UPDATE ON task_private_files
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE task_private_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_private_files_select_own" ON task_private_files
  FOR SELECT TO authenticated
  USING (uploader_id = auth.uid());

CREATE POLICY "task_private_files_insert_own" ON task_private_files
  FOR INSERT TO authenticated
  WITH CHECK (uploader_id = auth.uid());

CREATE POLICY "task_private_files_update_own" ON task_private_files
  FOR UPDATE TO authenticated
  USING (uploader_id = auth.uid());

CREATE POLICY "task_private_files_delete_own" ON task_private_files
  FOR DELETE TO authenticated
  USING (uploader_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE task_private_files;

