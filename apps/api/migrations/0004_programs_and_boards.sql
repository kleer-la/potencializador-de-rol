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
  -- At least one of the three panel roles is mandatory (user decision of 2026-11-13).
  mandatory_panel_roles text[] NOT NULL DEFAULT '{leader,specialist,mentor}'
    CHECK (mandatory_panel_roles <@ ARRAY['leader', 'specialist', 'mentor'] AND cardinality(mandatory_panel_roles) >= 1),
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

-- Who shapes programs: an administrator of the organization in scope, or a super
-- administrator. Who chooses the base selection: a map designer, or a super administrator.
CREATE FUNCTION app_administers_current_organization() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT app_is_super_admin() OR EXISTS (
      SELECT 1 FROM organization_memberships
       WHERE person_id = app_current_person_id()
         AND organization_id = app_current_organization_id()
         AND role = 'administrator'
    )
  $$;

CREATE FUNCTION app_designs_current_organization() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT app_is_super_admin() OR EXISTS (
      SELECT 1 FROM organization_memberships
       WHERE person_id = app_current_person_id()
         AND organization_id = app_current_organization_id()
         AND role = 'map_designer'
    )
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
    -- Boards and panels are checked against the role when they are written; a role that
    -- changed afterwards would silently break them.
    IF TG_OP = 'UPDATE' AND (NEW.person_id <> OLD.person_id OR NEW.program_id <> OLD.program_id OR NEW.role <> OLD.role) THEN
      RAISE EXCEPTION 'an enrollment never changes person, program or role' USING ERRCODE = '23514';
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
    -- Invariant 1 and 3: once set, a baseline stays, and so does its board. Deleting the
    -- enrollment cascades here too.
    IF TG_OP = 'DELETE' THEN
      IF OLD.baseline_set_at IS NOT NULL THEN
        RAISE EXCEPTION 'invariant 1: a board with a baseline cannot be deleted' USING ERRCODE = 'PM001';
      END IF;
      RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.baseline_set_at IS NOT NULL
       AND NEW.baseline_set_at IS DISTINCT FROM OLD.baseline_set_at THEN
      RAISE EXCEPTION 'invariant 1: the baseline of a board never changes' USING ERRCODE = 'PM001';
    END IF;
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
CREATE TRIGGER boards_guard BEFORE INSERT OR UPDATE OR DELETE ON boards
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
    ELSE
      -- Who added it is the person acting, not what the caller says.
      NEW.added_by := coalesce(app_current_person_id(), NEW.added_by);
      NEW.added_at := now();
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER placements_guard BEFORE INSERT OR UPDATE OR DELETE ON placements
  FOR EACH ROW EXECUTE FUNCTION guard_placement();

-- Row Level Security -------------------------------------------------------------------

-- Reading follows the organization in scope. Writing needs the organization's role for it:
-- otherwise a participant could enroll themself in someone's panel and read their board.
DO $$
DECLARE
  v_table text;
  v_writer text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['programs', 'program_capabilities', 'enrollments', 'panel_assignments', 'boards'] LOOP
    v_writer := CASE WHEN v_table = 'program_capabilities'
                     THEN 'app_designs_current_organization()'
                     ELSE 'app_administers_current_organization()' END;
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT
         USING (organization_id = app_current_organization_id() OR app_is_super_admin())',
      v_table || '_read', v_table
    );
    -- Boards are created only by app_create_board, with their placements.
    IF v_table <> 'boards' THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR INSERT
           WITH CHECK (organization_id = app_current_organization_id() AND %s)',
        v_table || '_insert', v_table, v_writer
      );
    END IF;
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR UPDATE
         USING (organization_id = app_current_organization_id() AND %s)
         WITH CHECK (organization_id = app_current_organization_id() AND %s)',
      v_table || '_update', v_table, v_writer, v_writer
    );
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR DELETE
         USING (organization_id = app_current_organization_id() AND %s)',
      v_table || '_delete', v_table, v_writer
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO potencializador_app', v_table);
  END LOOP;
END
$$;

