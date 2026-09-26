-- ============================================================
-- 050 — THE RECOGNITION BUDGET
--
-- 048 gave every employee one balance that did two jobs: it held the coins
-- colleagues sent them, and it was what they spent when sending. That makes
-- recognition self-financing, and self-financing recognition is not scarce.
-- "Recognise me and I'll recognise you" refills both wallets, and a budget
-- nobody can run out of is not a budget.
--
-- TWO BALANCES
-- ------------
--   budget_balance   what you may GIVE. Topped up each period, optionally
--                    forfeited at the reset, never received into.
--   earned_balance   what colleagues SENT you. Never resets, never expires,
--                    and never spendable as recognition.
--
-- Sending debits the sender's BUDGET and credits the recipient's EARNED, so
-- the two pools never feed each other. That separation is the whole mechanic:
-- it is what makes "who genuinely made a difference?" a question with a cost,
-- and it is what makes an expiry rule safe — forfeiting an unused budget can
-- never touch a coin anybody earned.
--
-- WHAT HR CONTROLS
-- ----------------
--   value_coin_signup_grant             earned coins a new joiner starts with
--   value_coin_monthly_allowance        budget granted each period
--   value_coin_max_per_recognition      ceiling on a single send
--   value_coin_max_per_person_per_day   ceiling on what one person may send
--                                       to one colleague in a day
--   value_coin_allowance_reset_day      day of the month the period turns
--   value_coin_allowance_carry_over     whether an unused budget survives it
--
-- A limit of 0 means NO LIMIT, consistently, for both ceilings. That is a
-- choice worth stating: the alternative is NULL, and a nullable limit invites
-- every caller to decide for itself what a missing row means.
--
-- THE TOP-UP IS LAZY
-- ------------------
-- No scheduler. A wallet's budget is refreshed when it is read or spent, by
-- comparing the period stamped on it against the period we are in now. A
-- cron job that fails silently leaves an organisation with no budgets and
-- nothing to notice it by; this cannot drift, because the thing that needs
-- the budget is the thing that refreshes it.
--
-- One period's top-up, never arrears. Somebody returning after three months
-- away gets this period's budget, not three. A budget is permission to
-- recognise people now, not a salary that accrued while they were gone.
-- ============================================================


-- ── 1. The knobs ────────────────────────────────────────────

INSERT INTO app_config (key, value, description) VALUES
  ('value_coin_monthly_allowance', '500'::jsonb,
   'Value Coins added to every employee''s recognition budget each period.'),
  ('value_coin_max_per_recognition', '100'::jsonb,
   'Most Value Coins that may be sent on one recognition. 0 means no limit.'),
  ('value_coin_max_per_person_per_day', '200'::jsonb,
   'Most Value Coins one employee may send to one colleague in a day. 0 means no limit.'),
  ('value_coin_allowance_reset_day', '1'::jsonb,
   'Day of the month the recognition budget resets (1-28).'),
  ('value_coin_allowance_carry_over', '0'::jsonb,
   'Whether an unused budget survives the reset. 1 carries over, 0 forfeits it.')
ON CONFLICT (key) DO NOTHING;

UPDATE app_config
   SET description = 'Value Coins a new employee starts with, in their EARNED balance, once.'
 WHERE key = 'value_coin_signup_grant';


