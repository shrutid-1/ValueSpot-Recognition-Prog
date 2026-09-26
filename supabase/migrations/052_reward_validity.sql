-- ============================================================
-- 052 — REWARD VALIDITY
--
-- 051 gave a reward a price and a redemption a status. It did not give the
-- redeemed thing a shelf life: an approved Coffee Voucher sat approved for
-- ever, and nothing said by when it had to be used.
--
-- WHEN THE CLOCK STARTS, AND WHY IT IS NOT AT REDEMPTION
-- -----------------------------------------------------
-- Validity runs from FULFILMENT — the moment the reward became the
-- employee's to use — not from the moment they asked for it.
--
-- 051 takes the coins at redemption and leaves the request pending until HR
-- decides. If the clock started there, a queue nobody worked for a fortnight
-- would burn a 14-day voucher down to nothing before anybody had the chance
-- to approve it, and the employee would have paid for a window they were
-- never given. Anchoring to `fulfilled_at` — already on the row, already set
-- at approval, and already set immediately for a reward that needs none —
-- makes a pending request unexpirable by construction. HR can take as long
-- as HR takes; the fourteen days start when there is something to use.
--
-- So `expires_at` is NULL while pending. That is not missing data: a pending
-- request genuinely has no expiry date yet, and inventing one would be a
-- countdown lying about a decision that has not happened.
--
-- 'EXPIRED' IS DERIVED, NOT STORED
-- --------------------------------
-- There is no fourth status and no sweep. 050 settled this argument for the
-- whole codebase — "a cron job that fails silently leaves an organisation
-- with no budgets and nothing to notice it by" — and the same reasoning
-- applies here with more force, because a missed sweep would leave rewards
-- reading as usable after they are not.
--
-- redemption_effective_status() compares `expires_at` against now() at read
-- time. It cannot drift, cannot be half-applied across a table, and needs
-- nothing running. The stored `status` keeps exactly the three values 051
-- allows, so no CHECK moves and no existing row changes meaning.
--
-- COINS ON EXPIRY: NOTHING MOVES
-- ------------------------------
-- An approval is a completed spend in this model — 051 debits at redemption
-- and refunds only on rejection. An expiry is therefore not a reversal of
-- anything: the employee bought a window and did not use it. No ledger row
-- is written, because no coins move, and writing one would be inventing a
-- balance change nobody made.
--
-- The alternative — refunding on expiry — needs a write at a moment when
-- nobody is acting, which without a scheduler means a SELECT that mutates
-- balances. A read that silently moves money is the opposite of an auditable
-- ledger.
--
-- The employee is told this in plain words rather than left to infer it from
-- a balance that did not change. See the My Redemptions detail view.
--
-- HISTORICAL INTEGRITY
-- --------------------
-- `validity_days_snapshot` is copied onto the redemption when it is raised,
-- by the same precedent as `coin_cost` and `reward_name_snapshot` in 051.
-- The approval that later sets `expires_at` reads THE SNAPSHOT ON THE ROW,
-- never `rewards.redemption_validity_days` as it stands that day. HR moving
-- the Coffee Voucher from 14 days to 30 changes what the next person gets
-- and nothing about anybody already holding one.
--
-- EXISTING ROWS
-- -------------
-- Every redemption that predates this migration keeps NULL for both columns
-- and never expires. Back-dating an expiry onto a reward somebody redeemed
-- under a promise that contained no expiry would be inventing a term of a
-- deal after it was struck. They are legacy, they read as legacy, and they
-- stay valid.
-- ============================================================


-- ── 1. The catalogue gains a shelf life ─────────────────────
--
-- 14 days is the default, and the value every existing reward inherits. The
-- ceiling is a year: a validity longer than that is indistinguishable from
-- none, and leaving it unbounded invites a typo to produce a voucher valid
-- until the year 3025.

ALTER TABLE rewards
  ADD COLUMN IF NOT EXISTS redemption_validity_days INTEGER NOT NULL DEFAULT 14;

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS rewards_validity_days_check;
ALTER TABLE rewards ADD CONSTRAINT rewards_validity_days_check
  CHECK (redemption_validity_days BETWEEN 1 AND 365);

COMMENT ON COLUMN rewards.redemption_validity_days IS
  'Days an approved redemption stays usable, counted from fulfilment. 1-365. Changing it affects future redemptions only; existing ones hold their own snapshot.';


-- ── 2. The redemption remembers the term it was sold ────────

