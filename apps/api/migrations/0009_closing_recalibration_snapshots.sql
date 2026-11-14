-- Closing cycles, recalibrating between cycles, closing boards, and snapshots.
--
-- Snapshots (document §4.3): a copy of the placements, the number of capabilities and the
--   score, taken when a cycle closes or a recalibration ends; never edited or deleted.
-- Invariant 4: a recalibration may change levels, also downwards; each change is a level
--   change with reason 'recalibration' and who approved it.
-- Invariant 3: a recalibration takes the attendance of the calibration and never replaces
--   the baseline.
-- A closed board no longer changes; owner and panel keep reading it.
-- Invariant 9: owner and panel read all of it; nobody else. Invariant 11: organization_id,
--   composite foreign keys, Row Level Security.
--
-- SQL states: PM031 attendance, PM050 a state that does not allow the change, 23514 a
-- reference outside the board or the map, 42501 who acts.

ALTER TABLE level_changes DROP CONSTRAINT level_changes_reason_check;
ALTER TABLE level_changes ADD CONSTRAINT level_changes_reason_check
  CHECK (reason IN ('calibration', 'initial_leveling', 'evidence', 'recalibration'));

CREATE TABLE snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('recalibration', 'cycle_close')),
  -- The cycle it closes, for a cycle close.
  cycle_id uuid,
  taken_at timestamptz NOT NULL DEFAULT now(),
  capability_count integer NOT NULL,
  score numeric(10, 2) NOT NULL,
  recorded_by uuid NOT NULL REFERENCES persons (id),
  CHECK ((kind = 'cycle_close') = (cycle_id IS NOT NULL)),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id),
  FOREIGN KEY (cycle_id, organization_id) REFERENCES cycles (id, organization_id)
);
CREATE INDEX snapshots_board_index ON snapshots (board_id);

CREATE TABLE snapshot_entries (
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  -- NULL: unplaced at that moment.
  level_id uuid,
  multiplier numeric(8, 2),
  bonus_points numeric(8, 2) NOT NULL,
  PRIMARY KEY (snapshot_id, capability_id),
  FOREIGN KEY (snapshot_id, organization_id) REFERENCES snapshots (id, organization_id),
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id),
  FOREIGN KEY (level_id, organization_id) REFERENCES levels (id, organization_id)
);

CREATE TABLE recalibration_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  held_on date NOT NULL,
  notes text NOT NULL DEFAULT '',
  snapshot_id uuid NOT NULL,
  -- The cycle it follows: one recalibration between two cycles.
  after_cycle_id uuid NOT NULL,
  recorded_by uuid NOT NULL REFERENCES persons (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recalibration_sessions_one_per_gap UNIQUE (after_cycle_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id),
  FOREIGN KEY (snapshot_id, organization_id) REFERENCES snapshots (id, organization_id),
  FOREIGN KEY (after_cycle_id, organization_id) REFERENCES cycles (id, organization_id)
);

CREATE TABLE recalibration_attendees (
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  recalibration_session_id uuid NOT NULL,
  person_id uuid NOT NULL REFERENCES persons (id),
  PRIMARY KEY (recalibration_session_id, person_id),
  FOREIGN KEY (recalibration_session_id, organization_id) REFERENCES recalibration_sessions (id, organization_id)
);

-- History is never edited (guard_recorded_history comes from migration 0006).
CREATE TRIGGER snapshots_guard BEFORE UPDATE OR DELETE ON snapshots
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('a snapshot is never edited', 'PM050');
CREATE TRIGGER snapshot_entries_guard BEFORE UPDATE OR DELETE ON snapshot_entries
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('a snapshot is never edited', 'PM050');
CREATE TRIGGER recalibration_sessions_guard BEFORE UPDATE OR DELETE ON recalibration_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('a recalibration is never edited', 'PM050');
CREATE TRIGGER recalibration_attendees_guard BEFORE UPDATE OR DELETE ON recalibration_attendees
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('a recalibration is never edited', 'PM050');

-- A closed board no longer changes ----------------------------------------------------

CREATE FUNCTION guard_open_board() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.board_id ELSE NEW.board_id END;
  BEGIN
    IF EXISTS (SELECT 1 FROM boards WHERE id = v_board AND status = 'closed') THEN
      RAISE EXCEPTION 'the board is closed and no longer changes' USING ERRCODE = 'PM050';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END
  $$;
CREATE TRIGGER placements_open_board BEFORE INSERT OR UPDATE OR DELETE ON placements
  FOR EACH ROW EXECUTE FUNCTION guard_open_board();
CREATE TRIGGER evidence_open_board BEFORE INSERT OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION guard_open_board();
CREATE TRIGGER level_change_proposals_open_board BEFORE INSERT OR UPDATE ON level_change_proposals
  FOR EACH ROW EXECUTE FUNCTION guard_open_board();
CREATE TRIGGER bonus_awards_open_board BEFORE INSERT OR UPDATE ON bonus_awards
  FOR EACH ROW EXECUTE FUNCTION guard_open_board();
