-- The WIP mark is only automatic (user request of 2026-11-23): nobody puts it or takes it off
-- by hand, so it is on exactly while an experiment on the capability is in progress in a
-- cycle of the board that is not closed. Migration 0019 already keeps it while one is in
-- progress; this also refuses a `wip` row without one, and aligns the existing marks.
--
-- SQL states: PM050 a state that does not allow the change.

CREATE FUNCTION app_capability_in_progress(p_board_id uuid, p_capability_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM experiments e
        JOIN focuses f ON f.id = e.focus_id
        JOIN cycles c ON c.id = f.cycle_id
       WHERE c.board_id = p_board_id
         AND c.state <> 'closed'
         AND f.capability_id = p_capability_id
         AND e.state = 'in_progress'
    )
  $$;
REVOKE ALL ON FUNCTION app_capability_in_progress(uuid, uuid) FROM PUBLIC;

CREATE FUNCTION guard_wip_mark_insert() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF NEW.mark = 'wip' AND NOT app_capability_in_progress(NEW.board_id, NEW.capability_id) THEN
      RAISE EXCEPTION 'WIP is on only while an experiment on the capability is in progress' USING ERRCODE = 'PM050';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER placement_marks_wip_insert BEFORE INSERT ON placement_marks
  FOR EACH ROW EXECUTE FUNCTION guard_wip_mark_insert();

-- Existing marks, on boards not closed (a closed board never changes): WIP put by hand
-- without an experiment in progress comes off; an experiment started before migration 0020
-- puts its WIP on.
DELETE FROM placement_marks m
 USING boards b
 WHERE b.id = m.board_id AND b.status <> 'closed'
   AND m.mark = 'wip'
   AND NOT app_capability_in_progress(m.board_id, m.capability_id);

INSERT INTO placement_marks (organization_id, board_id, capability_id, mark, marked_by)
SELECT DISTINCT ON (c.board_id, f.capability_id) c.organization_id, c.board_id, f.capability_id, 'wip', e.created_by
  FROM experiments e
  JOIN focuses f ON f.id = e.focus_id
  JOIN cycles c ON c.id = f.cycle_id
  JOIN placements p ON p.board_id = c.board_id AND p.capability_id = f.capability_id
  JOIN boards b ON b.id = c.board_id
 WHERE c.state <> 'closed' AND e.state = 'in_progress' AND b.status <> 'closed'
ON CONFLICT DO NOTHING;
