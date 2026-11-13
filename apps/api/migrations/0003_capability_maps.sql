-- Roles, capability maps and their content.
--
-- Two guarantees live here, below any application code:
--   Invariant 11: every table carries organization_id and is isolated by Row Level
--     Security; composite foreign keys stop a row from hanging from another
--     organization's parent.
--   Invariant 10: a published map only grows. Triggers refuse every change or removal
--     of existing content, for every database role including the owner.

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX roles_name_unique ON roles (organization_id, lower(name));

-- Catalogs of the organization. They are not part of a map version and stay editable.
CREATE TABLE tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  link text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX tools_name_unique ON tools (organization_id, lower(name));

CREATE TABLE strategic_objectives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX strategic_objectives_name_unique ON strategic_objectives (organization_id, lower(name));

CREATE TABLE capability_maps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  role_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  archived_at timestamptz,
  UNIQUE (role_id, version),
  UNIQUE (id, organization_id),
  FOREIGN KEY (role_id, organization_id) REFERENCES roles (id, organization_id)
);
CREATE UNIQUE INDEX capability_maps_one_draft_per_role ON capability_maps (role_id) WHERE status = 'draft';

-- The maturity scale of a map is its ordered levels; the scale has no attributes of its own.
CREATE TABLE levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  multiplier numeric(8, 2) NOT NULL CHECK (multiplier >= 0),
  requires_transfer boolean NOT NULL DEFAULT false,
  -- Deferred so that levels can be reordered within one transaction.
  UNIQUE (map_id, position) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (map_id, organization_id) REFERENCES capability_maps (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE dimensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  kind text NOT NULL CHECK (kind IN ('work_cycle', 'transversal')),
  UNIQUE (map_id, position) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (id, organization_id),
  FOREIGN KEY (map_id, organization_id) REFERENCES capability_maps (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX dimensions_name_unique ON dimensions (map_id, lower(name));

CREATE TABLE capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  dimension_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  statement text NOT NULL CHECK (length(btrim(statement)) > 0),
  -- NULL: difficulty not defined.
  difficulty text CHECK (difficulty IN ('low', 'medium', 'high')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dimension_id, position) DEFERRABLE INITIALLY DEFERRED,
  UNIQUE (id, organization_id),
  FOREIGN KEY (dimension_id, organization_id) REFERENCES dimensions (id, organization_id) ON DELETE CASCADE
);

CREATE TABLE capability_tools (
  organization_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  tool_id uuid NOT NULL,
  PRIMARY KEY (capability_id, tool_id),
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id) ON DELETE CASCADE,
  -- No cascade: a tool in use cannot be deleted.
  FOREIGN KEY (tool_id, organization_id) REFERENCES tools (id, organization_id)
);
CREATE INDEX capability_tools_tool_id_index ON capability_tools (tool_id);

