-- ============================================================
-- 057 -- pre-handover security hardening
--
-- Additive. Four trigger functions and their triggers are created, five
-- existing functions are redefined, one policy is replaced and six function
-- grants are narrowed. No table or column is created, altered or dropped and
-- no row is changed. Safe to run more than once. Requires 001-056.
--
-- Every change below closes a hole that was reproduced against the full
-- migration chain before it was fixed. What each one stops is written next to
-- it. Nothing a screen legitimately does is refused: the only direct table
-- writes the app makes are HR's employee edits, a recognition submission, the
-- author's clarification answer, and HR's reward and project maintenance, and
-- each of those still works exactly as before.
--
--
-- HOW "DIRECT" IS TOLD APART
-- --------------------------
-- Several guards below apply only to writes a browser sends straight to a
-- table over the REST API, not to writes made inside the SECURITY DEFINER
-- functions that already carry their own rules (claim_employee_account,
-- update_my_profile, moderate_recognition, decide_reward_redemption ...).
--
-- Those guards are SECURITY INVOKER trigger functions and test current_user.
-- A REST request runs as 'authenticated' (or 'anon'); a statement inside a
-- SECURITY DEFINER function runs as the function's owner; the service role,
-- seeders and migrations run as themselves. So current_user IN
-- ('authenticated', 'anon') is exactly "the browser wrote this row itself".
-- ============================================================


-- ── 1. A deactivated account stops working immediately ─────
--
-- Deactivating somebody set employees.is_active = false and nothing else. Their
-- session, second factor and JWT claims all stayed valid, and refresh tokens
-- keep a session alive indefinitely. Reproduced:
--
--   * a deactivated employee kept reading the directory and the feed, and
--     could set is_active back to true on their own row (employees_update_own);
--   * a deactivated HR Admin could still adjust Value Coin wallets and edit
--     employees, because those paths check the role but not is_active.
--
-- session_second_factor_ok() already gates every policy, view and RPC, so the
-- rule is added there once: a session whose employee record is deactivated is
-- treated as not verified. A session with NO employee record yet is unaffected
-- -- claim_employee_account() needs exactly that state during sign-up.

CREATE OR REPLACE FUNCTION public.session_second_factor_ok()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM login_verifications
     WHERE session_id  = public.current_session_id()
       AND verified_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM employees
     WHERE auth_user_id = auth.uid()
       AND NOT is_active
  );
$fn$;

-- The Edge Functions' form of the same check (they run as the service role, so
-- auth.uid() is empty there and the user is named explicitly).
CREATE OR REPLACE FUNCTION public.session_second_factor_ok_for(p_session_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM login_verifications
     WHERE session_id  = p_session_id
       AND user_id     = p_user_id
       AND verified_at IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM employees
     WHERE auth_user_id = p_user_id
       AND NOT is_active
  );
$fn$;

-- session_status() gains account_inactive, so the sign-in screen can still say
-- "your account has been deactivated" now that the employee row itself is no
-- longer readable by that session. Otherwise reproduced verbatim from 021.
CREATE OR REPLACE FUNCTION public.session_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
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
      END,
    -- Only said to a session that has passed the emailed code.
    'account_inactive',
      (v.verified_at IS NOT NULL)
      AND EXISTS (SELECT 1 FROM employees WHERE auth_user_id = uid AND NOT is_active)
  );
END;
$fn$;


-- ── 2. Employee records: direct writes ──────────────────────
--
-- employees_update_own lets a person UPDATE their own row, and its WITH CHECK
-- pins only `role`. Every other column was writable over REST. Reproduced:
-- an employee changing their own email, auth_user_id, avatar_url (to any
-- host), employee code and joined date, and -- with 1 above -- reactivating
-- themselves. Nothing in the app writes a person's own row directly: the
-- profile screens go through update_my_profile(), set_my_profile_image(),
-- set_own_department() and set_own_project(), which keep working.
--
-- employees_hr_full lets HR write any row. Reproduced, end to end: HR changes a
-- Super Admin's email to an address HR controls and clears their
-- auth_user_id; HR signs up with that address, passes the emailed code, and
-- claim_employee_account() links the Super Admin record to HR's new account.
-- HR could also DELETE Super Admin rows outright -- and with none left,
-- claim_employee_account() makes the next person to sign up a Super Admin.
--
-- The rules for a direct write:
--   * nobody deletes an employee row directly -- Delete employee (the
--     delete-employee Edge Function and purge_employee) is the only way, and
--     it keeps its own admin and last-admin rules;
--   * only an active HR Admin or Super Admin updates a row directly, which is
--     what the Employees screen does;
--   * email, auth_user_id and id are never changed directly by anyone;
--   * an HR Admin does not change a Super Admin's record at all;
--   * a new row is never created already linked to a sign-in.

