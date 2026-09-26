# Authentication — Test Checklist

Tests A–T from the finalisation brief. Each row says who can run it and what
already happened.

**Legend** · **DONE** verified against the live project · **MANUAL** needs your
browser, inbox or SQL Editor · **BLOCKED** waiting on migration 023.

---

## Step 0 — apply migration 023 first

```
supabase/migrations/023_finalize_email_2fa.sql
```

Paste into the Supabase SQL Editor. It creates one function and pins the
access-token hook's `search_path`. `npm run doctor` currently reports this as
the only outstanding item.

**Immediately afterwards, sign in once** and confirm you reach your portal. The
hook was redefined; if anything were wrong with it, RLS would see every user as
an ordinary employee and HR screens would silently return nothing. This one
sign-in is the check that matters most.

---

## Automated / already verified

| # | Test | Status | Evidence |
| --- | --- | --- | --- |
| J | Passwordless OTP session calls `request_login_code()` | **DONE** | Returned `password_required`. Verified live earlier |
| K | Unverified password session reads protected tables | **DONE** | 0 rows across employees, nominations, notifications, badges, feed, app_config — while holding a `super_admin` claim |
| R | Browser forges a `login_verifications` row | **DONE** | HTTP **403** authenticated, **401** anonymous |
| S | Service-role key in the bundle | **DONE** | Absent. `sb_secret` matches only the SDK's own literal `t.startsWith("sb_secret_")`, not a key |
| — | Unauthenticated reads of every protected table | **DONE** | HTTP 200, **rows=0** |
| — | `login_verifications` readable by anon | **DONE** | HTTP **401** |
| — | Anon calling the 2FA RPCs | **DONE** | HTTP **401** |
| — | `SECURITY DEFINER` without `SET search_path` | **DONE** | 1 found (`custom_access_token_hook`), fixed in 023 |
| — | Type-check / lint / build | **DONE** | All pass |

## Manual — needs your browser and inbox

| # | Test | Expected |
| --- | --- | --- |
| A | Correct password + correct code | Access granted, correct portal |
| B | Correct password + wrong code | Denied; "4 attempts remaining" |
| C | Five wrong codes | Code locked; further attempts refused without counting down |
| D | Expired code | Denied. Backdate with `LIFECYCLE_CHECKS.sql` query 4 — sends no email |
| E | Reuse a code that already succeeded | Denied. `code_hash` is NULL after success |
| F | Request a new code, then submit the old one | Old code denied |
| G | Press Resend twice quickly | Cooldown; button shows the server's countdown |
| H | Exceed 10 codes in an hour | `rate_limited`. Use `LIFECYCLE_CHECKS.sql` query 5 — sends no email |
| I | Code from session A used in session B | Denied — hash is salted with `session_id` |
| L | Unverified session attempts a protected **write** | Denied |
| M | Verified session reads protected tables | Correct data returned |
| N | **Logout, then reuse the old access token** | **Denied immediately.** This is what 023 fixes — see below |
| O | Token refresh after verification | Still verified, **no new code** |
| P | Browser F5 after verification | Still signed in, **no new code** |
| Q | Role routing: employee / manager / hr_admin / super_admin | Correct portal each; only super_admin sees Administration |
| T | Double-click Verify / Resend | No inconsistent state; `FOR UPDATE` lock holds |

### Test N in detail — the one that changed

Before 023, logging out left the verification row in place. An access token
captured before logout stayed valid until it expired (~1 hour), and every policy
still passed for it.

1. Sign in and verify. In the console:
   `JSON.parse(localStorage[Object.keys(localStorage).find(k=>k.endsWith('-auth-token'))]).access_token` — keep it.
2. Log out through the UI.
3. Replay that token:

```js
await (await fetch('https://kuyubrjsfujgfcznjvit.supabase.co/rest/v1/employees?select=id&limit=1', {
  headers: { apikey: '<anon key>', Authorization: 'Bearer ' + '<the token from step 1>' },
})).text()
```

* **PASS** — `[]` (zero rows). The token is still cryptographically valid, but it
  is no longer a *verified* session, so 022's policies refuse it.
* **FAIL** — a row comes back. 023 did not apply, or `revoke_login_verification`
  was not reached.

Do not paste the token into chat. `[]` or a row is all I need.

### Test Q — role accounts

`pushkarkaslikar@gmail.com`, `pushkarkaslikar2@`, `pushkarkaslikar3@` exist but
**cannot receive email** — the Resend development sender only delivers to the
account owner. Use `supabase/setup/TEST_LOGIN_WITHOUT_EMAIL.sql` to plant a
known code from the SQL Editor. It exercises the real `verify_login_code()`
path — same hash comparison, same attempt counter, same RLS — and changes no
function, policy or grant.

---

## Before handover

- [ ] Migration 023 applied, and one sign-in confirmed afterwards
- [ ] Tests A–T above
- [ ] **Signup allowlist set to `touchcoresystems.com`** (Administration → Signup
      domains). It is currently **open to any address** — correct for
      development, must not ship
- [ ] `VERIFY_LIVE.sql` query 6 → 0 unprotected policies across 18 tables
- [ ] Resend company sending domain — Touchcore IT, see `DEPLOYMENT_PREREQUISITES.md`
- [ ] `CLEANUP.sql` last, after all testing
