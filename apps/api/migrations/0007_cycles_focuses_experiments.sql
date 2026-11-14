-- Improvement cycles, their focuses and experiments.
--
-- Invariant 8: a cycle never holds more focuses than the program's maximum, and it starts
--   only when every focus has at least one experiment. Once active, its focuses stay and
--   its experiments are not deleted (discarding is a result).
-- Invariant 9: the owner and their panel read and plan them; nobody else. Only the panel
--   starts a cycle and reviews experiments.
-- Invariant 11: organization_id, composite foreign keys, Row Level Security.
--
-- SQL states: PM008 invariant 8; PM050 a state that does not allow the change.

CREATE TABLE cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  -- 1, 2, ... per board; set by the guard.
  number integer NOT NULL DEFAULT 0,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'active', 'closed')),
  started_at timestamptz,
  created_by uuid NOT NULL REFERENCES persons (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  CONSTRAINT cycles_number_per_board UNIQUE (board_id, number),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id)
);
CREATE UNIQUE INDEX cycles_one_open_per_board ON cycles (board_id) WHERE state <> 'closed';

CREATE TABLE focuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  target_level_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES persons (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT focuses_one_per_capability UNIQUE (cycle_id, capability_id),
  UNIQUE (id, organization_id),
  FOREIGN KEY (cycle_id, organization_id) REFERENCES cycles (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id),
  FOREIGN KEY (target_level_id, organization_id) REFERENCES levels (id, organization_id)
);