ALTER TABLE reward_assignments
  -- The validity in force WHEN THE REQUEST WAS RAISED. NULL on every row
  -- older than this migration, and on HR hand-outs, which have no term.
  ADD COLUMN IF NOT EXISTS validity_days_snapshot INTEGER,
  -- Set at fulfilment, never at redemption. NULL while pending.
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

ALTER TABLE reward_assignments DROP CONSTRAINT IF EXISTS reward_assignments_validity_snapshot_check;
ALTER TABLE reward_assignments ADD CONSTRAINT reward_assignments_validity_snapshot_check
  CHECK (validity_days_snapshot IS NULL OR validity_days_snapshot BETWEEN 1 AND 365);

-- An expiry date with no recorded term behind it cannot be explained to the
-- person holding it, and cannot be audited. One implies the other.
ALTER TABLE reward_assignments DROP CONSTRAINT IF EXISTS reward_assignments_expiry_shape;
ALTER TABLE reward_assignments ADD CONSTRAINT reward_assignments_expiry_shape
  CHECK (expires_at IS NULL OR validity_days_snapshot IS NOT NULL);

-- Nothing expires that was never fulfilled. This is the pending-cannot-expire
-- rule written as a constraint rather than left as an intention in a function.
ALTER TABLE reward_assignments DROP CONSTRAINT IF EXISTS reward_assignments_expiry_needs_fulfilment;
ALTER TABLE reward_assignments ADD CONSTRAINT reward_assignments_expiry_needs_fulfilment
  CHECK (expires_at IS NULL OR fulfilled_at IS NOT NULL);

COMMENT ON COLUMN reward_assignments.validity_days_snapshot IS
  'rewards.redemption_validity_days as it stood when this was redeemed. NULL means legacy (pre-052) or an HR hand-out.';
COMMENT ON COLUMN reward_assignments.expires_at IS
  'When this stops being usable. Set at fulfilment from the snapshot above, never from the catalogue as it stands today. NULL while pending.';

-- The queue sorts approved rewards by how close they are to lapsing.
CREATE INDEX IF NOT EXISTS idx_reward_assignments_expiring
  ON reward_assignments(expires_at)
  WHERE expires_at IS NOT NULL AND status = 'approved';


-- ── 3. How near is "expires soon" ───────────────────────────

INSERT INTO app_config (key, value, description) VALUES
  ('reward_expiry_warning_days', '3'::jsonb,
   'Days before a reward lapses at which the HR queue flags it as expiring soon.')
ON CONFLICT (key) DO NOTHING;


-- ── 4. The one place 'expired' is decided ───────────────────
--
-- STABLE, not IMMUTABLE: it reads now(), and the answer changes without the
-- row changing. That is the entire mechanism — the status is a question asked
-- at read time, so it is never stale and never needs correcting.
--
-- Only an APPROVED redemption can expire. A pending one has no expires_at to
-- compare against, and a rejected one was refunded and closed.

