-- Evidence, level changes with evidence, bonus awards and mentoring sessions.
--
-- Invariant 4: after the baseline a level changes only through a level change that cites
--   at least one evidence and names who approved it (reason 'evidence').
-- Invariant 5: the participant proposes; one panel member approves or rejects.
-- Invariant 6: a level that requires transfer needs evidence of having taught others.
-- Invariant 7: a bonus counts only once proposed with evidence and approved by the panel; at
--   most one per rule and capability that is proposed or approved.
-- Invariant 9: owner and panel read all of it; nobody else. Invariant 11: organization_id,
--   composite foreign keys, Row Level Security.
--
-- The API role inserts and deletes its own evidence; everything else is written by the
-- functions below. SQL states: PM004, PM006, PM007 the invariants; PM050 a state that does
-- not allow the change; 23514 a reference outside the board or the program's map.

ALTER TABLE bonus_rules ADD CONSTRAINT bonus_rules_id_organization_unique UNIQUE (id, organization_id);

CREATE TABLE evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  -- The experiment it comes from, if any (of the same board, checked by the guard).
  experiment_id uuid,
  description text NOT NULL CHECK (length(btrim(description)) > 0),
  link text CONSTRAINT evidence_link_web CHECK (link ~* '^https?://[^[:space:]]+$'),
  occurred_on date NOT NULL,
  -- The person taught others: what invariant 6 asks for.
  shows_transfer boolean NOT NULL DEFAULT false,
  author uuid NOT NULL REFERENCES persons (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id),
  FOREIGN KEY (experiment_id, organization_id) REFERENCES experiments (id, organization_id)
);
CREATE INDEX evidence_board_index ON evidence (board_id);

CREATE TABLE level_change_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  placement_id uuid NOT NULL,
  proposed_level_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'approved', 'rejected')),
  proposed_by uuid NOT NULL REFERENCES persons (id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES persons (id),
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '',
  CHECK ((state = 'proposed') = (decided_by IS NULL)),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id),
  FOREIGN KEY (placement_id, organization_id) REFERENCES placements (id, organization_id),
  FOREIGN KEY (proposed_level_id, organization_id) REFERENCES levels (id, organization_id)
);
CREATE UNIQUE INDEX level_change_proposals_one_open ON level_change_proposals (placement_id) WHERE state = 'proposed';

CREATE TABLE proposal_evidence (
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  proposal_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  PRIMARY KEY (proposal_id, evidence_id),
  FOREIGN KEY (proposal_id, organization_id) REFERENCES level_change_proposals (id, organization_id),
  FOREIGN KEY (evidence_id, organization_id) REFERENCES evidence (id, organization_id)
);

-- Invariant 4: a change with evidence names its proposal, which cites the evidence.
ALTER TABLE level_changes DROP CONSTRAINT level_changes_reason_check;
ALTER TABLE level_changes ADD CONSTRAINT level_changes_reason_check
  CHECK (reason IN ('calibration', 'initial_leveling', 'evidence'));
ALTER TABLE level_changes ADD COLUMN proposal_id uuid;
ALTER TABLE level_changes ADD CONSTRAINT level_changes_proposal_fk
  FOREIGN KEY (proposal_id, organization_id) REFERENCES level_change_proposals (id, organization_id);
ALTER TABLE level_changes ADD CONSTRAINT level_changes_evidence_has_proposal
  CHECK ((reason = 'evidence') = (proposal_id IS NOT NULL));

CREATE TABLE bonus_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  placement_id uuid NOT NULL,
  bonus_rule_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'proposed' CHECK (state IN ('proposed', 'approved', 'rejected')),
  proposed_by uuid NOT NULL REFERENCES persons (id),
  proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid REFERENCES persons (id),
  decided_at timestamptz,
  decision_note text NOT NULL DEFAULT '',
  CHECK ((state = 'proposed') = (decided_by IS NULL)),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id),
  FOREIGN KEY (placement_id, organization_id) REFERENCES placements (id, organization_id),
  FOREIGN KEY (bonus_rule_id, organization_id) REFERENCES bonus_rules (id, organization_id)
);
CREATE UNIQUE INDEX bonus_awards_one_per_rule ON bonus_awards (placement_id, bonus_rule_id) WHERE state <> 'rejected';

