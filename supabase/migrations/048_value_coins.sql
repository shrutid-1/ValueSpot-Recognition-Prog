-- ============================================================
-- 048 — VALUE COINS
--
-- An internal currency. Every employee is granted a starting balance once,
-- and can send coins to the person a recognition is ABOUT, from the post in
-- the feed. That is the whole of it: a grant, and transfers attached to
-- recognitions.
--
-- These coins are a token inside this product. They are not money, they are
-- not redeemable here, and nothing in this schema converts them to anything.
--
-- A STORED BALANCE, WHICH IS A DEPARTURE
-- --------------------------------------
-- appreciation_count, comment_count and a comment's like_count are all
-- counted at read time, and every one of those decisions was right: a
-- miscount shows a wrong number for a moment and corrects itself on the next
-- read.
--
-- A balance is not like that. Two sends racing each other must not both see
-- the same balance and both succeed, and you cannot lock a number you compute
-- on the fly. So the balance is a row, it is locked FOR UPDATE inside the one
-- function allowed to change it, and `CHECK (balance >= 0)` sits underneath as
-- the thing that is true even if the check above it is ever wrong.
--
-- value_coin_transactions is the ledger beside it: every grant and every
-- transfer, append-only, so a balance can always be explained rather than
-- merely trusted. The balance is what is enforced; the ledger is what is
-- audited.
--
-- NOBODY CAN WRITE EITHER TABLE DIRECTLY
-- --------------------------------------
-- There is no INSERT, UPDATE or DELETE policy on either one. Not for an
-- employee, not for HR, not for a Super Admin. The only way a balance moves
-- is send_value_coins(), which is SECURITY DEFINER and which checks
-- everything: the second factor, the amount, the sender's balance, that the
-- recipient is the person the recognition is actually about, and that the
-- sender is not paying themselves.
--
-- That is stricter than the rest of this schema, and deliberately. A comment
-- written by the wrong person is embarrassing; a balance written by the wrong
-- person is a currency nobody can trust again.
-- ============================================================


-- ── 1. The starting grant, as configuration ─────────────────
--
-- In app_config so HR can change what a new joiner receives without a
-- migration. Read through a COALESCE so the function still works if the row
-- is ever deleted — a missing configuration must not stop people signing up.

INSERT INTO app_config (key, value, description)
VALUES (
  'value_coin_signup_grant',
  '500'::jsonb,
  'Value Coins granted to each employee once, when their wallet is created.'
)
ON CONFLICT (key) DO NOTHING;


-- ── 2. The wallet ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS value_coin_wallets (
  employee_id UUID PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  balance     INTEGER NOT NULL DEFAULT 0,
  /* When the one-time grant was made. NOT a nullable "has been granted" flag:
     the timestamp answers both questions, and answers the second one with a
     fact rather than a boolean somebody has to trust. */
  granted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- The floor. Every path to a debit checks the balance first and returns a
  -- readable message; this is what is true if one of them is ever wrong.
  CONSTRAINT value_coin_wallets_not_overdrawn CHECK (balance >= 0)
);

ALTER TABLE value_coin_wallets ENABLE ROW LEVEL SECURITY;

-- Your own balance, and HR's view of everyone's. A colleague's balance is
-- nobody's business: it says how much they have given away.
DROP POLICY IF EXISTS "wallets_read_own" ON value_coin_wallets;
CREATE POLICY "wallets_read_own" ON value_coin_wallets
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND employee_id = (auth.jwt()->>'employee_id')::uuid
  );

DROP POLICY IF EXISTS "wallets_read_hr" ON value_coin_wallets;
CREATE POLICY "wallets_read_hr" ON value_coin_wallets
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

-- No write policy of any kind. See the header.


