-- ============================================================
--  CODE LIFECYCLE CHECKS  —  SQL Editor
--
--  Covers the parts that cannot be observed through the API, because the
--  values they depend on are deliberately never returned to a client.
--
--  Queries 1-3 are read-only. Query 4 modifies one test row on purpose and
--  says so.
-- ============================================================


-- ── 1. Single use: the hash is destroyed on success ─────────
--
-- verify_login_code() sets code_hash = NULL when it accepts a code. A verified
-- row with a NULL hash is proof the code cannot be replayed, which the API
-- cannot show you — a second submit returns 'ok' because the session is
-- already verified, which is idempotency rather than reuse.

SELECT '1. SINGLE USE' AS check,
       session_id,
       (verified_at IS NOT NULL) AS verified,
       (code_hash IS NULL)       AS hash_destroyed,
       attempts,
       created_at
  FROM login_verifications
 ORDER BY created_at DESC
 LIMIT 5;
-- EXPECT every verified = true row to also show hash_destroyed = true.


-- ── 2. Rate limiting: what the counters actually hold ───────

SELECT '2. RATE LIMIT' AS check,
       u.email,
       count(*) FILTER (WHERE s.sent_at > now() - interval '1 hour') AS sends_last_hour,
       10 AS hourly_limit,
       max(s.sent_at) AS most_recent_send
  FROM login_code_sends s
  JOIN auth.users u ON u.id = s.user_id
 GROUP BY u.email;
-- EXPECT sends_last_hour to match the number of codes you have requested.
-- request_login_code() refuses once this reaches 10.


-- ── 3. Stored shape: no plaintext anywhere ──────────────────

SELECT '3. NO PLAINTEXT' AS check,
       count(*)                                             AS rows_total,
       count(*) FILTER (WHERE code_hash IS NOT NULL)        AS rows_with_live_hash,
       bool_and(code_hash IS NULL OR length(code_hash) = 64) AS all_hashes_sha256,
       bool_or(code_hash ~ '^[0-9]{6}$')                    AS any_plaintext_code
  FROM login_verifications;
-- EXPECT all_hashes_sha256 = true, any_plaintext_code = false or null.


-- ── 4. Expiry — this one WRITES, deliberately ───────────────
--
-- Backdating is the only practical way to test expiry without waiting ten
-- minutes. It touches one row belonging to your own most recent unverified
-- session and nothing else.
--
-- Run this, then immediately submit that session's code through the app or
-- BLOCK 6 — verify_login_code() must answer 'expired'.

-- UPDATE login_verifications
--    SET expires_at = now() - interval '1 minute'
--  WHERE session_id = (
--        SELECT session_id FROM login_verifications
--         WHERE verified_at IS NULL
--         ORDER BY created_at DESC
--         LIMIT 1)
-- RETURNING session_id, expires_at;

-- Uncomment to run. Left commented so nothing is modified by accident.


-- ── 5. Rate limit: prove the 10/hour refusal ────────────────
--
-- Sending ten real emails to hit the threshold would be wasteful and would
-- leave your inbox full of live codes. The counter request_login_code() reads
-- is login_code_sends, so filling it directly exercises exactly the same
-- branch without any delivery.
--
-- 5a. Top the counter up to 10 for your account.
--     (Uncomment, run, then immediately do 5b.)

-- INSERT INTO login_code_sends (user_id, sent_at)
-- SELECT u.id, now()
--   FROM auth.users u,
--        generate_series(1, GREATEST(0, 10 - (
--          SELECT count(*) FROM login_code_sends s
--           WHERE s.user_id = u.id AND s.sent_at > now() - interval '1 hour')))
--  WHERE u.email = 'pdkaslikar29@gmail.com'
-- RETURNING user_id, sent_at;

-- 5b. In the browser, on a password-only session, call request_login_code().
--     EXPECT  { "status": "rate_limited" }  and NO email sent.

-- 5c. Clean up — removes only the padding rows added by 5a, by timestamp.

-- DELETE FROM login_code_sends
--  WHERE sent_at > now() - interval '2 minutes'
--    AND user_id = (SELECT id FROM auth.users WHERE email = 'pdkaslikar29@gmail.com')
-- RETURNING id;


-- ── 6. Leftovers: confirm nothing testing-only survives ─────

SELECT '6. TEST ARTIFACTS' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'debug_session_auth')            AS debug_fn_present,
       (SELECT count(*) FROM login_verifications)                AS verification_rows,
       (SELECT count(*) FROM login_code_sends)                   AS send_log_rows;
-- debug_fn_present should be false once Phase 11 cleanup has run.
