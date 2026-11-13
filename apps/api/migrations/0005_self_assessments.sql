-- Self-assessments: the levels a participant proposes for the capabilities of their board.
--
-- Invariant 2: a self-assessment is a proposal, not the baseline, and yields no score.
--   Its levels live in their own table; submitting changes only the self-assessment and the
--   board's state, never the placements.
-- Invariant 9: the owner sees and writes it; the panel sees it once submitted; nobody else.
-- Invariant 11: organization_id, composite foreign keys, Row Level Security.

CREATE TABLE self_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  -- NULL while it is a draft. Set once, by app_submit_self_assessment.
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT self_assessments_one_per_board UNIQUE (board_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE self_assessment_levels (
  organization_id uuid NOT NULL,
  self_assessment_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  level_id uuid NOT NULL,
  PRIMARY KEY (self_assessment_id, capability_id),
  FOREIGN KEY (self_assessment_id, organization_id) REFERENCES self_assessments (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id),
  FOREIGN KEY (level_id, organization_id) REFERENCES levels (id, organization_id)
);

-- Lookups ------------------------------------------------------------------------------

CREATE FUNCTION app_owns_board(p_board_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT EXISTS (SELECT 1 FROM boards WHERE id = p_board_id AND owner_person_id = app_current_person_id()) $$;

CREATE FUNCTION app_self_assessment_state(p_self_assessment_id uuid, OUT board_id uuid, OUT submitted boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT board_id, submitted_at IS NOT NULL FROM self_assessments WHERE id = p_self_assessment_id $$;

-- Owner always; panel once submitted.
CREATE FUNCTION app_sees_self_assessment(p_self_assessment_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT app_owns_board(s.board_id) OR (s.submitted AND app_on_board_panel(s.board_id))
      FROM app_self_assessment_state(p_self_assessment_id) s
  $$;

CREATE FUNCTION app_writes_self_assessment(p_self_assessment_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT app_owns_board(s.board_id) AND NOT s.submitted FROM app_self_assessment_state(p_self_assessment_id) s
  $$;

-- Guards -------------------------------------------------------------------------------

-- A submitted self-assessment never changes and is never deleted, for every role. Deleting
-- its board (a cascade) is the only way it goes, and boards with a baseline cannot go.
CREATE FUNCTION guard_self_assessment() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'INSERT' THEN
      IF NEW.submitted_at IS NOT NULL THEN
        RAISE EXCEPTION 'invariant 2: a self-assessment starts as a draft' USING ERRCODE = 'PM002';
      END IF;
      RETURN NEW;
    END IF;
    IF OLD.submitted_at IS NOT NULL THEN
      IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM boards WHERE id = OLD.board_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'invariant 2: the self-assessment was submitted and never changes' USING ERRCODE = 'PM002';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.board_id <> OLD.board_id OR NEW.organization_id <> OLD.organization_id) THEN
      RAISE EXCEPTION 'invariant 2: a self-assessment never changes board' USING ERRCODE = 'PM002';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END
  $$;
CREATE TRIGGER self_assessments_guard BEFORE INSERT OR UPDATE OR DELETE ON self_assessments
  FOR EACH ROW EXECUTE FUNCTION guard_self_assessment();

CREATE FUNCTION guard_self_assessment_level() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_row self_assessment_levels%ROWTYPE;
    v_assessment self_assessments%ROWTYPE;
    v_map uuid;
  BEGIN
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    SELECT * INTO v_assessment FROM self_assessments WHERE id = v_row.self_assessment_id;
    IF v_assessment.id IS NULL THEN
      RETURN v_row; -- cascade from the self-assessment's own removal
    END IF;
    IF v_assessment.submitted_at IS NOT NULL THEN
      IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM boards WHERE id = v_assessment.board_id) THEN
        RETURN OLD;
      END IF;
      RAISE EXCEPTION 'invariant 2: the self-assessment was submitted and never changes' USING ERRCODE = 'PM002';
    END IF;
    IF TG_OP <> 'DELETE' THEN
      IF NOT EXISTS (
        SELECT 1 FROM placements WHERE board_id = v_assessment.board_id AND capability_id = NEW.capability_id
      ) THEN
        RAISE EXCEPTION 'the capability is not on the board' USING ERRCODE = 'PM002';
      END IF;
      SELECT p.map_id INTO v_map FROM boards b JOIN programs p ON p.id = b.program_id WHERE b.id = v_assessment.board_id;
      IF app_map_of_level(NEW.level_id) IS DISTINCT FROM v_map THEN
        RAISE EXCEPTION 'the level is not of the program map' USING ERRCODE = 'PM002';
      END IF;
    END IF;
    RETURN v_row;
  END
  $$;
CREATE TRIGGER self_assessment_levels_guard BEFORE INSERT OR UPDATE OR DELETE ON self_assessment_levels
  FOR EACH ROW EXECUTE FUNCTION guard_self_assessment_level();

-- Submits the self-assessment of a board: only its owner, only when every capability on
-- the board has a proposed level. Moves the board from 'not_started' to 'self_assessed'.
-- Touches no placement (invariant 2).
CREATE FUNCTION app_submit_self_assessment(p_board_id uuid) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_assessment self_assessments%ROWTYPE;
    v_submitted timestamptz := now();
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id;
    IF v_board.id IS NULL OR v_board.organization_id IS DISTINCT FROM app_current_organization_id()
       OR v_board.owner_person_id IS DISTINCT FROM app_current_person_id() THEN
      RAISE EXCEPTION 'only the owner of the board submits its self-assessment' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_assessment FROM self_assessments WHERE board_id = p_board_id FOR UPDATE;
    IF v_assessment.id IS NULL THEN
      RAISE EXCEPTION 'the self-assessment is incomplete' USING ERRCODE = 'PM002';
    END IF;
    IF v_assessment.submitted_at IS NOT NULL THEN
      RAISE EXCEPTION 'invariant 2: the self-assessment was already submitted' USING ERRCODE = 'PM002';
    END IF;
    IF EXISTS (
      SELECT 1 FROM placements p
       WHERE p.board_id = p_board_id
         AND NOT EXISTS (
           SELECT 1 FROM self_assessment_levels l
            WHERE l.self_assessment_id = v_assessment.id AND l.capability_id = p.capability_id
         )
    ) THEN
      RAISE EXCEPTION 'the self-assessment is incomplete' USING ERRCODE = 'PM002';
    END IF;
    UPDATE self_assessments SET submitted_at = v_submitted WHERE id = v_assessment.id;
    UPDATE boards SET status = 'self_assessed' WHERE id = p_board_id AND status = 'not_started';
    RETURN v_submitted;
  END
  $$;
REVOKE ALL ON FUNCTION app_submit_self_assessment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_submit_self_assessment(uuid) TO potencializador_app;

-- Row Level Security: no super administrator clause, as for placements (invariant 9).
-- No UPDATE or DELETE on self_assessments for the API role: only the function submits.

ALTER TABLE self_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY self_assessments_read ON self_assessments FOR SELECT
  USING (organization_id = app_current_organization_id()
         AND (app_owns_board(board_id) OR (submitted_at IS NOT NULL AND app_on_board_panel(board_id))));
CREATE POLICY self_assessments_insert ON self_assessments FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_owns_board(board_id));
GRANT SELECT, INSERT ON self_assessments TO potencializador_app;

ALTER TABLE self_assessment_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY self_assessment_levels_read ON self_assessment_levels FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_self_assessment(self_assessment_id));
CREATE POLICY self_assessment_levels_insert ON self_assessment_levels FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_writes_self_assessment(self_assessment_id));
CREATE POLICY self_assessment_levels_update ON self_assessment_levels FOR UPDATE
  USING (organization_id = app_current_organization_id() AND app_writes_self_assessment(self_assessment_id))
  WITH CHECK (organization_id = app_current_organization_id() AND app_writes_self_assessment(self_assessment_id));
CREATE POLICY self_assessment_levels_delete ON self_assessment_levels FOR DELETE
  USING (organization_id = app_current_organization_id() AND app_writes_self_assessment(self_assessment_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON self_assessment_levels TO potencializador_app;
