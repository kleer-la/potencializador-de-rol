-- Sign-in with an email and a password, for invited persons only.
--
-- Like person_identities and sessions, this table is read before any person is known, so
-- the API role gets no privilege on it: it reaches it only through the SECURITY DEFINER
-- functions below. The password hash is computed by the API (scrypt); the database never
-- sees a password. Confirmation links are stored as SHA-256 hashes.
--
-- The email is confirmed before any password exists: the person chooses the password on
-- the page the mailed link opens. Whoever asks for the link therefore never decides the
-- password of someone else's account.

CREATE TABLE password_credentials (
  person_id uuid PRIMARY KEY REFERENCES persons (id) ON DELETE CASCADE,
  -- NULL until the person opens the mailed link and chooses a password there.
  password_hash text,
  confirmed_at timestamptz,
  confirmation_token_hash text UNIQUE,
  confirmation_expires_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((confirmed_at IS NULL) = (password_hash IS NULL))
);

ALTER TABLE password_credentials ENABLE ROW LEVEL SECURITY;

-- Stores a confirmation link for an invited person and returns their name, so the API can
-- mail it. Returns NULL (nothing to mail) when nobody has that email or the person already
-- has a password, which this never replaces. A new link replaces a pending one.
CREATE FUNCTION app_password_register(p_email text, p_token_hash text, p_expires_at timestamptz)
  RETURNS text
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

    INSERT INTO password_credentials (person_id, confirmation_token_hash, confirmation_expires_at)
      VALUES (v_person.id, p_token_hash, p_expires_at)
      ON CONFLICT (person_id) DO UPDATE
        SET confirmation_token_hash = excluded.confirmation_token_hash,
            confirmation_expires_at = excluded.confirmation_expires_at,
            updated_at = now()
        WHERE password_credentials.confirmed_at IS NULL;
    -- FOUND is false when the WHERE above kept a confirmed password untouched.
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
    RETURN v_person.name;
  END
  $$;

-- Sets the password chosen on the page of the link and returns its person, or NULL when
-- the link is unknown, expired or already used.
CREATE FUNCTION app_password_confirm(p_token_hash text, p_password_hash text) RETURNS uuid
  LANGUAGE sql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE password_credentials
      SET password_hash = p_password_hash,
          confirmed_at = now(),
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

-- Reserves one password check for the person with that email, before the API checks it.
-- Each reservation counts as a failure until app_password_succeeded clears the count; the
-- fifth in a row locks the password for fifteen minutes. The row lock of the UPDATE
-- serializes concurrent requests, so no more than five checks run per lock window.
-- No row: nobody with that email has a password. `locked`: the check was refused.
CREATE FUNCTION app_password_begin_attempt(p_email text)
  RETURNS TABLE (person_id uuid, password_hash text, locked boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_person_id uuid;
  BEGIN
    SELECT credential.person_id INTO v_person_id
      FROM password_credentials credential
      JOIN persons person ON person.id = credential.person_id
      WHERE lower(person.email) = lower(p_email)
        AND credential.confirmed_at IS NOT NULL;
    IF NOT FOUND THEN
      RETURN;
    END IF;

    RETURN QUERY
      UPDATE password_credentials credential
        SET failed_attempts = CASE WHEN credential.failed_attempts + 1 >= 5 THEN 0
                                   ELSE credential.failed_attempts + 1 END,
            locked_until = CASE WHEN credential.failed_attempts + 1 >= 5
                                THEN now() + interval '15 minutes'
                                ELSE credential.locked_until END,
            updated_at = now()
        WHERE credential.person_id = v_person_id
          AND (credential.locked_until IS NULL OR credential.locked_until <= now())
        RETURNING credential.person_id, credential.password_hash, false;
    IF NOT FOUND THEN
      RETURN QUERY SELECT v_person_id, NULL::text, true;
    END IF;
  END
  $$;

-- A reserved check found the right password: the failures in a row start again from zero.
CREATE FUNCTION app_password_succeeded(p_person_id uuid) RETURNS void
  LANGUAGE sql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    UPDATE password_credentials
      SET failed_attempts = 0, locked_until = NULL, updated_at = now()
      WHERE person_id = p_person_id
  $$;

REVOKE ALL ON FUNCTION app_password_register(text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_password_confirm(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_password_begin_attempt(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_password_succeeded(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_password_register(text, text, timestamptz) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_password_confirm(text, text) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_password_begin_attempt(text) TO potencializador_app;
GRANT EXECUTE ON FUNCTION app_password_succeeded(uuid) TO potencializador_app;