CREATE TABLE experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  focus_id uuid NOT NULL,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  expected_result text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT 'planned' CHECK (state IN ('planned', 'in_progress', 'reviewed')),
  result text CHECK (result IN ('consolidated', 'not_consolidated', 'discarded')),
  learnings text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES persons (id),
  reviewed_at timestamptz,
  created_by uuid NOT NULL REFERENCES persons (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'reviewed') = (result IS NOT NULL)),
  UNIQUE (id, organization_id),
  FOREIGN KEY (focus_id, organization_id) REFERENCES focuses (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX experiments_focus_index ON experiments (focus_id);

-- Lookups ------------------------------------------------------------------------------

CREATE FUNCTION app_board_of_cycle(p_cycle_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT board_id FROM cycles
     WHERE id = p_cycle_id AND organization_id = app_current_organization_id() AND app_sees_board(board_id)
  $$;

CREATE FUNCTION app_board_of_focus(p_focus_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.board_id FROM focuses f JOIN cycles c ON c.id = f.cycle_id
     WHERE f.id = p_focus_id AND f.organization_id = app_current_organization_id() AND app_sees_board(c.board_id)
  $$;

-- Guards -------------------------------------------------------------------------------

CREATE FUNCTION guard_cycle() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.state <> 'planned' THEN
        RAISE EXCEPTION 'only a planned cycle is deleted' USING ERRCODE = 'PM050';
      END IF;
      RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF NOT EXISTS (
        SELECT 1 FROM boards WHERE id = NEW.board_id AND baseline_set_at IS NOT NULL AND status <> 'closed'
      ) THEN
        RAISE EXCEPTION 'a cycle needs an open board with a baseline' USING ERRCODE = 'PM050';
      END IF;
      -- Serializes numbering per board.
      PERFORM 1 FROM boards WHERE id = NEW.board_id FOR UPDATE;
      NEW.number := coalesce((SELECT max(number) FROM cycles WHERE board_id = NEW.board_id), 0) + 1;
      NEW.state := 'planned';
      NEW.started_at := NULL;
      NEW.created_by := coalesce(app_current_person_id(), NEW.created_by);
      NEW.created_at := now();
      RETURN NEW;
    END IF;
    IF NEW.board_id <> OLD.board_id OR NEW.number <> OLD.number OR NEW.organization_id <> OLD.organization_id THEN
      RAISE EXCEPTION 'a cycle never changes board or number' USING ERRCODE = 'PM050';
    END IF;
    IF (NEW.starts_on, NEW.ends_on) IS DISTINCT FROM (OLD.starts_on, OLD.ends_on) AND OLD.state <> 'planned' THEN
      RAISE EXCEPTION 'the dates of a cycle change only while it is planned' USING ERRCODE = 'PM050';
    END IF;
    IF NEW.state <> OLD.state AND NOT (
      (OLD.state = 'planned' AND NEW.state = 'active') OR (OLD.state = 'active' AND NEW.state = 'closed')
    ) THEN
      RAISE EXCEPTION 'a cycle goes from planned to active to closed' USING ERRCODE = 'PM050';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER cycles_guard BEFORE INSERT OR UPDATE OR DELETE ON cycles
  FOR EACH ROW EXECUTE FUNCTION guard_cycle();

-- Focuses change only while their cycle is planned; invariant 8 caps their number.
CREATE FUNCTION guard_focus() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_row focuses%ROWTYPE;
    v_cycle cycles%ROWTYPE;
    v_board boards%ROWTYPE;
    v_max integer;
    v_current integer;
    v_target integer;
  BEGIN
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    -- Locks the cycle: concurrent focuses are counted one after the other.
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
      SELECT max_focuses INTO v_max FROM programs WHERE id = v_board.program_id;
      IF (SELECT count(*) FROM focuses WHERE cycle_id = NEW.cycle_id) >= v_max THEN
        RAISE EXCEPTION 'invariant 8: the cycle already has the maximum of % focuses', v_max USING ERRCODE = 'PM008';
      END IF;
      NEW.created_by := coalesce(app_current_person_id(), NEW.created_by);
      NEW.created_at := now();
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER focuses_guard BEFORE INSERT OR UPDATE OR DELETE ON focuses
  FOR EACH ROW EXECUTE FUNCTION guard_focus();

-- Experiment states: planned -> in_progress -> reviewed with a result; a planned one may be
-- reviewed only as discarded; nothing moves outside an active cycle; reviewed is final and
-- only a panel member reviews. Experiments of a cycle that started are not deleted.
CREATE FUNCTION guard_experiment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_row experiments%ROWTYPE;
    v_cycle cycles%ROWTYPE;
  BEGIN
    v_row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
    -- Locks the cycle, as the focus guard and app_start_cycle do: removing an experiment and
    -- starting the cycle never interleave (invariant 8).
    SELECT c.* INTO v_cycle FROM focuses f JOIN cycles c ON c.id = f.cycle_id WHERE f.id = v_row.focus_id
      FOR UPDATE OF c;
    IF TG_OP = 'DELETE' THEN
      IF v_cycle.id IS NOT NULL AND v_cycle.state <> 'planned' THEN
        RAISE EXCEPTION 'invariant 8: experiments of a cycle that started are not deleted; discard them'
          USING ERRCODE = 'PM008';
      END IF;
      RETURN OLD;
    END IF;
    IF TG_OP = 'INSERT' THEN
      IF v_cycle.state NOT IN ('planned', 'active') THEN
        RAISE EXCEPTION 'experiments join a planned or active cycle' USING ERRCODE = 'PM050';
      END IF;
      NEW.state := 'planned';
      NEW.result := NULL;
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
      NEW.created_by := coalesce(app_current_person_id(), NEW.created_by);
      NEW.created_at := now();
      RETURN NEW;
    END IF;

    IF OLD.state = 'reviewed' THEN
      RAISE EXCEPTION 'a reviewed experiment is final' USING ERRCODE = 'PM050';
    END IF;
    IF NEW.focus_id <> OLD.focus_id THEN
      RAISE EXCEPTION 'an experiment never changes focus' USING ERRCODE = 'PM050';
    END IF;
    IF NEW.state <> OLD.state OR NEW.result IS DISTINCT FROM OLD.result THEN
      IF v_cycle.state <> 'active' THEN
        RAISE EXCEPTION 'experiments move only in an active cycle' USING ERRCODE = 'PM050';
      END IF;
      IF NEW.state = 'in_progress' AND OLD.state = 'planned' AND NEW.result IS NULL THEN
        RETURN NEW;
      END IF;
      IF NEW.state <> 'reviewed' THEN
        RAISE EXCEPTION 'an experiment goes from planned to in progress to reviewed' USING ERRCODE = 'PM050';
      END IF;
      IF NOT app_on_board_panel(v_cycle.board_id) THEN
        RAISE EXCEPTION 'only a panel member reviews an experiment' USING ERRCODE = '42501';
      END IF;
      IF NEW.result IS NULL THEN
        RAISE EXCEPTION 'a reviewed experiment needs a result' USING ERRCODE = 'PM050';
      END IF;
      IF OLD.state = 'planned' AND NEW.result <> 'discarded' THEN
        RAISE EXCEPTION 'an experiment that never ran can only be discarded' USING ERRCODE = 'PM050';
      END IF;
      NEW.reviewed_by := app_current_person_id();
      NEW.reviewed_at := now();
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER experiments_guard BEFORE INSERT OR UPDATE OR DELETE ON experiments
  FOR EACH ROW EXECUTE FUNCTION guard_experiment();

-- Starts a planned cycle: only a panel member, with at least one focus, no more than the
-- program's maximum, each with an experiment (invariant 8). The board goes "en ciclo".
CREATE FUNCTION app_start_cycle(p_cycle_id uuid) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_cycle cycles%ROWTYPE;
    v_board boards%ROWTYPE;
    v_max integer;
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
    SELECT max_focuses INTO v_max FROM programs WHERE id = v_board.program_id;
    IF NOT EXISTS (SELECT 1 FROM focuses WHERE cycle_id = p_cycle_id) THEN
      RAISE EXCEPTION 'invariant 8: a cycle starts with at least one focus' USING ERRCODE = 'PM008';
    END IF;
    IF (SELECT count(*) FROM focuses WHERE cycle_id = p_cycle_id) > v_max THEN
      RAISE EXCEPTION 'invariant 8: the cycle has more than the maximum of % focuses', v_max USING ERRCODE = 'PM008';
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

-- Row Level Security: owner and panel, no super administrator clause (invariant 9).
-- Column grants keep the state of a cycle and who reviewed an experiment out of the API's
-- direct reach: the function and the guards set them.

ALTER TABLE cycles ENABLE ROW LEVEL SECURITY;
CREATE POLICY cycles_read ON cycles FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(board_id));
CREATE POLICY cycles_insert ON cycles FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_sees_board(board_id));
CREATE POLICY cycles_update ON cycles FOR UPDATE
  USING (organization_id = app_current_organization_id() AND app_sees_board(board_id))
  WITH CHECK (organization_id = app_current_organization_id() AND app_sees_board(board_id));
CREATE POLICY cycles_delete ON cycles FOR DELETE
  USING (organization_id = app_current_organization_id() AND app_sees_board(board_id));
GRANT SELECT, INSERT, DELETE ON cycles TO potencializador_app;
GRANT UPDATE (starts_on, ends_on) ON cycles TO potencializador_app;

ALTER TABLE focuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY focuses_read ON focuses FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_cycle(cycle_id)));
CREATE POLICY focuses_insert ON focuses FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_cycle(cycle_id)));
CREATE POLICY focuses_update ON focuses FOR UPDATE
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_cycle(cycle_id)))
  WITH CHECK (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_cycle(cycle_id)));
CREATE POLICY focuses_delete ON focuses FOR DELETE
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_cycle(cycle_id)));
GRANT SELECT, INSERT, DELETE ON focuses TO potencializador_app;
GRANT UPDATE (target_level_id) ON focuses TO potencializador_app;

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY experiments_read ON experiments FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_focus(focus_id)));
CREATE POLICY experiments_insert ON experiments FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_focus(focus_id)));
CREATE POLICY experiments_update ON experiments FOR UPDATE
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_focus(focus_id)))
  WITH CHECK (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_focus(focus_id)));
CREATE POLICY experiments_delete ON experiments FOR DELETE
  USING (organization_id = app_current_organization_id() AND app_sees_board(app_board_of_focus(focus_id)));
GRANT SELECT, INSERT, DELETE ON experiments TO potencializador_app;
GRANT UPDATE (description, expected_result, state, result, learnings) ON experiments TO potencializador_app;

DO $$
DECLARE
  v_function text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY['app_board_of_cycle(uuid)', 'app_board_of_focus(uuid)', 'app_start_cycle(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO potencializador_app', v_function);
  END LOOP;
END
$$;
