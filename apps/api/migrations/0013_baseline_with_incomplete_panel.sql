-- The baseline with an incomplete panel (amendment of invariant 3, user decision of
-- 2026-11-23): the participant must still attend, but the panel may fix the baseline
-- without a mandatory role when it says so explicitly. The calibration records which
-- mandatory roles were missing.
--
-- Without p_allow_missing_roles the function refuses as before (PM031), so a caller that
-- does not know the amendment keeps the original rule.

-- Mandatory roles nobody attended for. Existing calibrations had every role present.
ALTER TABLE calibration_sessions ADD COLUMN missing_panel_roles text[] NOT NULL DEFAULT '{}';

DROP FUNCTION app_calibrate_board(uuid, date, text, uuid[], jsonb);

-- Records the calibration of a board and fixes its baseline. p_levels is a JSON array of
-- {"capabilityId", "levelId"}, one per capability on the board.
CREATE FUNCTION app_calibrate_board(
  p_board_id uuid, p_held_on date, p_notes text, p_attendee_ids uuid[], p_levels jsonb,
  p_allow_missing_roles boolean DEFAULT false
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_map uuid;
    v_person uuid;
    v_role text;
    v_session uuid;
    v_missing text[] := '{}';
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
      RAISE EXCEPTION 'a board is calibrated once it is self-assessed' USING ERRCODE = 'PM032';
    END IF;

    -- Attendance: the owner and panel members of this board only; the owner always attends.
    FOREACH v_person IN ARRAY coalesce(p_attendee_ids, '{}') LOOP
      IF v_person IS DISTINCT FROM v_board.owner_person_id AND NOT EXISTS (
        SELECT 1 FROM panel_assignments pa JOIN enrollments m ON m.id = pa.member_enrollment_id
         WHERE pa.participant_enrollment_id = v_board.enrollment_id AND m.person_id = v_person
      ) THEN
        RAISE EXCEPTION 'the attendee % is not on the board', v_person USING ERRCODE = '23514';
      END IF;
    END LOOP;
    IF NOT v_board.owner_person_id = ANY (coalesce(p_attendee_ids, '{}')) THEN
      RAISE EXCEPTION 'invariant 3: the participant did not attend the calibration' USING ERRCODE = 'PM031';
    END IF;
    FOREACH v_role IN ARRAY coalesce((SELECT mandatory_panel_roles FROM programs WHERE id = v_board.program_id), '{}') LOOP
      IF NOT EXISTS (
        SELECT 1 FROM panel_assignments pa JOIN enrollments m ON m.id = pa.member_enrollment_id
         WHERE pa.participant_enrollment_id = v_board.enrollment_id AND pa.role = v_role
           AND m.person_id = ANY (p_attendee_ids)
      ) THEN
        IF NOT coalesce(p_allow_missing_roles, false) THEN
          RAISE EXCEPTION 'invariant 3: nobody attended for the mandatory role %', v_role USING ERRCODE = 'PM031';
        END IF;
        v_missing := v_missing || v_role;
      END IF;
    END LOOP;

    -- Agreed levels: one per capability on the board, of the program's map.
    IF EXISTS (
      SELECT 1 FROM app_agreed_levels(p_levels) a
       WHERE NOT EXISTS (SELECT 1 FROM placements p WHERE p.board_id = p_board_id AND p.capability_id = a.capability_id)
    ) THEN
      RAISE EXCEPTION 'the capability is not on the board' USING ERRCODE = '23514';
    END IF;
    IF (SELECT count(*) <> count(DISTINCT capability_id) FROM app_agreed_levels(p_levels)) THEN
      RAISE EXCEPTION 'a capability has more than one agreed level' USING ERRCODE = '23514';
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

    INSERT INTO calibration_sessions (organization_id, board_id, held_on, notes, missing_panel_roles, recorded_by, recorded_at)
      VALUES (v_board.organization_id, p_board_id, p_held_on, coalesce(p_notes, ''), v_missing, app_current_person_id(), v_now)
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

REVOKE ALL ON FUNCTION app_calibrate_board(uuid, date, text, uuid[], jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_calibrate_board(uuid, date, text, uuid[], jsonb, boolean) TO potencializador_app;