-- ── 3. The ledger ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS value_coin_transactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  /* Null for a grant: the coins come from the organisation, not from a
     person, and inventing a system employee to be the sender would put a
     fake party in an audit trail. */
  sender_id     UUID REFERENCES employees(id),
  recipient_id  UUID NOT NULL REFERENCES employees(id),
  amount        INTEGER NOT NULL,
  /* Which recognition the coins were sent on. Null only for a grant. */
  nomination_id UUID REFERENCES nominations(id) ON DELETE SET NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('signup_grant', 'recognition_tip')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT value_coin_transactions_amount_positive CHECK (amount > 0),
  CONSTRAINT value_coin_transactions_note_length
    CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 200),
  -- A grant has no sender; a transfer has one, and it is never the recipient.
  CONSTRAINT value_coin_transactions_parties CHECK (
    (kind = 'signup_grant' AND sender_id IS NULL AND nomination_id IS NULL)
    OR (kind = 'recognition_tip' AND sender_id IS NOT NULL AND sender_id <> recipient_id)
  )
);

CREATE INDEX IF NOT EXISTS idx_value_coin_tx_recipient
  ON value_coin_transactions(recipient_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_value_coin_tx_sender
  ON value_coin_transactions(sender_id, created_at DESC)
  WHERE sender_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_value_coin_tx_nomination
  ON value_coin_transactions(nomination_id)
  WHERE nomination_id IS NOT NULL;

ALTER TABLE value_coin_transactions ENABLE ROW LEVEL SECURITY;

-- The two parties to a transaction can read it. Nobody else, except HR.
DROP POLICY IF EXISTS "value_coin_tx_read_party" ON value_coin_transactions;
CREATE POLICY "value_coin_tx_read_party" ON value_coin_transactions
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND (
      recipient_id = (auth.jwt()->>'employee_id')::uuid
      OR sender_id = (auth.jwt()->>'employee_id')::uuid
    )
  );

DROP POLICY IF EXISTS "value_coin_tx_read_hr" ON value_coin_transactions;
CREATE POLICY "value_coin_tx_read_hr" ON value_coin_transactions
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

-- Append-only from the outside: no INSERT, UPDATE or DELETE policy. The
-- ledger is written by the functions below and by nothing else.


-- ── 4. Opening a wallet ─────────────────────────────────────
--
-- One place that creates a wallet, so the grant cannot be made twice by two
-- paths that each thought they were first. ON CONFLICT DO NOTHING is what
-- makes it idempotent, and the ledger row is written only when the insert
-- actually created the row — `IF FOUND` after RETURNING, not before.