/*
  One reader for all of them.

  Every function below needs these numbers and none of them should carry its
  own COALESCE and its own idea of the default — that is how two functions
  end up disagreeing about what a missing row means.
*/
CREATE OR REPLACE FUNCTION public.value_coin_setting(p_key TEXT, p_default INTEGER)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    (SELECT (value #>> '{}')::integer FROM app_config WHERE key = p_key),
    p_default
  );
$fn$;

REVOKE ALL ON FUNCTION public.value_coin_setting(TEXT, INTEGER) FROM PUBLIC;


/*
  The first day of the period we are in.

  Reset day 1 means calendar months. Any other day means the period runs from
  that date to the same date next month — so with a reset day of 15, the 14th
  of March belongs to the period that began on 15 February.

  Clamped to 1-28 because 29, 30 and 31 do not exist in every month, and a
  reset day that silently skips February is a budget that silently skips
  February.
*/
CREATE OR REPLACE FUNCTION public.value_coin_period_start()
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  reset_day INTEGER := LEAST(GREATEST(
    public.value_coin_setting('value_coin_allowance_reset_day', 1), 1), 28);
  candidate DATE;
BEGIN
  candidate := (date_trunc('month', now())::date + (reset_day - 1));

  IF candidate > now()::date THEN
    candidate := ((date_trunc('month', now()) - INTERVAL '1 month')::date + (reset_day - 1));
  END IF;

  RETURN candidate;
END;
$fn$;

REVOKE ALL ON FUNCTION public.value_coin_period_start() FROM PUBLIC;


-- ── 2. The wallet grows a second balance ────────────────────

-- Guarded so the file can be run again. A failed push rolls the whole
-- migration back, but a rename that only works once makes a retry fail on a
-- column that is already gone -- and this file just had to be retried.
DO $rename$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'value_coin_wallets'
       AND column_name = 'balance'
  ) THEN
    ALTER TABLE value_coin_wallets RENAME COLUMN balance TO earned_balance;
  END IF;
END;
$rename$;

ALTER TABLE value_coin_wallets
  ADD COLUMN IF NOT EXISTS budget_balance INTEGER NOT NULL DEFAULT 0,
  /* The period this budget belongs to. Comparing it against
     value_coin_period_start() is the whole of the top-up decision. */
  ADD COLUMN IF NOT EXISTS budget_period_start DATE;

ALTER TABLE value_coin_wallets
  DROP CONSTRAINT IF EXISTS value_coin_wallets_budget_not_overdrawn;
ALTER TABLE value_coin_wallets
  ADD CONSTRAINT value_coin_wallets_budget_not_overdrawn CHECK (budget_balance >= 0);


-- ── 3. The ledger learns the new movements ──────────────────
--
-- `effect` and `account` exist because a ledger row now has to answer two
-- questions it did not before: which way did the coins go, and which of the
-- two balances moved.
--
-- A TIP answers both from its parties: sender's budget out, recipient's
-- earned in, one row. Every other kind has a single party, so the row has to
-- say for itself — and without `effect` an expiry would render in the wallet
-- as a credit, because the employee is its recipient.

ALTER TABLE value_coin_transactions
  ADD COLUMN IF NOT EXISTS effect TEXT NOT NULL DEFAULT 'credit',
  ADD COLUMN IF NOT EXISTS account TEXT NOT NULL DEFAULT 'earned';

ALTER TABLE value_coin_transactions
  DROP CONSTRAINT IF EXISTS value_coin_transactions_effect_check;
ALTER TABLE value_coin_transactions
  ADD CONSTRAINT value_coin_transactions_effect_check
  CHECK (effect IN ('credit', 'debit'));

ALTER TABLE value_coin_transactions
  DROP CONSTRAINT IF EXISTS value_coin_transactions_account_check;
ALTER TABLE value_coin_transactions
  ADD CONSTRAINT value_coin_transactions_account_check
  CHECK (account IN ('budget', 'earned'));

ALTER TABLE value_coin_transactions DROP CONSTRAINT IF EXISTS value_coin_transactions_kind_check;
ALTER TABLE value_coin_transactions
  ADD CONSTRAINT value_coin_transactions_kind_check
  CHECK (kind IN (
    'signup_grant',       -- the welcome coins, into earned
    'recognition_tip',    -- a send: sender's budget out, recipient's earned in
    'monthly_allowance',  -- the periodic top-up, into budget
    'allowance_expired',  -- an unused budget forfeited at the reset
    'admin_adjustment'    -- HR or a Super Admin moving a balance by hand
  ));