CREATE OR REPLACE FUNCTION public.guard_employee_direct_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  caller_role text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Employees are removed with Delete employee, which also clears their records safely.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'A new employee record cannot be linked to a sign-in here. The person links it by signing up.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;

  -- NULL for an unverified or deactivated session, as in 026.
  caller_role := public.current_employee_role();

  IF caller_role IS NULL OR caller_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Your details are changed from your Profile page.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.id           IS DISTINCT FROM OLD.id
  OR NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
  OR NEW.email        IS DISTINCT FROM OLD.email
  THEN
    RAISE EXCEPTION 'An employee''s email address and sign-in cannot be changed here.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF caller_role = 'hr_admin' AND OLD.role = 'super_admin' THEN
    RAISE EXCEPTION 'Only a Super Admin can change a Super Admin''s record.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_employee_direct_write ON public.employees;
CREATE TRIGGER guard_employee_direct_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.employees
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_direct_write();


-- ── 3. Recognition submission ───────────────────────────────
--
-- nominations_insert checks who is submitting and for whom, but nothing about
-- the row's state. Reproduced, as an ordinary Employee over REST:
--
--   * inserting a recognition with status 'approved' and an approver of their
--     choosing -- published to the feed and counted towards a badge without
--     anyone reviewing it (also 'rejected' and 'removed');
--   * a behaviour from a different core value, a scenario from a different
--     behaviour;
--   * snapshot names of their choosing ("FORGED"), which the feed, reports and
--     approval emails display;
--   * a backdated submitted_at, which moves it between report periods;
--   * inserting as 'draft' and then updating it to 'pending', which skips the
--     rate limit and the approvers' notifications (both fire on INSERT only).
--     Nothing in the app creates drafts.
--
-- From a signed-in session the row is now made to match what the app sends: a
-- pending recognition, decision fields empty, stamped with the server's time,
-- its names copied from the catalogue rather than from the request. Seeders
-- and the service role (no auth.uid()) are untouched, as in 029.
--
-- Named so it runs after the eligibility and rate-limit triggers and before
-- route_nomination_to_project_manager(), which fills snapshot_project_name
-- from the project once this has cleared it.

