-- ============================================================
-- Migration 027: send the invitation email automatically
--
-- Additive. One small table, three functions, one config key. Safe to run
-- more than once. Requires 021-026.
--
--
-- WHY
-- ---
-- HR adds somebody on the Employees page and the record is created correctly,
-- at the right role. Then nothing happens. The "Send invitation email" button
-- was a mailto: link -- it opened HR's own mail client, and on a machine with
-- no desktop mail client configured it appeared to do nothing at all. The
-- application has never sent an invitation itself.
--
-- This adds the sender, reusing the delivery path that already works for the
-- 2FA code: pg_net -> Brevo, credentials in Vault. There is no second email
-- provider, no Edge Function and no new secret.
--
--
-- WHAT IS NOT CHANGED
-- -------------------
--   request_login_code() / verify_login_code()   the 2FA email flow
--   login_verifications / login_code_sends       2FA state and ITS rate limits
--   claim_employee_account()                     who becomes what
--   guard_employee_role_insert (026)             who may create a record
--   set_employee_role(), 016/017 guards          role changes
--   every RLS policy                             untouched, none altered
--   the Super Admin system                       untouched
--
-- Sending an invitation does not create, alter or authorise anything. The
-- employee record -- created by HR, guarded by 026 -- is what authorises
-- setup. This function only tells the person that record exists. Nothing here
-- widens who may be invited or to what role.
--
--
-- THE ROLE IN THE LINK IS NOT AN ARGUMENT
-- ---------------------------------------
-- The only parameter is p_employee_id. The destination path is derived from
-- employees.role, read from the row inside this function. There is no way to
-- ask for a different destination: no role argument, no URL argument, nothing
-- the browser supplies beyond which record to send to. Sending an "HR" link to
-- somebody stored as manager is not expressible.
--
-- And it would not matter if it were: /hr/setup grants nothing. An uninvited
-- or wrongly-invited person is refused by claim_employee_account(), which
-- reads the same stored role. The link decides where somebody lands, never
-- what they become.
--
--
-- THE BASE URL COMES FROM app_config, NOT THE BROWSER
-- ---------------------------------------------------
-- If the client passed its own origin, an hr_admin could pass an attacker's
-- host and the phishing link would go out FROM THE COMPANY'S VERIFIED SENDER,
-- carrying its reputation. Only HR and Super Admin can call this, so the blast
-- radius is small -- but reading it from app_config costs nothing and closes
-- it entirely. Unset means refuse, never guess.
--
--
-- NO EXPIRY IS CLAIMED
-- --------------------
-- An invitation is an employees row with auth_user_id IS NULL. Nothing expires
-- it and no migration enforces a lifetime, so the email does not pretend
-- otherwise. It says the link stays valid until used, which is true.
-- ============================================================


-- ── 1. Where the application lives ──────────────────────────
--
-- Seeded only if absent, so re-running never overwrites a real deployment URL.
-- Left as an empty string deliberately: the sender refuses on empty, which is
-- a clear error rather than a broken link in somebody's inbox.

INSERT INTO app_config (key, value, description)
VALUES ('app_base_url', '""'::jsonb,
        'Origin used to build invitation links, e.g. "https://valuespot.example.com". '
        'No trailing slash. Invitations cannot be sent until this is set.')
ON CONFLICT (key) DO NOTHING;


-- ── 2. Rate-limit ledger ────────────────────────────────────
--
-- Separate from login_code_sends on purpose: the 2FA limits are per auth user
-- and must not be consumed, or even observed, by HR resending an invitation.
-- Small, append-only, cleaned opportunistically.

