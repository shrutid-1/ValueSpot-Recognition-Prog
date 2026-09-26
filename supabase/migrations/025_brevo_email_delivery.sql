-- ============================================================
--  Migration 025: deliver login codes through Brevo instead of Resend
--
--  PROVIDER SWAP ONLY. This redefines exactly one function,
--  public.request_login_code(), and within it changes only two things:
--
--    1. which Vault secrets are read
--    2. the net.http_post() call (URL, auth header, body shape)
--
--  Everything else in the function is reproduced VERBATIM from migration 021:
--
--    the auth.uid()/session_id checks        the 'password' = ANY(amr) guarantee
--    the opportunistic cleanup               the already_verified short-circuit
--    the 60-second cooldown                  the 10/hour rate limit
--    the CSPRNG 6-digit generation           hash_login_code(code, session_id)
--    the upsert that resets attempts         the login_code_sends ledger row
--    the send_ref record                     the audit_logs entry
--    the exact return contract               the grants
--
--  NOT TOUCHED AT ALL: login_verifications, login_code_sends,
--  verify_login_code(), session_second_factor_ok(), session_status(),
--  revoke_login_verification(), login_code_delivery_status(),
--  claim_employee_account(), every RLS policy, and migrations 021-024.
--
--  Safe to run more than once.
--
--
--  WHY
--  ---
--  Resend's shared test sender delivers only to the address that owns the
--  Resend account, which makes it impossible to test several employee,
--  manager and HR accounts at once. Brevo verifies a SINGLE sender address by
--  emailing it a code, so no domain and no DNS are required.
--
--
--  WHAT THE SECRETS MUST CONTAIN
--  -----------------------------
--    brevo_api_key   the Brevo API key (already stored)
--    brevo_sender    the sender address verified in Brevo. Either form works:
--                      noreply@example.com
--                      Touchcore ValueSpot <noreply@example.com>
--
--  If brevo_sender does not exist yet, create it in the SQL Editor — paste the
--  address directly, never into a file or a commit:
--
--    SELECT vault.create_secret('you@yourgmail.com', 'brevo_sender');
--
--  A missing secret returns 'email_not_configured', exactly as before. Nothing
--  is defaulted or invented: sending from an unverified address would be
--  rejected by the provider and the failure would be silent.
-- ============================================================


CREATE OR REPLACE FUNCTION public.request_login_code()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, extensions
AS $fn$
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
  sender_email text;
  sender_name  text;
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

  -- ── CHANGED: Brevo's secrets ──────────────────────────────
  -- Same pattern as before: Vault only, readable solely by this SECURITY
  -- DEFINER function, never defaulted.
  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'brevo_api_key';
  SELECT decrypted_secret INTO sender  FROM vault.decrypted_secrets WHERE name = 'brevo_sender';

  IF api_key IS NULL OR btrim(api_key) = '' OR sender IS NULL OR btrim(sender) = '' THEN
    RETURN jsonb_build_object('status', 'email_not_configured');
  END IF;

  -- Brevo wants the sender split into name and address, unlike Resend's single
  -- "Name <addr>" string. Accept either storage form so the secret does not
  -- have to be rewritten in one exact shape.
  IF sender LIKE '%<%>%' THEN
    sender_email := btrim(substring(sender from '<([^>]+)>'));
    sender_name  := NULLIF(btrim(regexp_replace(sender, '<[^>]*>', '')), '');
  ELSE
    sender_email := btrim(sender);
    sender_name  := NULL;
  END IF;

  sender_name := COALESCE(sender_name, 'Touchcore ValueSpot');

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

  -- ── CHANGED: Brevo's transactional endpoint ───────────────
  -- Still pg_net, still asynchronous: this queues the request and returns an
  -- id. It does NOT confirm delivery — login_code_delivery_status() from
  -- migration 024 reads what the provider actually answered.
  --
  -- Differences from Resend: the api-key header rather than a bearer token,
  -- sender as an object, recipients as objects, and htmlContent rather than
  -- html. The code itself is the SAME one hashed above — never regenerated.
  SELECT net.http_post(
    url     := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object(
                 'api-key',      api_key,
                 'Content-Type', 'application/json',
                 'accept',       'application/json'),
    body    := jsonb_build_object(
                 'sender', jsonb_build_object('name', sender_name, 'email', sender_email),
                 'to',     jsonb_build_array(jsonb_build_object('email', uemail)),
                 'subject', 'Your Touchcore ValueSpot security code',
                 'htmlContent',
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
$fn$;

-- Restated so this migration is self-contained if replayed. CREATE OR REPLACE
-- does not disturb existing grants.
REVOKE EXECUTE ON FUNCTION public.request_login_code() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.request_login_code() TO authenticated;


-- ── Verification ────────────────────────────────────────────

SELECT '025 APPLIED' AS check,
       (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name = 'brevo_api_key' AND btrim(decrypted_secret) <> '') = 1 AS brevo_api_key_set,
       (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name = 'brevo_sender'  AND btrim(decrypted_secret) <> '') = 1 AS brevo_sender_set,
       (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'brevo_sender')                                       AS sender_in_use,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')       AS policies_untouched;
-- The API key is checked for PRESENCE only and never selected.
-- If brevo_sender_set is false, create it:
--   SELECT vault.create_secret('you@yourgmail.com', 'brevo_sender');


-- ============================================================
-- ROLLBACK — return to Resend
--
-- Re-run the request_login_code() definition from
-- 021_session_bound_2fa.sql. It reads resend_api_key / resend_sender, both of
-- which are still in Vault and untouched by this migration, so the swap back
-- is immediate and loses nothing.
--
-- Nothing else has to be reverted: no table, policy, grant or other function
-- was altered here.
-- ============================================================