CREATE OR REPLACE FUNCTION public.guard_nomination_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  cv_name text;
  b_name  text;
  s_name  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'A recognition is submitted for review. It cannot be created already decided.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.what_happened, '')), '') IS NULL
  OR NULLIF(btrim(COALESCE(NEW.what_impact,   '')), '') IS NULL THEN
    RAISE EXCEPTION 'Describe what happened and the impact it had.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- The wizard's own limit (Step5Story).
  IF char_length(btrim(NEW.what_happened)) > 1000
  OR char_length(btrim(NEW.what_impact))   > 1000 THEN
    RAISE EXCEPTION 'Please keep each answer under 1000 characters.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Exactly one core value, and it must be one people can choose today.
  SELECT name INTO cv_name
    FROM core_values WHERE id = NEW.core_value_id AND is_active;

  IF cv_name IS NULL THEN
    RAISE EXCEPTION 'That core value is no longer available. Choose another.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.behaviour_id IS NOT NULL THEN
    SELECT name INTO b_name
      FROM behaviours
     WHERE id = NEW.behaviour_id
       AND core_value_id = NEW.core_value_id
       AND is_active;

    IF b_name IS NULL THEN
      RAISE EXCEPTION 'That behaviour does not belong to the chosen core value.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF NEW.scenario_id IS NOT NULL THEN
    SELECT name INTO s_name
      FROM scenarios
     WHERE id = NEW.scenario_id
       AND behaviour_id = NEW.behaviour_id
       AND is_active;

    IF s_name IS NULL THEN
      RAISE EXCEPTION 'That scenario does not belong to the chosen behaviour.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- Names from the catalogue, never from the request.
  NEW.snapshot_core_value_name := cv_name;
  NEW.snapshot_behaviour_name  := b_name;
  NEW.snapshot_scenario_name   := s_name;
  NEW.snapshot_project_name    := NULL;   -- filled by the routing trigger
  NEW.snapshot_nominator_dept  := (SELECT d.name FROM employees e
                                     JOIN departments d ON d.id = e.department_id
                                    WHERE e.id = NEW.nominator_id);
  NEW.snapshot_nominee_dept    := (SELECT d.name FROM employees e
                                     JOIN departments d ON d.id = e.department_id
                                    WHERE e.id = NEW.nominee_id);
  NEW.snapshot_nominee_manager_id := NULL;  -- retired in 030

  -- A new recognition has been decided by nobody.
  NEW.approved_by_id                  := NULL;
  NEW.approved_by_role                := NULL;
  NEW.approved_at                     := NULL;
  NEW.published_at                    := NULL;
  NEW.rejected_by_id                  := NULL;
  NEW.rejected_by_role                := NULL;
  NEW.rejected_at                     := NULL;
  NEW.rejection_reason                := NULL;
  NEW.clarification_requested_by_id   := NULL;
  NEW.clarification_requested_by_role := NULL;
  NEW.clarification_requested_at      := NULL;
  NEW.clarification_note              := NULL;
  NEW.clarification_responded_at      := NULL;
  NEW.removed_at                      := NULL;
  NEW.removed_by_id                   := NULL;
  NEW.removal_reason                  := NULL;
  NEW.previous_status                 := NULL;

  -- The server's clock. created_at is what the rate limit counts.
  NEW.submitted_at := now();
  NEW.created_at   := now();

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_nomination_submission ON public.nominations;
CREATE TRIGGER guard_nomination_submission
  BEFORE INSERT ON public.nominations
  FOR EACH ROW EXECUTE FUNCTION public.guard_nomination_submission();


-- ── 4. Recognition updates ──────────────────────────────────
--
-- nominations_update_approver lets the routed Manager UPDATE a pending
-- recognition, and enforce_nominator_update_scope() only polices the AUTHOR.
-- Reproduced: the routed Manager rewriting the nominee of a pending
-- recognition before it is approved. Decisions already go through
-- process-approval / record_nomination_decision() and HR corrections through
-- moderate_recognition(); the one direct UPDATE the app makes is the author
-- answering a clarification request (resubmitWithClarification).
--
-- So a direct UPDATE is now only that: the author, on their own recognition
-- while it awaits clarification, changing the two answers and sending it back
-- to pending. The response time is the server's.
--
-- Separately, and for every signed-in path including moderate_recognition():
-- a behaviour must belong to the recognition's core value and a scenario to
-- its behaviour whenever one of the three changes.