CREATE TABLE bonus_evidence (
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  bonus_award_id uuid NOT NULL,
  evidence_id uuid NOT NULL,
  PRIMARY KEY (bonus_award_id, evidence_id),
  FOREIGN KEY (bonus_award_id, organization_id) REFERENCES bonus_awards (id, organization_id),
  FOREIGN KEY (evidence_id, organization_id) REFERENCES evidence (id, organization_id)
);

CREATE TABLE mentoring_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  held_on date NOT NULL,
  notes text NOT NULL DEFAULT '',
  recorded_by uuid NOT NULL REFERENCES persons (id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (board_id, organization_id) REFERENCES boards (id, organization_id)
);
CREATE INDEX mentoring_sessions_board_index ON mentoring_sessions (board_id);

CREATE TABLE mentoring_session_experiments (
  organization_id uuid NOT NULL,
  board_id uuid NOT NULL,
  mentoring_session_id uuid NOT NULL,
  experiment_id uuid NOT NULL,
  PRIMARY KEY (mentoring_session_id, experiment_id),
  FOREIGN KEY (mentoring_session_id, organization_id) REFERENCES mentoring_sessions (id, organization_id),
  FOREIGN KEY (experiment_id, organization_id) REFERENCES experiments (id, organization_id)
);

-- Guards -------------------------------------------------------------------------------

-- Evidence is recorded after the baseline, as the person acting, from an experiment of the
-- same board; it is never edited, and only its author deletes it while nothing cites it
-- (the citing tables' foreign keys refuse the rest).
CREATE FUNCTION guard_evidence() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  BEGIN
    IF TG_OP = 'UPDATE' THEN
      RAISE EXCEPTION 'evidence is never edited' USING ERRCODE = 'PM050';
    END IF;
    IF TG_OP = 'DELETE' THEN
      IF app_current_person_id() IS NOT NULL AND OLD.author IS DISTINCT FROM app_current_person_id() THEN
        RAISE EXCEPTION 'only the author deletes evidence' USING ERRCODE = '42501';
      END IF;
      RETURN OLD;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM boards WHERE id = NEW.board_id AND baseline_set_at IS NOT NULL) THEN
      RAISE EXCEPTION 'evidence is recorded after the baseline' USING ERRCODE = 'PM050';
    END IF;
    IF NEW.experiment_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM experiments e JOIN focuses f ON f.id = e.focus_id JOIN cycles c ON c.id = f.cycle_id
       WHERE e.id = NEW.experiment_id AND c.board_id = NEW.board_id
    ) THEN
      RAISE EXCEPTION 'the experiment is not of the board' USING ERRCODE = '23514';
    END IF;
    NEW.author := coalesce(app_current_person_id(), NEW.author);
    NEW.created_at := now();
    RETURN NEW;
  END
  $$;
CREATE TRIGGER evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON evidence
  FOR EACH ROW EXECUTE FUNCTION guard_evidence();

-- A decided proposal or award never changes, for every role; nothing is deleted.
CREATE FUNCTION guard_decision() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
  BEGIN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'proposals and bonuses are never deleted' USING ERRCODE = 'PM050';
    END IF;
    IF OLD.state <> 'proposed' THEN
      RAISE EXCEPTION 'it was already decided and never changes' USING ERRCODE = 'PM050';
    END IF;
    IF NEW.placement_id <> OLD.placement_id OR NEW.board_id <> OLD.board_id OR NEW.proposed_by <> OLD.proposed_by THEN
      RAISE EXCEPTION 'a proposal keeps its capability and author' USING ERRCODE = 'PM050';
    END IF;
    RETURN NEW;
  END
  $$;
CREATE TRIGGER level_change_proposals_guard BEFORE UPDATE OR DELETE ON level_change_proposals
  FOR EACH ROW EXECUTE FUNCTION guard_decision();
CREATE TRIGGER bonus_awards_guard BEFORE UPDATE OR DELETE ON bonus_awards
  FOR EACH ROW EXECUTE FUNCTION guard_decision();

