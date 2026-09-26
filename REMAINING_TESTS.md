# Remaining Tests — developer runbook

Everything here needs something the assistant cannot do: run SQL in the
Supabase SQL Editor, read an inbox, or drive a browser. Each step says exactly
what to paste and exactly what a PASS looks like.

Dev server is already running on **http://localhost:5174** (5173 was in use).

---

## Step 1 — Expiry (LIFECYCLE_CHECKS.sql query 4)

Sign in to the app but **stop at the code screen** — do not enter the code.
Then in the Supabase SQL Editor:

```sql
UPDATE login_verifications
   SET expires_at = now() - interval '1 minute'
 WHERE session_id = (
       SELECT session_id FROM login_verifications
        WHERE verified_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1)
RETURNING session_id, expires_at;
```

Now enter the emailed code in the app.

* **PASS** — refused as expired; you are not let in.
* **FAIL** — the code is accepted.

Sends no email.

---

## Step 2 — Rate limit (LIFECYCLE_CHECKS.sql query 5)

```sql
INSERT INTO login_code_sends (user_id, sent_at)
SELECT u.id, now()
  FROM auth.users u,
       generate_series(1, GREATEST(0, 10 - (
         SELECT count(*) FROM login_code_sends s
          WHERE s.user_id = u.id AND s.sent_at > now() - interval '1 hour')))
 WHERE u.email = 'pdkaslikar29@gmail.com'
RETURNING user_id, sent_at;
```

Then click **Resend code** in the app.

* **PASS** — refused (`rate_limited`), and **no email arrives**.
* **FAIL** — an email arrives.

Clean up:

```sql
DELETE FROM login_code_sends
 WHERE sent_at > now() - interval '5 minutes'
   AND user_id = (SELECT id FROM auth.users WHERE email = 'pdkaslikar29@gmail.com');
```

Sends no email.

---

## Step 3 — RLS coverage (VERIFY_LIVE.sql query 6)

Re-run query 6 from `supabase/setup/VERIFY_LIVE.sql`.

* **PASS** — 18 tables covered, **0** unprotected policies.
* **FAIL** — paste the output; do not edit policies first.

---

## Step 4 — Role boundaries with Gmail aliases

**Corrected.** An earlier version of this file said Gmail `+aliases` would
receive the login code. That was wrong: `check_signup_eligibility` accepts them,
but Resend string-compares the recipient against the account owner address, so
`pdkaslikar29+mgr@gmail.com` is refused with 403 exactly like a separate Gmail
account. Measured, not assumed — three separate addresses all returned:

> `You can only send testing emails to your own email address
> (pdkaslikar29@gmail.com).`

**Only one address can receive a login code until a sending domain is verified.**

Use `supabase/setup/TEST_LOGIN_WITHOUT_EMAIL.sql` instead. It plants a known
code hash for a test session from the SQL Editor, so the login completes through
the real `verify_login_code()` — same hash comparison, same attempt counter,
same RLS — with no email involved. It changes no function, policy or grant.

The three accounts already created (`pushkarkaslikar@`, `pushkarkaslikar2@`,
`pushkarkaslikar3@`) are usable this way; they do not need to be recreated.

All three signed up as `employee`, which is correct — self-registration can
never mint a privileged role. Promote from **Administration** as your Super
Admin, which exercises the real permission path:

| Account | Promote to |
| --- | --- |
| `pushkarkaslikar3@gmail.com` | leave as employee |
| `pushkarkaslikar@gmail.com` | manager |
| `pushkarkaslikar2@gmail.com` | hr_admin |

### Tests

1. **Employee** — no HR or Manager nav; typing `/hr/dashboard` is refused.
2. **Manager** — sees Pending Approvals; typing `/hr/administration` is refused.
3. **HR Admin** — full HR portal, **no Administration item in the sidebar**;
   typing `/hr/administration` directly is still refused.
4. **HR Admin cannot promote itself** — in Employees, attempt to set own role
   to `hr_admin`/`super_admin`. Expect refusal (`needs_super_admin`).
5. **HR Admin cannot touch a Super Admin** — attempt to edit the Super Admin's
   role. Expect refusal.
6. **Super Admin** — same portal *plus* Administration; can grant/revoke roles
   and edit signup domains.

Backstop test — proves it is not just the UI. As HR Admin, in the console:

```js
await (await fetch(location.origin.replace(/.*/, 'https://kuyubrjsfujgfcznjvit.supabase.co') +
  '/rest/v1/employees?id=eq.<YOUR_OWN_EMPLOYEE_ID>', {
  method: 'PATCH',
  headers: {
    apikey: '<anon key>',
    Authorization: 'Bearer ' + JSON.parse(localStorage.getItem(
      Object.keys(localStorage).find(k => k.endsWith('-auth-token')))).access_token,
    'Content-Type': 'application/json', Prefer: 'return=representation',
  },
  body: JSON.stringify({ role: 'super_admin' }),
})).text()
```

* **PASS** — rejected by the row trigger (`403`, or an exception mentioning the
  role guard). Re-check the row afterwards; the role must be unchanged.

---

## Step 5 — process-approval authorization

Already verified without accounts:

| Case | Result |
| --- | --- |
| No `Authorization` header | HTTP 401 |
| Malformed bearer token | HTTP 401 `Invalid JWT` |
| Anon key used as bearer | HTTP 401 `Unauthorized` |

Still to do, needs the accounts from Step 4:

1. **Password-only session** (signed in, code not yet entered) → expect
   **403 Verification required**.
2. **Assigned manager, verified** → expect success.
3. **Other manager, verified** → expect **403 not the assigned approver**.
4. **Employee, verified** → expect **403 Insufficient permissions**.

For 1, sign in and stop at the code screen, then from the console:

```js
await (await fetch('https://kuyubrjsfujgfcznjvit.supabase.co/functions/v1/process-approval', {
  method: 'POST',
  headers: {
    apikey: '<anon key>',
    Authorization: 'Bearer ' + '<access_token from the password-only session>',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ nomination_id: '<a real pending nomination id>', action: 'approve' }),
})).text()
```

A passwordless-OTP session cannot reach this at all — it is already refused at
`request_login_code()`, proven earlier.

---

## Step 6 — Browser flow

At http://localhost:5174 with any test account:

- [ ] Password login reaches the code screen (not the dashboard)
- [ ] Wrong code is refused and decrements the attempt counter
- [ ] Correct code lands on the right portal for the role
- [ ] Navigating between pages does **not** re-prompt for a code
- [ ] **F5 refresh** does not re-prompt
- [ ] Leaving it open past the access-token refresh does not re-prompt
- [ ] Logout returns to login
- [ ] Signing in again **does** require a new code
- [ ] Super Admin and HR Admin land on the **same** `/hr/dashboard`
- [ ] Administration visible only to Super Admin
- [ ] `/superadmin` 404s → redirects to dashboard (no such route exists)

---

## Step 7 — Secure password change

Cannot be read via the API — `/auth/v1/settings` does not expose it. Enable by
hand:

**Supabase Dashboard → Authentication → Providers → Email → Secure password
change → ON**

Change nothing else on that screen.

---

## Step 8 — Cleanup

Run `supabase/setup/CLEANUP.sql` **only after Steps 1–6 are done**.