CREATE OR REPLACE FUNCTION public.redemption_effective_status(
  p_status     TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $fn$
  SELECT CASE
    WHEN p_status = 'approved'
     AND p_expires_at IS NOT NULL
     AND p_expires_at <= now()
    THEN 'expired'
    ELSE p_status
  END;
$fn$;

COMMENT ON FUNCTION public.redemption_effective_status(TEXT, TIMESTAMPTZ) IS
  'The status a redemption actually has right now. 051 stores three; this derives the fourth from the clock so that no sweep has to write it.';


-- ── 5. Redeeming, now with a term attached ──────────────────
--
-- The signature is unchanged and the caller still names ONE thing. The
-- validity is read here, from the row, exactly as the price already was — a
-- browser can no more propose a term than it can propose a price.

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
  expiry        TIMESTAMPTZ;
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

  SELECT id, name, coin_price, requires_approval, is_active, redemption_validity_days
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
    A reward that needs no approval is fulfilled on the spot, so its clock
    starts on the spot. One that does is fulfilled by the approval and gets
    its expiry there — see decide_reward_redemption(). Either way the term
    written onto the row below is the one in force RIGHT NOW, and that copy
    is what the approval reads later.
  */
  expiry := CASE
              WHEN needs_ok THEN NULL
              ELSE now() + make_interval(days => r.redemption_validity_days)
            END;

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
    coin_cost, reward_name_snapshot, fulfilled_at,
    validity_days_snapshot, expires_at
  )
  VALUES (
    r.id, me, me, 'redemption', new_status,
    r.coin_price, r.name,
    CASE WHEN needs_ok THEN NULL ELSE now() END,
    r.redemption_validity_days, expiry
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
      'validity_days', r.redemption_validity_days,
      'expires_at', expiry,
      'earned_balance', my_earned - r.coin_price
    )
  );

  SELECT earned_balance INTO my_earned FROM value_coin_wallets WHERE employee_id = me;

  RETURN json_build_object(
    'redemption_id', assignment_id,
    'status', new_status,
    'coin_cost', r.coin_price,
    'reward_name', r.name,
    'validity_days', r.redemption_validity_days,
    'expires_at', expiry,
    'earned', my_earned
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.redeem_reward(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_reward(UUID) TO authenticated;


-- ── 6. Approving starts the clock ───────────────────────────
--
-- The expiry is computed HERE, from `validity_days_snapshot` on the request
-- — the term that was in force when the employee raised it — and never from
-- rewards.redemption_validity_days as it stands at the moment of approval.
-- That single choice is the whole of the historical-integrity rule.
--
-- A legacy row (snapshot NULL, redeemed before 052) approves with a NULL
-- expiry and never lapses, which is the promise it was sold under.

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
  expiry      TIMESTAMPTZ;
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
  SELECT id, employee_id, status, coin_cost, reward_name_snapshot, validity_days_snapshot
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
    /*
      The term is read off the REQUEST, not the catalogue. This is the line
      that makes HR changing a reward's validity today irrelevant to a
      redemption raised last week.
    */
    expiry := CASE
                WHEN req.validity_days_snapshot IS NULL THEN NULL
                ELSE now() + make_interval(days => req.validity_days_snapshot)
              END;

    UPDATE reward_assignments
       SET status = 'approved',
           decided_by_id = actor,
           decided_at = now(),
           decision_reason = reason,
           fulfilled_at = now(),
           expires_at = expiry
     WHERE id = req.id;

    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    SELECT
      req.employee_id,
      'reward_approved',
      'Your ' || req.reward_name_snapshot || ' was approved',
      COALESCE(actor_name, 'HR') || ' approved your reward request.'
        || COALESCE(' Use it by ' || to_char(expiry AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY') || '.', '')
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
      'validity_days', req.validity_days_snapshot,
      'expires_at', expiry,
      '_actor_role', actor_role
    )
  );

  RETURN json_build_object(
    'redemption_id', req.id,
    'status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
    'refunded', CASE WHEN p_action = 'reject' THEN req.coin_cost ELSE 0 END,
    'expires_at', expiry
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.decide_reward_redemption(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decide_reward_redemption(UUID, TEXT, TEXT) TO authenticated;


-- ── 7. The employee's own redemptions ───────────────────────
--
-- A function rather than the plain select the store used before, for one
-- reason: the status has to be DERIVED, and deriving it in the browser would
-- make the clock on the employee's laptop the authority on whether a reward
-- has lapsed. A machine with a wrong date would show an expired voucher as
-- usable, or the reverse.
--
-- It reads the caller's own rows and nobody else's. `me` comes from the
-- session; there is no employee parameter to pass a different id into, which
-- is the same shape redeem_reward() already uses.

CREATE OR REPLACE FUNCTION public.list_my_redemptions(p_limit INTEGER DEFAULT 50)
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me UUID := (auth.jwt()->>'employee_id')::uuid;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'No employee on this session.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT json_agg(row_to_json(t) ORDER BY t.assigned_at DESC)
      FROM (
        SELECT
          ra.id,
          ra.status,
          public.redemption_effective_status(ra.status, ra.expires_at) AS effective_status,
          ra.coin_cost,
          ra.reward_name_snapshot,
          ra.assigned_at,
          ra.decided_at,
          ra.decision_reason,
          ra.fulfilled_at,
          ra.validity_days_snapshot,
          ra.expires_at,
          -- The catalogue row is joined for the shelf only, and only to give
          -- the card an icon. The NAME still comes from the snapshot, so a
          -- renamed or deleted reward still reads correctly.
          rw.category AS reward_category
        FROM reward_assignments ra
        LEFT JOIN rewards rw ON rw.id = ra.reward_id
       WHERE ra.employee_id = me
         AND ra.origin = 'redemption'
       ORDER BY ra.assigned_at DESC
       LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
      ) t
  ), '[]'::json);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_my_redemptions(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_my_redemptions(INTEGER) TO authenticated;


-- ── 8. The HR queue learns about lapsing ────────────────────
--
-- Same authorisation as before — role re-read from `employees`, never the
-- token. What is added is the expiry, the derived status and one flag saying
-- whether it is close, computed against the configured threshold rather than
-- a number picked in the browser.

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
  warn_days  INTEGER := public.value_coin_setting('reward_expiry_warning_days', 3);
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
    SELECT json_agg(row_to_json(t) ORDER BY t.assigned_at DESC)
      FROM (
        SELECT
          ra.id,
          ra.status,
          public.redemption_effective_status(ra.status, ra.expires_at) AS effective_status,
          ra.coin_cost,
          ra.reward_name_snapshot,
          ra.assigned_at,
          ra.decided_at,
          ra.decision_reason,
          ra.fulfilled_at,
          ra.validity_days_snapshot,
          ra.expires_at,
          /* Close to lapsing, and not lapsed already. Both halves matter: a
             reward that went last week is not "expiring soon", it is gone. */
          (
            ra.status = 'approved'
            AND ra.expires_at IS NOT NULL
            AND ra.expires_at > now()
            AND ra.expires_at <= now() + make_interval(days => warn_days)
          ) AS expires_soon,
          e.id           AS employee_id,
          e.full_name    AS employee_name,
          e.employee_id  AS employee_code,
          e.avatar_url   AS employee_avatar,
          d.full_name    AS decided_by_name
        FROM reward_assignments ra
        JOIN employees e ON e.id = ra.employee_id
        LEFT JOIN employees d ON d.id = ra.decided_by_id
       WHERE ra.origin = 'redemption'
         AND (
              p_status = 'all'
              OR (p_status = 'expired'
                  AND public.redemption_effective_status(ra.status, ra.expires_at) = 'expired')
              OR (p_status <> 'expired'
                  AND ra.status = p_status
                  AND public.redemption_effective_status(ra.status, ra.expires_at) = p_status)
             )
       ORDER BY ra.assigned_at DESC
       LIMIT GREATEST(LEAST(COALESCE(p_limit, 100), 300), 1)
      ) t
  ), '[]'::json);
END;
$fn$;

REVOKE ALL ON FUNCTION public.list_reward_redemptions(TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_reward_redemptions(TEXT, INTEGER) TO authenticated;


-- ── 9. Only HR and a Super Admin may set a term ─────────────
--
-- `rewards_hr_full` (005) already restricts writes to those two roles, and
-- it does so in the database rather than the browser. It reads the role from
-- the signed JWT claim, though, and 051 set the precedent that anything
-- deciding money re-reads the role from `employees` instead — "a claim is
-- what a session says".
--
-- A validity period decides how long a spend stays worth anything, so it
-- belongs on the stricter side of that line. This trigger is the belt to the
-- policy's braces: it refuses the write on the table itself, whatever route
-- reached it, with the role taken from the employees row.

CREATE OR REPLACE FUNCTION public.guard_reward_configuration()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor      UUID := (auth.jwt()->>'employee_id')::uuid;
  actor_role TEXT;
BEGIN
  -- Server-side callers with no session (migrations, seeds, SECURITY DEFINER
  -- functions running as the definer) are not employees and are not what this
  -- guards against. It exists to stop a signed-in Manager or Employee, not
  -- the database maintaining itself.
  IF actor IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor;

  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only HR and a Super Admin can change the reward catalogue.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS guard_reward_configuration_trg ON rewards;
CREATE TRIGGER guard_reward_configuration_trg
  BEFORE INSERT OR UPDATE ON rewards
  FOR EACH ROW EXECUTE FUNCTION public.guard_reward_configuration();


-- ── 10. A starting spread of terms ──────────────────────────
--
-- Only touches rewards still sitting on the 14-day default, and only by
-- name, so an HR team that has already set its own terms keeps them. Without
-- this every reward in the sample catalogue would read "14-day validity",
-- which tells nobody what the field is for.

UPDATE rewards SET redemption_validity_days = 7
 WHERE redemption_validity_days = 14 AND category = 'wellness';

UPDATE rewards SET redemption_validity_days = 30
 WHERE redemption_validity_days = 14 AND category = 'learning';

UPDATE rewards SET redemption_validity_days = 21
 WHERE redemption_validity_days = 14 AND category = 'experiences';
