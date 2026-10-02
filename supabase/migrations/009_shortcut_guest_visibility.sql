-- ============================================================
-- EXTERNAL SHORTCUTS: guest visibility
--
-- The home page is viewable without login. Guests only see
-- shortcuts a SUPER_ADMIN explicitly marks as show_to_guests.
-- Defaults to false so existing links are not exposed.
-- ============================================================

ALTER TABLE external_shortcuts
  ADD COLUMN show_to_guests BOOLEAN NOT NULL DEFAULT false;
