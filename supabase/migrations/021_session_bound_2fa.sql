-- ============================================================
-- Migration 021: Session-bound email second factor  (core)
--
-- Apply AFTER 018. Then apply 022, which turns on enforcement.
-- Idempotent and safe to re-apply.
--
-- What this is
-- ------------
-- A real second factor for login: password first, then a six-digit code that
-- is issued only to the session the password created.
--
-- Why not Supabase's own email OTP
-- --------------------------------
-- signInWithOtp() / POST /auth/v1/otp is *passwordless primary* authentication.
-- Its verify request carries no Authorization header, so GoTrue cannot know a
-- password session exists and always mints a new one. Used as a "second"
-- factor it would make the password optional: anyone who could read a
-- colleague's inbox could sign in without ever knowing their password.
--
-- So the code here is bound to auth.jwt()->>'session_id', and is only ever
-- issued to a session whose `amr` already contains `password`. Email alone
-- gets nobody in, and neither does a password alone.
--
-- Why session_id is the right anchor
-- ----------------------------------
-- Measured on this project: session_id is present in the JWT and does NOT
-- change when the access token is refreshed. So a session verified once stays
-- verified for its whole life — no re-prompting on navigation, on refresh, or
-- when the token rotates — and it stops the moment the session ends.
--
-- Nothing here trusts the browser. Both tables have RLS on with no policies
-- and no grants; every read and write goes through the SECURITY DEFINER
-- functions below.
-- ============================================================


-- ── 1. Storage ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS login_verifications (
  -- The binding. One live code per session; a code issued for one session is
  -- arithmetically incapable of verifying another (see hash_login_code).
  session_id   UUID PRIMARY KEY,
  user_id      UUID NOT NULL,
  email        TEXT NOT NULL,
  -- SHA-256 of code + session id. Never the code itself. NULL once redeemed.
  code_hash    TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  attempts     SMALLINT NOT NULL DEFAULT 0,
  last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at  TIMESTAMPTZ,
  -- pg_net request id, so a delivery failure can be traced afterwards.
  send_ref     BIGINT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_verifications_user ON login_verifications(user_id);

-- Per-account send accounting, separate because login_verifications is
-- upserted per session and would otherwise lose the history.
CREATE TABLE IF NOT EXISTS login_code_sends (
  id      BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_code_sends_user ON login_code_sends(user_id, sent_at DESC);

ALTER TABLE login_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_code_sends    ENABLE ROW LEVEL SECURITY;

-- No policies, and no privileges either. RLS with no policy denies everything
-- to anon/authenticated; revoking as well means a future policy added by
-- accident still cannot expose these rows through PostgREST.
REVOKE ALL ON TABLE login_verifications FROM anon, authenticated;
REVOKE ALL ON TABLE login_code_sends    FROM anon, authenticated;


-- ── 2. Primitives ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.current_session_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(auth.jwt()->>'session_id', '')::uuid;
$$;

GRANT EXECUTE ON FUNCTION public.current_session_id() TO authenticated;


-- Recreated here so 021 stands alone even if VERIFY_AMR.sql was never run.
CREATE OR REPLACE FUNCTION public.session_auth_methods()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT e->>'method'
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(auth.jwt()->'amr') = 'array'
                    THEN auth.jwt()->'amr'
                    ELSE '[]'::jsonb
               END
             ) e
       WHERE e->>'method' IS NOT NULL
    ),
    ARRAY[]::text[]
  );
$$;

GRANT EXECUTE ON FUNCTION public.session_auth_methods() TO authenticated;


-- Salted with the session id: a hash lifted from the table cannot be replayed
-- against a different session, and a rainbow table over 10^6 codes is useless.
CREATE OR REPLACE FUNCTION public.hash_login_code(p_code text, p_session uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(sha256(convert_to(btrim(p_code) || ':' || p_session::text, 'UTF8')), 'hex');
$$;


-- ── 3. Is this session past the second step? ────────────────

CREATE OR REPLACE FUNCTION public.session_second_factor_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM login_verifications
     WHERE session_id  = public.current_session_id()
       AND verified_at IS NOT NULL
  );
$$;

GRANT EXECUTE ON FUNCTION public.session_second_factor_ok() TO authenticated;


-- Edge Functions run under the service role, where auth.jwt() is empty, so the
-- session must be named explicitly. Both the session AND the user are checked:
-- the caller passes values taken from the verified JWT, and this refuses if
-- they do not belong together, so a forged session id proves nothing.
CREATE OR REPLACE FUNCTION public.session_second_factor_ok_for(
  p_session_id uuid,
  p_user_id    uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM login_verifications
     WHERE session_id  = p_session_id
       AND user_id     = p_user_id
       AND verified_at IS NOT NULL
  );
