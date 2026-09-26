-- ============================================================
-- 056 -- email the approval request, not just the bell
--
-- Additive. One table, two functions, two trigger functions redefined. No
-- policy, trigger, notification type or routing rule is created, altered or
-- dropped. Safe to run more than once. Requires 001-055.
--
--
-- WHAT CHANGES
-- ------------
-- When a recognition is submitted, everyone who gets the in-app "A recognition
-- needs your review" notification now also gets it by email:
--
--     the routed Project Manager   the project's manager, as routed by 029/030
--     every active HR Admin        organisation-wide, as in 042
--     every active Super Admin     organisation-wide, as in 042
--
-- And when the author answers a clarification request, the approver who gets
-- the in-app "Clarification answered" notification gets it by email too, since
-- the recognition is waiting for their decision again.
--
-- No other notification is emailed. Approvals, rejections, comments, coins and
-- support stay in the bell only.
--
--
-- WHAT DOES NOT CHANGE
-- --------------------
-- Routing. route_nomination_to_project_manager() is not read, written or
-- mentioned. The email goes to exactly the people the in-app notification goes
-- to, selected by exactly the same conditions -- a Manager is emailed only
-- about recognitions routed to them, never about another Manager's project.
--
-- The in-app notifications. Both trigger functions are reproduced verbatim from
-- 042 and 009; the email is a step added after them.
--
--
-- WHY FROM THESE TRIGGERS AND NOT FROM THE notifications TABLE
-- ------------------------------------------------------------
-- An AFTER INSERT trigger on notifications would be shorter, but
-- notifications_own is FOR ALL: any signed-in user may insert rows addressed to
-- themselves. A trigger there would let anyone make the company's sender mail
-- them on demand, spending the Brevo quota. These two trigger functions only
-- run when a recognition is really submitted or really returned.
--
--
-- NO SESSION, NO EMAIL
-- --------------------
-- A real submission always comes from a signed-in employee's browser. An insert
-- with auth.uid() NULL is a seeder, a demo-data script, a migration or the SQL
-- editor -- the same trusted, identity-less callers 029 lets through. They still
-- get their in-app notifications, as before, but never send mail: seeding demo
-- recognitions must not email every HR Admin in the organisation.
--
--
-- AN EMAIL PROBLEM NEVER BLOCKS A RECOGNITION
-- -------------------------------------------
-- Missing Brevo secrets, a missing app_base_url, a recipient without an address
-- or an unexpected error: the recognition is still submitted and the bell
-- still rings. The email is skipped and the reason is written to the ledger.
--
-- Delivery is pg_net -> Brevo with the Vault secrets from 025, exactly like the
-- 2FA code and the invitation (027). No new provider, secret or Edge Function.
-- ============================================================


-- ============================================================
-- PART A -- the ledger
--
-- One row per email attempted, so "did the manager get the email?" has an
-- answer. send_ref is the pg_net request id; join it to net._http_response to
-- see what Brevo said (query at the bottom of this file).
--
-- Same posture as invitation_sends (027): RLS on, NO policies, revoked from the
-- client. Only the SECURITY DEFINER sender writes it.
-- ============================================================

CREATE TABLE IF NOT EXISTS approval_email_sends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id uuid NOT NULL REFERENCES nominations(id) ON DELETE CASCADE,
  recipient_id  uuid NOT NULL REFERENCES employees(id)   ON DELETE CASCADE,
  reason        text NOT NULL CHECK (reason IN ('submitted', 'clarification_answered')),
  status        text NOT NULL CHECK (status IN ('queued', 'skipped')),
  -- Why it was skipped, or 'no_link' when it went out without a button.
  detail        text,
  send_ref      bigint,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approval_email_sends_nomination
  ON approval_email_sends(nomination_id, created_at DESC);

ALTER TABLE approval_email_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE approval_email_sends FROM anon, authenticated;


-- ============================================================
-- PART B -- HTML escaping
--
-- Names, core values and project names are typed by people, and the sender
-- is the company's verified address. Without escaping, a full name containing
-- markup would put that markup -- a link, say -- in an email that HR trusts.
-- 027 predates this and interpolates raw; this file does not.
-- ============================================================