CREATE OR REPLACE FUNCTION public.guard_nomination_direct_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.core_value_id IS DISTINCT FROM OLD.core_value_id
  OR NEW.behaviour_id  IS DISTINCT FROM OLD.behaviour_id
  OR NEW.scenario_id   IS DISTINCT FROM OLD.scenario_id
  THEN
    IF NEW.behaviour_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM behaviours
          WHERE id = NEW.behaviour_id AND core_value_id = NEW.core_value_id)
    THEN
      RAISE EXCEPTION 'That behaviour does not belong to the chosen core value.'
        USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.scenario_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM scenarios
          WHERE id = NEW.scenario_id AND behaviour_id = NEW.behaviour_id)
    THEN
      RAISE EXCEPTION 'That scenario does not belong to the chosen behaviour.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF OLD.nominator_id IS DISTINCT FROM (auth.jwt()->>'employee_id')::uuid
  OR OLD.status <> 'clarification_requested'
  THEN
    RAISE EXCEPTION 'Recognitions are changed through review and moderation, not edited directly.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['what_happened', 'what_impact', 'status',
                            'clarification_responded_at', 'updated_at'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['what_happened', 'what_impact', 'status',
                            'clarification_responded_at', 'updated_at'])
  THEN
    RAISE EXCEPTION 'You may only revise the description and impact of your recognition.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.status NOT IN ('clarification_requested', 'pending') THEN
    RAISE EXCEPTION 'A clarification response must return the recognition to pending review.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NULLIF(btrim(COALESCE(NEW.what_happened, '')), '') IS NULL
  OR NULLIF(btrim(COALESCE(NEW.what_impact,   '')), '') IS NULL THEN
    RAISE EXCEPTION 'Describe what happened and the impact it had.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF char_length(btrim(NEW.what_happened)) > 1000
  OR char_length(btrim(NEW.what_impact))   > 1000 THEN
    RAISE EXCEPTION 'Please keep each answer under 1000 characters.'
      USING ERRCODE = 'check_violation';
  END IF;

  NEW.clarification_responded_at :=
    CASE WHEN NEW.status = 'pending' THEN now() ELSE OLD.clarification_responded_at END;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_nomination_direct_update ON public.nominations;
CREATE TRIGGER guard_nomination_direct_update
  BEFORE UPDATE ON public.nominations
  FOR EACH ROW EXECUTE FUNCTION public.guard_nomination_direct_update();


-- ── 5. Reward requests ──────────────────────────────────────
--
-- Reproduced: an HR Admin redeeming a reward that needs approval, then
-- approving their own request -- through decide_reward_redemption() and also
-- by a direct UPDATE (reward_assignments_hr_full). And HR rewriting a
-- redemption's coin_cost directly, which leaves the ledger (which recorded the
-- real debit) disagreeing with the request.
--
--   * Nobody decides their own reward request, by any path. Recognitions have
--     the same rule ('party' in 042).
--   * A redemption row is created only by redeem_reward() and decided only by
--     decide_reward_redemption(), which move the coins and write the ledger.
--     HR's own assignments (origin 'hr_assignment') are unaffected.

CREATE OR REPLACE FUNCTION public.guard_reward_assignment_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.origin = 'redemption'
     AND NEW.decided_by_id IS NOT NULL
     AND NEW.decided_by_id IS DISTINCT FROM OLD.decided_by_id
     AND NEW.decided_by_id = NEW.employee_id
  THEN
    RAISE EXCEPTION 'You cannot decide your own reward request. Another HR Admin or a Super Admin has to.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF current_user IN ('authenticated', 'anon') THEN
    IF (TG_OP = 'INSERT' AND NEW.origin = 'redemption')
    OR (TG_OP = 'UPDATE' AND (OLD.origin = 'redemption' OR NEW.origin = 'redemption'))
    OR (TG_OP = 'DELETE' AND OLD.origin = 'redemption')
    THEN
      RAISE EXCEPTION 'Reward requests are made from the Value Store and decided from the reward queue.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_reward_assignment_write ON public.reward_assignments;
CREATE TRIGGER guard_reward_assignment_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.reward_assignments
  FOR EACH ROW EXECUTE FUNCTION public.guard_reward_assignment_write();


-- ── 6. Signup domains stay a Super Admin control ────────────
--
-- 017 made the signup domain policy Super Admin only and audited it through
-- set_signup_domains(). app_config_hr_write still let HR update the same row
-- directly -- reproduced: HR opening self-registration to every domain, with
-- no audit entry. The policy is reproduced from 005 (with 022's second-factor
-- gate) and holds that one key back from HR. HR's other settings are unaffected.

DROP POLICY IF EXISTS "app_config_hr_write" ON public.app_config;
CREATE POLICY "app_config_hr_write" ON public.app_config
  FOR ALL
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role') IN ('hr_admin', 'super_admin')
    AND (key <> 'signup_allowed_domains' OR (auth.jwt()->>'user_role') = 'super_admin')
  )
  WITH CHECK (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role') IN ('hr_admin', 'super_admin')
    AND (key <> 'signup_allowed_domains' OR (auth.jwt()->>'user_role') = 'super_admin')
  );


