-- Sign-in with an email and a password, for invited persons only.
--
-- Like person_identities and sessions, this table is read before any person is known, so
-- the API role gets no privilege on it: it reaches it only through the SECURITY DEFINER
-- functions below. The password hash is computed by the API (scrypt); the database never
-- sees a password. Confirmation links are stored as SHA-256 hashes.

CREATE TABLE password_credentials (
  person_id uuid PRIMARY KEY REFERENCES persons (id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  -- NULL until the person opens the link mailed to them; only confirmed passwords sign in.
  confirmed_at timestamptz,
  confirmation_token_hash text UNIQUE,
  confirmation_expires_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE password_credentials ENABLE ROW LEVEL SECURITY;

-- Stores a pending password for an invited person and returns their name, so the API can
-- mail the confirmation link. Returns NULL (nothing to mail) when nobody has that email or
-- the person already confirmed a password, which registering never replaces.
CREATE FUNCTION app_password_register(
  p_email text, p_password_hash text, p_token_hash text, p_expires_at timestamptz
) RETURNS text
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_person persons%ROWTYPE;
  BEGIN
    SELECT * INTO v_person FROM persons WHERE lower(email) = lower(p_email);
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    INSERT INTO password_credentials
        (person_id, password_hash, confirmation_token_hash, confirmation_expires_at)
      VALUES (v_person.id, p_password_hash, p_token_hash, p_expires_at)
      ON CONFLICT (person_id) DO UPDATE
        SET password_hash = excluded.password_hash,
            confirmation_token_hash = excluded.confirmation_token_hash,
            confirmation_expires_at = excluded.confirmation_expires_at,
            updated_at = now()
        WHERE password_credentials.confirmed_at IS NULL;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    RETURN v_person.name;
  END
  $$;

-- Confirms the password the link belongs to and returns its person, or NULL when the link
-- is unknown, expired or already used.
CREATE FUNCTION app_password_confirm(p_token_hash text) RETURNS uuid
  LANGUAGE sql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE password_credentials
      SET confirmed_at = now(),
          confirmation_token_hash = NULL,
          confirmation_expires_at = NULL,
          failed_attempts = 0,
          locked_until = NULL,
          updated_at = now()
      WHERE confirmation_token_hash = p_token_hash
        AND confirmation_expires_at > now()
        AND confirmed_at IS NULL
      RETURNING person_id
  $$;

-- The confirmed password of the person with that email, for the API to check. No row when
-- there is none.
CREATE FUNCTION app_password_credential(p_email text)
  RETURNS TABLE (person_id uuid, password_hash text, locked boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT credential.person_id,
           credential.password_hash,
           coalesce(credential.locked_until > now(), false)
      FROM password_credentials credential
      JOIN persons person ON person.id = credential.person_id
      WHERE lower(person.email) = lower(p_email)
        AND credential.confirmed_at IS NOT NULL
  $$;

-- Records the outcome of a password check. Five failures in a row lock the password for
-- fifteen minutes; a success clears the count.
CREATE FUNCTION app_password_attempt(p_person_id uuid, p_succeeded boolean) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE password_credentials
      SET failed_attempts = CASE
            WHEN p_succeeded OR failed_attempts + 1 >= 5 THEN 0
            ELSE failed_attempts + 1
          END,
          locked_until = CASE
            WHEN p_succeeded THEN NULL
            WHEN failed_attempts + 1 >= 5 THEN now() + interval '15 minutes'
            ELSE locked_until
          END,
          updated_at = now()
      WHERE person_id = p_person_id
  $$;

REVOKE ALL ON FUNCTION app_password_register(text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_password_confirm(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_password_credential(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_password_attempt(uuid, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_password_register(text, text, text, timestamptz) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_password_confirm(text) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_password_credential(text) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_password_attempt(uuid, boolean) TO potencializador_app;