CREATE OR REPLACE FUNCTION public.email_html_escape(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT replace(replace(replace(replace(replace(COALESCE(p, ''),
           '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;'), '''', '&#39;');
$fn$;

REVOKE EXECUTE ON FUNCTION public.email_html_escape(text) FROM PUBLIC, anon;


-- ============================================================
-- PART C -- the sender
--
-- Emails ONE recipient about ONE recognition. Called only by the two trigger
-- functions below, which have already decided who the recipients are. EXECUTE
-- is revoked from every client role: a browser able to call this could mail
-- any employee about any recognition, as often as it liked.
--
-- Never raises. Whatever goes wrong is caught, the recognition carries on, and
-- the attempt is rolled back to a WARNING in the Postgres log.
-- ============================================================

CREATE OR REPLACE FUNCTION public.send_approval_request_email(
  p_nomination_id uuid,
  p_recipient_id  uuid,
  p_reason        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, extensions
AS $fn$
DECLARE
  nom          nominations%ROWTYPE;
  rcpt         employees%ROWTYPE;
  nominator    text;
  nominee      text;
  value_name   text;
  project_name text;
  base_url     text;
  link         text;
  api_key      text;
  sender       text;
  sender_email text;
  sender_name  text;
  subject      text;
  heading      text;
  intro         text;
  why          text;
  html         text;
  req_id       bigint;
BEGIN
  BEGIN
    SELECT * INTO nom  FROM nominations WHERE id = p_nomination_id;
    SELECT * INTO rcpt FROM employees   WHERE id = p_recipient_id;

    IF nom.id IS NULL OR rcpt.id IS NULL THEN
      RETURN;
    END IF;

    IF rcpt.email IS NULL OR btrim(rcpt.email) = '' THEN
      INSERT INTO approval_email_sends (nomination_id, recipient_id, reason, status, detail)
      VALUES (nom.id, rcpt.id, p_reason, 'skipped', 'no_recipient_email');
      RETURN;
    END IF;

    -- ── Brevo. Same secrets, same parsing as 025 and 027. ──
    SELECT decrypted_secret INTO api_key FROM vault.decrypted_secrets WHERE name = 'brevo_api_key';
    SELECT decrypted_secret INTO sender  FROM vault.decrypted_secrets WHERE name = 'brevo_sender';

    IF api_key IS NULL OR btrim(api_key) = '' OR sender IS NULL OR btrim(sender) = '' THEN
      INSERT INTO approval_email_sends (nomination_id, recipient_id, reason, status, detail)
      VALUES (nom.id, rcpt.id, p_reason, 'skipped', 'email_not_configured');
      RETURN;
    END IF;

    IF sender LIKE '%<%>%' THEN
      sender_email := btrim(substring(sender from '<([^>]+)>'));
      sender_name  := NULLIF(btrim(regexp_replace(sender, '<[^>]*>', '')), '');
    ELSE
      sender_email := btrim(sender);
      sender_name  := NULL;
    END IF;

    sender_name := COALESCE(sender_name, 'Touchcore ValueSpot');

    -- ── The link. From app_config, never from a client, as in 027. ──
    -- Unset is not a reason to stay silent here, unlike an invitation: the
    -- email still tells them to go and review, just without a button.
    SELECT NULLIF(btrim(value #>> '{}'), '') INTO base_url
      FROM app_config WHERE key = 'app_base_url';

    IF base_url IS NOT NULL THEN
      -- ROUTES.PENDING_APPROVALS -- the page all three roles review from, and
      -- where the in-app notification already links.
      link := rtrim(base_url, '/') || '/manager/approvals';
    END IF;

    -- ── What to say. Everything typed by a person is escaped. ──
    SELECT full_name INTO nominator FROM employees WHERE id = nom.nominator_id;
    SELECT full_name INTO nominee   FROM employees WHERE id = nom.nominee_id;

    nominator    := public.email_html_escape(COALESCE(nominator, 'A colleague'));
    nominee      := public.email_html_escape(COALESCE(nominee, 'a colleague'));
    value_name   := public.email_html_escape(COALESCE(nom.snapshot_core_value_name, 'a Core Value'));
    project_name := NULLIF(public.email_html_escape(nom.snapshot_project_name), '');

    IF p_reason = 'clarification_answered' THEN
      subject := 'A recognition is back for your approval';
      heading := 'A recognition is back for your approval';
      intro    := '<strong>' || nominator || '</strong> answered the clarification request on their '
              || 'recognition of <strong>' || nominee || '</strong> for <strong>' || value_name
              || '</strong> and returned it for approval.';
    ELSE
      subject := 'Approval needed: a recognition for ' || COALESCE(nom.snapshot_core_value_name, 'a Core Value');
      heading := 'A recognition is waiting for your approval';
      intro    := '<strong>' || nominator || '</strong> recognised <strong>' || nominee
              || '</strong> for <strong>' || value_name || '</strong>'
              || COALESCE(' on the <strong>' || project_name || '</strong> project', '') || '.';
    END IF;

    why := CASE rcpt.role
             WHEN 'manager'     THEN 'You are receiving this because it was sent to you as the Project Manager'
                                  || COALESCE(' for ' || project_name, '') || '.'
             WHEN 'hr_admin'    THEN 'You are receiving this because you are an HR Admin in ValueSpot.'
             WHEN 'super_admin' THEN 'You are receiving this because you are a Super Admin in ValueSpot.'
             ELSE 'You are receiving this because this recognition was sent to you for approval.'
           END;

    html := '<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1a1a1a;max-width:520px">'
         || '<p style="font-size:15px">Hi ' || public.email_html_escape(rcpt.full_name) || ',</p>'
         || '<p style="font-size:17px;font-weight:600;margin:18px 0 8px">' || heading || '</p>'
         || '<p style="font-size:15px;line-height:1.55;margin:0">' || intro || '</p>'
         || CASE WHEN link IS NOT NULL THEN
                 '<p style="margin:24px 0"><a href="' || public.email_html_escape(link) || '" '
              || 'style="background:#111113;color:#fff;padding:11px 20px;border-radius:6px;'
              || 'text-decoration:none;font-size:15px;font-weight:600">Review in ValueSpot</a></p>'
            ELSE
                 '<p style="font-size:15px;line-height:1.55">Sign in to ValueSpot and open '
              || '<strong>Pending Approvals</strong> to review it.</p>'
            END
         || '<p style="font-size:13px;color:#666;line-height:1.55">Only one reviewer needs to act. If '
         || 'somebody else gets to it first, ValueSpot will show you who did.</p>'
         || '<p style="font-size:13px;color:#666;line-height:1.55">' || why || '</p>'
         || '<p style="font-size:12px;color:#999;margin-top:22px">&mdash; Touchcore ValueSpot</p>'
         || '</div>';

    SELECT net.http_post(
      url     := 'https://api.brevo.com/v3/smtp/email',
      headers := jsonb_build_object(
                   'api-key',      api_key,
                   'Content-Type', 'application/json',
                   'accept',       'application/json'),
      body    := jsonb_build_object(
                   'sender',      jsonb_build_object('name', sender_name, 'email', sender_email),
                   'to',          jsonb_build_array(jsonb_build_object(
                                    'email', rcpt.email, 'name', rcpt.full_name)),
                   'subject',     subject,
                   'htmlContent', html)
    ) INTO req_id;

    INSERT INTO approval_email_sends (nomination_id, recipient_id, reason, status, detail, send_ref)
    VALUES (nom.id, rcpt.id, p_reason, 'queued',
            CASE WHEN link IS NULL THEN 'no_link' END, req_id);

  EXCEPTION WHEN OTHERS THEN
    -- Everything above is undone -- including a queued request -- and the
    -- recognition goes ahead.
    RAISE WARNING 'approval email to % about % not sent: %', p_recipient_id, p_nomination_id, SQLERRM;
  END;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.send_approval_request_email(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.send_approval_request_email(uuid, uuid, text) IS
  'Emails one approval authority that a recognition is waiting for them. Called only by notify_nomination_submitted() and notify_clarification_answered(); no client role may execute it. Never raises.';


-- ============================================================
-- PART D -- submission: the same three authorities, by email as well
--
-- Steps 1 and 2 are 042's function, verbatim. Step 3 is new. Its recipient
-- conditions are step 2's, copied exactly -- if one changes, change both.
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_nomination_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nominator_name text;
  value_name     text;
  title          text := 'A recognition needs your review';
  body           text;
  recipient      record;
BEGIN
  -- Drafts have not been submitted to anyone yet.
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;

  SELECT full_name INTO nominator_name FROM employees WHERE id = NEW.nominator_id;
  value_name := COALESCE(NEW.snapshot_core_value_name, 'a Core Value');

  body := COALESCE(nominator_name, 'A colleague')
          || ' submitted a recognition for ' || value_name || '.';

  -- 1. The approver it was ROUTED to. Unchanged from 009, including the
  --    assigned_approver_id IS NULL guard that used to sit in the early return.
  IF NEW.assigned_approver_id IS NOT NULL THEN
    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    VALUES (NEW.assigned_approver_id, 'approval_required', title, body, NEW.id, 'nomination');
  END IF;

  -- 2. The organisation-wide authorities.
  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  SELECT e.id, 'approval_required', title, body, NEW.id, 'nomination'
    FROM employees e
   WHERE e.role IN ('hr_admin', 'super_admin')
     AND e.is_active
     AND e.id IS DISTINCT FROM NEW.assigned_approver_id
     AND e.id <> NEW.nominator_id
     AND e.id <> NEW.nominee_id;

  -- 3. The same people, by email (056). Only for a real submission from a
  --    signed-in employee -- never for seeders or demo data.
  IF auth.uid() IS NOT NULL THEN
    FOR recipient IN
      SELECT NEW.assigned_approver_id AS id
       WHERE NEW.assigned_approver_id IS NOT NULL
      UNION ALL
      SELECT e.id
        FROM employees e
       WHERE e.role IN ('hr_admin', 'super_admin')
         AND e.is_active
         AND e.id IS DISTINCT FROM NEW.assigned_approver_id
         AND e.id <> NEW.nominator_id
         AND e.id <> NEW.nominee_id
    LOOP
      PERFORM public.send_approval_request_email(NEW.id, recipient.id, 'submitted');
    END LOOP;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.notify_nomination_submitted() FROM PUBLIC;


-- ============================================================
-- PART E -- a clarification answered: the approver, by email as well
--
-- 009's function, verbatim, plus the email to the same single recipient.
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_clarification_answered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nominator_name text;
BEGIN
  IF OLD.status = 'clarification_requested'
     AND NEW.status = 'pending'
     AND NEW.assigned_approver_id IS NOT NULL
  THEN
    SELECT full_name INTO nominator_name FROM employees WHERE id = NEW.nominator_id;

    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    VALUES (
      NEW.assigned_approver_id,
      'approval_required',
      'Clarification answered',
      COALESCE(nominator_name, 'A colleague')
        || ' has updated their recognition and returned it for review.',
      NEW.id,
      'nomination'
    );

    -- By email too (056). Only when the author really answered it.
    IF auth.uid() IS NOT NULL THEN
      PERFORM public.send_approval_request_email(
        NEW.id, NEW.assigned_approver_id, 'clarification_answered');
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.notify_clarification_answered() FROM PUBLIC;

-- Both triggers are unchanged (009/042) and keep pointing at these functions.


-- ============================================================
-- Verification
-- ============================================================
SELECT '056 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public'
                AND tablename = 'approval_email_sends')                AS ledger_installed,
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename = 'approval_email_sends')                     AS ledger_policies,
       -- No browser can send these emails directly.
       NOT has_function_privilege('authenticated',
         'public.send_approval_request_email(uuid,uuid,text)', 'EXECUTE')
                                                                      AS sender_not_callable_by_browser,
       -- Routing untouched: still the selected project's manager.
       (SELECT pg_get_functiondef(oid) NOT LIKE '%e.manager_id%' FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'route_nomination_to_project_manager')        AS routing_untouched,
       EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgrelid = 'public.nominations'::regclass
                  AND tgname = 'notify_nomination_submitted')          AS submit_trigger_attached,
       EXISTS (SELECT 1 FROM pg_trigger
                WHERE tgrelid = 'public.nominations'::regclass
                  AND tgname = 'notify_clarification_answered')        AS answer_trigger_attached,
       (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name IN ('brevo_api_key', 'brevo_sender')
           AND btrim(decrypted_secret) <> '')                          AS brevo_secrets_present,
       COALESCE(NULLIF(btrim((SELECT value #>> '{}' FROM app_config
                               WHERE key = 'app_base_url')), ''),
                '(NOT SET -- emails go out without a Review button)')  AS app_base_url;
-- EXPECT ledger_installed, sender_not_callable_by_browser, routing_untouched and
-- both *_attached true, ledger_policies = 0 and brevo_secrets_present = 2.
--
-- Did the emails for a recognition go out, and what did Brevo say?
--
--   SELECT s.created_at, e.full_name, e.email, s.reason, s.status, s.detail,
--          r.status_code
--     FROM approval_email_sends s
--     JOIN employees e ON e.id = s.recipient_id
--     LEFT JOIN net._http_response r ON r.id = s.send_ref
--    ORDER BY s.created_at DESC
--    LIMIT 20;
--
-- status_code 201 is accepted by Brevo. NULL shortly after sending is normal
-- (not answered yet); pg_net also clears old responses after a while.


-- ============================================================
-- ROLLBACK
--
--   Restore notify_nomination_submitted() from 042 (Part H) and
--   notify_clarification_answered() from 009, then:
--
--   DROP FUNCTION IF EXISTS public.send_approval_request_email(uuid, uuid, text);
--   DROP FUNCTION IF EXISTS public.email_html_escape(text);
--   DROP TABLE    IF EXISTS approval_email_sends;
--
-- The in-app notifications are unaffected either way.
-- ============================================================