-- Citations and sessions are history (guard_recorded_history comes from migration 0006).
CREATE TRIGGER proposal_evidence_guard BEFORE UPDATE OR DELETE ON proposal_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('invariant 4: cited evidence is never removed', 'PM004');
CREATE TRIGGER bonus_evidence_guard BEFORE UPDATE OR DELETE ON bonus_evidence
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('invariant 7: cited evidence is never removed', 'PM007');
CREATE TRIGGER mentoring_sessions_guard BEFORE UPDATE OR DELETE ON mentoring_sessions
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('a mentoring session is never edited', 'PM050');
CREATE TRIGGER mentoring_session_experiments_guard BEFORE UPDATE OR DELETE ON mentoring_session_experiments
  FOR EACH ROW EXECUTE FUNCTION guard_recorded_history('a mentoring session is never edited', 'PM050');

-- Writers ------------------------------------------------------------------------------

-- Evidence ids given to a proposal or award: all of this board, at least one.
CREATE FUNCTION app_board_evidence(p_board_id uuid, p_evidence_ids uuid[]) RETURNS SETOF evidence
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_given integer := (SELECT count(DISTINCT x) FROM unnest(coalesce(p_evidence_ids, '{}')) AS x);
  BEGIN
    IF (SELECT count(*) FROM evidence WHERE id = ANY (p_evidence_ids) AND board_id = p_board_id) <> v_given THEN
      RAISE EXCEPTION 'only evidence of this board can be cited' USING ERRCODE = '23514';
    END IF;
    RETURN QUERY SELECT * FROM evidence WHERE id = ANY (p_evidence_ids);
  END
  $$;

CREATE FUNCTION app_propose_level_change(
  p_board_id uuid, p_capability_id uuid, p_level_id uuid, p_evidence_ids uuid[]
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_placement placements%ROWTYPE;
    v_current integer;
    v_target levels%ROWTYPE;
    v_proposal uuid;
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id;
    IF v_board.id IS NULL OR v_board.organization_id IS DISTINCT FROM app_current_organization_id()
       OR v_board.owner_person_id IS DISTINCT FROM app_current_person_id() THEN
      RAISE EXCEPTION 'invariant 5: only the owner of the board proposes a level change' USING ERRCODE = '42501';
    END IF;
    IF v_board.baseline_set_at IS NULL THEN
      RAISE EXCEPTION 'invariant 4: before the baseline, levels are agreed in the calibration' USING ERRCODE = 'PM004';
    END IF;
    SELECT * INTO v_placement FROM placements WHERE board_id = p_board_id AND capability_id = p_capability_id;
    IF v_placement.id IS NULL THEN
      RAISE EXCEPTION 'the capability is not on the board' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_target FROM levels WHERE id = p_level_id;
    IF v_target.id IS NULL OR v_target.map_id IS DISTINCT FROM app_map_of_program(v_board.program_id) THEN
      RAISE EXCEPTION 'the level is not of the program map' USING ERRCODE = '23514';
    END IF;
    SELECT position INTO v_current FROM levels WHERE id = v_placement.level_id;
    IF v_current IS NULL OR v_target.position <= v_current THEN
      RAISE EXCEPTION 'a level change with evidence goes above the current level of a placed capability'
        USING ERRCODE = 'PM004';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_board_evidence(p_board_id, p_evidence_ids)) THEN
      RAISE EXCEPTION 'invariant 4: a level change cites at least one evidence' USING ERRCODE = 'PM004';
    END IF;
    IF v_target.requires_transfer AND NOT EXISTS (
      SELECT 1 FROM app_board_evidence(p_board_id, p_evidence_ids) WHERE shows_transfer
    ) THEN
      RAISE EXCEPTION 'invariant 6: this level requires evidence of having taught others' USING ERRCODE = 'PM006';
    END IF;
    INSERT INTO level_change_proposals (organization_id, board_id, placement_id, proposed_level_id, proposed_by)
      VALUES (v_board.organization_id, p_board_id, v_placement.id, p_level_id, app_current_person_id())
      RETURNING id INTO v_proposal;
    INSERT INTO proposal_evidence (organization_id, board_id, proposal_id, evidence_id)
      SELECT DISTINCT v_board.organization_id, p_board_id, v_proposal, x FROM unnest(p_evidence_ids) AS x;
    RETURN v_proposal;
  END
  $$;

