-- ============================================================
-- 051 — THE VALUE STORE
--
-- The last link in the loop: recognise → coins → wallet → store → reward.
--
-- WHAT WAS ALREADY HERE
-- ---------------------
-- `rewards` (005) is an HR catalogue — name, description, frequency,
-- eligibility text, a value description and requires_approval. HR could
-- create and edit them and nothing else ever read the table.
--
-- `reward_assignments` (005) was built for HR to hand a reward to somebody:
-- reward, employee, who assigned it, an optional nomination and a note. It
-- has no status, no price and no approver, and in the whole codebase nothing
-- ever inserted a row into it.
--
-- So this migration EXTENDS both rather than building a second reward system
-- beside them. A redemption is a reward_assignment that the employee raised
-- themselves, and the columns added below are the ones that shape is missing.
--
-- TWO BALANCES, AND ONLY ONE OF THEM BUYS
-- ---------------------------------------
-- 050 split the wallet into a budget (what you may GIVE) and an earned
-- balance (what colleagues SENT you). A redemption spends EARNED and only
-- earned. redeem_reward() reads and writes `earned_balance` and never names
-- `budget_balance` at all, so spending a giving budget on a reward is not a
-- thing this schema can express.
--
-- PRICE IS HISTORY, NOT A LOOKUP
-- ------------------------------
-- The cost is COPIED onto the assignment at redemption, alongside the
-- reward's name. HR raising the Coffee Voucher from 500 to 750 must not
-- rewrite what somebody already paid, and a refund must return the amount
-- actually taken. Nothing downstream recomputes a price from `rewards`.
--
-- The name is snapshotted for the same reason and by the same precedent as
-- nominations.snapshot_core_value_name (003): a redemption of a reward HR
-- later deletes or deactivates still has to say what it was for.
-- ============================================================


-- ── 1. The catalogue gains a price and a shelf ──────────────

ALTER TABLE rewards
  ADD COLUMN IF NOT EXISTS coin_price INTEGER NOT NULL DEFAULT 0,
  /* Which part of the store it sits in. Free text with a CHECK rather than an
     enum type, so HR can be given a new shelf by one ALTER rather than by a
     type migration and a cast. */
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'everyday';

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS rewards_coin_price_check;
ALTER TABLE rewards ADD CONSTRAINT rewards_coin_price_check
  CHECK (coin_price >= 0);

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS rewards_category_check;
ALTER TABLE rewards ADD CONSTRAINT rewards_category_check
  CHECK (category IN ('everyday', 'experiences', 'learning', 'wellness', 'recognition'));

/*
  Employees may read the ACTIVE catalogue.

  Until now `rewards_hr_full` was the only policy, so the table was invisible
  to the people the rewards are for. This adds the store's read and nothing
  more: an inactive reward stays out of sight, and HR keeps the full view
  through their own policy, which is OR-ed with this one for SELECT.
*/
DROP POLICY IF EXISTS "rewards_read_active" ON rewards;
CREATE POLICY "rewards_read_active" ON rewards
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND is_active
  );


-- ── 2. An assignment learns to be a redemption ──────────────
--
-- `assigned_by` stays NOT NULL and, for a redemption, holds the employee
-- themselves. That is accurate rather than a fudge: they are who caused the
-- row. `origin` is what tells the two cases apart, so neither has to be
-- inferred from which columns happen to be null.

ALTER TABLE reward_assignments
  ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT 'hr_assignment',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved',
  /* The price PAID, copied at redemption. Null for an HR hand-out, which
     costs the employee nothing. */
  ADD COLUMN IF NOT EXISTS coin_cost INTEGER,
  /* What the reward was called at the time. */
  ADD COLUMN IF NOT EXISTS reward_name_snapshot TEXT,
  ADD COLUMN IF NOT EXISTS decided_by_id UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS decision_reason TEXT,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ;

ALTER TABLE reward_assignments DROP CONSTRAINT IF EXISTS reward_assignments_origin_check;
ALTER TABLE reward_assignments ADD CONSTRAINT reward_assignments_origin_check
  CHECK (origin IN ('hr_assignment', 'redemption'));

