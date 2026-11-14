-- Recovering a forgotten password: the mailed link now also reaches a person who already
-- has a password, and using it replaces that password.
--
-- The current password keeps working until the link is used. Using it proves the person
-- reads that mailbox, so it also clears the lockout and ends every session of the person;
-- the API then opens a new one.

DROP FUNCTION app_password_register(text, text, timestamptz);

-- Stores a link for the person with that email and returns their name and whether they
-- already have a password, so the API can word the mail. No row when nobody has that email.
-- A new link replaces a pending one.
CREATE FUNCTION app_password_register(p_email text, p_token_hash text, p_expires_at timestamptz)
  RETURNS TABLE (name text, has_password boolean)
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_person persons%ROWTYPE;
  BEGIN
    SELECT * INTO v_person FROM persons WHERE lower(email) = lower(p_email);
    IF NOT FOUND THEN
      RETURN;
    END IF;

    RETURN QUERY
      INSERT INTO password_credentials AS credential
          (person_id, confirmation_token_hash, confirmation_expires_at)
        VALUES (v_person.id, p_token_hash, p_expires_at)
        ON CONFLICT (person_id) DO UPDATE
          SET confirmation_token_hash = excluded.confirmation_token_hash,
              confirmation_expires_at = excluded.confirmation_expires_at,
              updated_at = now()
        RETURNING v_person.name, credential.password_hash IS NOT NULL;
  END
  $$;

-- Sets the password chosen on the page of the link and returns its person, or NULL when
-- the link is unknown, expired or already used.
CREATE OR REPLACE FUNCTION app_password_confirm(p_token_hash text, p_password_hash text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
  DECLARE
    v_person_id uuid;
  BEGIN
    UPDATE password_credentials
      SET password_hash = p_password_hash,
          confirmed_at = coalesce(confirmed_at, now()),
          confirmation_token_hash = NULL,
          confirmation_expires_at = NULL,
          failed_attempts = 0,
          locked_until = NULL,
          updated_at = now()
      WHERE confirmation_token_hash = p_token_hash
        AND confirmation_expires_at > now()
      RETURNING person_id INTO v_person_id;
    IF v_person_id IS NOT NULL THEN
      DELETE FROM sessions WHERE person_id = v_person_id;
    END IF;
    RETURN v_person_id;
  END
  $$;

REVOKE ALL ON FUNCTION app_password_register(text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_password_register(text, text, timestamptz) TO potencializador_app;