$$;

REVOKE EXECUTE ON FUNCTION public.session_second_factor_ok_for(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.session_second_factor_ok_for(uuid, uuid) TO service_role;


-- ── 4. Request a code ───────────────────────────────────────
--
-- Returns { status, ... } where status is one of:
--   ok | not_authenticated | password_required | already_verified
--   | cooldown | rate_limited | email_not_configured | no_email

CREATE OR REPLACE FUNCTION public.request_login_code()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, extensions
AS $$
DECLARE
  uid          uuid   := auth.uid();
  sid          uuid   := public.current_session_id();
  uemail       text   := lower(btrim(auth.jwt()->>'email'));
  methods      text[] := public.session_auth_methods();
  existing     login_verifications%ROWTYPE;
  recent_sends integer;
  raw_bits     bigint;
  code         text;
  api_key      text;
  sender       text;
  req_id       bigint;
  actor        uuid;
BEGIN
  IF uid IS NULL OR sid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  -- THE guarantee that makes this a *second* factor rather than a first one.
  -- A session created by /auth/v1/otp carries amr ['otp'] and stops here, so
  -- inbox access alone can never produce application access.
  IF NOT ('password' = ANY(methods)) THEN
    RETURN jsonb_build_object('status', 'password_required');
  END IF;

  IF uemail IS NULL OR uemail = '' THEN
    RETURN jsonb_build_object('status', 'no_email');
  END IF;

  -- Opportunistic cleanup; both tables are small and this avoids a cron
  -- dependency. Verified rows are kept well beyond any refresh-token lifetime
  -- so a live session is never silently un-verified.
  DELETE FROM login_code_sends WHERE sent_at < now() - interval '2 hours';
  DELETE FROM login_verifications
   WHERE (verified_at IS NULL AND expires_at  < now() - interval '1 day')
      OR (verified_at IS NOT NULL AND created_at < now() - interval '60 days');

  SELECT * INTO existing FROM login_verifications WHERE session_id = sid;

  IF existing.session_id IS NOT NULL AND existing.verified_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_verified');
  END IF;

  IF existing.session_id IS NOT NULL
     AND existing.last_sent_at > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object(
      'status', 'cooldown',
      'retry_after',
      GREATEST(1, ceil(extract(epoch FROM
        (existing.last_sent_at + interval '60 seconds' - now()))))::integer);
  END IF;

  SELECT count(*) INTO recent_sends
    FROM login_code_sends
   WHERE user_id = uid AND sent_at > now() - interval '1 hour';

  IF recent_sends >= 10 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  -- Secrets live in Vault, readable only by this SECURITY DEFINER function.
  -- Never defaulted or invented: a missing secret is reported, not worked
  -- around with a hard-coded value.
  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'resend_api_key';
  SELECT decrypted_secret INTO sender  FROM vault.decrypted_secrets WHERE name = 'resend_sender';

  IF api_key IS NULL OR btrim(api_key) = '' OR sender IS NULL OR btrim(sender) = '' THEN
    RETURN jsonb_build_object('status', 'email_not_configured');
  END IF;

  -- 60 bits from gen_random_uuid(), which Postgres draws from a
  -- cryptographically strong source, reduced to six digits.
  raw_bits := ('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 15))::bit(60)::bigint;
  code     := lpad((raw_bits % 1000000)::text, 6, '0');

  -- Upsert: issuing a new code overwrites any previous one for this session
  -- and resets the attempt counter, so the older code stops working.
  INSERT INTO login_verifications (
    session_id, user_id, email, code_hash, expires_at, attempts, last_sent_at
  )
  VALUES (
    sid, uid, uemail, public.hash_login_code(code, sid),
    now() + interval '10 minutes', 0, now()
  )
  ON CONFLICT (session_id) DO UPDATE
    SET code_hash    = EXCLUDED.code_hash,
        expires_at   = EXCLUDED.expires_at,
        attempts     = 0,
        last_sent_at = now(),
        email        = EXCLUDED.email;

  INSERT INTO login_code_sends (user_id) VALUES (uid);

  -- pg_net is asynchronous: this queues the request and returns an id. It does
  -- NOT confirm delivery, and the status returned below says 'queued' rather
  -- than pretending otherwise.
  SELECT net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
                 'Authorization', 'Bearer ' || api_key,
                 'Content-Type',  'application/json'),
    body    := jsonb_build_object(
                 'from',    sender,
                 'to',      jsonb_build_array(uemail),
                 'subject', 'Your ValueSpot sign-in code',
                 'html',
                   '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a1a">'
                || '<p style="font-size:15px">Enter this code to finish signing in:</p>'
                || '<p style="font-size:30px;font-weight:700;letter-spacing:8px;margin:20px 0">'
                || code || '</p>'
                || '<p style="font-size:13px;color:#666">It expires in 10 minutes. '
                || 'If you did not try to sign in, you can ignore this email.</p></div>')
  ) INTO req_id;

  UPDATE login_verifications SET send_ref = req_id WHERE session_id = sid;

  SELECT id INTO actor FROM employees WHERE auth_user_id = uid LIMIT 1;
  INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, new_value)
  VALUES (actor, uemail, 'login.code_sent', 'session', sid,
          jsonb_build_object('expires_in', 600));

  RETURN jsonb_build_object('status', 'ok', 'expires_in', 600, 'retry_after', 60);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_login_code() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_login_code() TO authenticated;


