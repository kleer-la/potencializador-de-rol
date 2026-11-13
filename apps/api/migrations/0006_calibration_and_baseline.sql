-- Calibration sessions, the baseline and level changes.
--
-- Invariant 3: the baseline is born from a calibration that the participant and the
--   mandatory roles of the panel attended, and takes the capabilities on the board at that
--   moment. Its entries are never edited. A capability added afterwards enters unplaced; a
--   panel member records its initial level, which joins the baseline as a new entry.
-- Invariant 4: after the baseline, a placement's level changes only together with a
--   recorded level change. Here: the calibration and the initial leveling; changes with
--   evidence come later.
-- Invariant 9: the owner and their panel read all of it; nobody else.
-- Invariant 11: organization_id, composite foreign keys, Row Level Security.
--
-- The API role reads these tables and writes none of them: only app_calibrate_board and
-- app_record_initial_level write, after their checks.

ALTER TABLE placements ADD CONSTRAINT placements_id_organization_unique UNIQUE (id, organization_id);

-- One calibration fixes the baseline of a board. A later recalibration only produces a
-- snapshot and is not recorded here.
CREATE TABLE calibration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  held_on date NOT NULL,
  notes text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES persons (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calibration_sessions_one_per_board UNIQUE (board_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id)
);

CREATE TABLE calibration_attendees (
  organization_id uuid NOT NULL,
  calibration_session_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES persons (id),
  PRIMARY KEY (calibration_session_id, person_id),
  FOREIGN KEY (calibration_session_id, organization_id) REFERENCES calibration_sessions (id, organization_id)
);

-- The difference between what was self-assessed and what was agreed (document §6.2).
CREATE TABLE calibration_levels (
  organization_id uuid NOT NULL,
  calibration_session_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  -- NULL: the participant proposed nothing for it (it was added after the self-assessment).
  self_assessed_level_id uuid,
  agreed_level_id uuid NOT NULL,
  PRIMARY KEY (calibration_session_id, capability_id),
  FOREIGN KEY (calibration_session_id, organization_id) REFERENCES calibration_sessions (id, organization_id),
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id),
  FOREIGN KEY (self_assessed_level_id, organization_id) REFERENCES levels (id, organization_id),
  FOREIGN KEY (agreed_level_id, organization_id) REFERENCES levels (id, organization_id)
);

CREATE TABLE baseline_entries (
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  level_id uuid NOT NULL,
  origin text NOT NULL CHECK (origin IN ('calibration', 'initial_leveling')),
  set_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, capability_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id),
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id),
  FOREIGN KEY (level_id, organization_id) REFERENCES levels (id, organization_id)
);

-- Reasons with evidence ('evidence') and recalibrations come in later increments.
CREATE TABLE level_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  placement_id uuid NOT NULL,
  previous_level_id uuid,
  new_level_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('calibration', 'initial_leveling')),
  approved_by uuid NOT NULL REFERENCES persons (id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (placement_id, organization_id) REFERENCES placements (id, organization_id),
  FOREIGN KEY (previous_level_id, organization_id) REFERENCES levels (id, organization_id),
  FOREIGN KEY (new_level_id, organization_id) REFERENCES levels (id, organization_id)
);
CREATE INDEX level_changes_placement_index ON level_changes (placement_id);

-- Lookups ------------------------------------------------------------------------------

