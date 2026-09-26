-- ============================================================
--  Migration 024: let the UI tell the truth about email delivery
--
--  Additive. Creates ONE new read-only function. Nothing existing is altered:
--
--    * no table created, altered or dropped
--    * no RLS policy touched
--    * no existing function redefined
--    * migrations 021, 022 and 023 untouched
--    * no change to code generation, verification, expiry or rate limiting
--
--  Safe to run more than once.
--
--
--  THE PROBLEM
--  -----------
--  request_login_code() sends through pg_net, which is asynchronous.
--  net.http_post() queues the request and returns an id immediately, so the
--  function returns {"status":"ok"} meaning QUEUED — never DELIVERED.
--
--  When the email provider then refuses the message, nothing notices. The
--  provider's reply lands in net._http_response, which the browser cannot
--  read, so the screen goes on saying "we sent you a code" while no code was
--  ever sent. The user waits, retries, hits the cooldown, and concludes the
--  application is broken.
--
--  That is exactly what happens today with Resend's shared test sender, which
--  refuses every recipient except the account owner:
--
--    403  "You can only send testing emails to your own email address."
--
--  This function lets the code screen say so instead of lying by omission.
--
--
--  WHAT IT DELIBERATELY DOES NOT RETURN
--  ------------------------------------
--  Never the provider's response body. Resend's 403 text contains the Resend
--  account owner's email address; returning it would disclose one person's
--  address to every user who fails to receive a code. The HTTP status code is
--  returned because a number carries no such payload, and a coarse reason
--  category is derived server-side.
--
--  It reads only the caller's OWN session row. Session and user must both
--  match, so this cannot be used to observe anyone else's sign-in.
-- ============================================================


CREATE OR REPLACE FUNCTION public.login_code_delivery_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid    uuid := auth.uid();
  sid    uuid := public.current_session_id();
  ref    bigint;
  code   integer;
  errmsg text;
BEGIN
  IF uid IS NULL OR sid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  -- Own row only: both columns are matched.
  SELECT send_ref INTO ref
    FROM login_verifications
   WHERE session_id = sid AND user_id = uid;

  IF ref IS NULL THEN
    -- No code requested for this session yet, or the send was never queued.
    RETURN jsonb_build_object('status', 'none');
  END IF;

  SELECT r.status_code, r.error_msg
    INTO code, errmsg
    FROM net._http_response r
   WHERE r.id = ref;

  -- pg_net clears old responses, and a fresh request takes a moment to
  -- complete. Absence therefore means "not answered yet", not "failed".
  IF NOT FOUND OR (code IS NULL AND errmsg IS NULL) THEN
    RETURN jsonb_build_object('status', 'pending');
  END IF;

  IF code IS NULL THEN
    -- The request never completed at all: DNS, timeout, network.
    RETURN jsonb_build_object('status', 'failed', 'reason', 'unreachable');
  END IF;

  IF code BETWEEN 200 AND 299 THEN
    RETURN jsonb_build_object('status', 'sent', 'provider_status', code);
  END IF;

  -- Categorised server-side so the UI never has to parse provider text, and
  -- so the body itself is never returned.
  RETURN jsonb_build_object(
    'status', 'failed',
    'provider_status', code,
    'reason',
    CASE
      WHEN code = 403 THEN 'recipient_not_allowed'   -- sender not verified for this recipient
      WHEN code = 401 THEN 'provider_auth'           -- API key wrong or revoked
      WHEN code = 422 THEN 'invalid_sender'          -- malformed from address
      WHEN code = 429 THEN 'provider_rate_limited'
      ELSE 'provider_error'
    END
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.login_code_delivery_status() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.login_code_delivery_status() TO authenticated;


-- ── Verification ────────────────────────────────────────────

SELECT '024 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'login_code_delivery_status')          AS function_created,
       (SELECT COALESCE(array_to_string(proacl, ' | '), 'PUBLIC (default)')
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'login_code_delivery_status')                 AS grants,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')  AS policies_untouched;
-- EXPECT function_created = true, grants listing authenticated and NOT anon.


-- ============================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.login_code_delivery_status();
--
-- The UI treats an error from this call as "unknown" and shows the ordinary
-- wording, so dropping it degrades the message without breaking sign-in.
-- Nothing else calls it and no policy depends on it.
-- ============================================================
