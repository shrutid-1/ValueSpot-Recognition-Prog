-- ============================================================
-- 049 — THE VALUE WALLET
--
-- 048 built the currency: balances, a ledger, and sending. What it gave the
-- employee was a number. This gives them a wallet — what arrived, what left,
-- WHICH RECOGNITION produced it, and how the last six months went.
--
-- WHY A VIEW AND NOT A JOIN IN THE BROWSER
-- ----------------------------------------
-- A ledger row is only meaningful with its recognition attached: "+50" says
-- nothing, "+50 from Vaibhav, Collaborative, Project Alpha" is the thing
-- worth reading. That context lives on `nominations` and the tables around
-- it — and an employee cannot SELECT a nomination they were not party to
-- (003). Somebody who sent coins on a colleague's recognition can read their
-- own transaction and nothing else about it.
--
-- The same shape of problem v_recognition_feed has, solved the same way: the
-- view reads those tables as its OWNER, and scopes itself to the caller in
-- its own WHERE clause. What it exposes is the recognition a transaction the
-- caller was party to was sent on — never a nomination they have no
-- transaction against.
--
-- WHY `direction` IS A COLUMN
-- ---------------------------
-- The same transfer is a credit to one person and a debit to the other. The
-- browser could derive that by comparing ids, and every screen that rendered
-- a ledger row would then carry its own copy of the rule. It is computed once
-- here, against the session, which is the only place that knows who is
-- asking.
-- ============================================================


-- ── 1. A transaction, with the recognition behind it ────────

CREATE OR REPLACE VIEW v_value_coin_activity AS
SELECT
  t.id,
  t.created_at,
  t.amount,
  t.kind,
  t.note,
  t.nomination_id,

  CASE WHEN t.recipient_id = (auth.jwt()->>'employee_id')::uuid
       THEN 'in' ELSE 'out' END                       AS direction,

  /* The other party, from the caller's side. Null for the welcome grant,
     which has no sender — the coins come from the organisation. */
  CASE WHEN t.recipient_id = (auth.jwt()->>'employee_id')::uuid
       THEN t.sender_id ELSE t.recipient_id END       AS counterparty_id,
  CASE WHEN t.recipient_id = (auth.jwt()->>'employee_id')::uuid
       THEN sender.full_name ELSE recipient.full_name END   AS counterparty_name,
  CASE WHEN t.recipient_id = (auth.jwt()->>'employee_id')::uuid
       THEN sender.avatar_url ELSE recipient.avatar_url END AS counterparty_avatar,

  /* The recognition. Snapshot names first, the same COALESCE the feed uses,
     so a renamed Core Value does not rewrite what a past transaction was
     sent for. */
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


-- ── 2. The wallet, summarised ───────────────────────────────
--
-- One call rather than six. A wallet screen needs the balance, this month's
-- movement, the lifetime totals, how many recognitions have earned coins and
-- a six-month series — and fetching those separately is six round trips that
-- can disagree with each other, which on a screen about money is the one
-- thing it must not do.
--
-- Months are generated rather than read, so a quiet month is a zero in the
-- series instead of a gap the chart has to invent. Six including the current
-- one: enough to see a trend, few enough to read without a scrollbar.

CREATE OR REPLACE FUNCTION public.value_coin_summary()
RETURNS JSON
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  me            UUID := (auth.jwt()->>'employee_id')::uuid;
  month_start   DATE := date_trunc('month', now())::date;
  result        JSON;
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'No employee on this session.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT json_build_object(
    'balance', COALESCE((SELECT balance FROM value_coin_wallets WHERE employee_id = me), 0),

    'received_this_month', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE recipient_id = me
         AND kind = 'recognition_tip'
         AND created_at >= month_start
    ), 0),

    'given_this_month', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE sender_id = me
         AND created_at >= month_start
    ), 0),

    'received_total', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE recipient_id = me AND kind = 'recognition_tip'
    ), 0),

    'given_total', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE sender_id = me
    ), 0),

    'granted_total', COALESCE((
      SELECT SUM(amount) FROM value_coin_transactions
       WHERE recipient_id = me AND kind = 'signup_grant'
    ), 0),

    /* DISTINCT nominations, not transactions. Three colleagues sending coins
       on the same recognition is one recognition that earned coins, and
       counting the transactions would report three. */
    'recognitions_earning_total', COALESCE((
      SELECT COUNT(DISTINCT nomination_id) FROM value_coin_transactions
       WHERE recipient_id = me
         AND kind = 'recognition_tip'
         AND nomination_id IS NOT NULL
    ), 0),

    'recognitions_earning_this_month', COALESCE((
      SELECT COUNT(DISTINCT nomination_id) FROM value_coin_transactions
       WHERE recipient_id = me
         AND kind = 'recognition_tip'
         AND nomination_id IS NOT NULL
         AND created_at >= month_start
    ), 0),

    'months', COALESCE((
      SELECT json_agg(m ORDER BY m.month)
        FROM (
          SELECT
            d.month::date AS month,
            COALESCE((
              SELECT SUM(t.amount) FROM value_coin_transactions t
               WHERE t.recipient_id = me
                 AND t.kind = 'recognition_tip'
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