CREATE FUNCTION app_board_of_calibration(p_calibration_session_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT board_id FROM calibration_sessions WHERE id = p_calibration_session_id $$;

CREATE FUNCTION app_board_of_placement(p_placement_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT board_id FROM placements WHERE id = p_placement_id $$;

-- The agreed levels a calibration receives, as rows.
CREATE FUNCTION app_agreed_levels(p_levels jsonb) RETURNS TABLE (capability_id uuid, level_id uuid)
  LANGUAGE sql IMMUTABLE
  AS $$
    SELECT x."capabilityId", x."levelId"
      FROM jsonb_to_recordset(coalesce(p_levels, '[]')) AS x("capabilityId" uuid, "levelId" uuid)
  $$;

-- Guards -------------------------------------------------------------------------------

-- What a calibration and the baseline record is never edited or deleted, for every role.
-- Boards with a baseline cannot be deleted (migration 0004), so no cascade reaches them.
CREATE FUNCTION guard_recorded_history() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    RAISE EXCEPTION '%', TG_ARGV[0] USING ERRCODE = TG_ARGV[1];
  END
  $$;
CREATE TRIGGER calibration_sessions_guard BEFORE UPDATE OR DELETE ON calibration_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('invariant 3: a calibration is never edited', 'PM003');
CREATE TRIGGER calibration_attendees_guard BEFORE UPDATE OR DELETE ON calibration_attendees
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('invariant 3: a calibration is never edited', 'PM003');
CREATE TRIGGER calibration_levels_guard BEFORE UPDATE OR DELETE ON calibration_levels
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('invariant 3: a calibration is never edited', 'PM003');
CREATE TRIGGER baseline_entries_guard BEFORE UPDATE OR DELETE ON baseline_entries
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('invariant 3: the entries of a baseline are never edited', 'PM003');
CREATE TRIGGER level_changes_guard BEFORE UPDATE OR DELETE ON level_changes
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('invariant 4: a level change is never edited', 'PM004');

-- Invariant 3: the baseline is set only by a calibration, and the board's state follows it.
CREATE FUNCTION guard_board_baseline() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF OLD.baseline_set_at IS NULL AND NEW.baseline_set_at IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM calibration_sessions WHERE board_id = NEW.id) THEN
      RAISE EXCEPTION 'invariant 3: a baseline is born only from a calibration' USING ERRCODE = 'PM003';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.baseline_set_at IS NULL AND NEW.status IN ('calibrated', 'in_cycle', 'between_cycles', 'closed') THEN
        RAISE EXCEPTION 'invariant 3: a board without a baseline is not calibrated' USING ERRCODE = 'PM003';
      END IF;
      IF NEW.baseline_set_at IS NOT NULL AND NEW.status IN ('not_started', 'self_assessed') THEN
        RAISE EXCEPTION 'invariant 3: a board with a baseline does not go back before it' USING ERRCODE = 'PM003';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER boards_baseline_guard BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION guard_board_baseline();

-- Invariant 3: a capability added after the baseline enters unplaced. Invariant 4: after the
-- baseline, a level changes only with the level change recorded for it in this transaction.
CREATE FUNCTION guard_placement_level() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NOT EXISTS (SELECT 1 FROM boards WHERE id = NEW.board_id AND baseline_set_at IS NOT NULL) THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NEW.level_id IS NOT NULL THEN
        RAISE EXCEPTION 'invariant 3: a capability added after the baseline enters unplaced' USING ERRCODE = 'PM003';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.level_id IS DISTINCT FROM OLD.level_id AND NOT EXISTS (
      SELECT 1 FROM level_changes
       WHERE placement_id = NEW.id
         AND new_level_id IS NOT DISTINCT FROM NEW.level_id
         AND previous_level_id IS NOT DISTINCT FROM OLD.level_id
         AND changed_at = now()
    ) THEN
      RAISE EXCEPTION 'invariant 4: after the baseline a level changes only with its level change' USING ERRCODE = 'PM004';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER placements_level_guard BEFORE INSERT OR UPDATE ON placements
  FOR EACH ROW EXECUTE FUNCTION guard_placement_level();

-- Writers ------------------------------------------------------------------------------

-- Records the calibration of a board and fixes its baseline. p_levels is a JSON array of
-- {"capabilityId", "levelId"}, one per capability on the board.
CREATE FUNCTION app_calibrate_board(
  p_board_id uuid, p_held_on date, p_notes text, p_attendee_ids uuid[], p_levels jsonb
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_map uuid;
    v_person uuid;
    v_role text;
    v_session uuid;
    v_now timestamptz := now();
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id FOR UPDATE;
    IF v_board.id IS NULL OR v_board.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(p_board_id) THEN
      RAISE EXCEPTION 'only a panel member of the board records its calibration' USING ERRCODE = '42501';
    END IF;
    IF v_board.baseline_set_at IS NOT NULL THEN
      RAISE EXCEPTION 'invariant 3: the board already has its baseline' USING ERRCODE = 'PM003';
    END IF;
    IF v_board.status <> 'self_assessed' THEN
      RAISE EXCEPTION 'a board is calibrated once it is self-assessed' USING ERRCODE = 'PM003';
    END IF;

    -- Attendance: the owner and panel members of this board only.
    FOREACH v_person IN ARRAY coalesce(p_attendee_ids, '{}') LOOP
      IF v_person IS DISTINCT FROM v_board.owner_person_id AND NOT EXISTS (
        SELECT 1 FROM panel_assignments pa JOIN enrollments m ON m.id = pa.member_enrollment_id
         WHERE pa.participant_enrollment_id = v_board.enrollment_id AND m.person_id = v_person
      ) THEN
        RAISE EXCEPTION 'the attendee % is not on the board', v_person USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF NOT v_board.owner_person_id = ANY (coalesce(p_attendee_ids, '{}')) THEN
      RAISE EXCEPTION 'invariant 3: the participant did not attend the calibration' USING ERRCODE = 'PM003';
    END IF;
    FOREACH v_role IN ARRAY (SELECT mandatory_panel_roles FROM programs WHERE id = v_board.program_id) LOOP
      IF NOT EXISTS (
        SELECT 1 FROM panel_assignments pa JOIN enrollments m ON m.id = pa.member_enrollment_id
         WHERE pa.participant_enrollment_id = v_board.enrollment_id AND pa.role = v_role
           AND m.person_id = ANY (p_attendee_ids)
      ) THEN
        RAISE EXCEPTION 'invariant 3: nobody attended for the mandatory role %', v_role USING ERRCODE = 'PM003';
      END IF;
    END LOOP;

    -- Agreed levels: one per capability on the board, of the program's map.
    IF (SELECT count(*) <> count(DISTINCT capability_id) FROM app_agreed_levels(p_levels)) THEN
      RAISE EXCEPTION 'a capability has more than one agreed level' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM app_agreed_levels(p_levels) a
       WHERE NOT EXISTS (SELECT 1 FROM placements p WHERE p.board_id = p_board_id AND p.capability_id = a.capability_id)
    ) THEN
      RAISE EXCEPTION 'the capability is not on the board' USING ERRCODE = '23514';
    END IF;
    v_map := app_map_of_program(v_board.program_id);
    IF EXISTS (SELECT 1 FROM app_agreed_levels(p_levels) WHERE level_id IS NULL OR app_map_of_level(level_id) IS DISTINCT FROM v_map) THEN
      RAISE EXCEPTION 'the level is not of the program map' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM placements p
       WHERE p.board_id = p_board_id AND NOT EXISTS (SELECT 1 FROM app_agreed_levels(p_levels) a WHERE a.capability_id = p.capability_id)
    ) THEN
      RAISE EXCEPTION 'every capability on the board needs an agreed level' USING ERRCODE = '23514';
    END IF;

    INSERT INTO calibration_sessions (organization_id, board_id, held_on, notes, recorded_by, recorded_at)
      VALUES (v_board.organization_id, p_board_id, p_held_on, coalesce(p_notes, ''), app_current_person_id(), v_now)
      RETURNING id INTO v_session;
    INSERT INTO calibration_attendees (organization_id, calibration_session_id, person_id)
      SELECT DISTINCT v_board.organization_id, v_session, person FROM unnest(p_attendee_ids) AS person;
    INSERT INTO calibration_levels (organization_id, calibration_session_id, capability_id, self_assessed_level_id, agreed_level_id)
      SELECT v_board.organization_id, v_session, a.capability_id, proposed.level_id, a.level_id
        FROM app_agreed_levels(p_levels) a
        LEFT JOIN self_assessments s ON s.board_id = p_board_id AND s.submitted_at IS NOT NULL
        LEFT JOIN self_assessment_levels proposed
          ON proposed.self_assessment_id = s.id AND proposed.capability_id = a.capability_id;
    INSERT INTO level_changes (organization_id, placement_id, previous_level_id, new_level_id, reason, approved_by, changed_at)
      SELECT v_board.organization_id, p.id, p.level_id, a.level_id, 'calibration', app_current_person_id(), v_now
        FROM placements p JOIN app_agreed_levels(p_levels) a ON a.capability_id = p.capability_id
       WHERE p.board_id = p_board_id;
    UPDATE placements p SET level_id = a.level_id
      FROM app_agreed_levels(p_levels) a WHERE p.board_id = p_board_id AND p.capability_id = a.capability_id;
    INSERT INTO baseline_entries (organization_id, board_id, capability_id, level_id, origin, set_at)
      SELECT v_board.organization_id, p_board_id, capability_id, level_id, 'calibration', v_now FROM app_agreed_levels(p_levels);
    UPDATE boards SET baseline_set_at = v_now, status = 'calibrated' WHERE id = p_board_id;
    RETURN v_session;
  END
  $$;