-- A tip has two parties; everything else has one.
ALTER TABLE value_coin_transactions DROP CONSTRAINT IF EXISTS value_coin_transactions_parties;
ALTER TABLE value_coin_transactions
  ADD CONSTRAINT value_coin_transactions_parties CHECK (
    (kind = 'recognition_tip'
      AND sender_id IS NOT NULL
      AND sender_id <> recipient_id)
    OR (kind <> 'recognition_tip'
      AND sender_id IS NULL
      AND nomination_id IS NULL)
  );

-- Existing rows predate the columns and their defaults are right for them:
-- every signup_grant was a credit to earned, every tip a credit of earned to
-- its recipient. Stated rather than assumed.
UPDATE value_coin_transactions
   SET effect = 'credit', account = 'earned'
 WHERE kind IN ('signup_grant', 'recognition_tip');


-- ── 4. Opening a wallet: an earned gift and a first budget ──

CREATE OR REPLACE FUNCTION public.open_value_coin_wallet(p_employee_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  grant_amount  INTEGER := public.value_coin_setting('value_coin_signup_grant', 500);
  allowance     INTEGER := public.value_coin_setting('value_coin_monthly_allowance', 500);
  period        DATE    := public.value_coin_period_start();
  opened        UUID;
BEGIN
  INSERT INTO value_coin_wallets
    (employee_id, earned_balance, budget_balance, budget_period_start, granted_at)
  VALUES
    (p_employee_id, grant_amount, allowance, period, now())
  ON CONFLICT (employee_id) DO NOTHING
  RETURNING employee_id INTO opened;

  -- Already had a wallet. Nothing granted, nothing recorded.
  IF opened IS NULL THEN
    RETURN 0;
  END IF;

  IF grant_amount > 0 THEN
    INSERT INTO value_coin_transactions
      (recipient_id, amount, kind, effect, account, note)
    VALUES
      (p_employee_id, grant_amount, 'signup_grant', 'credit', 'earned', 'Welcome grant');
  END IF;

  IF allowance > 0 THEN
    INSERT INTO value_coin_transactions
      (recipient_id, amount, kind, effect, account, note)
    VALUES
      (p_employee_id, allowance, 'monthly_allowance', 'credit', 'budget',
       'Recognition budget');
  END IF;

  RETURN grant_amount;
END;
$fn$;

REVOKE ALL ON FUNCTION public.open_value_coin_wallet(UUID) FROM PUBLIC;


-- ── 5. The top-up ───────────────────────────────────────────
--
-- Called before any read of a budget and before any spend of one, so the
-- number a person sees and the number they are allowed to spend are the same
-- number. Writes nothing when the wallet is already in the current period,
-- which is almost every call.

CREATE OR REPLACE FUNCTION public.refresh_value_coin_budget(p_employee_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  period     DATE    := public.value_coin_period_start();
  allowance  INTEGER := public.value_coin_setting('value_coin_monthly_allowance', 500);
  carry_over BOOLEAN := public.value_coin_setting('value_coin_allowance_carry_over', 0) <> 0;
  w          RECORD;
  forfeited  INTEGER := 0;
BEGIN
  SELECT employee_id, budget_balance, budget_period_start
    INTO w
    FROM value_coin_wallets
   WHERE employee_id = p_employee_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Already this period. The common path writes nothing at all.
  IF w.budget_period_start IS NOT NULL AND w.budget_period_start >= period THEN
    RETURN;
  END IF;

  IF NOT carry_over THEN
    forfeited := GREATEST(w.budget_balance, 0);
  END IF;

  UPDATE value_coin_wallets
     SET budget_balance = CASE WHEN carry_over
                               THEN budget_balance + allowance
                               ELSE allowance
                          END,
         budget_period_start = period,
         updated_at = now()
   WHERE employee_id = p_employee_id;

  /* The forfeiture is recorded, not merely performed. An employee who had 180
     coins and now has 500 is owed an explanation of where the 180 went, and
     "the budget reset" is only an explanation if it is written down. */
  IF forfeited > 0 THEN
    INSERT INTO value_coin_transactions
      (recipient_id, amount, kind, effect, account, note)
    VALUES
      (p_employee_id, forfeited, 'allowance_expired', 'debit', 'budget',
       'Unused budget at the reset');
  END IF;

  IF allowance > 0 THEN
    INSERT INTO value_coin_transactions
      (recipient_id, amount, kind, effect, account, note)
    VALUES
      (p_employee_id, allowance, 'monthly_allowance', 'credit', 'budget',
       'Recognition budget');
  END IF;
END;
$fn$;

REVOKE ALL ON FUNCTION public.refresh_value_coin_budget(UUID) FROM PUBLIC;


-- ── 6. What the employee's own screens read ─────────────────

DROP FUNCTION IF EXISTS public.ensure_my_value_coin_wallet();

/*
  The caller's wallet: both balances, the limits that apply to them, and when
  the budget next turns.

  Returns the LIMITS as well, which is why app_config's HR-only read policy is
  not in the way: an employee never reads that table, they read this, and this
  runs as its owner. The alternative — opening app_config to everyone so a
  popover can say "max 100" — would widen a table of operational settings to
  answer a question about one screen.
*/
CREATE OR REPLACE FUNCTION public.ensure_my_value_coin_wallet()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me     UUID := (auth.jwt()->>'employee_id')::uuid;
  w      RECORD;
  period DATE := public.value_coin_period_start();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'No employee on this session.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public.open_value_coin_wallet(me);
  PERFORM public.refresh_value_coin_budget(me);

  SELECT earned_balance, budget_balance, budget_period_start
    INTO w
    FROM value_coin_wallets
   WHERE employee_id = me;

  RETURN json_build_object(
    'budget', COALESCE(w.budget_balance, 0),
    'earned', COALESCE(w.earned_balance, 0),
    'period_start', period,
    'period_end', (period + INTERVAL '1 month')::date,
    'monthly_allowance', public.value_coin_setting('value_coin_monthly_allowance', 500),
    'max_per_recognition', public.value_coin_setting('value_coin_max_per_recognition', 0),
    'max_per_person_per_day', public.value_coin_setting('value_coin_max_per_person_per_day', 0),
    'carry_over', public.value_coin_setting('value_coin_allowance_carry_over', 0) <> 0
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.ensure_my_value_coin_wallet() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_value_coin_wallet() TO authenticated;


-- ── 7. Sending, now against a budget ────────────────────────

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

  /*
    The daily ceiling, counted ACROSS recognitions.

    Per sender and per recipient, not per post — the thing it is there to stop
    is one person funnelling their whole budget to one colleague, and doing it
    across four of that colleague's recognitions is the same thing.
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

  first_lock  := LEAST(me, p_recipient_id);
  second_lock := GREATEST(me, p_recipient_id);

  PERFORM 1 FROM value_coin_wallets WHERE employee_id = first_lock  FOR UPDATE;
  PERFORM 1 FROM value_coin_wallets WHERE employee_id = second_lock FOR UPDATE;

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

REVOKE ALL ON FUNCTION public.send_value_coins(UUID, INTEGER, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_value_coins(UUID, INTEGER, UUID, TEXT) TO authenticated;


-- ── 8. HR and Super Admin over everyone's wallets ───────────
--
-- The role is re-derived from `employees` inside each function rather than
-- read off the JWT. A claim is what the token says; the table is what is
-- true, and these two functions can move any balance in the organisation.

CREATE OR REPLACE FUNCTION public.admin_list_value_coin_wallets(
  p_search TEXT DEFAULT NULL,
  p_limit  INTEGER DEFAULT 50
)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor      UUID := (auth.jwt()->>'employee_id')::uuid;
  actor_role TEXT;
  term       TEXT := NULLIF(btrim(COALESCE(p_search, '')), '');
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor;

  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only HR and a Super Admin can review Value Coin wallets.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT json_agg(row_to_json(r) ORDER BY r.full_name)
      FROM (
        SELECT
          e.id            AS employee_id,
          e.full_name,
          e.employee_id   AS employee_code,
          e.email,
          e.role,
          e.is_active,
          COALESCE(w.budget_balance, 0)  AS budget_balance,
          COALESCE(w.earned_balance, 0)  AS earned_balance,
          w.budget_period_start
        FROM employees e
        LEFT JOIN value_coin_wallets w ON w.employee_id = e.id
        WHERE term IS NULL
           OR e.full_name ILIKE '%' || term || '%'
           OR e.email ILIKE '%' || term || '%'
           OR e.employee_id ILIKE '%' || term || '%'
        ORDER BY e.full_name
        LIMIT GREATEST(LEAST(COALESCE(p_limit, 50), 200), 1)
      ) r
  ), '[]'::json);
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_list_value_coin_wallets(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_list_value_coin_wallets(TEXT, INTEGER) TO authenticated;


/*
  Move one employee's balance by hand.

  A DELTA, not a new total. An administrator looking at a number and typing a
  different one is making a decision based on what they last loaded, and two
  of them doing it at once means the second silently discards the first. "Add
  200" composes; "set to 700" does not.

  A reason is required and it is not decoration: this is the one path by which
  coins appear or vanish without anybody having recognised anybody, so the
  ledger row and the audit entry both carry why.
*/
CREATE OR REPLACE FUNCTION public.admin_adjust_value_coin_wallet(
  p_employee_id UUID,
  p_account     TEXT,
  p_delta       INTEGER,
  p_reason      TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor      UUID := (auth.jwt()->>'employee_id')::uuid;
  actor_role TEXT;
  reason     TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  before     RECORD;
  after      RECORD;
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor;

  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only HR and a Super Admin can adjust Value Coin wallets.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_account NOT IN ('budget', 'earned') THEN
    RAISE EXCEPTION 'Adjust either the budget or the earned balance.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_delta IS NULL OR p_delta = 0 THEN
    RAISE EXCEPTION 'Enter how many Value Coins to add or remove.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason for this adjustment.' USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.open_value_coin_wallet(p_employee_id);

  SELECT budget_balance, earned_balance INTO before
    FROM value_coin_wallets WHERE employee_id = p_employee_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That employee has no Value Coin wallet.' USING ERRCODE = 'no_data_found';
  END IF;

  -- Refused here with a sentence rather than left to the CHECK constraint,
  -- which would surface as an unreadable violation.
  IF p_account = 'budget' AND before.budget_balance + p_delta < 0 THEN
    RAISE EXCEPTION 'That would take the budget below zero. It is currently %.',
      before.budget_balance USING ERRCODE = 'check_violation';
  END IF;

  IF p_account = 'earned' AND before.earned_balance + p_delta < 0 THEN
    RAISE EXCEPTION 'That would take the earned balance below zero. It is currently %.',
      before.earned_balance USING ERRCODE = 'check_violation';
  END IF;

  IF p_account = 'budget' THEN
    UPDATE value_coin_wallets
       SET budget_balance = budget_balance + p_delta, updated_at = now()
     WHERE employee_id = p_employee_id;
  ELSE
    UPDATE value_coin_wallets
       SET earned_balance = earned_balance + p_delta, updated_at = now()
     WHERE employee_id = p_employee_id;
  END IF;

  INSERT INTO value_coin_transactions
    (recipient_id, amount, kind, effect, account, note)
  VALUES
    (p_employee_id, abs(p_delta), 'admin_adjustment',
     CASE WHEN p_delta > 0 THEN 'credit' ELSE 'debit' END,
     p_account, reason);

  SELECT budget_balance, earned_balance INTO after
    FROM value_coin_wallets WHERE employee_id = p_employee_id;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    actor,
    lower(btrim(auth.jwt()->>'email')),
    'value_coins.adjusted',
    'employee',
    p_employee_id,
    jsonb_build_object('budget', before.budget_balance, 'earned', before.earned_balance),
    jsonb_build_object(
      'budget', after.budget_balance,
      'earned', after.earned_balance,
      'account', p_account,
      'delta', p_delta,
      'reason', reason,
      '_actor_role', actor_role
    )
  );

  RETURN json_build_object(
    'budget_balance', after.budget_balance,
    'earned_balance', after.earned_balance
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.admin_adjust_value_coin_wallet(UUID, TEXT, INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_adjust_value_coin_wallet(UUID, TEXT, INTEGER, TEXT) TO authenticated;


-- ── 9. The activity view learns direction and account ───────

-- DROPPED and recreated, not replaced. CREATE OR REPLACE VIEW matches the new
-- column list against the old one BY POSITION and accepts only additions at
-- the END -- inserting `account` in the middle, as this does, reads to
-- Postgres as renaming `direction` to `account`, and is refused.
--
-- Dropping is safe here: nothing but the wallet screen selects from this
-- view, and no view, function or policy depends on it. The GRANT below is
-- what puts the privileges back, since a DROP takes them with it.

DROP VIEW IF EXISTS v_value_coin_activity;

CREATE VIEW v_value_coin_activity AS
SELECT
  t.id,
  t.created_at,
  t.amount,
  t.kind,
  t.note,
  t.nomination_id,
  t.account,

  /*
    A tip's direction comes from WHICH SIDE the reader is on; every other
    kind has one party, so the row's own `effect` says it. Without this an
    expiry would render as a credit, the employee being its recipient.
  */
  CASE
    WHEN t.sender_id IS NOT NULL THEN
      CASE WHEN t.recipient_id = (auth.jwt()->>'employee_id')::uuid THEN 'in' ELSE 'out' END
    WHEN t.effect = 'debit' THEN 'out'
    ELSE 'in'
  END AS direction,

  CASE WHEN t.recipient_id = (auth.jwt()->>'employee_id')::uuid
       THEN t.sender_id ELSE t.recipient_id END       AS counterparty_id,
  CASE WHEN t.recipient_id = (auth.jwt()->>'employee_id')::uuid
       THEN sender.full_name ELSE recipient.full_name END   AS counterparty_name,
  CASE WHEN t.recipient_id = (auth.jwt()->>'employee_id')::uuid
       THEN sender.avatar_url ELSE recipient.avatar_url END AS counterparty_avatar,

  COALESCE(n.snapshot_core_value_name, cv.name) AS core_value_name,
  COALESCE(n.snapshot_project_name, p.name)     AS project_name,
  nominee.full_name                             AS nominee_name,
  nominator.full_name                           AS nominator_name

FROM value_coin_transactions t
LEFT JOIN employees sender     ON sender.id = t.sender_id
LEFT JOIN employees recipient  ON recipient.id = t.recipient_id
LEFT JOIN nominations n        ON n.id = t.nomination_id
LEFT JOIN core_values cv       ON cv.id = n.core_value_id
LEFT JOIN projects p           ON p.id = n.project_id
LEFT JOIN employees nominee    ON nominee.id = n.nominee_id
LEFT JOIN employees nominator  ON nominator.id = n.nominator_id

WHERE public.session_second_factor_ok()
  AND (
    t.recipient_id = (auth.jwt()->>'employee_id')::uuid
    OR t.sender_id = (auth.jwt()->>'employee_id')::uuid
  );

GRANT SELECT ON v_value_coin_activity TO authenticated;


-- ── 10. The wallet summary, over two balances ───────────────

CREATE OR REPLACE FUNCTION public.value_coin_summary()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me          UUID := (auth.jwt()->>'employee_id')::uuid;
  month_start DATE := date_trunc('month', now())::date;
  period      DATE;
  w           RECORD;
  result      JSON;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'No employee on this session.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Read and spend see the same budget: both go through the top-up first.
  PERFORM public.open_value_coin_wallet(me);
  PERFORM public.refresh_value_coin_budget(me);

  period := public.value_coin_period_start();

  SELECT budget_balance, earned_balance INTO w
    FROM value_coin_wallets WHERE employee_id = me;

  SELECT json_build_object(
    'budget', COALESCE(w.budget_balance, 0),
    'earned', COALESCE(w.earned_balance, 0),
    'monthly_allowance', public.value_coin_setting('value_coin_monthly_allowance', 500),
    'max_per_recognition', public.value_coin_setting('value_coin_max_per_recognition', 0),
    'max_per_person_per_day', public.value_coin_setting('value_coin_max_per_person_per_day', 0),
    'carry_over', public.value_coin_setting('value_coin_allowance_carry_over', 0) <> 0,
    'period_start', period,
    'period_end', (period + INTERVAL '1 month')::date,

    'received_this_month', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE recipient_id = me AND kind = 'recognition_tip' AND created_at >= month_start
    ), 0),

    'given_this_month', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE sender_id = me AND created_at >= month_start
    ), 0),

    'received_total', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE recipient_id = me AND kind = 'recognition_tip'
    ), 0),

    'given_total', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions WHERE sender_id = me
    ), 0),

    'granted_total', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE recipient_id = me AND kind = 'signup_grant'
    ), 0),

    'recognitions_earning_total', COALESCE((
      SELECT COUNT(DISTINCT nomination_id) FROM value_coin_transactions
       WHERE recipient_id = me AND kind = 'recognition_tip' AND nomination_id IS NOT NULL
    ), 0),

    'recognitions_earning_this_month', COALESCE((
      SELECT COUNT(DISTINCT nomination_id) FROM value_coin_transactions
       WHERE recipient_id = me AND kind = 'recognition_tip'
         AND nomination_id IS NOT NULL AND created_at >= month_start
    ), 0),

    'months', COALESCE((
      SELECT json_agg(m ORDER BY m.month)
        FROM (
          SELECT
            d.month::date AS month,
            COALESCE((
              SELECT SUM(t.amount) FROM value_coin_transactions t
               WHERE t.recipient_id = me AND t.kind = 'recognition_tip'
                 AND t.created_at >= d.month
                 AND t.created_at < d.month + INTERVAL '1 month'
            ), 0)::integer AS received,
            COALESCE((
              SELECT SUM(t.amount) FROM value_coin_transactions t
               WHERE t.sender_id = me
                 AND t.created_at >= d.month
                 AND t.created_at < d.month + INTERVAL '1 month'
            ), 0)::integer AS given
          FROM generate_series(
            date_trunc('month', now()) - INTERVAL '5 months',
            date_trunc('month', now()),
            INTERVAL '1 month'
          ) AS d(month)
        ) m
    ), '[]'::json)
  ) INTO result;

  RETURN result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.value_coin_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.value_coin_summary() TO authenticated;


-- ── 11. Existing wallets get a budget ───────────────────────
--
-- Everyone opened before this migration has an earned balance and no budget
-- at all, which would leave the whole organisation unable to send anything
-- until their next reset. They are put into the current period with a full
-- allowance, and the ledger says so.

DO $backfill$
DECLARE
  w          RECORD;
  allowance  INTEGER := public.value_coin_setting('value_coin_monthly_allowance', 500);
  period     DATE    := public.value_coin_period_start();
BEGIN
  FOR w IN SELECT employee_id FROM value_coin_wallets WHERE budget_period_start IS NULL LOOP
    UPDATE value_coin_wallets
       SET budget_balance = allowance,
           budget_period_start = period,
           updated_at = now()
     WHERE employee_id = w.employee_id;

    IF allowance > 0 THEN
      INSERT INTO value_coin_transactions
        (recipient_id, amount, kind, effect, account, note)
      VALUES
        (w.employee_id, allowance, 'monthly_allowance', 'credit', 'budget',
         'Recognition budget');
    END IF;
  END LOOP;
END;
$backfill$;
