-- A cycle closes only with every experiment reviewed (user decision of 2026-11-23). Before,
-- a cycle closed with experiments planned or in progress, and the closed-cycle guard froze
-- them that way for good. A planned experiment that never ran is reviewed as discarded, so
-- the panel can always close. Cycles already closed keep their experiments as they are.
--
-- Same function as 0009 plus the check, under the cycle lock that the experiment guard also
-- takes, so no experiment moves between the check and the close.
--
-- SQL states: PM008 invariant 8 (what a cycle needs); PM050 a state that does not allow it.

CREATE OR REPLACE FUNCTION app_close_cycle(p_cycle_id uuid) RETURNS uuid
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
    IF EXISTS (
      SELECT 1 FROM experiments e JOIN focuses f ON f.id = e.focus_id
       WHERE f.cycle_id = p_cycle_id AND e.state <> 'reviewed'
    ) THEN
      RAISE EXCEPTION 'a cycle closes once every experiment is reviewed' USING ERRCODE = 'PM008';
    END IF;
    PERFORM 1 FROM boards WHERE id = v_cycle.board_id FOR UPDATE;
    UPDATE cycles SET state = 'closed' WHERE id = p_cycle_id;
    UPDATE boards SET status = 'between_cycles' WHERE id = v_cycle.board_id;
    RETURN app_record_snapshot(v_cycle.board_id, 'cycle_close', p_cycle_id);
  END
  $$;