ALTER TABLE reward_assignments DROP CONSTRAINT IF EXISTS reward_assignments_status_check;
ALTER TABLE reward_assignments ADD CONSTRAINT reward_assignments_status_check
  CHECK (status IN ('pending', 'approved', 'rejected'));

ALTER TABLE reward_assignments DROP CONSTRAINT IF EXISTS reward_assignments_cost_check;
ALTER TABLE reward_assignments ADD CONSTRAINT reward_assignments_cost_check
  CHECK (coin_cost IS NULL OR coin_cost >= 0);

-- A redemption always records what it cost and what it was for; an HR
-- hand-out is never pending, because nobody is waiting to approve it.
ALTER TABLE reward_assignments DROP CONSTRAINT IF EXISTS reward_assignments_redemption_shape;
ALTER TABLE reward_assignments ADD CONSTRAINT reward_assignments_redemption_shape
  CHECK (
    origin = 'hr_assignment'
    OR (coin_cost IS NOT NULL AND reward_name_snapshot IS NOT NULL)
  );

-- A decision names its maker and its moment, together or not at all.
ALTER TABLE reward_assignments DROP CONSTRAINT IF EXISTS reward_assignments_decision_shape;
ALTER TABLE reward_assignments ADD CONSTRAINT reward_assignments_decision_shape
  CHECK ((decided_by_id IS NULL) = (decided_at IS NULL));

CREATE INDEX IF NOT EXISTS idx_reward_assignments_employee
  ON reward_assignments(employee_id, assigned_at DESC);

-- The HR queue reads exactly this: what is still waiting, oldest first.
CREATE INDEX IF NOT EXISTS idx_reward_assignments_pending
  ON reward_assignments(status, assigned_at)
  WHERE status = 'pending';


-- ── 3. The ledger learns two more movements ─────────────────

ALTER TABLE value_coin_transactions DROP CONSTRAINT IF EXISTS value_coin_transactions_kind_check;
ALTER TABLE value_coin_transactions
  ADD CONSTRAINT value_coin_transactions_kind_check
  CHECK (kind IN (
    'signup_grant',       -- the welcome coins, into earned
    'recognition_tip',    -- a send: sender's budget out, recipient's earned in
    'monthly_allowance',  -- the periodic top-up, into budget
    'allowance_expired',  -- an unused budget forfeited at the reset
    'admin_adjustment',   -- HR or a Super Admin moving a balance by hand
    -- Added by 051.
    'reward_redemption',  -- earned coins spent in the Value Store
    'reward_refund'       -- a rejected redemption, returned in full
  ));

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'nomination_submitted',
    'approval_required',
    'clarification_requested',
    'nomination_approved',
    'nomination_rejected',
    'recognition_received',
    'team_recognition_published',
    'badge_unlocked',
    'monthly_report_ready',
    'support_request_created',
    'support_request_resolved',
    'support_request_rejected',
    'recognition_commented',
    'comment_replied',
    'value_coins_received',
    -- Added by 051.
    'reward_requested',   -- to HR and Super Admins, when approval is needed
    'reward_approved',    -- to the employee
    'reward_rejected'     -- to the employee, with the reason
  ));


-- ── 4. Redeeming ────────────────────────────────────────────
--
-- NOTHING IS TRUSTED FROM THE CALLER except which reward they want. The
-- employee is the session's; the price, the active flag and whether approval
-- is needed are read here from `rewards`; the balance is read inside the
-- lock. A browser that posts a price, a balance or an employee id is posting
-- values this function does not accept.