CREATE OR REPLACE FUNCTION public.open_value_coin_wallet(p_employee_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  grant_amount INTEGER;
  opened       UUID;
BEGIN
  SELECT COALESCE((value #>> '{}')::integer, 500)
    INTO grant_amount
    FROM app_config
   WHERE key = 'value_coin_signup_grant';

  grant_amount := COALESCE(grant_amount, 500);

  INSERT INTO value_coin_wallets (employee_id, balance, granted_at)
  VALUES (p_employee_id, grant_amount, now())
  ON CONFLICT (employee_id) DO NOTHING
  RETURNING employee_id INTO opened;

  -- Already had a wallet. Nothing granted, nothing recorded.
  IF opened IS NULL THEN
    RETURN 0;
  END IF;

  INSERT INTO value_coin_transactions (recipient_id, amount, kind, note)
  VALUES (p_employee_id, grant_amount, 'signup_grant', 'Welcome grant');

  RETURN grant_amount;
END;
$fn$;

REVOKE ALL ON FUNCTION public.open_value_coin_wallet(UUID) FROM PUBLIC;


/*
  The caller's own wallet, opened if this is their first time.

  Called by the browser once the session has an employee. Takes no argument
  precisely so it cannot be used to open somebody else's wallet: the employee
  is read from the session, not from a parameter.

  Returns the balance either way, so the caller has one round trip rather than
  "open, then read".
*/
CREATE OR REPLACE FUNCTION public.ensure_my_value_coin_wallet()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me      UUID := (auth.jwt()->>'employee_id')::uuid;
  current INTEGER;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'No employee on this session.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  /*
    The read comes first, and almost always answers.

    The browser calls this on every page load — it is what mounts the balance
    in the top bar — so the path taken by everybody who already has a wallet
    must not be a write. Going straight to open_value_coin_wallet() would
    issue an INSERT ... ON CONFLICT DO NOTHING on every navigation: correct,
    idempotent, and a write to the WAL for each one.
  */
  SELECT balance INTO current FROM value_coin_wallets WHERE employee_id = me;

  IF FOUND THEN
    RETURN current;
  END IF;

  PERFORM public.open_value_coin_wallet(me);

  SELECT balance INTO current FROM value_coin_wallets WHERE employee_id = me;
  RETURN COALESCE(current, 0);
END;
$fn$;

REVOKE ALL ON FUNCTION public.ensure_my_value_coin_wallet() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_value_coin_wallet() TO authenticated;


-- A new employee gets a wallet the moment they exist, so the grant does not
-- depend on anybody remembering to ask for it.
CREATE OR REPLACE FUNCTION public.open_wallet_for_new_employee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.open_value_coin_wallet(NEW.id);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_open_wallet_for_new_employee ON employees;
CREATE TRIGGER trg_open_wallet_for_new_employee
  AFTER INSERT ON employees
  FOR EACH ROW EXECUTE FUNCTION public.open_wallet_for_new_employee();


-- Everyone who already exists. Without this, the grant would be a benefit
-- only new joiners ever received.
DO $backfill$
DECLARE
  e RECORD;
BEGIN
  FOR e IN SELECT id FROM employees LOOP
    PERFORM public.open_value_coin_wallet(e.id);
  END LOOP;
END;
$backfill$;


-- ── 5. Sending ─────────────────────────────────────────────

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
    -- Added by 034.
    'support_request_created',
    'support_request_resolved',
    'support_request_rejected',
    -- Added by 046.
    'recognition_commented',
    -- Added by 047.
    'comment_replied',
    -- Added by 048.
    'value_coins_received'
  ));

/*
  Move coins from the caller to the person a recognition is about.

  THE SENDER IS NOT A PARAMETER. It is read from the session, which is what
  makes "spend somebody else's balance" unexpressible rather than merely
  forbidden.

  THE RECIPIENT IS CHECKED AGAINST THE RECOGNITION. Passing a recipient who
  is not that nomination's nominee is refused. Without this the id would be
  a free-form "credit anyone" field with a recognition's name attached to it
  in the ledger, and the audit trail would be fiction.

  LOCK ORDER IS BY EMPLOYEE ID, not sender-then-recipient. Two people sending
  to each other at the same moment would otherwise each hold the lock the
  other is waiting for; ordering the two locks the same way in every call
  makes that deadlock impossible rather than rare.
*/
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
  me           UUID := (auth.jwt()->>'employee_id')::uuid;
  first_lock   UUID;
  second_lock  UUID;
  my_balance   INTEGER;
  nom          RECORD;
  sender_name  TEXT;
  clean_note   TEXT;
  tx_id        UUID;
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

  -- The recognition must be real, approved, and about the person being paid.
  SELECT id, nominee_id, status INTO nom
    FROM nominations
   WHERE id = p_nomination_id;

  IF NOT FOUND OR nom.status <> 'approved' THEN
    RAISE EXCEPTION 'That recognition is not open for Value Coins.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF nom.nominee_id <> p_recipient_id THEN
    RAISE EXCEPTION 'Value Coins go to the person the recognition is about.'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM 1 FROM employees
   WHERE id = p_recipient_id AND is_active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That colleague is no longer active.' USING ERRCODE = 'check_violation';
  END IF;

  -- Both wallets exist before either is locked.
  PERFORM public.open_value_coin_wallet(me);
  PERFORM public.open_value_coin_wallet(p_recipient_id);

  first_lock  := LEAST(me, p_recipient_id);
  second_lock := GREATEST(me, p_recipient_id);

  PERFORM 1 FROM value_coin_wallets WHERE employee_id = first_lock  FOR UPDATE;
  PERFORM 1 FROM value_coin_wallets WHERE employee_id = second_lock FOR UPDATE;

  SELECT balance INTO my_balance FROM value_coin_wallets WHERE employee_id = me;

  IF COALESCE(my_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'You have % Value Coins, which is not enough to send %.',
      COALESCE(my_balance, 0), p_amount
      USING ERRCODE = 'check_violation';
  END IF;

  clean_note := NULLIF(btrim(COALESCE(p_note, '')), '');
  IF clean_note IS NOT NULL AND char_length(clean_note) > 200 THEN
    clean_note := left(clean_note, 200);
  END IF;

  UPDATE value_coin_wallets
     SET balance = balance - p_amount, updated_at = now()
   WHERE employee_id = me;

  UPDATE value_coin_wallets
     SET balance = balance + p_amount, updated_at = now()
   WHERE employee_id = p_recipient_id;

  INSERT INTO value_coin_transactions
    (sender_id, recipient_id, amount, nomination_id, kind, note)
  VALUES
    (me, p_recipient_id, p_amount, p_nomination_id, 'recognition_tip', clean_note)
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

  SELECT balance INTO my_balance FROM value_coin_wallets WHERE employee_id = me;

  RETURN json_build_object(
    'transaction_id', tx_id,
    'amount', p_amount,
    'balance', my_balance
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.send_value_coins(UUID, INTEGER, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_value_coins(UUID, INTEGER, UUID, TEXT) TO authenticated;


-- ── 6. The feed says what a recognition has received ────────
--
-- Counted at read time like every other total on this view. A recognition's
-- coin total is display, not a balance — nothing is enforced against it — so
-- the read-time rule that was wrong for a wallet is right here.

CREATE OR REPLACE VIEW v_recognition_feed AS
SELECT
  n.id,
  n.approved_at,
  n.published_at,
  n.what_happened,
  n.what_impact,
  n.recognition_source,

  nominator.id             AS nominator_id,
  nominator.full_name      AS nominator_name,
  nominator.avatar_url     AS nominator_avatar,

  nominee.id               AS nominee_id,
  nominee.full_name        AS nominee_name,
  nominee.avatar_url       AS nominee_avatar,

  cv.id                    AS core_value_id,
  cv.name                  AS core_value_name,
  cv.accent_color          AS core_value_color,
  cv.icon                  AS core_value_icon,

  COALESCE(n.snapshot_behaviour_name, b.name) AS behaviour_name,
  COALESCE(n.snapshot_scenario_name, s.name)  AS scenario_name,
  COALESCE(n.snapshot_project_name, p.name)   AS project_name,
  n.project_id,

  (SELECT COUNT(*) FROM nomination_appreciations na WHERE na.nomination_id = n.id)::integer AS appreciation_count,
  (SELECT COUNT(*) FROM nomination_comments nc WHERE nc.nomination_id = n.id)::integer      AS comment_count,
  (SELECT COALESCE(SUM(t.amount), 0)
     FROM value_coin_transactions t
    WHERE t.nomination_id = n.id
      AND t.kind = 'recognition_tip')::integer                                              AS value_coins_received

FROM nominations n
JOIN employees nominator ON n.nominator_id = nominator.id
JOIN employees nominee   ON n.nominee_id = nominee.id
JOIN core_values cv       ON n.core_value_id = cv.id
LEFT JOIN behaviours b    ON n.behaviour_id = b.id
LEFT JOIN scenarios s     ON n.scenario_id = s.id
LEFT JOIN projects p      ON n.project_id = p.id

WHERE n.status = 'approved'
  AND public.session_second_factor_ok();

GRANT SELECT ON v_recognition_feed TO authenticated;


-- ── 7. Erasure ──────────────────────────────────────────────
--
-- Extends the trigger 046 added and 047 grew. The wallet cascades from
-- employees, but value_coin_transactions references employees on both sides
-- with no ON DELETE action, so the purge would fail on the constraint.
--
-- The ledger rows are deleted rather than anonymised. An erasure is meant to
-- remove the person, and a transaction naming who sent what to whom is a
-- record OF that person; the counterparty's balance is not recomputed from it
-- and so is unaffected. The coins themselves stay wherever they ended up.

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
  RETURN OLD;
END;
$fn$;
