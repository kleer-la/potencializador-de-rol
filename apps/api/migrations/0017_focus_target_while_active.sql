-- Focus target while active (user request of 2026-11-23): the target level of a focus
-- changes while its cycle is planned or active, never once it is closed. Adding and removing
-- focuses stays limited to a planned cycle, so an active cycle keeps its focuses (invariant 8).

-- Focuses are added and removed only while their cycle is planned; their target level
-- changes while it is planned or active. Always above the current level of a placed
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
    IF TG_OP = 'UPDATE' AND v_cycle.state = 'closed' THEN
      RAISE EXCEPTION 'the target level of a focus never changes in a closed cycle' USING ERRCODE = 'PM050';
    END IF;
    IF TG_OP <> 'UPDATE' AND v_cycle.state <> 'planned' THEN
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
    ELSE
      NEW.created_by := OLD.created_by;
      NEW.created_at := OLD.created_at;
    END IF;
    RETURN NEW;
  END
  $$;
