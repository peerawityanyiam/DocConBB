-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE app_role AS ENUM (
  'STAFF',
  'DOCCON',
  'REVIEWER',
  'BOSS',
  'SUPER_BOSS',
  'SUPER_ADMIN'
);

CREATE TYPE task_status AS ENUM (
  'ASSIGNED',
  'SUBMITTED_TO_DOCCON',
  'DOCCON_REJECTED',
  'PENDING_REVIEW',
  'REVIEWER_REJECTED',
  'WAITING_BOSS_APPROVAL',
  'BOSS_REJECTED',
  'WAITING_SUPER_BOSS_APPROVAL',
  'SUPER_BOSS_REJECTED',
  'COMPLETED',
  'CANCELLED'
);

-- ============================================================
-- CORE TABLES
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE projects (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,
  description   TEXT,
  is_active     BOOLEAN DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_project_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role          app_role NOT NULL,
  assigned_by   UUID REFERENCES users(id),
  assigned_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, project_id, role)
);

-- ============================================================
-- TASKS
-- ============================================================

CREATE TABLE tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_code       TEXT UNIQUE NOT NULL,
  title           TEXT NOT NULL,
  detail          TEXT,
  officer_id      UUID NOT NULL REFERENCES users(id),
  reviewer_id     UUID NOT NULL REFERENCES users(id),
  created_by      UUID NOT NULL REFERENCES users(id),
  status          task_status NOT NULL DEFAULT 'ASSIGNED',
  doc_ref         TEXT,
  superseded_by   UUID REFERENCES tasks(id),
  is_archived     BOOLEAN DEFAULT false,
  drive_file_id   TEXT,
  drive_file_name TEXT,
  ref_file_id     TEXT,
  ref_file_name   TEXT,
  task_folder_id  TEXT,
  doccon_checked  BOOLEAN DEFAULT false,
  drive_uploaded  BOOLEAN DEFAULT false,
  sent_to_branch  BOOLEAN DEFAULT false,
  status_history  JSONB DEFAULT '[]'::jsonb,
  comment_history JSONB DEFAULT '[]'::jsonb,
  file_history    JSONB DEFAULT '[]'::jsonb,
  latest_comment  TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  completed_at    TIMESTAMPTZ
);

-- ============================================================
-- FILE TRACKING
-- ============================================================

CREATE TABLE uploaded_files (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,
  uploader_id     UUID NOT NULL REFERENCES users(id),
  drive_file_id   TEXT NOT NULL,
  drive_file_name TEXT NOT NULL,
  file_type       TEXT,
  file_size_bytes BIGINT,
  is_current      BOOLEAN DEFAULT true,
  is_deleted      BOOLEAN DEFAULT false,
  deleted_by      UUID REFERENCES users(id),
  deleted_at      TIMESTAMPTZ,
  uploaded_at     TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- STANDARDS (Library)
-- ============================================================

CREATE TABLE standards (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  url           TEXT NOT NULL,
  drive_file_id TEXT,
  is_link       BOOLEAN DEFAULT false,
  start_date    DATE,
  end_date      DATE,
  always_open   BOOLEAN DEFAULT false,
  hidden        BOOLEAN DEFAULT false,
  locked        BOOLEAN DEFAULT false,
  pinned        BOOLEAN DEFAULT false,
  sort_order    INTEGER DEFAULT 0,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- DELETION LOG
-- ============================================================

CREATE TABLE deletion_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_at  TIMESTAMPTZ DEFAULT now(),
  deleted_by  UUID REFERENCES users(id),
  doc_name    TEXT NOT NULL,
  drive_file_id TEXT,
  reason      TEXT
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_tasks_status ON tasks(status) WHERE NOT is_archived;
CREATE INDEX idx_tasks_officer ON tasks(officer_id) WHERE NOT is_archived;
CREATE INDEX idx_tasks_reviewer ON tasks(reviewer_id) WHERE NOT is_archived;
CREATE INDEX idx_tasks_created_by ON tasks(created_by) WHERE NOT is_archived;
CREATE INDEX idx_tasks_doc_ref ON tasks(doc_ref) WHERE doc_ref IS NOT NULL;
CREATE INDEX idx_uploaded_files_task ON uploaded_files(task_id) WHERE NOT is_deleted;
CREATE INDEX idx_uploaded_files_uploader ON uploaded_files(uploader_id);
CREATE INDEX idx_upr_user ON user_project_roles(user_id);
CREATE INDEX idx_upr_project ON user_project_roles(project_id);

-- ============================================================
-- TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER standards_updated_at
  BEFORE UPDATE ON standards
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION get_user_roles(p_user_id UUID, p_project_slug TEXT)
RETURNS app_role[] AS $$
  SELECT COALESCE(array_agg(upr.role), '{}')
  FROM user_project_roles upr
  JOIN projects p ON p.id = upr.project_id
  WHERE upr.user_id = p_user_id AND p.slug = p_project_slug;
$$ LANGUAGE sql STABLE;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_project_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE standards ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_log ENABLE ROW LEVEL SECURITY;

-- Users: authenticated can read
CREATE POLICY "users_select" ON users
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE TO authenticated
  USING (id = auth.uid());

-- Projects: authenticated can read
CREATE POLICY "projects_select" ON projects
  FOR SELECT TO authenticated USING (true);

-- User project roles: authenticated can read
CREATE POLICY "upr_select" ON user_project_roles
  FOR SELECT TO authenticated USING (true);

-- Tasks: related users or admins
CREATE POLICY "tasks_select" ON tasks
  FOR SELECT TO authenticated
  USING (
    officer_id = auth.uid()
    OR reviewer_id = auth.uid()
    OR created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_project_roles upr
      JOIN projects p ON p.id = upr.project_id
      WHERE upr.user_id = auth.uid()
        AND p.slug = 'tracking'
        AND upr.role IN ('BOSS', 'DOCCON', 'SUPER_BOSS', 'SUPER_ADMIN')
    )
  );

CREATE POLICY "tasks_insert" ON tasks
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "tasks_update" ON tasks
  FOR UPDATE TO authenticated
  USING (true);

-- Uploaded files: all can read, delete restricted
CREATE POLICY "files_select" ON uploaded_files
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "files_insert" ON uploaded_files
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "files_update" ON uploaded_files
  FOR UPDATE TO authenticated
  USING (
    uploader_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_project_roles upr
      JOIN projects p ON p.id = upr.project_id
      WHERE upr.user_id = auth.uid()
        AND p.slug = 'tracking'
        AND upr.role = 'DOCCON'
    )
  );

-- Standards: hidden rows for DOCCON/SUPER_ADMIN only
CREATE POLICY "standards_select" ON standards
  FOR SELECT TO authenticated
  USING (
    hidden = false
    OR EXISTS (
      SELECT 1 FROM user_project_roles upr
      JOIN projects p ON p.id = upr.project_id
      WHERE upr.user_id = auth.uid()
        AND p.slug = 'library'
        AND upr.role IN ('DOCCON', 'SUPER_ADMIN')
    )
  );

CREATE POLICY "standards_insert" ON standards
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "standards_update" ON standards
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "standards_delete" ON standards
  FOR DELETE TO authenticated USING (true);

-- Deletion log: admins can read/write
CREATE POLICY "deletion_log_select" ON deletion_log
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "deletion_log_insert" ON deletion_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- UPR write policies (admin only, enforced at API layer)
CREATE POLICY "upr_insert" ON user_project_roles
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "upr_delete" ON user_project_roles
  FOR DELETE TO authenticated USING (true);

-- ============================================================
-- REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE uploaded_files;