CREATE TRIGGER mentoring_sessions_open_board BEFORE INSERT ON mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_open_board();

-- "Cerrado" is the last state of a board, for every role.
CREATE FUNCTION guard_board_closed() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF OLD.status = 'closed' AND NEW.status IS DISTINCT FROM 'closed' THEN
      RAISE EXCEPTION 'a closed board stays closed' USING ERRCODE = 'PM050';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER boards_closed_guard BEFORE UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION guard_board_closed();

-- Writers ------------------------------------------------------------------------------

-- Copies the board as it is now (document §4.3): each capability with its level, multiplier and
-- approved bonus points, the number of capabilities and the score (document §5.2).
CREATE FUNCTION app_record_snapshot(p_board_id uuid, p_kind text, p_cycle_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_snapshot uuid := gen_random_uuid();
    v_count integer;
    v_score numeric;
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id;
    SELECT count(*), coalesce(sum(coalesce(l.multiplier, 0) + coalesce((
             SELECT sum(r.extra_points) FROM bonus_awards a JOIN bonus_rules r ON r.id = a.bonus_rule_id
              WHERE a.placement_id = p.id AND a.state = 'approved'), 0)), 0)
      INTO v_count, v_score
      FROM placements p LEFT JOIN levels l ON l.id = p.level_id
     WHERE p.board_id = p_board_id;
    INSERT INTO snapshots (id, organization_id, board_id, kind, cycle_id, capability_count, score, recorded_by)
      VALUES (v_snapshot, v_board.organization_id, p_board_id, p_kind, p_cycle_id, v_count, v_score, app_current_person_id());
    INSERT INTO snapshot_entries (organization_id, board_id, snapshot_id, capability_id, level_id, multiplier, bonus_points)
      SELECT v_board.organization_id, p_board_id, v_snapshot, p.capability_id, p.level_id, l.multiplier,
             coalesce((SELECT sum(r.extra_points) FROM bonus_awards a JOIN bonus_rules r ON r.id = a.bonus_rule_id
                        WHERE a.placement_id = p.id AND a.state = 'approved'), 0)
        FROM placements p LEFT JOIN levels l ON l.id = p.level_id
       WHERE p.board_id = p_board_id;
    RETURN v_snapshot;
  END
  $$;

CREATE FUNCTION app_close_cycle(p_cycle_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cycle cycles%ROWTYPE;
  BEGIN
    SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id FOR UPDATE;
    IF v_cycle.id IS NULL OR v_cycle.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(v_cycle.board_id) THEN
      RAISE EXCEPTION 'only a panel member of the board closes its cycle' USING ERRCODE = '42501';
    END IF;
    IF v_cycle.state <> 'active' THEN
      RAISE EXCEPTION 'only an active cycle closes' USING ERRCODE = 'PM050';
    END IF;
    PERFORM 1 FROM boards WHERE id = v_cycle.board_id FOR UPDATE;
    UPDATE cycles SET state = 'closed' WHERE id = p_cycle_id;
    UPDATE boards SET status = 'between_cycles' WHERE id = v_cycle.board_id;
    RETURN app_record_snapshot(v_cycle.board_id, 'cycle_close', p_cycle_id);
  END
  $$;

-- Recalibrates a board between cycles: the calibration's attendance, an agreed level for
-- every capability (it may go down), a level change for each one that moves, a snapshot.
CREATE FUNCTION app_recalibrate_board(
  p_board_id uuid, p_held_on date, p_notes text, p_attendee_ids uuid[], p_levels jsonb
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_person uuid;
    v_role text;
    v_now timestamptz := now();
    v_snapshot uuid;
    v_session uuid;
    v_after_cycle uuid;
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id FOR UPDATE;
    IF v_board.id IS NULL OR v_board.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(p_board_id) THEN
      RAISE EXCEPTION 'only a panel member of the board records a recalibration' USING ERRCODE = '42501';
    END IF;
    IF v_board.status <> 'between_cycles' THEN
      RAISE EXCEPTION 'a recalibration happens between cycles' USING ERRCODE = 'PM050';
    END IF;
    SELECT id INTO v_after_cycle FROM cycles
     WHERE board_id = p_board_id AND state = 'closed' ORDER BY number DESC LIMIT 1;
    IF EXISTS (SELECT 1 FROM recalibration_sessions WHERE after_cycle_id = v_after_cycle) THEN
      RAISE EXCEPTION 'there is already one recalibration between these cycles' USING ERRCODE = 'PM050';
    END IF;

    FOREACH v_person IN ARRAY coalesce(p_attendee_ids, '{}') LOOP
      IF v_person IS DISTINCT FROM v_board.owner_person_id AND NOT EXISTS (
        SELECT 1 FROM panel_assignments pa JOIN enrollments m ON m.id = pa.member_enrollment_id
         WHERE pa.participant_enrollment_id = v_board.enrollment_id AND m.person_id = v_person
      ) THEN
        RAISE EXCEPTION 'the attendee % is not on the board', v_person USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF NOT v_board.owner_person_id = ANY (coalesce(p_attendee_ids, '{}')) THEN
      RAISE EXCEPTION 'invariant 3: the participant did not attend the recalibration' USING ERRCODE = 'PM031';
    END IF;
    FOREACH v_role IN ARRAY coalesce((SELECT mandatory_panel_roles FROM programs WHERE id = v_board.program_id), '{}') LOOP
      IF NOT EXISTS (
        SELECT 1 FROM panel_assignments pa JOIN enrollments m ON m.id = pa.member_enrollment_id
         WHERE pa.participant_enrollment_id = v_board.enrollment_id AND pa.role = v_role
           AND m.person_id = ANY (p_attendee_ids)
      ) THEN
        RAISE EXCEPTION 'invariant 3: nobody attended for the mandatory role %', v_role USING ERRCODE = 'PM031';
      END IF;
    END LOOP;

    -- app_agreed_levels comes from migration 0006.
    IF EXISTS (
      SELECT 1 FROM app_agreed_levels(p_levels) a
       WHERE NOT EXISTS (SELECT 1 FROM placements p WHERE p.board_id = p_board_id AND p.capability_id = a.capability_id)
    ) THEN
      RAISE EXCEPTION 'the capability is not on the board' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) <> count(DISTINCT capability_id) FROM app_agreed_levels(p_levels)) THEN
      RAISE EXCEPTION 'a capability has more than one agreed level' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM app_agreed_levels(p_levels)
       WHERE level_id IS NULL OR app_map_of_level(level_id) IS DISTINCT FROM app_map_of_program(v_board.program_id)
    ) THEN
      RAISE EXCEPTION 'the level is not of the program map' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM placements p
       WHERE p.board_id = p_board_id
         AND NOT EXISTS (SELECT 1 FROM app_agreed_levels(p_levels) a WHERE a.capability_id = p.capability_id)
    ) THEN
      RAISE EXCEPTION 'every capability on the board needs an agreed level' USING ERRCODE = '23514';
    END IF;

    INSERT INTO level_changes (organization_id, placement_id, previous_level_id, new_level_id, reason, approved_by, changed_at)
      SELECT v_board.organization_id, p.id, p.level_id, a.level_id, 'recalibration', app_current_person_id(), v_now
        FROM placements p JOIN app_agreed_levels(p_levels) a ON a.capability_id = p.capability_id
       WHERE p.board_id = p_board_id AND p.level_id IS DISTINCT FROM a.level_id;
    UPDATE placements p SET level_id = a.level_id
      FROM app_agreed_levels(p_levels) a
     WHERE p.board_id = p_board_id AND p.capability_id = a.capability_id AND p.level_id IS DISTINCT FROM a.level_id;

    v_snapshot := app_record_snapshot(p_board_id, 'recalibration', NULL);
    INSERT INTO recalibration_sessions
      (organization_id, board_id, held_on, notes, snapshot_id, after_cycle_id, recorded_by, recorded_at)
      VALUES (v_board.organization_id, p_board_id, p_held_on, coalesce(p_notes, ''), v_snapshot, v_after_cycle,
              app_current_person_id(), v_now)
      RETURNING id INTO v_session;
    INSERT INTO recalibration_attendees (organization_id, board_id, recalibration_session_id, person_id)
      SELECT DISTINCT v_board.organization_id, p_board_id, v_session, x FROM unnest(p_attendee_ids) AS x;
    RETURN v_session;
  END
  $$;

