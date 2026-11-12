-- Sign-in with an external provider and sessions.
--
-- Both tables are read before any person is known, so they cannot be protected by the
-- person/organization scope. Instead the API role gets no privilege on them at all: it
-- reaches them only through the SECURITY DEFINER functions below, each a narrow operation.

CREATE TABLE person_identities (
  issuer text NOT NULL,
  subject text NOT NULL,
  person_id uuid NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject)
);

CREATE TABLE sessions (
  -- SHA-256 of the cookie value; the value itself is never stored.
  token_hash text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES persons (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX sessions_person_id_index ON sessions (person_id);

ALTER TABLE person_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

-- Resolves a provider account to a person, or NULL when the person was not invited.
-- A known account (issuer + subject) wins. Otherwise a verified email that matches an
-- invited person binds the account to that person, so later sign-ins no longer depend
-- on the email. The caller must pass an email only when the provider vouches for it.
CREATE FUNCTION app_sign_in(p_issuer text, p_subject text, p_verified_email text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_person_id uuid;
  BEGIN
    SELECT person_id INTO v_person_id
      FROM person_identities WHERE issuer = p_issuer AND subject = p_subject;
    IF v_person_id IS NOT NULL THEN
      RETURN v_person_id;
    END IF;

    IF p_verified_email IS NULL THEN
      RETURN NULL;
    END IF;

    SELECT id INTO v_person_id FROM persons WHERE lower(email) = lower(p_verified_email);
    IF v_person_id IS NULL THEN
      RETURN NULL;
    END IF;

    INSERT INTO person_identities (issuer, subject, person_id)
      VALUES (p_issuer, p_subject, v_person_id)
      ON CONFLICT (issuer, subject) DO NOTHING;
    -- On a concurrent first sign-in the other transaction's binding is the truth.
    SELECT person_id INTO v_person_id
      FROM person_identities WHERE issuer = p_issuer AND subject = p_subject;
    RETURN v_person_id;
  END
  $$;

CREATE FUNCTION app_create_session(p_person_id uuid, p_token_hash text, p_expires_at timestamptz)
  RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    DELETE FROM sessions WHERE person_id = p_person_id AND expires_at <= now();
    INSERT INTO sessions (token_hash, person_id, expires_at)
      VALUES (p_token_hash, p_person_id, p_expires_at);
  $$;

CREATE FUNCTION app_session_person(p_token_hash text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT person_id FROM sessions WHERE token_hash = p_token_hash AND expires_at > now()
  $$;

CREATE FUNCTION app_delete_session(p_token_hash text) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$ DELETE FROM sessions WHERE token_hash = p_token_hash $$;

REVOKE ALL ON FUNCTION app_sign_in(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_create_session(uuid, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_session_person(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_delete_session(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_sign_in(text, text, text) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_create_session(uuid, text, timestamptz) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_session_person(text) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_delete_session(text) TO potencializador_app;
