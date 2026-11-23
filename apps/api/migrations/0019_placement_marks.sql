-- Marks on the capabilities of a board (user request of 2026-11-23): a capability on a board
-- may carry the mark `candidate` (to work on in the short or medium term) and the mark `wip`
-- (being worked on now). The catalog grows by widening the CHECK below.
--
-- The owner and their panel put and take off marks; everyone who reads the board sees them.
-- The `wip` mark stays while an experiment in progress, in a cycle of the board that is not
-- closed, belongs to a focus on that capability (user decision of 2026-11-23). A closed board
-- never changes.
--
-- SQL states: PM050 a state that does not allow the change.

CREATE TABLE placement_marks (
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  mark text NOT NULL CHECK (mark IN ('candidate', 'wip')),
  marked_by uuid NOT NULL REFERENCES persons (id),
  marked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (board_id, capability_id, mark),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id) ON DELETE CASCADE,
  -- A mark lives on a capability of the board; taking the capability off takes its marks off.
  FOREIGN KEY (board_id, capability_id) REFERENCES placements (board_id, capability_id) ON DELETE CASCADE
);

CREATE FUNCTION guard_placement_mark() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board_id uuid := coalesce(NEW.board_id, OLD.board_id);
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'a mark is put or taken off, never edited' USING ERRCODE = 'PM050';
    END IF;
    IF TG_OP = 'DELETE' THEN
      -- A cascade from the capability or the board taking it off: nothing left to keep.
      IF NOT EXISTS (SELECT 1 FROM placements WHERE board_id = OLD.board_id AND capability_id = OLD.capability_id) THEN
        RETURN OLD;
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM boards WHERE id = v_board_id AND status = 'closed') THEN
      RAISE EXCEPTION 'the board is closed' USING ERRCODE = 'PM050';
    END IF;
    IF TG_OP = 'DELETE' THEN
      IF OLD.mark = 'wip' AND EXISTS (
        SELECT 1
          FROM experiments e
          JOIN focuses f ON f.id = e.focus_id
          JOIN cycles c ON c.id = f.cycle_id
         WHERE c.board_id = OLD.board_id
           AND c.state <> 'closed'
           AND f.capability_id = OLD.capability_id
           AND e.state = 'in_progress'
      ) THEN
        RAISE EXCEPTION 'an experiment on the capability is in progress' USING ERRCODE = 'PM050';
      END IF;
      RETURN OLD;
    END IF;
    NEW.marked_by := coalesce(app_current_person_id(), NEW.marked_by);
    NEW.marked_at := now();
    RETURN NEW;
  END
  $$;
CREATE TRIGGER placement_mark_guard BEFORE INSERT OR UPDATE OR DELETE ON placement_marks
  FOR EACH ROW EXECUTE FUNCTION guard_placement_mark();

-- Invariant 9 and 11: the organization in scope; readers of the board read, the owner and
-- their panel write.
ALTER TABLE placement_marks ENABLE ROW LEVEL SECURITY;
CREATE POLICY placement_marks_read ON placement_marks FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_reads_board(board_id));
CREATE POLICY placement_marks_insert ON placement_marks FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_sees_board(board_id));
CREATE POLICY placement_marks_delete ON placement_marks FOR DELETE
  USING (organization_id = app_current_organization_id() AND app_sees_board(board_id));
GRANT SELECT, INSERT, DELETE ON placement_marks TO potencializador_app;
