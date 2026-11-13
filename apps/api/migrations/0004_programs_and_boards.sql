-- Programs, enrollments, panels, boards and placements.
--
-- Guarantees kept here, below any application code:
--   Invariant 1: one placement per capability on a board; only capabilities and levels of
--     the program's map; no capability is removed once the board has a baseline.
--   Invariant 9: the content of a board (its placements) is read and changed only by its
--     owner and their panel; changed only by the panel. There is no super administrator
--     bypass: a person of the mentoring firm sees a board only when on its panel.
--   Invariant 11: organization_id on every table, composite foreign keys, Row Level Security.

-- Levels get the composite key placements need; the column pair is already unique.
ALTER TABLE levels ADD CONSTRAINT levels_id_organization_unique UNIQUE (id, organization_id);

CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  max_focuses integer NOT NULL DEFAULT 3 CHECK (max_focuses BETWEEN 1 AND 20),
  mandatory_panel_roles text[] NOT NULL DEFAULT '{leader,specialist,mentor}'
    CHECK (mandatory_panel_roles <@ ARRAY['leader', 'specialist', 'mentor']),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on),
  UNIQUE (id, organization_id),
  FOREIGN KEY (map_id, organization_id) REFERENCES capability_maps (id, organization_id)
);
CREATE INDEX programs_map_id_index ON programs (map_id);

-- The base selection: capabilities of the program's map that every new board starts with.
CREATE TABLE program_capabilities (
  organization_id uuid NOT NULL,
  program_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  PRIMARY KEY (program_id, capability_id),
  FOREIGN KEY (program_id, organization_id) REFERENCES programs (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id)
);