-- ── 5. Verify a code ────────────────────────────────────────
--
-- Returns { status, ... } where status is one of:
--   ok | not_authenticated | no_code | expired | locked | invalid

CREATE OR REPLACE FUNCTION public.verify_login_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid   uuid := auth.uid();
  sid   uuid := public.current_session_id();
  v     login_verifications%ROWTYPE;
  actor uuid;
BEGIN
  IF uid IS NULL OR sid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  -- Row lock: two submissions racing cannot both spend an attempt or both
  -- slip past the attempt ceiling.
  SELECT * INTO v FROM login_verifications
   WHERE session_id = sid AND user_id = uid
     FOR UPDATE;

  IF v.session_id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_code');
  END IF;

  -- Already done. Idempotent so a double submit is not an error.
  IF v.verified_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'ok');
  END IF;

  -- code_hash is cleared on success, so a redeemed code cannot be replayed.
  IF v.code_hash IS NULL THEN
    RETURN jsonb_build_object('status', 'no_code');
  END IF;

  IF v.expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  IF v.attempts >= 5 THEN
    RETURN jsonb_build_object('status', 'locked');
  END IF;

  IF v.code_hash IS DISTINCT FROM public.hash_login_code(p_code, sid) THEN
    UPDATE login_verifications
       SET attempts = attempts + 1
     WHERE session_id = sid;

    SELECT id INTO actor FROM employees WHERE auth_user_id = uid LIMIT 1;
    INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, new_value)
    VALUES (actor, v.email, 'login.code_failed', 'session', sid,
            jsonb_build_object('attempts', v.attempts + 1));

    RETURN jsonb_build_object(
      'status', 'invalid',
      'attempts_remaining', GREATEST(0, 5 - (v.attempts + 1)));
  END IF;

  UPDATE login_verifications
     SET verified_at = now(),
         code_hash   = NULL          -- single use
   WHERE session_id = sid;

  SELECT id INTO actor FROM employees WHERE auth_user_id = uid LIMIT 1;
  INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, new_value)
  VALUES (actor, v.email, 'login.code_verified', 'session', sid, '{}'::jsonb);

  RETURN jsonb_build_object('status', 'ok');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_login_code(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verify_login_code(text) TO authenticated;


-- ── 6. What the sign-in screen needs to know ────────────────

CREATE OR REPLACE FUNCTION public.session_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid   := auth.uid();
  sid uuid   := public.current_session_id();
  v   login_verifications%ROWTYPE;
BEGIN
  IF uid IS NULL OR sid IS NULL THEN
    RETURN jsonb_build_object('authenticated', false, 'verified', false);
  END IF;

  SELECT * INTO v FROM login_verifications WHERE session_id = sid;

  RETURN jsonb_build_object(
    'authenticated',    true,
    'password_session', ('password' = ANY(public.session_auth_methods())),
    'verified',         (v.verified_at IS NOT NULL),
    'has_pending_code', (v.code_hash IS NOT NULL AND v.expires_at > now()),
    'retry_after',
      CASE WHEN v.last_sent_at IS NULL THEN 0
           ELSE GREATEST(0, ceil(extract(epoch FROM
                  (v.last_sent_at + interval '60 seconds' - now()))))::integer
      END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.session_status() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.session_status() TO authenticated;


-- ── 7. Retire the AMR-based helper ──────────────────────────
--
-- session_email_verified() was created by VERIFY_AMR.sql during testing. It
-- treated any email-authenticated session as verified, which is exactly the
-- passwordless hole this migration exists to close. Nothing references it
-- (022 uses session_second_factor_ok), so it is removed rather than left
-- around to be wired up by mistake.

DROP FUNCTION IF EXISTS public.session_email_verified();