-- Records the initial level of a capability added after the baseline: a level change with
-- reason 'initial_leveling' and a new baseline entry.
CREATE FUNCTION app_record_initial_level(p_board_id uuid, p_capability_id uuid, p_level_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_placement placements%ROWTYPE;
    v_change uuid;
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id;
    IF v_board.id IS NULL OR v_board.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(p_board_id) THEN
      RAISE EXCEPTION 'only a panel member of the board records an initial level' USING ERRCODE = '42501';
    END IF;
    IF v_board.baseline_set_at IS NULL THEN
      RAISE EXCEPTION 'invariant 3: before the baseline, the calibration agrees the levels' USING ERRCODE = 'PM003';
    END IF;
    SELECT * INTO v_placement FROM placements WHERE board_id = p_board_id AND capability_id = p_capability_id FOR UPDATE;
    IF v_placement.id IS NULL THEN
      RAISE EXCEPTION 'the capability is not on the board' USING ERRCODE = '23514';
    END IF;
    IF v_placement.level_id IS NOT NULL
       OR EXISTS (SELECT 1 FROM baseline_entries WHERE board_id = p_board_id AND capability_id = p_capability_id) THEN
      RAISE EXCEPTION 'invariant 3: the capability already has its initial level in the baseline' USING ERRCODE = 'PM003';
    END IF;
    IF p_level_id IS NULL OR app_map_of_level(p_level_id) IS DISTINCT FROM app_map_of_program(v_board.program_id) THEN
      RAISE EXCEPTION 'the level is not of the program map' USING ERRCODE = '23514';
    END IF;

    INSERT INTO level_changes (organization_id, placement_id, previous_level_id, new_level_id, reason, approved_by)
      VALUES (v_board.organization_id, v_placement.id, NULL, p_level_id, 'initial_leveling', app_current_person_id())
      RETURNING id INTO v_change;
    UPDATE placements SET level_id = p_level_id WHERE id = v_placement.id;
    INSERT INTO baseline_entries (organization_id, board_id, capability_id, level_id, origin)
      VALUES (v_board.organization_id, p_board_id, p_capability_id, p_level_id, 'initial_leveling');
    RETURN v_change;
  END
  $$;

-- Row Level Security: read by the owner and their panel, no super administrator clause
-- (invariant 9). No write grant: only the two functions above write.

ALTER TABLE calibration_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY calibration_sessions_read ON calibration_sessions FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(board_id));

ALTER TABLE calibration_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY calibration_attendees_read ON calibration_attendees FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_calibration(calibration_session_id)));

ALTER TABLE calibration_levels ENABLE ROW LEVEL SECURITY;
CREATE POLICY calibration_levels_read ON calibration_levels FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_calibration(calibration_session_id)));

ALTER TABLE baseline_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_entries_read ON baseline_entries FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(board_id));

ALTER TABLE level_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY level_changes_read ON level_changes FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_placement(placement_id)));

GRANT SELECT ON calibration_sessions, calibration_attendees, calibration_levels, baseline_entries, level_changes
  TO potencializador_app;

-- Functions are executable by PUBLIC by default; only the API role runs these. Covers two
-- lookups of earlier migrations left out of migration 0005.
DO $$
DECLARE
  v_function text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'app_board_of_calibration(uuid)', 'app_board_of_placement(uuid)', 'app_agreed_levels(jsonb)',
    'app_calibrate_board(uuid, date, text, uuid[], jsonb)', 'app_record_initial_level(uuid, uuid, uuid)',
    'app_is_super_admin()', 'map_state_of(text, jsonb)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO potencializador_app', v_function);
  END LOOP;
END
$$;