-- ── 7. Functions nobody outside the database should call ────
--
-- Supabase grants EXECUTE on new public functions to anon and authenticated
-- explicitly, so "REVOKE ... FROM PUBLIC" alone never took these away.
--
--   custom_access_token_hook   the Auth server's hook. Callable by anyone, it
--                              mapped an auth user id to their employee id and
--                              role (reproduced as anon). Supabase's own
--                              guidance is to revoke it from these roles.
--   open_value_coin_wallet     internal helpers of the Value Coin functions,
--   refresh_value_coin_budget  callable for ANY employee id, by anon.
--   app_config_text            read any app_config row, bypassing its RLS
--   value_coin_setting         (reproduced: anon reading the signup domains).
--
-- All four are only ever called from SECURITY DEFINER functions and triggers,
-- which run as the owner and are unaffected.

REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook(jsonb)     TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.open_value_coin_wallet(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_value_coin_budget(uuid)     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.app_config_text(text, text)         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.value_coin_setting(text, integer)   FROM PUBLIC, anon, authenticated;


-- ── 8. The signup check does not reveal an account's role ───
--
-- check_signup_eligibility() is callable before sign-in, by design. For an
-- address that is already registered it also returned that account's role, so
-- anyone could look up whether an address belongs to a Super Admin. The sign-up
-- page reads expected_role only for 'invited'. Otherwise reproduced verbatim
-- from 015.

CREATE OR REPLACE FUNCTION public.check_signup_eligibility(p_email text, p_full_name text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  emp  employees%ROWTYPE;
  mail text := lower(btrim(p_email));
BEGIN
  -- No administrator yet: whoever signs up next becomes one, whatever else is
  -- already in the table.
  IF NOT public.has_usable_admin() THEN
    RETURN jsonb_build_object('status', 'first_admin', 'expected_role', 'super_admin');
  END IF;

  IF mail IS NULL OR mail = '' THEN
    RETURN jsonb_build_object('status', 'open', 'expected_role', 'employee');
  END IF;

  SELECT * INTO emp FROM employees WHERE lower(email) = mail LIMIT 1;

  IF emp.id IS NULL THEN
    IF NOT public.signup_domain_allowed(mail) THEN
      RETURN jsonb_build_object('status', 'domain_blocked', 'expected_role', NULL);
    END IF;
    RETURN jsonb_build_object('status', 'open', 'expected_role', 'employee');
  END IF;

  IF NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'inactive', 'expected_role', NULL);
  END IF;

  IF emp.auth_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_registered', 'expected_role', NULL);
  END IF;

  IF p_full_name IS NULL
     OR lower(regexp_replace(btrim(emp.full_name), '\s+', ' ', 'g'))
        IS DISTINCT FROM lower(regexp_replace(btrim(p_full_name), '\s+', ' ', 'g'))
  THEN
    RETURN jsonb_build_object('status', 'name_mismatch', 'expected_role', NULL);
  END IF;

  RETURN jsonb_build_object('status', 'invited', 'expected_role', emp.role);
END;
$fn$;


-- ── 9. The daily per-colleague coin cap under concurrency ───
--
-- send_value_coins() added up today's tips BEFORE taking the wallet locks, so
-- two sends from two tabs could both read the same total and together pass
-- the cap. The budget itself was always safe (read after the lock). The sum is
-- now taken after the locks, where concurrent sends by the same person are
-- already serialised. Otherwise reproduced verbatim from 050.

CREATE OR REPLACE FUNCTION public.send_value_coins(
  p_recipient_id  UUID,
  p_amount        INTEGER,
  p_nomination_id UUID,
  p_note          TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me            UUID := (auth.jwt()->>'employee_id')::uuid;
  first_lock    UUID;
  second_lock   UUID;
  my_budget     INTEGER;
  max_per_tip   INTEGER := public.value_coin_setting('value_coin_max_per_recognition', 0);
  max_per_day   INTEGER := public.value_coin_setting('value_coin_max_per_person_per_day', 0);
  sent_today    INTEGER;
  nom           RECORD;
  sender_name   TEXT;
  clean_note    TEXT;
  tx_id         UUID;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'No employee on this session.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Enter how many Value Coins to send.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_recipient_id = me THEN
    RAISE EXCEPTION 'You cannot send Value Coins to yourself.' USING ERRCODE = 'check_violation';
  END IF;

  -- A limit of 0 is no limit. Stated once, here and below, rather than
  -- re-decided by every caller.
  IF max_per_tip > 0 AND p_amount > max_per_tip THEN
    RAISE EXCEPTION 'The most you can send on one recognition is %.', max_per_tip
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT id, nominee_id, status INTO nom FROM nominations WHERE id = p_nomination_id;

  IF NOT FOUND OR nom.status <> 'approved' THEN
    RAISE EXCEPTION 'That recognition is not open for Value Coins.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF nom.nominee_id <> p_recipient_id THEN
    RAISE EXCEPTION 'Value Coins go to the person the recognition is about.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM employees WHERE id = p_recipient_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That colleague is no longer active.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.open_value_coin_wallet(me);
  PERFORM public.open_value_coin_wallet(p_recipient_id);
  PERFORM public.refresh_value_coin_budget(me);

  first_lock  := LEAST(me, p_recipient_id);
  second_lock := GREATEST(me, p_recipient_id);

  PERFORM 1 FROM value_coin_wallets WHERE employee_id = first_lock  FOR UPDATE;
  PERFORM 1 FROM value_coin_wallets WHERE employee_id = second_lock FOR UPDATE;

  /*
    The daily ceiling, counted ACROSS recognitions.

    Per sender and per recipient, not per post — the thing it is there to stop
    is one person funnelling their whole budget to one colleague, and doing it
    across four of that colleague's recognitions is the same thing. Counted
    after the locks (057) so a concurrent send is already in the total.
  */
  IF max_per_day > 0 THEN
    SELECT COALESCE(SUM(amount), 0) INTO sent_today
      FROM value_coin_transactions
     WHERE sender_id = me
       AND recipient_id = p_recipient_id
       AND kind = 'recognition_tip'
       AND created_at >= date_trunc('day', now());

    IF sent_today + p_amount > max_per_day THEN
      RAISE EXCEPTION
        'You can send one colleague % Value Coins a day. You have sent % today.',
        max_per_day, sent_today
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  SELECT budget_balance INTO my_budget FROM value_coin_wallets WHERE employee_id = me;

  IF COALESCE(my_budget, 0) < p_amount THEN
    RAISE EXCEPTION
      'Your recognition budget is % Value Coins, which is not enough to send %.',
      COALESCE(my_budget, 0), p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  clean_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF clean_note IS NOT NULL AND char_length(clean_note) > 200 THEN
    clean_note := left(clean_note, 200);
  END IF;

  -- The budget pays; the earned balance receives. The two never meet.
  UPDATE value_coin_wallets
     SET budget_balance = budget_balance - p_amount, updated_at = now()
   WHERE employee_id = me;

  UPDATE value_coin_wallets
     SET earned_balance = earned_balance + p_amount, updated_at = now()
   WHERE employee_id = p_recipient_id;

  INSERT INTO value_coin_transactions
    (sender_id, recipient_id, amount, nomination_id, kind, effect, account, note)
  VALUES
    (me, p_recipient_id, p_amount, p_nomination_id, 'recognition_tip',
     'credit', 'earned', clean_note)
  RETURNING id INTO tx_id;

  SELECT full_name INTO sender_name FROM employees WHERE id = me;

  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  SELECT
    p_recipient_id,
    'value_coins_received',
    COALESCE(sender_name, 'A colleague') || ' sent you ' || p_amount || ' Value Coins',
    COALESCE(sender_name, 'A colleague') || ' sent ' || p_amount
      || ' Value Coins on a recognition you received.'
      || COALESCE(' "' || clean_note || '"', ''),
    p_nomination_id,
    'nomination'
  FROM employees e
  WHERE e.id = p_recipient_id
    AND e.auth_user_id IS NOT NULL;

  SELECT budget_balance INTO my_budget FROM value_coin_wallets WHERE employee_id = me;

  RETURN json_build_object(
    'transaction_id', tx_id,
    'amount', p_amount,
    'budget', my_budget
  );
END;
$fn$;
