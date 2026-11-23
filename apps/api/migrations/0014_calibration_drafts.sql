-- The calibration draft: what the panel has agreed so far, saved before the baseline is
-- fixed (user request of 2026-11-23). A draft is a working copy, not a record: it holds any
-- subset of the agreed levels and any attendance, is replaced on every save, and is
-- discarded once the baseline is fixed. Nothing reads it to set levels; the calibration
-- (app_calibrate_board) checks everything again.
--
-- Invariant 9: only the panel of the board reads or writes it; the owner sees the
-- calibration once it is recorded.
-- Invariant 11: organization_id, composite foreign key, Row Level Security.

CREATE TABLE calibration_drafts (
  board_id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  held_on date NOT NULL,
  notes text NOT NULL DEFAULT '',
  attendee_ids uuid[] NOT NULL DEFAULT '{}',
  -- JSON array of {"capabilityId", "levelId"}, as app_calibrate_board receives it.
  levels jsonb NOT NULL DEFAULT '[]',
  saved_by uuid NOT NULL REFERENCES persons (id),
  saved_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id) ON DELETE CASCADE
);

-- The board has no baseline yet: a draft exists only before it.
CREATE FUNCTION app_board_without_baseline(p_board_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM boards WHERE id = p_board_id AND baseline_set_at IS NULL) $$;

ALTER TABLE calibration_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY calibration_drafts_read ON calibration_drafts FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_on_board_panel(board_id));
CREATE POLICY calibration_drafts_insert ON calibration_drafts FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_on_board_panel(board_id)
              AND app_board_without_baseline(board_id) AND saved_by = app_current_person_id());
CREATE POLICY calibration_drafts_update ON calibration_drafts FOR UPDATE
  USING (organization_id = app_current_organization_id() AND app_on_board_panel(board_id))
  WITH CHECK (organization_id = app_current_organization_id() AND app_on_board_panel(board_id)
              AND app_board_without_baseline(board_id) AND saved_by = app_current_person_id());
CREATE POLICY calibration_drafts_delete ON calibration_drafts FOR DELETE
  USING (organization_id = app_current_organization_id() AND app_on_board_panel(board_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON calibration_drafts TO potencializador_app;

REVOKE ALL ON FUNCTION app_board_without_baseline(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_board_without_baseline(uuid) TO potencializador_app;
