-- ============================================================
--  WHY IS NO LOGIN CODE ARRIVING?
--
--  Run queries 1-4 in the Supabase SQL Editor, in order, then read §5.
--
--  Background: request_login_code() sends through pg_net, which is
--  ASYNCHRONOUS. net.http_post() queues the request and returns an id
--  immediately, so the function returns {"status":"ok"} meaning QUEUED, never
--  DELIVERED. If Resend rejects the send, the app still says a code was sent.
--  Query 3 is where the truth lives.
--
--  No secret is printed by any query below.
-- ============================================================


-- ── 1. Is the sender a domain Resend will actually accept? ──
--
-- The single most likely cause. A sender on an unverified domain is rejected
-- with HTTP 403 on every send.

SELECT '1. SENDER' AS check,
       (SELECT decrypted_secret FROM vault.decrypted_secrets
         WHERE name = 'resend_sender')                       AS resend_sender,
       (SELECT decrypted_secret IS NOT NULL AND btrim(decrypted_secret) <> ''
          FROM vault.decrypted_secrets
         WHERE name = 'resend_api_key')                      AS api_key_present,
       (SELECT length(decrypted_secret) FROM vault.decrypted_secrets
         WHERE name = 'resend_api_key')                      AS api_key_length,
       (SELECT left(decrypted_secret, 3) FROM vault.decrypted_secrets
         WHERE name = 'resend_api_key')                      AS api_key_prefix;

-- EXPECT while no sending domain is verified:
--   resend_sender    ...@resend.dev        <- the shared test sender
--   api_key_present  true
--   api_key_length   ~36
--   api_key_prefix   re_
--
-- PROBLEM if resend_sender uses a domain that is NOT verified in the Resend
-- account being used. Resend then refuses every send with 403. See 5a below.


-- ── 2. Is pg_net actually installed and running? ────────────

SELECT '2. PG_NET' AS check,
       EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') AS extension_installed,
       (SELECT count(*) FROM net.http_request_queue)                AS still_queued;

-- extension_installed must be true.
-- still_queued climbing over repeated runs means the worker is not draining.


-- ── 3. What did Resend actually answer?  <-- THE ANSWER ─────
--
-- Joins the request id stored on each verification row to the response pg_net
-- recorded. This is the only place a delivery failure is visible.

SELECT '3. RESEND REPLY' AS check,
       v.created_at,
       v.email,
       r.status_code,
       r.error_msg,
       left(r.content::text, 400) AS response_body
  FROM login_verifications v
  LEFT JOIN net._http_response r ON r.id = v.send_ref
 ORDER BY v.created_at DESC
 LIMIT 5;

-- READ IT LIKE THIS:
--   status_code 200  -> Resend ACCEPTED it. The email left. Check spam, and
--                       check the "to" address is the one you are watching.
--   status_code 403  -> almost always an unverified sender domain, or the
--                       test sender being used for a recipient other than the
--                       Resend account owner. Body names which.        -> §5a
--   status_code 401  -> API key wrong, revoked, or from another Resend
--                       account.                                       -> §5b
--   status_code 422  -> malformed "from" address.                      -> §5a
--   status_code NULL -> the request never completed. If error_msg is set, read
--                       it. If everything is NULL, pg_net never ran the
--                       request — see query 2.
--
-- NOTE: net._http_response is periodically cleared by pg_net. If it is empty,
-- request a fresh code and re-run this query straight away.


-- ── 4. Did the code even get generated? ─────────────────────

SELECT '4. CODE ROWS' AS check,
       session_id,
       email,
       created_at,
       last_sent_at,
       expires_at > now()      AS still_valid,
       code_hash IS NOT NULL   AS code_live,
       verified_at IS NOT NULL AS verified,
       attempts,
       send_ref IS NOT NULL    AS send_was_queued
  FROM login_verifications
 ORDER BY created_at DESC
 LIMIT 5;

-- No rows at all -> request_login_code() never got far enough to store one.
--   The app would have shown you the reason: password_required, rate_limited,
--   cooldown, email_not_configured. Read the message on the code screen.
-- Rows present but send_was_queued = false -> net.http_post() failed outright.


-- ============================================================
--  5. FIXES
-- ============================================================

-- 5a. Set the sender.
--
-- For MULTIPLE test recipients, use an address on a domain YOU control that is
-- verified in your own Resend account. onboarding@resend.dev below needs no DNS
-- but delivers ONLY to the address owning the Resend account - single mailbox only.

-- SELECT vault.update_secret(
--   (SELECT id FROM vault.secrets WHERE name = 'resend_sender'),
--   'ValueSpot <onboarding@resend.dev>'
-- );

-- 5b. Replace the API key. Create a fresh one in the Resend dashboard first.
--     Paste it directly into the SQL Editor. Do not put it in a file, a commit,
--     or a chat message.

-- SELECT vault.update_secret(
--   (SELECT id FROM vault.secrets WHERE name = 'resend_api_key'),
--   'PASTE_THE_NEW_KEY_HERE'
-- );

-- 5c. If the secrets were never created at all, create rather than update.
--     (Query 1 shows api_key_present = false / resend_sender = NULL.)

-- SELECT vault.create_secret('ValueSpot <onboarding@resend.dev>', 'resend_sender');
-- SELECT vault.create_secret('PASTE_THE_KEY_HERE', 'resend_api_key');

-- 5d. Clear the 60-second cooldown so you can retry immediately after a fix.

-- DELETE FROM login_verifications
--  WHERE verified_at IS NULL
--    AND user_id = (SELECT id FROM auth.users WHERE email = 'pdkaslikar29@gmail.com');

-- After any fix: sign in again, request a code, then re-run query 3.
-- status_code 200 means it left Resend.