-- Creates the board of a participant enrollment with one unplaced placement per capability
-- of the program's base selection. The only way a board is created, so a board never
-- exists without its starting capabilities.
CREATE FUNCTION app_create_board(p_enrollment_id uuid) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_organization uuid;
    v_board uuid;
  BEGIN
    SELECT organization_id INTO v_organization FROM enrollments WHERE id = p_enrollment_id;
    IF v_organization IS NULL OR v_organization IS DISTINCT FROM app_current_organization_id()
       OR NOT app_administers_current_organization() THEN
      RAISE EXCEPTION 'only an administrator of the organization creates boards' USING ERRCODE = '42501';
    END IF;
    INSERT INTO boards (organization_id, enrollment_id) VALUES (v_organization, p_enrollment_id)
      RETURNING id INTO v_board;
    INSERT INTO placements (organization_id, board_id, capability_id, added_by)
      SELECT v_organization, v_board, pc.capability_id, app_current_person_id()
        FROM boards b
        JOIN program_capabilities pc ON pc.program_id = b.program_id
       WHERE b.id = v_board;
    RETURN v_board;
  END
  $$;
REVOKE ALL ON FUNCTION app_create_board(uuid) FROM PUBLIC;

-- The person an administrator may enroll, by email: a person of the organization in scope
-- or of the mentoring firm. NULL for anyone else, so another organization's people stay
-- indistinguishable from unknown emails.
CREATE FUNCTION app_find_enrollable_person(p_email text)
  RETURNS TABLE (id uuid, name text, email text, is_firm_person boolean)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT p.id, p.name, p.email, p.organization_id IS NULL
      FROM persons p
     WHERE app_administers_current_organization()
       AND lower(p.email) = lower(p_email)
       AND (p.organization_id IS NULL OR p.organization_id = app_current_organization_id())
  $$;
REVOKE ALL ON FUNCTION app_find_enrollable_person(text) FROM PUBLIC;

-- The boards the person acting owns or accompanies, in any organization: a participant
-- may hold no organization role and a Kleer mentor belongs to none, so this cannot go
-- through an organization scope. Returns only what lists need, never placements.
CREATE FUNCTION app_my_boards()
  RETURNS TABLE (
    board_id uuid, organization_id uuid, organization_name text, program_id uuid, program_name text,
    owner_name text, status text, relation text, panel_roles text[]
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT b.id, b.organization_id, o.name, p.id, p.name, owner.name, b.status,
           CASE WHEN b.owner_person_id = app_current_person_id() THEN 'owner' ELSE 'panel' END,
           coalesce(
             (SELECT array_agg(pa.role ORDER BY pa.role)
                FROM panel_assignments pa JOIN enrollments m ON m.id = pa.member_enrollment_id
               WHERE pa.participant_enrollment_id = b.enrollment_id AND m.person_id = app_current_person_id()),
             '{}')
      FROM boards b
      JOIN organizations o ON o.id = b.organization_id
      JOIN programs p ON p.id = b.program_id
      JOIN persons owner ON owner.id = b.owner_person_id
     WHERE app_current_person_id() IS NOT NULL
       AND (b.owner_person_id = app_current_person_id() OR app_on_board_panel(b.id))
     ORDER BY p.starts_on, p.name, owner.name
  $$;
REVOKE ALL ON FUNCTION app_my_boards() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_my_boards() TO potencializador_app;

-- The organization of a board, only for its owner or a panel member; NULL otherwise.
CREATE FUNCTION app_board_organization(p_board_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT organization_id FROM boards WHERE id = p_board_id AND app_sees_board(p_board_id)
  $$;
REVOKE ALL ON FUNCTION app_board_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_board_organization(uuid) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_find_enrollable_person(text) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_create_board(uuid) TO potencializador_app;

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

-- A person of the mentoring firm enrolled in a program of the organization in scope is
-- visible there, so a panel can show its Kleer mentor. People of the organization already are.
CREATE POLICY persons_select_enrolled ON persons FOR SELECT
  USING (organization_id IS NULL AND app_enrolled_in_current_organization(id));
