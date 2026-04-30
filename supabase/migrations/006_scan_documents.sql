-- ============================================================
-- MOBILE SCANNER MODULE
-- ============================================================

CREATE TABLE scan_documents (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id                  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title                     TEXT NOT NULL DEFAULT 'เอกสารสแกน',
  status                    TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'PDF_READY', 'ERROR')),
  scan_folder_id            TEXT,
  originals_folder_id       TEXT,
  processed_folder_id       TEXT,
  pdf_folder_id             TEXT,
  latest_pdf_file_id        TEXT,
  latest_pdf_file_name      TEXT,
  latest_pdf_view_url       TEXT,
  latest_pdf_size_bytes     BIGINT,
  latest_pdf_uploaded_at    TIMESTAMPTZ,
  page_count                INTEGER NOT NULL DEFAULT 0,
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE scan_pages (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id                    UUID NOT NULL REFERENCES scan_documents(id) ON DELETE CASCADE,
  owner_id                   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page_index                 INTEGER NOT NULL,
  original_drive_file_id     TEXT NOT NULL,
  original_drive_file_name   TEXT NOT NULL,
  original_mime_type         TEXT,
  original_size_bytes        BIGINT,
  processed_drive_file_id    TEXT,
  processed_drive_file_name  TEXT,
  processed_mime_type        TEXT,
  processed_size_bytes       BIGINT,
  adjustments                JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at                 TIMESTAMPTZ DEFAULT now(),
  updated_at                 TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_scan_documents_owner_updated
  ON scan_documents(owner_id, updated_at DESC);

CREATE INDEX idx_scan_pages_scan_order
  ON scan_pages(scan_id, page_index ASC);

CREATE INDEX idx_scan_pages_owner
  ON scan_pages(owner_id);

CREATE TRIGGER scan_documents_updated_at
  BEFORE UPDATE ON scan_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER scan_pages_updated_at
  BEFORE UPDATE ON scan_pages
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE scan_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_pages ENABLE ROW LEVEL SECURITY;

-- API-only access: all reads/writes go through server routes with service role.
-- Do not add permissive authenticated policies here.
