-- Focuses above the recommended number (user request of 2026-11-23): the program's maximum
-- of focuses per cycle becomes a recommended number. A planned cycle may take more focuses,
-- and it starts whatever their number; the web app warns when a focus goes above it.
--
-- Invariant 8 now reads: a cycle starts only with at least one focus and an experiment per
-- focus; once active, its focuses stay and its experiments are not deleted. The column
-- programs.max_focuses keeps its name and holds the recommended number.

-- Focuses change only while their cycle is planned, above the current level of a placed
-- capability, on a level of the program map.
CREATE OR REPLACE FUNCTION guard_focus() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_row focuses%ROWTYPE;
    v_cycle cycles%ROWTYPE;
    v_board boards%ROWTYPE;
    v_current integer;
    v_target integer;
  BEGIN
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    -- Locks the cycle: focus changes and the start of the cycle never interleave.
    SELECT * INTO v_cycle FROM cycles WHERE id = v_row.cycle_id FOR UPDATE;
    IF v_cycle.id IS NULL THEN
      RETURN v_row; -- cascade from the cycle's own removal
    END IF;
    IF v_cycle.state <> 'planned' THEN
      RAISE EXCEPTION 'the focuses of a cycle change only while it is planned' USING ERRCODE = 'PM050';
    END IF;
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.cycle_id <> OLD.cycle_id OR NEW.capability_id <> OLD.capability_id) THEN
      RAISE EXCEPTION 'a focus never changes cycle or capability' USING ERRCODE = 'PM050';
    END IF;

    SELECT * INTO v_board FROM boards WHERE id = v_cycle.board_id;
    SELECT l.position INTO v_current
      FROM placements p JOIN levels l ON l.id = p.level_id
     WHERE p.board_id = v_board.id AND p.capability_id = NEW.capability_id;
    IF NOT EXISTS (SELECT 1 FROM placements WHERE board_id = v_board.id AND capability_id = NEW.capability_id) THEN
      RAISE EXCEPTION 'the capability is not on the board' USING ERRCODE = '23514';
    END IF;
    IF app_map_of_level(NEW.target_level_id) IS DISTINCT FROM app_map_of_program(v_board.program_id) THEN
      RAISE EXCEPTION 'the level is not of the program map' USING ERRCODE = '23514';
    END IF;
    SELECT position INTO v_target FROM levels WHERE id = NEW.target_level_id;
    IF v_current IS NULL OR v_target <= v_current THEN
      RAISE EXCEPTION 'the target level must be above the current level of a placed capability' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.created_by := coalesce(app_current_person_id(), NEW.created_by);
      NEW.created_at := now();
    END IF;
    RETURN NEW;
  END
  $$;

-- Starts a planned cycle: only a panel member, with at least one focus, each with an
-- experiment (invariant 8), whatever the number of focuses. The board goes "en ciclo".
CREATE OR REPLACE FUNCTION app_start_cycle(p_cycle_id uuid) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cycle cycles%ROWTYPE;
    v_board boards%ROWTYPE;
    v_now timestamptz := now();
  BEGIN
    SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id FOR UPDATE;
    IF v_cycle.id IS NULL OR v_cycle.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(v_cycle.board_id) THEN
      RAISE EXCEPTION 'only a panel member of the board starts its cycle' USING ERRCODE = '42501';
    END IF;
    IF v_cycle.state <> 'planned' THEN
      RAISE EXCEPTION 'only a planned cycle starts' USING ERRCODE = 'PM050';
    END IF;
    SELECT * INTO v_board FROM boards WHERE id = v_cycle.board_id FOR UPDATE;
    IF v_board.status NOT IN ('calibrated', 'between_cycles') THEN
      RAISE EXCEPTION 'a cycle starts on a calibrated board or between cycles' USING ERRCODE = 'PM050';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM focuses WHERE cycle_id = p_cycle_id) THEN
      RAISE EXCEPTION 'invariant 8: a cycle starts with at least one focus' USING ERRCODE = 'PM008';
    END IF;
    IF EXISTS (
      SELECT 1 FROM focuses f
       WHERE f.cycle_id = p_cycle_id AND NOT EXISTS (SELECT 1 FROM experiments e WHERE e.focus_id = f.id)
    ) THEN
      RAISE EXCEPTION 'invariant 8: every focus needs at least one experiment' USING ERRCODE = 'PM008';
    END IF;
    UPDATE cycles SET state = 'active', started_at = v_now WHERE id = p_cycle_id;
    UPDATE boards SET status = 'in_cycle' WHERE id = v_board.id;
    RETURN v_now;
  END
  $$;