CREATE FUNCTION app_decide_level_change(p_proposal_id uuid, p_approve boolean, p_note text) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_proposal level_change_proposals%ROWTYPE;
    v_placement placements%ROWTYPE;
    v_now timestamptz := now();
  BEGIN
    SELECT * INTO v_proposal FROM level_change_proposals WHERE id = p_proposal_id FOR UPDATE;
    IF v_proposal.id IS NULL OR v_proposal.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(v_proposal.board_id) THEN
      RAISE EXCEPTION 'invariant 5: only a panel member decides a level change' USING ERRCODE = '42501';
    END IF;
    IF v_proposal.state <> 'proposed' THEN
      RAISE EXCEPTION 'the level change was already decided' USING ERRCODE = 'PM050';
    END IF;
    IF p_approve THEN
      SELECT * INTO v_placement FROM placements WHERE id = v_proposal.placement_id FOR UPDATE;
      IF (SELECT position FROM levels WHERE id = v_proposal.proposed_level_id)
         <= coalesce((SELECT position FROM levels WHERE id = v_placement.level_id), -1) THEN
        RAISE EXCEPTION 'the proposed level is no longer above the current one' USING ERRCODE = 'PM004';
      END IF;
      INSERT INTO level_changes
        (organization_id, placement_id, previous_level_id, new_level_id, reason, approved_by, changed_at, proposal_id)
        VALUES (v_proposal.organization_id, v_placement.id, v_placement.level_id, v_proposal.proposed_level_id,
                'evidence', app_current_person_id(), v_now, v_proposal.id);
      UPDATE placements SET level_id = v_proposal.proposed_level_id WHERE id = v_placement.id;
    END IF;
    UPDATE level_change_proposals
       SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
           decided_by = app_current_person_id(), decided_at = v_now, decision_note = coalesce(p_note, '')
     WHERE id = v_proposal.id;
    RETURN v_now;
  END
  $$;

CREATE FUNCTION app_propose_bonus(
  p_board_id uuid, p_capability_id uuid, p_bonus_rule_id uuid, p_evidence_ids uuid[]
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_placement uuid;
    v_award uuid;
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id;
    IF v_board.id IS NULL OR v_board.organization_id IS DISTINCT FROM app_current_organization_id()
       OR v_board.owner_person_id IS DISTINCT FROM app_current_person_id() THEN
      RAISE EXCEPTION 'invariant 7: only the owner of the board proposes a bonus' USING ERRCODE = '42501';
    END IF;
    IF v_board.baseline_set_at IS NULL THEN
      RAISE EXCEPTION 'bonuses come after the baseline' USING ERRCODE = 'PM007';
    END IF;
    SELECT id INTO v_placement FROM placements WHERE board_id = p_board_id AND capability_id = p_capability_id;
    IF v_placement IS NULL THEN
      RAISE EXCEPTION 'the capability is not on the board' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM bonus_rules WHERE id = p_bonus_rule_id AND map_id = app_map_of_program(v_board.program_id)
    ) THEN
      RAISE EXCEPTION 'not a bonus rule of the program map' USING ERRCODE = '23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_board_evidence(p_board_id, p_evidence_ids)) THEN
      RAISE EXCEPTION 'invariant 7: a bonus cites at least one evidence' USING ERRCODE = 'PM007';
    END IF;
    INSERT INTO bonus_awards (organization_id, board_id, placement_id, bonus_rule_id, proposed_by)
      VALUES (v_board.organization_id, p_board_id, v_placement, p_bonus_rule_id, app_current_person_id())
      RETURNING id INTO v_award;
    INSERT INTO bonus_evidence (organization_id, board_id, bonus_award_id, evidence_id)
      SELECT DISTINCT v_board.organization_id, p_board_id, v_award, x FROM unnest(p_evidence_ids) AS x;
    RETURN v_award;
  END
  $$;

