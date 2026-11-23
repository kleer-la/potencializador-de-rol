-- A leader of a program reads every board of it (amendment of invariant 9, user decision
-- of 2026-11-23). Reading only: every write keeps asking for the owner or the panel.
--
-- app_sees_board stays as it was because some write policies use it (cycles, focuses,
-- experiments, evidence). Reading goes through app_reads_board instead: the read policies,
-- the read lookups and the list of boards.

-- The person acting is enrolled as leader in the program of the board.
CREATE FUNCTION app_leads_program_of_board(p_board_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM boards b
        JOIN enrollments e ON e.program_id = b.program_id
       WHERE b.id = p_board_id AND e.role = 'leader' AND e.person_id = app_current_person_id()
    )
  $$;

CREATE FUNCTION app_reads_board(p_board_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT app_sees_board(p_board_id) OR app_leads_program_of_board(p_board_id) $$;

REVOKE ALL ON FUNCTION app_leads_program_of_board(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_reads_board(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_leads_program_of_board(uuid) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_reads_board(uuid) TO potencializador_app;

-- Every read policy that asked app_sees_board now asks app_reads_board. Write policies
-- (INSERT, UPDATE, DELETE, ALL) are left untouched.
DO $$
DECLARE
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname, qual FROM pg_policies
     WHERE schemaname = 'public' AND cmd = 'SELECT' AND qual LIKE '%app_sees_board(%'
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON %I USING (%s)',
      v_policy.policyname, v_policy.tablename, replace(v_policy.qual, 'app_sees_board(', 'app_reads_board(')
    );
  END LOOP;
END
$$;

-- The self-assessment: the owner always; the panel and the program's leaders once submitted.
ALTER POLICY self_assessments_read ON self_assessments
  USING (organization_id = app_current_organization_id()
         AND (app_owns_board(board_id) OR (submitted_at IS NOT NULL AND app_reads_board(board_id))));

CREATE OR REPLACE FUNCTION app_sees_self_assessment(p_self_assessment_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT app_owns_board(s.board_id) OR (s.submitted AND app_reads_board(s.board_id))
      FROM app_self_assessment_state(p_self_assessment_id) s
  $$;

-- Lookups of read policies. Write policies wrap them in app_sees_board, so a leader off the
-- panel still writes nothing.
CREATE OR REPLACE FUNCTION app_board_of_cycle(p_cycle_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT board_id FROM cycles
     WHERE id = p_cycle_id AND organization_id = app_current_organization_id() AND app_reads_board(board_id)
  $$;

CREATE OR REPLACE FUNCTION app_board_of_focus(p_focus_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT c.board_id FROM focuses f JOIN cycles c ON c.id = f.cycle_id
     WHERE f.id = p_focus_id AND f.organization_id = app_current_organization_id() AND app_reads_board(c.board_id)
  $$;

-- The organization of a board, for whoever reads it; NULL otherwise.
CREATE OR REPLACE FUNCTION app_board_organization(p_board_id uuid) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT organization_id FROM boards WHERE id = p_board_id AND app_reads_board(p_board_id)
  $$;

-- The boards the person acting owns, accompanies, or reads as leader of their program.
CREATE OR REPLACE FUNCTION app_my_boards()
  RETURNS TABLE (
    board_id uuid, organization_id uuid, organization_name text, program_id uuid, program_name text,
    owner_name text, status text, relation text, panel_roles text[]
  )
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
    SELECT b.id, b.organization_id, o.name, p.id, p.name, owner.name, b.status,
           CASE WHEN b.owner_person_id = app_current_person_id() THEN 'owner'
                WHEN app_on_board_panel(b.id) THEN 'panel'
                ELSE 'program' END,
           coalesce(
             (SELECT array_agg(pa.role ORDER BY pa.role)
                FROM panel_assignments pa JOIN enrollments m ON m.id = pa.member_enrollment_id
               WHERE pa.participant_enrollment_id = b.enrollment_id AND m.person_id = app_current_person_id()),
             '{}')
      FROM boards b
      JOIN organizations o ON o.id = b.organization_id
      JOIN programs p ON p.id = b.program_id
      JOIN persons owner ON owner.id = b.owner_person_id
     WHERE app_current_person_id() IS NOT NULL AND app_reads_board(b.id)
     ORDER BY p.starts_on, p.name, owner.name
  $$;