CREATE TABLE capability_objectives (
  organization_id uuid NOT NULL,
  capability_id uuid NOT NULL,
  objective_id uuid NOT NULL,
  PRIMARY KEY (capability_id, objective_id),
  FOREIGN KEY (capability_id, organization_id) REFERENCES capabilities (id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (objective_id, organization_id) REFERENCES strategic_objectives (id, organization_id)
);
CREATE INDEX capability_objectives_objective_id_index ON capability_objectives (objective_id);

CREATE TABLE bonus_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  map_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  extra_points numeric(8, 2) NOT NULL CHECK (extra_points > 0),
  condition text NOT NULL CHECK (length(btrim(condition)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (map_id, organization_id) REFERENCES capability_maps (id, organization_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX bonus_rules_name_unique ON bonus_rules (map_id, lower(name));

-- Invariant 11 -------------------------------------------------------------------------

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'roles', 'tools', 'strategic_objectives', 'capability_maps', 'levels', 'dimensions',
    'capabilities', 'capability_tools', 'capability_objectives', 'bonus_rules'
  ] LOOP
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

-- Invariant 10 -------------------------------------------------------------------------

-- The map moves draft → published → archived; its identity never changes; only a draft
-- can be discarded.
CREATE FUNCTION guard_capability_map() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      IF OLD.status <> 'draft' THEN
        RAISE EXCEPTION 'invariant 10: a % map cannot be deleted', OLD.status USING ERRCODE = 'PM010';
      END IF;
      RETURN OLD;
    END IF;

    IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id
       OR NEW.role_id <> OLD.role_id OR NEW.version <> OLD.version THEN
      RAISE EXCEPTION 'invariant 10: the role and version of a map never change' USING ERRCODE = 'PM010';
    END IF;

    IF NEW.status <> OLD.status THEN
      IF OLD.status = 'draft' AND NEW.status = 'published' THEN
        NEW.published_at := now();
      ELSIF OLD.status = 'published' AND NEW.status = 'archived' THEN
        NEW.archived_at := now();
      ELSE
        RAISE EXCEPTION 'invariant 10: a map cannot go from % to %', OLD.status, NEW.status
          USING ERRCODE = 'PM010';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER capability_maps_guard BEFORE UPDATE OR DELETE ON capability_maps
  FOR EACH ROW EXECUTE FUNCTION guard_capability_map();

-- State of the map a content row belongs to, found through its parent column.
-- NULL when the parent is gone: the row is being removed by the cascade of a draft, the
-- only kind of parent that can be deleted. p_created is the capability's creation time
-- when the parent is a capability.
CREATE FUNCTION map_state_of(p_parent text, p_row jsonb, OUT p_status text, OUT p_created timestamptz)
  LANGUAGE plpgsql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF p_parent = 'map' THEN
      SELECT m.status INTO p_status FROM capability_maps m WHERE m.id = (p_row ->> 'map_id')::uuid;
    ELSIF p_parent = 'dimension' THEN
      SELECT m.status INTO p_status
        FROM dimensions d JOIN capability_maps m ON m.id = d.map_id
       WHERE d.id = (p_row ->> 'dimension_id')::uuid;
    ELSE
      SELECT m.status, c.created_at INTO p_status, p_created
        FROM capabilities c
        JOIN dimensions d ON d.id = c.dimension_id
        JOIN capability_maps m ON m.id = d.map_id
       WHERE c.id = (p_row ->> 'capability_id')::uuid;
    END IF;
  END
  $$;

-- Guards every content table. Arguments: the parent ('map', 'dimension', 'capability')
-- and what a published map admits for the table:
--   'frozen' nothing (levels, bonus rules)
--   'grows'  new rows (dimensions, capabilities)
--   'links'  new rows only in the transaction that creates their capability
CREATE FUNCTION guard_map_content() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  DECLARE
    v_state record;
    v_rows jsonb[];
    v_row jsonb;
  BEGIN
    -- An update is judged against both the old and the new parent.
    IF TG_OP = 'INSERT' THEN
      v_rows := ARRAY[to_jsonb(NEW)];
    ELSIF TG_OP = 'DELETE' THEN
      v_rows := ARRAY[to_jsonb(OLD)];
    ELSE
      v_rows := ARRAY[to_jsonb(OLD), to_jsonb(NEW)];
    END IF;

    FOREACH v_row IN ARRAY v_rows LOOP
      SELECT * INTO v_state FROM map_state_of(TG_ARGV[0], v_row);
      CONTINUE WHEN v_state.p_status IS NULL OR v_state.p_status = 'draft';

      IF v_state.p_status = 'published' AND TG_OP = 'INSERT' THEN
        CONTINUE WHEN TG_ARGV[1] = 'grows';
        CONTINUE WHEN TG_ARGV[1] = 'links' AND v_state.p_created = transaction_timestamp();
      END IF;

      RAISE EXCEPTION 'invariant 10: a % map does not accept % on %', v_state.p_status, lower(TG_OP), TG_TABLE_NAME
        USING ERRCODE = 'PM010';
    END LOOP;

    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END
  $$;

CREATE TRIGGER levels_guard BEFORE INSERT OR UPDATE OR DELETE ON levels
  FOR EACH ROW EXECUTE FUNCTION guard_map_content('map', 'frozen');
CREATE TRIGGER bonus_rules_guard BEFORE INSERT OR UPDATE OR DELETE ON bonus_rules
  FOR EACH ROW EXECUTE FUNCTION guard_map_content('map', 'frozen');
CREATE TRIGGER dimensions_guard BEFORE INSERT OR UPDATE OR DELETE ON dimensions
  FOR EACH ROW EXECUTE FUNCTION guard_map_content('map', 'grows');
CREATE TRIGGER capabilities_guard BEFORE INSERT OR UPDATE OR DELETE ON capabilities
  FOR EACH ROW EXECUTE FUNCTION guard_map_content('dimension', 'grows');
CREATE TRIGGER capability_tools_guard BEFORE INSERT OR UPDATE OR DELETE ON capability_tools
  FOR EACH ROW EXECUTE FUNCTION guard_map_content('capability', 'links');
CREATE TRIGGER capability_objectives_guard BEFORE INSERT OR UPDATE OR DELETE ON capability_objectives
  FOR EACH ROW EXECUTE FUNCTION guard_map_content('capability', 'links');

-- The creation time of a capability decides whether its links may still be added, so it
-- is always the transaction's time, whatever the insert says.
CREATE FUNCTION stamp_capability_creation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    NEW.created_at := transaction_timestamp();
    RETURN NEW;
  END
  $$;

CREATE TRIGGER capabilities_stamp BEFORE INSERT ON capabilities
  FOR EACH ROW EXECUTE FUNCTION stamp_capability_creation();