CREATE TABLE enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  program_id uuid NOT NULL,
  -- A person of the organization, or of the mentoring firm (checked by trigger: a plain
  -- foreign key cannot say "this organization or none").
  person_id uuid NOT NULL REFERENCES persons (id),
  role text NOT NULL CHECK (role IN ('participant', 'leader', 'specialist', 'mentor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (program_id, person_id, role),
  UNIQUE (id, organization_id),
  FOREIGN KEY (program_id, organization_id) REFERENCES programs (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX enrollments_person_id_index ON enrollments (person_id);

CREATE TABLE panel_assignments (
  organization_id uuid NOT NULL,
  participant_enrollment_id uuid NOT NULL,
  member_enrollment_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('leader', 'specialist', 'mentor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (participant_enrollment_id, member_enrollment_id, role),
  FOREIGN KEY (participant_enrollment_id, organization_id) REFERENCES enrollments (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (member_enrollment_id, organization_id) REFERENCES enrollments (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX panel_assignments_member_index ON panel_assignments (member_enrollment_id);

CREATE TABLE boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  -- One board per participant enrollment; program and owner are copied from it by trigger.
  enrollment_id uuid NOT NULL UNIQUE,
  program_id uuid NOT NULL,
  owner_person_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started', 'self_assessed', 'calibrated', 'in_cycle', 'between_cycles', 'closed')),
  baseline_set_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (enrollment_id, organization_id) REFERENCES enrollments (id, organization_id) ON DELETE CASCADE
);
CREATE INDEX boards_owner_person_id_index ON boards (owner_person_id);

CREATE TABLE placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  -- NULL: not placed yet. A valid state at any time; it counts zero.
  level_id uuid,
  added_by uuid NOT NULL REFERENCES persons (id),
  added_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT placements_one_per_capability UNIQUE (board_id, capability_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id),
  FOREIGN KEY (level_id, organization_id) REFERENCES levels (id, organization_id)
);
CREATE INDEX placements_board_id_index ON placements (board_id);

-- Lookups for the guards. SECURITY DEFINER because each must see the row whatever the
-- caller's policies (a firm person, a map of the same organization); each returns one fact.

CREATE FUNCTION app_map_of_capability(p_capability_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT d.map_id FROM capabilities c JOIN dimensions d ON d.id = c.dimension_id WHERE c.id = p_capability_id
  $$;

CREATE FUNCTION app_map_of_level(p_level_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT map_id FROM levels WHERE id = p_level_id $$;

CREATE FUNCTION app_map_of_program(p_program_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT map_id FROM programs WHERE id = p_program_id $$;

-- Invariant 9: owner or panel member of the board, for the person acting.
CREATE FUNCTION app_on_board_panel(p_board_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM boards b
        JOIN panel_assignments pa ON pa.participant_enrollment_id = b.enrollment_id
        JOIN enrollments member ON member.id = pa.member_enrollment_id
       WHERE b.id = p_board_id AND member.person_id = app_current_person_id()
    )
  $$;

CREATE FUNCTION app_sees_board(p_board_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (SELECT 1 FROM boards WHERE id = p_board_id AND owner_person_id = app_current_person_id())
        OR app_on_board_panel(p_board_id)
  $$;

-- A person enrolled in a program of the organization in scope (a firm mentor, typically).
CREATE FUNCTION app_enrolled_in_current_organization(p_person_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM enrollments
       WHERE person_id = p_person_id AND organization_id = app_current_organization_id()
    )
  $$;

-- Guards -------------------------------------------------------------------------------

CREATE FUNCTION guard_program() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      IF NEW.map_id <> OLD.map_id OR NEW.organization_id <> OLD.organization_id THEN
        RAISE EXCEPTION 'the map of a program never changes' USING ERRCODE = '23514';
      END IF;
      RETURN NEW;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM capability_maps
       WHERE id = NEW.map_id AND organization_id = NEW.organization_id AND status = 'published'
    ) THEN
      RAISE EXCEPTION 'a program needs a published map version' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER programs_guard BEFORE INSERT OR UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION guard_program();

CREATE FUNCTION guard_program_capability() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF app_map_of_capability(NEW.capability_id) IS DISTINCT FROM app_map_of_program(NEW.program_id) THEN
      RAISE EXCEPTION 'not a capability of the program map' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER program_capabilities_guard BEFORE INSERT OR UPDATE ON program_capabilities
  FOR EACH ROW EXECUTE FUNCTION guard_program_capability();

CREATE FUNCTION guard_enrollment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_found boolean;
    v_person_organization uuid;
  BEGIN
    SELECT true, organization_id INTO v_found, v_person_organization FROM persons WHERE id = NEW.person_id;
    IF v_person_organization IS NULL AND v_found THEN
      IF NEW.role = 'participant' THEN
        RAISE EXCEPTION 'a person of the mentoring firm cannot be a participant' USING ERRCODE = '23514';
      END IF;
    ELSIF v_person_organization IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'the person does not belong to the organization' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (NEW.person_id <> OLD.person_id OR NEW.program_id <> OLD.program_id) THEN
      RAISE EXCEPTION 'an enrollment never changes person or program' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER enrollments_guard BEFORE INSERT OR UPDATE ON enrollments
  FOR EACH ROW EXECUTE FUNCTION guard_enrollment();

CREATE FUNCTION guard_panel_assignment() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_participant enrollments%ROWTYPE;
    v_member enrollments%ROWTYPE;
  BEGIN
    SELECT * INTO v_participant FROM enrollments WHERE id = NEW.participant_enrollment_id;
    SELECT * INTO v_member FROM enrollments WHERE id = NEW.member_enrollment_id;
    IF v_participant.role <> 'participant' THEN
      RAISE EXCEPTION 'a panel accompanies a participant enrollment' USING ERRCODE = '23514';
    END IF;
    IF v_member.role <> NEW.role THEN
      RAISE EXCEPTION 'a panel member must be enrolled with that role' USING ERRCODE = '23514';
    END IF;
    IF v_member.program_id <> v_participant.program_id THEN
      RAISE EXCEPTION 'a panel member must be enrolled in the same program' USING ERRCODE = '23514';
    END IF;
    IF v_member.person_id = v_participant.person_id THEN
      RAISE EXCEPTION 'a participant is not on their own panel' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER panel_assignments_guard BEFORE INSERT OR UPDATE ON panel_assignments
  FOR EACH ROW EXECUTE FUNCTION guard_panel_assignment();

CREATE FUNCTION guard_board() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_enrollment enrollments%ROWTYPE;
  BEGIN
    SELECT * INTO v_enrollment FROM enrollments WHERE id = NEW.enrollment_id;
    IF v_enrollment.role IS DISTINCT FROM 'participant' THEN
      RAISE EXCEPTION 'a board belongs to a participant enrollment' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.enrollment_id <> OLD.enrollment_id THEN
      RAISE EXCEPTION 'a board never changes owner' USING ERRCODE = '23514';
    END IF;
    NEW.program_id := v_enrollment.program_id;
    NEW.owner_person_id := v_enrollment.person_id;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER boards_guard BEFORE INSERT OR UPDATE ON boards
  FOR EACH ROW EXECUTE FUNCTION guard_board();

CREATE FUNCTION guard_placement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_map uuid;
  BEGIN
    IF TG_OP = 'DELETE' THEN
      SELECT * INTO v_board FROM boards WHERE id = OLD.board_id;
      -- A missing board is a cascade from a removed enrollment.
      IF v_board.baseline_set_at IS NOT NULL THEN
        RAISE EXCEPTION 'invariant 1: no capability leaves a board after the baseline' USING ERRCODE = 'PM001';
      END IF;
      RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND (NEW.board_id <> OLD.board_id OR NEW.capability_id <> OLD.capability_id) THEN
      RAISE EXCEPTION 'invariant 1: a placement never changes board or capability' USING ERRCODE = 'PM001';
    END IF;
    SELECT * INTO v_board FROM boards WHERE id = NEW.board_id;
    v_map := app_map_of_program(v_board.program_id);
    IF app_map_of_capability(NEW.capability_id) IS DISTINCT FROM v_map THEN
      RAISE EXCEPTION 'invariant 1: the capability is not of the program map' USING ERRCODE = 'PM001';
    END IF;
    IF NEW.level_id IS NOT NULL AND app_map_of_level(NEW.level_id) IS DISTINCT FROM v_map THEN
      RAISE EXCEPTION 'invariant 1: the level is not of the program map' USING ERRCODE = 'PM001';
    END IF;
    IF TG_OP = 'UPDATE' THEN
      NEW.added_by := OLD.added_by;
      NEW.added_at := OLD.added_at;
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER placements_guard BEFORE INSERT OR UPDATE OR DELETE ON placements
  FOR EACH ROW EXECUTE FUNCTION guard_placement();

-- Row Level Security -------------------------------------------------------------------

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['programs', 'program_capabilities', 'enrollments', 'panel_assignments', 'boards'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I
         USING (organization_id = app_current_organization_id() OR app_is_super_admin())
         WITH CHECK (organization_id = app_current_organization_id() OR app_is_super_admin())',
      v_table || '_organization', v_table
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO potencializador_app', v_table);
  END LOOP;
END
$$;

-- Invariant 9: no super administrator clause. The organization must be the one in scope,
-- and the person must be the owner (read) or on the panel (read and write).
ALTER TABLE placements ENABLE ROW LEVEL SECURITY;
CREATE POLICY placements_read ON placements FOR SELECT
  USING (organization_id = app_current_organization_id() AND app_sees_board(board_id));
CREATE POLICY placements_insert ON placements FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_on_board_panel(board_id));
CREATE POLICY placements_update ON placements FOR UPDATE
  USING (organization_id = app_current_organization_id() AND app_on_board_panel(board_id))
  WITH CHECK (organization_id = app_current_organization_id() AND app_on_board_panel(board_id));
CREATE POLICY placements_delete ON placements FOR DELETE
  USING (organization_id = app_current_organization_id() AND app_on_board_panel(board_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON placements TO potencializador_app;

-- People enrolled in a program of the organization in scope are visible there by name,
-- so a panel can show a mentor of the mentoring firm.
CREATE POLICY persons_select_enrolled ON persons FOR SELECT
  USING (app_enrolled_in_current_organization(id));