CREATE TABLE IF NOT EXISTS invitation_sends (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  sent_by     uuid REFERENCES employees(id) ON DELETE SET NULL,
  send_ref    bigint,
  sent_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invitation_sends_employee
  ON invitation_sends(employee_id, sent_at DESC);

-- Same posture as login_verifications in 021: RLS on, NO policies, and the
-- table revoked from the client. Only these SECURITY DEFINER functions read
-- it. Nothing here is useful to a browser.
ALTER TABLE invitation_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE invitation_sends FROM anon, authenticated;


-- ── 3. The sender ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.send_employee_invitation(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, extensions
AS $fn$
DECLARE
  caller_role  text;
  caller_id    uuid;
  emp          employees%ROWTYPE;
  base_url     text;
  setup_path   text;
  role_label   text;
  link         text;
  api_key      text;
  sender       text;
  sender_email text;
  sender_name  text;
  recent_min   integer;
  recent_day   integer;
  req_id       bigint;
BEGIN
  -- ── Authorisation. Read from the TABLE, never from the JWT. ──
  -- current_employee_role() also returns NULL for a session that has not
  -- passed the emailed code, so the second factor gates this too, with no
  -- policy change. This is the same function 026's insert guard relies on.
  caller_role := public.current_employee_role();

  IF caller_role IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT id INTO caller_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  -- ── The target ──
  SELECT * INTO emp FROM employees WHERE id = p_employee_id;

  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  -- Already registered. Re-sending would be pointless and mildly misleading.
  IF emp.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_registered');
  END IF;

  -- super_admin is never an invitation target: it is granted in
  -- Administration, to somebody who has already signed in.
  IF emp.role NOT IN ('employee', 'manager', 'hr_admin') THEN
    RETURN jsonb_build_object('status', 'invalid_target_role');
  END IF;

  -- ── Rate limit. Per employee, and separate from the 2FA limits. ──
  DELETE FROM invitation_sends WHERE sent_at < now() - interval '7 days';

  SELECT count(*) INTO recent_min
    FROM invitation_sends
   WHERE employee_id = emp.id AND sent_at > now() - interval '1 minute';

  IF recent_min > 0 THEN
    RETURN jsonb_build_object('status', 'cooldown', 'retry_after', 60);
  END IF;

  SELECT count(*) INTO recent_day
    FROM invitation_sends
   WHERE employee_id = emp.id AND sent_at > now() - interval '1 day';

  IF recent_day >= 10 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;

  -- ── Where the link points. Both halves decided server-side. ──
  SELECT NULLIF(btrim(value #>> '{}'), '') INTO base_url
    FROM app_config WHERE key = 'app_base_url';

  IF base_url IS NULL THEN
    RETURN jsonb_build_object('status', 'app_url_not_configured');
  END IF;

  base_url := rtrim(base_url, '/');

  -- Derived from the STORED role. Not a parameter, not a claim, not a URL.
  setup_path := CASE emp.role
                  WHEN 'manager'  THEN '/manager/setup'
                  WHEN 'hr_admin' THEN '/hr/setup'
                  ELSE '/signup'
                END;

  role_label := CASE emp.role
                  WHEN 'manager'  THEN 'Manager'
                  WHEN 'hr_admin' THEN 'HR'
                  ELSE 'Employee'
                END;

  -- Only the address travels in the URL, exactly as the Copy-link action has
  -- always produced. It is not a secret and grants nothing.
  link := base_url || setup_path || '?email=' ||
          replace(replace(replace(emp.email, '%', '%25'), '&', '%26'), '+', '%2B');

  -- ── Brevo. Same secrets, same endpoint, same shape as 025. ──
  SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'brevo_api_key';
  SELECT decrypted_secret INTO sender  FROM vault.decrypted_secrets WHERE name = 'brevo_sender';

  IF api_key IS NULL OR btrim(api_key) = '' OR sender IS NULL OR btrim(sender) = '' THEN
    RETURN jsonb_build_object('status', 'email_not_configured');
  END IF;

  -- Accept either storage form, identically to 025.
  IF sender LIKE '%<%>%' THEN
    sender_email := btrim(substring(sender from '<([^>]+)>'));
    sender_name  := NULLIF(btrim(regexp_replace(sender, '<[^>]*>', '')), '');
  ELSE
    sender_email := btrim(sender);
    sender_name  := NULL;
  END IF;

  sender_name := COALESCE(sender_name, 'Touchcore ValueSpot');

  SELECT net.http_post(
    url     := 'https://api.brevo.com/v3/smtp/email',
    headers := jsonb_build_object(
                 'api-key',      api_key,
                 'Content-Type', 'application/json',
                 'accept',       'application/json'),
    body    := jsonb_build_object(
                 'sender', jsonb_build_object('name', sender_name, 'email', sender_email),
                 'to',     jsonb_build_array(jsonb_build_object(
                             'email', emp.email, 'name', emp.full_name)),
                 'subject', 'Set up your Touchcore ValueSpot account',
                 'htmlContent',
                   '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a1a;max-width:520px">'
                || '<p style="font-size:15px">Hi ' || emp.full_name || ',</p>'
                || '<p style="font-size:15px;line-height:1.55">You have been added to '
                || '<strong>Touchcore ValueSpot</strong>, our employee recognition platform, as '
                || '<strong>' || role_label || '</strong>. Set up your account to get started:</p>'
                || '<p style="margin:24px 0"><a href="' || link || '" '
                || 'style="background:#1a3a5c;color:#fff;padding:11px 20px;border-radius:3px;'
                || 'text-decoration:none;font-size:15px;font-weight:600">Complete your account</a></p>'
                || '<p style="font-size:13px;color:#666;line-height:1.55">Or paste this into your browser:<br>'
                || '<span style="word-break:break-all">' || link || '</span></p>'
                || '<p style="font-size:13px;color:#666;line-height:1.55">Sign up with this address ('
                || emp.email || ') and your full name as it appears on your employee record, then '
                || 'choose your own password. You will be emailed a six-digit code to confirm the '
                || 'address.</p>'
                -- No expiry is claimed: nothing in the schema enforces one.
                || '<p style="font-size:13px;color:#666;line-height:1.55">This link is meant for you '
                || 'and stays valid until you use it. If you were not expecting this, please tell HR.</p>'
                || '<p style="font-size:12px;color:#999;margin-top:22px">&mdash; Touchcore ValueSpot</p>'
                || '</div>')
  ) INTO req_id;

  -- ── Record the send. No key, no provider body. ──
  INSERT INTO invitation_sends (employee_id, sent_by, send_ref)
  VALUES (emp.id, caller_id, req_id);

  INSERT INTO audit_logs (actor_id, actor_email, action, entity_type, entity_id, new_value)
  VALUES (caller_id, lower(btrim(auth.jwt()->>'email')), 'employee.invited', 'employee', emp.id,
          jsonb_build_object('role', emp.role, 'email', emp.email, 'send_ref', req_id));

  RETURN jsonb_build_object(
    'status', 'queued',        -- queued, NOT delivered. See the status helper.
    'role',   emp.role,
    'email',  emp.email);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.send_employee_invitation(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.send_employee_invitation(uuid) TO authenticated;


-- ── 4. Did the provider accept it? ──────────────────────────
--
-- Same shape and the same categories as login_code_delivery_status() in 024:
-- a status code and a CATEGORY, never the provider's body. Brevo's error text
-- can name the account owner's address, which has no business reaching a
-- browser.

CREATE OR REPLACE FUNCTION public.invitation_delivery_status(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, net, extensions
AS $fn$
DECLARE
  caller_role text;
  ref         bigint;
  code        integer;
  errmsg      text;
BEGIN
  caller_role := public.current_employee_role();

  IF caller_role IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT send_ref INTO ref
    FROM invitation_sends
   WHERE employee_id = p_employee_id
   ORDER BY sent_at DESC
   LIMIT 1;

  IF ref IS NULL THEN
    RETURN jsonb_build_object('status', 'none');
  END IF;

  SELECT r.status_code, r.error_msg INTO code, errmsg
    FROM net._http_response r WHERE r.id = ref;

  -- pg_net clears old responses and a fresh request takes a moment, so
  -- absence means "not answered yet", not "failed".
  IF NOT FOUND OR (code IS NULL AND errmsg IS NULL) THEN
    RETURN jsonb_build_object('status', 'pending');
  END IF;

  IF code IS NULL THEN
    RETURN jsonb_build_object('status', 'failed', 'reason', 'unreachable');
  END IF;

  IF code BETWEEN 200 AND 299 THEN
    RETURN jsonb_build_object('status', 'sent', 'provider_status', code);
  END IF;

  RETURN jsonb_build_object(
    'status', 'failed',
    'provider_status', code,
    'reason',
    CASE
      WHEN code = 403 THEN 'recipient_not_allowed'
      WHEN code = 401 THEN 'provider_auth'
      WHEN code = 422 THEN 'invalid_sender'
      WHEN code = 429 THEN 'provider_rate_limited'
      ELSE 'provider_error'
    END);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.invitation_delivery_status(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.invitation_delivery_status(uuid) TO authenticated;


-- ── Verification ────────────────────────────────────────────

SELECT '027 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND proname = 'send_employee_invitation')              AS sender_installed,
       EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND proname = 'invitation_delivery_status')            AS status_helper_installed,
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public'
                AND tablename = 'invitation_sends')                    AS ledger_installed,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'invitation_sends') AS ledger_policies,
       COALESCE(NULLIF(btrim((SELECT value #>> '{}' FROM app_config
                               WHERE key = 'app_base_url')), ''),
                '(NOT SET -- invitations will refuse)')                AS app_base_url,
       (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name IN ('brevo_api_key', 'brevo_sender')
           AND btrim(decrypted_secret) <> '')                          AS brevo_secrets_present;
-- EXPECT the three installs true, ledger_policies = 0 (RLS on, no policies,
-- revoked from the client), and brevo_secrets_present = 2.
-- The API key is checked for PRESENCE only and never selected.
--
-- app_base_url must be set before any invitation can be sent:
--   UPDATE app_config SET value = '"http://localhost:5173"'::jsonb
--    WHERE key = 'app_base_url';


-- ============================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.invitation_delivery_status(uuid);
--   DROP FUNCTION IF EXISTS public.send_employee_invitation(uuid);
--   DROP TABLE    IF EXISTS invitation_sends;
--   DELETE FROM app_config WHERE key = 'app_base_url';
--
-- That returns the system to manual invitation hand-off -- Copy link and the
-- mailto fallback, both of which the UI keeps. No other function, table,
-- policy, grant or trigger was touched, so nothing else has to be reverted.
-- ============================================================
