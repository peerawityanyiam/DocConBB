-- ============================================================
-- EXTERNAL SHORTCUTS (home page "ลิงก์ที่เกี่ยวข้อง" buttons)
--
-- Managed by SUPER_ADMIN via the admin modal; read by everyone
-- who can access the hub. All writes go through API routes that
-- enforce role checks, so RLS only needs a permissive read policy.
-- ============================================================

CREATE TABLE external_shortcuts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label        TEXT NOT NULL,
  url          TEXT NOT NULL,
  icon_key     TEXT,                          -- nullable: icon is optional
  sort_order   INTEGER NOT NULL DEFAULT 0,
  is_active    BOOLEAN NOT NULL DEFAULT true,
  created_by   UUID REFERENCES users(id),
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_external_shortcuts_active_order
  ON external_shortcuts(sort_order, created_at)
  WHERE is_active = true;

CREATE TRIGGER external_shortcuts_updated_at
  BEFORE UPDATE ON external_shortcuts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE external_shortcuts ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can list active shortcuts.
CREATE POLICY "external_shortcuts_select_active" ON external_shortcuts
  FOR SELECT TO authenticated
  USING (is_active = true);
