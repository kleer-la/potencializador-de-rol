-- Identity and organizations, with isolation by organization (invariant 11).
--
-- The API connects as role potencializador_app, which owns nothing and cannot bypass
-- Row Level Security. Each API transaction declares who acts and, when relevant, inside
-- which organization, through two transaction-local settings:
--   app.person_id        the signed-in person
--   app.organization_id  the organization the request works in, set only after the
--                        application has authorized the person for it
-- Without settings every policy is false: the connection reads and writes nothing.

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE persons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL: the person belongs to the mentoring firm and is a super administrator.
  organization_id uuid REFERENCES organizations (id),
  email text NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Target of the composite foreign key of organization_memberships.
  UNIQUE (id, organization_id)
);

CREATE UNIQUE INDEX persons_email_unique ON persons (lower(email));
CREATE INDEX persons_organization_id_index ON persons (organization_id);

CREATE TABLE organization_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations (id),
  person_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('administrator', 'map_designer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, person_id, role),
  -- A membership is only for a person of that same organization. Foreign keys are
  -- checked regardless of Row Level Security, so this holds for every caller.
  FOREIGN KEY (person_id, organization_id) REFERENCES persons (id, organization_id)
);

CREATE INDEX organization_memberships_person_id_index ON organization_memberships (person_id);

CREATE FUNCTION app_current_person_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.person_id', true), '')::uuid $$;

CREATE FUNCTION app_current_organization_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.organization_id', true), '')::uuid $$;

-- Super administrator is derived from the stored person, never from a setting the
-- application could claim. SECURITY DEFINER because the lookup must see the person row
-- regardless of the caller's policies; it exposes only a boolean.
CREATE FUNCTION app_is_super_admin() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM persons
      WHERE id = app_current_person_id() AND organization_id IS NULL
    )
  $$;

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE persons ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;

-- Read policies also let a person see their own rows without an organization scope
-- (own person, own memberships, organizations where they are a member). Write policies
-- do not: writing always needs the organization scope or a super administrator.

CREATE POLICY organizations_select ON organizations FOR SELECT USING (
  id = app_current_organization_id()
  OR app_is_super_admin()
  OR EXISTS (
    SELECT 1 FROM organization_memberships membership
    WHERE membership.organization_id = organizations.id
      AND membership.person_id = app_current_person_id()
  )
);
CREATE POLICY organizations_insert ON organizations FOR INSERT
  WITH CHECK (app_is_super_admin());
CREATE POLICY organizations_update ON organizations FOR UPDATE
  USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());
CREATE POLICY organizations_delete ON organizations FOR DELETE
  USING (app_is_super_admin());

CREATE POLICY persons_select ON persons FOR SELECT USING (
  organization_id = app_current_organization_id()
  OR id = app_current_person_id()
  OR app_is_super_admin()
);
CREATE POLICY persons_insert ON persons FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() OR app_is_super_admin());
CREATE POLICY persons_update ON persons FOR UPDATE
  USING (organization_id = app_current_organization_id() OR app_is_super_admin())
  WITH CHECK (organization_id = app_current_organization_id() OR app_is_super_admin());
CREATE POLICY persons_delete ON persons FOR DELETE
  USING (organization_id = app_current_organization_id() OR app_is_super_admin());

CREATE POLICY organization_memberships_select ON organization_memberships FOR SELECT USING (
  organization_id = app_current_organization_id()
  OR person_id = app_current_person_id()
  OR app_is_super_admin()
);
CREATE POLICY organization_memberships_insert ON organization_memberships FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() OR app_is_super_admin());
CREATE POLICY organization_memberships_update ON organization_memberships FOR UPDATE
  USING (organization_id = app_current_organization_id() OR app_is_super_admin())
  WITH CHECK (organization_id = app_current_organization_id() OR app_is_super_admin());
CREATE POLICY organization_memberships_delete ON organization_memberships FOR DELETE
  USING (organization_id = app_current_organization_id() OR app_is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE
  ON organizations, persons, organization_memberships
  TO potencializador_app;