CREATE FUNCTION app_close_board(p_board_id uuid) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id FOR UPDATE;
    IF v_board.id IS NULL OR v_board.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(p_board_id) THEN
      RAISE EXCEPTION 'only a panel member of the board closes it' USING ERRCODE = '42501';
    END IF;
    IF v_board.status NOT IN ('calibrated', 'between_cycles') OR EXISTS (
      SELECT 1 FROM cycles WHERE board_id = p_board_id AND state <> 'closed'
    ) THEN
      RAISE EXCEPTION 'a board closes with no cycle open' USING ERRCODE = 'PM050';
    END IF;
    UPDATE boards SET status = 'closed' WHERE id = p_board_id;
    RETURN now();
  END
  $$;

-- Row Level Security: owner and panel read; no super administrator clause (invariant 9).
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['snapshots', 'snapshot_entries', 'recalibration_sessions', 'recalibration_attendees'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (organization_id = app_current_organization_id() AND app_sees_board(board_id))',
      v_table || '_read', v_table
    );
    EXECUTE format('GRANT SELECT ON %I TO potencializador_app', v_table);
  END LOOP;
END
$$;

-- app_record_snapshot is used only by the functions above.
REVOKE ALL ON FUNCTION app_record_snapshot(uuid, text, uuid) FROM PUBLIC;
DO $$
DECLARE
  v_function text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'app_close_cycle(uuid)', 'app_recalibrate_board(uuid, date, text, uuid[], jsonb)', 'app_close_board(uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO potencializador_app', v_function);
  END LOOP;
END
$$;
