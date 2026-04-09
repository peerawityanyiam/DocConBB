-- Speed up tracking queries that frequently sort by updated_at
-- and filter by role/status.

CREATE INDEX IF NOT EXISTS idx_tasks_active_updated_at
  ON tasks (updated_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_tasks_status_updated_at
  ON tasks (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_officer_active_updated_at
  ON tasks (officer_id, updated_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_tasks_reviewer_active_updated_at
  ON tasks (reviewer_id, updated_at DESC)
  WHERE is_archived = false;

CREATE INDEX IF NOT EXISTS idx_tasks_creator_active_updated_at
  ON tasks (created_by, updated_at DESC)
  WHERE is_archived = false;