CREATE OR REPLACE FUNCTION public.redeem_reward(p_reward_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me            UUID := (auth.jwt()->>'employee_id')::uuid;
  r             RECORD;
  my_earned     INTEGER;
  needs_ok      BOOLEAN;
  new_status    TEXT;
  assignment_id UUID;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'No employee on this session.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM 1 FROM employees WHERE id = me AND is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Your account is not active.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT id, name, coin_price, requires_approval, is_active
    INTO r
    FROM rewards
   WHERE id = p_reward_id;

  IF NOT FOUND OR NOT r.is_active THEN
    RAISE EXCEPTION 'That reward is not available.' USING ERRCODE = 'check_violation';
  END IF;

  IF r.coin_price <= 0 THEN
    RAISE EXCEPTION 'That reward has no Value Coin price set. Ask HR to price it.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.open_value_coin_wallet(me);

  /*
    THE LOCK IS THE WHOLE OF THE DOUBLE-SPEND DEFENCE.

    Two tabs pressing Redeem at the same instant both reach this line; one
    takes the row lock and the other waits behind it. The waiter then reads
    the balance AFTER the first has debited it, so it sees the real remainder
    and fails on the check below rather than spending the same coins twice.
    Disabling the button in the browser is a courtesy; this is the rule.
  */
  SELECT earned_balance INTO my_earned
    FROM value_coin_wallets
   WHERE employee_id = me
     FOR UPDATE;

  IF COALESCE(my_earned, 0) < r.coin_price THEN
    RAISE EXCEPTION
      'You have % earned Value Coins. % costs %.',
      COALESCE(my_earned, 0), r.name, r.coin_price
      USING ERRCODE = 'check_violation';
  END IF;

  needs_ok := r.requires_approval;
  new_status := CASE WHEN needs_ok THEN 'pending' ELSE 'approved' END;

  /*
    The coins leave NOW, whether or not HR still has to approve it.

    The alternative — hold the request and debit on approval — lets somebody
    queue five requests they can only afford one of, and leaves HR approving
    things that then fail. Taking the coins up front makes the request real.
    A rejection refunds them in full, as its own ledger row.
  */
  UPDATE value_coin_wallets
     SET earned_balance = earned_balance - r.coin_price,
         updated_at = now()
   WHERE employee_id = me;

  INSERT INTO reward_assignments (
    reward_id, employee_id, assigned_by, origin, status,
    coin_cost, reward_name_snapshot, fulfilled_at
  )
  VALUES (
    r.id, me, me, 'redemption', new_status,
    r.coin_price, r.name,
    CASE WHEN needs_ok THEN NULL ELSE now() END
  )
  RETURNING id INTO assignment_id;

  INSERT INTO value_coin_transactions
    (recipient_id, amount, kind, effect, account, note)
  VALUES
    (me, r.coin_price, 'reward_redemption', 'debit', 'earned', r.name);

  -- Everyone who can decide it is told there is something to decide.
  IF needs_ok THEN
    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    SELECT
      e.id,
      'reward_requested',
      'A reward request needs a decision',
      (SELECT full_name FROM employees WHERE id = me)
        || ' requested ' || r.name || ' for ' || r.coin_price || ' Value Coins.',
      assignment_id,
      'reward_assignment'
    FROM employees e
    WHERE e.role IN ('hr_admin', 'super_admin')
      AND e.is_active
      AND e.auth_user_id IS NOT NULL;
  END IF;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    me,
    lower(btrim(auth.jwt()->>'email')),
    'reward.redeemed',
    'reward_assignment',
    assignment_id,
    jsonb_build_object('earned_balance', my_earned),
    jsonb_build_object(
      'reward_id', r.id,
      'reward_name', r.name,
      'coin_cost', r.coin_price,
      'status', new_status,
      'earned_balance', my_earned - r.coin_price
    )
  );

  SELECT earned_balance INTO my_earned FROM value_coin_wallets WHERE employee_id = me;

  RETURN json_build_object(
    'redemption_id', assignment_id,
    'status', new_status,
    'coin_cost', r.coin_price,
    'reward_name', r.name,
    'earned', my_earned
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.redeem_reward(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_reward(UUID) TO authenticated;


-- ── 5. Approving or rejecting ───────────────────────────────

CREATE OR REPLACE FUNCTION public.decide_reward_redemption(
  p_redemption_id UUID,
  p_action        TEXT,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor       UUID := (auth.jwt()->>'employee_id')::uuid;
  actor_role  TEXT;
  actor_name  TEXT;
  req         RECORD;
  reason      TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The role comes from the table, not the token. A claim is what a session
  -- says; this decides whether coins move.
  SELECT role, full_name INTO actor_role, actor_name FROM employees WHERE id = actor;

  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only HR and a Super Admin can decide reward requests.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Approve or reject.' USING ERRCODE = 'check_violation';
  END IF;

  IF p_action = 'reject' AND reason IS NULL THEN
    RAISE EXCEPTION 'Give a reason for rejecting this request.'
      USING ERRCODE = 'check_violation';
  END IF;

  /*
    LOCK FIRST, THEN LOOK.

    HR and a Super Admin can both be looking at this queue. Whichever of them
    commits first holds this row; the second waits, then reads the status the
    first wrote and falls into the branch below. Exactly one decision lands,
    and the loser is told what actually happened rather than silently
    overwriting it.
  */
  SELECT id, employee_id, status, coin_cost, reward_name_snapshot
    INTO req
    FROM reward_assignments
   WHERE id = p_redemption_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That reward request no longer exists.' USING ERRCODE = 'no_data_found';
  END IF;

  IF req.status <> 'pending' THEN
    RAISE EXCEPTION 'That request was already %.', req.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_action = 'approve' THEN
    UPDATE reward_assignments
       SET status = 'approved',
           decided_by_id = actor,
           decided_at = now(),
           decision_reason = reason,
           fulfilled_at = now()
     WHERE id = req.id;

    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    SELECT
      req.employee_id,
      'reward_approved',
      'Your ' || req.reward_name_snapshot || ' was approved',
      COALESCE(actor_name, 'HR') || ' approved your reward request.'
        || COALESCE(' ' || reason, ''),
      req.id,
      'reward_assignment'
    FROM employees e
    WHERE e.id = req.employee_id AND e.auth_user_id IS NOT NULL;

  ELSE
    UPDATE reward_assignments
       SET status = 'rejected',
           decided_by_id = actor,
           decided_at = now(),
           decision_reason = reason
     WHERE id = req.id;

    /*
      The refund returns THE COIN COST RECORDED ON THE REQUEST, not the
      reward's price today. HR may have repriced it in between, and giving
      back a different number than was taken is how a balance stops being
      explainable by its own ledger.

      It is its own transaction, with its own reason, rather than a quiet
      correction of the redemption row.
    */
    UPDATE value_coin_wallets
       SET earned_balance = earned_balance + req.coin_cost,
           updated_at = now()
     WHERE employee_id = req.employee_id;

    INSERT INTO value_coin_transactions
      (recipient_id, amount, kind, effect, account, note)
    VALUES
      (req.employee_id, req.coin_cost, 'reward_refund', 'credit', 'earned',
       req.reward_name_snapshot || ' — request rejected, refunded');

    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    SELECT
      req.employee_id,
      'reward_rejected',
      'Your ' || req.reward_name_snapshot || ' request was not approved',
      COALESCE(actor_name, 'HR') || ': ' || reason
        || ' Your ' || req.coin_cost || ' Value Coins have been returned.',
      req.id,
      'reward_assignment'
    FROM employees e
    WHERE e.id = req.employee_id AND e.auth_user_id IS NOT NULL;
  END IF;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    actor,
    lower(btrim(auth.jwt()->>'email')),
    'reward.' || p_action || 'd',
    'reward_assignment',
    req.id,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object(
      'status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
      'coin_cost', req.coin_cost,
      'reason', reason,
      'refunded', p_action = 'reject',
      '_actor_role', actor_role
    )
  );

  RETURN json_build_object(
    'redemption_id', req.id,
    'status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    'refunded', CASE WHEN p_action = 'reject' THEN req.coin_cost ELSE 0 END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.decide_reward_redemption(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_reward_redemption(UUID, TEXT, TEXT) TO authenticated;


-- ── 6. The HR queue ─────────────────────────────────────────
--
-- A function rather than a view, because it joins `employees` for names that
-- the HR policies already permit but which a plain client-side join would
-- have to spell out in every caller.

CREATE OR REPLACE FUNCTION public.list_reward_redemptions(
  p_status TEXT DEFAULT 'pending',
  p_limit  INTEGER DEFAULT 100
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
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor;

  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only HR and a Super Admin can review reward requests.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT json_agg(row_to_json(x) ORDER BY x.assigned_at DESC)
      FROM (
        SELECT
          ra.id,
          ra.status,
          ra.coin_cost,
          ra.reward_name_snapshot,
          ra.assigned_at,
          ra.decided_at,
          ra.decision_reason,
          e.id          AS employee_id,
          e.full_name   AS employee_name,
          e.employee_id AS employee_code,
          e.avatar_url  AS employee_avatar,
          d.full_name   AS decided_by_name
        FROM reward_assignments ra
        JOIN employees e ON e.id = ra.employee_id
        LEFT JOIN employees d ON d.id = ra.decided_by_id
        WHERE ra.origin = 'redemption'
          AND (p_status = 'all' OR ra.status = p_status)
        ORDER BY ra.assigned_at DESC
        LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 300), 1)
      ) x
  ), '[]'::json);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_reward_redemptions(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_reward_redemptions(TEXT, INTEGER) TO authenticated;


-- ── 7. Erasure takes redemptions with it ────────────────────
--
-- purge_employee() (037) already deletes reward_assignments for the target,
-- and value_coin_transactions go through the employees trigger 050 extended.
-- What is new is `decided_by_id`, which references employees with no ON
-- DELETE action: erasing an HR admin who once approved somebody's voucher
-- would fail on that constraint. The decision is kept and the name is
-- released, which is the same thing nominations do with approved_by_id.

CREATE OR REPLACE FUNCTION public.erase_employee_comments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM nomination_comment_likes WHERE employee_id = OLD.id;
  DELETE FROM nomination_comments WHERE author_id = OLD.id;
  DELETE FROM value_coin_transactions
   WHERE sender_id = OLD.id OR recipient_id = OLD.id;
  UPDATE reward_assignments SET decided_by_id = NULL WHERE decided_by_id = OLD.id;
  RETURN OLD;
END;
$fn$;


-- ── 8. A starting catalogue ─────────────────────────────────
--
-- SAMPLE rewards, so the store is not empty on day one and the feature can
-- be exercised end to end. They are ordinary rows: HR edits, reprices,
-- deactivates or deletes them from the Rewards screen like any other.
-- Nothing here is a commitment by the organisation to provide them.
--
-- Idempotent on name, so re-running setup adds nothing. Deliberately NOT an
-- upsert: once HR has repriced the Coffee Voucher, a later run must leave
-- their number alone rather than restoring this one.
--
-- Priced so the 500-coin welcome grant reaches exactly the first rung, and
-- everything above it has to be earned from colleagues.

INSERT INTO rewards (name, description, coin_price, category, requires_approval, is_active)
SELECT v.name, v.description, v.coin_price, v.category, v.requires_approval, true
FROM (VALUES
  ('Coffee Voucher',
   'A coffee voucher as a small personal reward.',
   500, 'everyday', false),
  ('Movie Voucher',
   'A movie voucher for a well-earned break.',
   1000, 'experiences', false),
  ('Lunch Voucher',
   'A lunch voucher as an employee appreciation reward.',
   1500, 'everyday', false),
  ('Book & Learning Voucher',
   'Support for books or learning material.',
   2000, 'learning', true),
  ('Wellness Voucher',
   'A wellness-focused employee reward.',
   2500, 'wellness', true),
  ('Learning Course Contribution',
   'Contribution toward an approved learning course or professional development activity.',
   3000, 'learning', true),
  ('Special Recognition Reward',
   'A higher-value recognition reward for exceptional contribution.',
   5000, 'recognition', true)
) AS v(name, description, coin_price, category, requires_approval)
WHERE NOT EXISTS (SELECT 1 FROM rewards r WHERE r.name = v.name);
