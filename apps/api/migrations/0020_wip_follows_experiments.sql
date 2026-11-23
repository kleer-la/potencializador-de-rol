-- The WIP mark follows the experiments (user request of 2026-11-23): starting an experiment
-- puts the `wip` mark on its capability; when no experiment on that capability is in
-- progress any more, in a cycle of the board that is not closed, the mark comes off. A
-- planned experiment that has not started does not keep it (user decision of 2026-11-23);
-- starting it puts the mark back.
--
-- It runs after the experiment guards, so only moves they accepted change marks. SECURITY
-- DEFINER: whoever may move the experiment also moves its mark, without needing a policy of
-- `placement_marks`. Board, capability and organization come from the experiment's own focus.

CREATE FUNCTION wip_follows_experiment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_focus record;
  BEGIN
    IF NEW.state = OLD.state THEN
      RETURN NULL;
    END IF;
    SELECT f.capability_id, c.board_id, c.organization_id
      INTO v_focus
      FROM focuses f JOIN cycles c ON c.id = f.cycle_id
     WHERE f.id = NEW.focus_id;

    IF NEW.state = 'in_progress' THEN
      INSERT INTO placement_marks (organization_id, board_id, capability_id, mark, marked_by)
      SELECT v_focus.organization_id, v_focus.board_id, v_focus.capability_id, 'wip',
             coalesce(app_current_person_id(), NEW.created_by)
       WHERE EXISTS (
         SELECT 1 FROM placements WHERE board_id = v_focus.board_id AND capability_id = v_focus.capability_id
       )
      ON CONFLICT DO NOTHING;
    ELSIF OLD.state = 'in_progress' AND NOT EXISTS (
      SELECT 1
        FROM experiments e
        JOIN focuses f ON f.id = e.focus_id
        JOIN cycles c ON c.id = f.cycle_id
       WHERE c.board_id = v_focus.board_id
         AND c.state <> 'closed'
         AND f.capability_id = v_focus.capability_id
         AND e.state = 'in_progress'
    ) THEN
      DELETE FROM placement_marks
       WHERE board_id = v_focus.board_id AND capability_id = v_focus.capability_id AND mark = 'wip';
    END IF;
    RETURN NULL;
  END
  $$;
CREATE TRIGGER experiments_wip_mark AFTER UPDATE OF state ON experiments
  FOR EACH ROW EXECUTE FUNCTION wip_follows_experiment();