CREATE FUNCTION app_decide_bonus(p_bonus_award_id uuid, p_approve boolean, p_note text) RETURNS timestamptz
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_award bonus_awards%ROWTYPE;
    v_now timestamptz := now();
  BEGIN
    SELECT * INTO v_award FROM bonus_awards WHERE id = p_bonus_award_id FOR UPDATE;
    IF v_award.id IS NULL OR v_award.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(v_award.board_id) THEN
      RAISE EXCEPTION 'invariant 7: only a panel member decides a bonus' USING ERRCODE = '42501';
    END IF;
    IF v_award.state <> 'proposed' THEN
      RAISE EXCEPTION 'the bonus was already decided' USING ERRCODE = 'PM050';
    END IF;
    UPDATE bonus_awards
       SET state = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
           decided_by = app_current_person_id(), decided_at = v_now, decision_note = coalesce(p_note, '')
     WHERE id = v_award.id;
    RETURN v_now;
  END
  $$;

CREATE FUNCTION app_record_mentoring(p_board_id uuid, p_held_on date, p_notes text, p_experiment_ids uuid[]) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_board boards%ROWTYPE;
    v_session uuid;
  BEGIN
    SELECT * INTO v_board FROM boards WHERE id = p_board_id;
    IF v_board.id IS NULL OR v_board.organization_id IS DISTINCT FROM app_current_organization_id()
       OR NOT app_on_board_panel(p_board_id) THEN
      RAISE EXCEPTION 'only a panel member of the board records a mentoring session' USING ERRCODE = '42501';
    END IF;
    IF v_board.baseline_set_at IS NULL THEN
      RAISE EXCEPTION 'mentoring sessions come after the baseline' USING ERRCODE = 'PM050';
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(coalesce(p_experiment_ids, '{}')) AS x) <> (
      SELECT count(*) FROM experiments e JOIN focuses f ON f.id = e.focus_id JOIN cycles c ON c.id = f.cycle_id
       WHERE e.id = ANY (p_experiment_ids) AND c.board_id = p_board_id
    ) THEN
      RAISE EXCEPTION 'only an experiment of the board is reviewed in its sessions' USING ERRCODE = '23514';
    END IF;
    INSERT INTO mentoring_sessions (organization_id, board_id, held_on, notes, recorded_by)
      VALUES (v_board.organization_id, p_board_id, p_held_on, coalesce(p_notes, ''), app_current_person_id())
      RETURNING id INTO v_session;
    INSERT INTO mentoring_session_experiments (organization_id, board_id, mentoring_session_id, experiment_id)
      SELECT DISTINCT v_board.organization_id, p_board_id, v_session, x FROM unnest(coalesce(p_experiment_ids, '{}')) AS x;
    RETURN v_session;
  END
  $$;

-- Row Level Security: owner and panel read; no super administrator clause (invariant 9).

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'evidence', 'level_change_proposals', 'proposal_evidence', 'bonus_awards', 'bonus_evidence',
    'mentoring_sessions', 'mentoring_session_experiments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (organization_id = app_current_organization_id() AND app_sees_board(board_id))',
      v_table || '_read', v_table
    );
    EXECUTE format('GRANT SELECT ON %I TO potencializador_app', v_table);
  END LOOP;
END
$$;
CREATE POLICY evidence_insert ON evidence FOR INSERT
  WITH CHECK (organization_id = app_current_organization_id() AND app_sees_board(board_id));
CREATE POLICY evidence_delete ON evidence FOR DELETE
  USING (organization_id = app_current_organization_id() AND app_sees_board(board_id));
GRANT INSERT, DELETE ON evidence TO potencializador_app;

DO $$
DECLARE
  v_function text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'app_board_evidence(uuid, uuid[])', 'app_propose_level_change(uuid, uuid, uuid, uuid[])',
    'app_decide_level_change(uuid, boolean, text)', 'app_propose_bonus(uuid, uuid, uuid, uuid[])',
    'app_decide_bonus(uuid, boolean, text)', 'app_record_mentoring(uuid, date, text, uuid[])'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', v_function);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO potencializador_app', v_function);
  END LOOP;
END
$$;
