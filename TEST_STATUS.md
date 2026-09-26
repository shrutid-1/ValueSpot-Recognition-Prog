# Test Status — Touchcore ValueSpot

Every test is in exactly one of three buckets, by **who can run it**.

Legend: PASS = verified against the live project · READY = written, awaiting a
run · BLOCKED = needs something outside the developer's control.

---

## Bucket A — completable by the developer now

### A1. Security enforcement (all PASS, verified live)

| Test | Result |
| --- | --- |
| Password-only session reads `employees` | 0 rows |
| Password-only session reads `nominations` | 0 rows |
| Password-only session reads `notifications` | 0 rows |
| Password-only session reads `employee_value_badges` | 0 rows |
| Password-only session reads `v_recognition_feed` | 0 rows |
| Password-only session reads `app_config` | 0 rows |
| `current_employee_role()` while unverified | `null` |
| Forging a row in `login_verifications` | HTTP 403 |
| Passwordless OTP session calls `request_login_code()` | `password_required` |
| Passwordless OTP session reads `employees` | 0 rows |
| Unprotected RLS policies across all 18 tables | **0** |
| `session_id` stable across token refresh | true |
| Verification survives token refresh | true |

The password-only session in these tests carried a `super_admin` JWT claim and
still read nothing. Enforcement is in the database, not the UI.

### A2. Code lifecycle (PASS)

| Test | Result |
| --- | --- |
| Wrong code decrements attempts | 4, 3, 2, 1 remaining |
| Fifth wrong code locks the session | `locked` |
| Sixth attempt refused without counting | `locked` |
| 60-second resend cooldown | `cooldown` |
| Code from another session rejected | `invalid` |
| Reissuing a code invalidates the previous one | `invalid` |
| Correct code destroys the stored hash | `code_hash IS NULL` |
| No plaintext code ever stored | all hashes 64-char SHA-256 |

### A3. Static and build (PASS)

| Test | Result |
| --- | --- |
| `npm run type-check` | clean |
| `npm run lint` (`--max-warnings 0`) | clean |
| `npm run build` | succeeds |
| `signInWithOtp` anywhere in `src/` | absent (one explanatory comment only) |
| Service-role key anywhere in `src/` | absent |
| Secrets in the repository | none |
| `console.log` / `TODO` / hardcoded `localhost` in `src/` | none |

### A4. Role boundaries — verified by code review of the enforcing SQL

`hr_admin` cannot grant `hr_admin` or `super_admin`, cannot modify a
`super_admin` record, and cannot change signup domain policy. The last active
`super_admin` cannot be demoted or deactivated. These are enforced in
`set_employee_role()` **and** independently by a row trigger, so a direct
`PATCH /rest/v1/employees` cannot bypass them.

Runtime confirmation with a second real account is in Bucket B.

### A5. Remaining, READY to run

| Test | How |
| --- | --- |
| Code expiry returns `expired` | `LIFECYCLE_CHECKS.sql` query 4 (backdates one row) |
| 10/hour rate limit returns `rate_limited` | `LIFECYCLE_CHECKS.sql` query 5 (sends no email) |
| Post-test cleanup | `CLEANUP.sql` |

Both need only the developer's own account.

---

## Bucket B — needs additional test accounts

These require a second and third sign-in identity. They do **not** need
company mailboxes — any mailbox the developer controls works, including
Gmail `+` aliases, provided the signup domain allowlist permits it.

| Test | Needs |
| --- | --- |
| Employee sees only their own recognitions | 1 employee account |
| Manager approves only their assigned nominations | 1 manager account |
| Manager cannot approve another manager's queue | 2 manager accounts |
| `hr_admin` cannot open the Administration section | 1 HR Admin account |
| `hr_admin` cannot promote themselves | 1 HR Admin account |
| Super Admin handover between two administrators | 2 Super Admin accounts |
| `process-approval` rejects a non-assigned approver | 2 accounts |

**Measured, 2026-09-08:** Resend's shared test sender refuses every recipient
except the account owner, with HTTP 403:

> `You can only send testing emails to your own email address
> (pdkaslikar29@gmail.com).`

Gmail `+aliases` do **not** escape this — an earlier note in this file claimed
they would, which was wrong. Only `pdkaslikar29@gmail.com` can receive a code
until a sending domain is verified.

**This no longer blocks Bucket B.** `supabase/setup/TEST_LOGIN_WITHOUT_EMAIL.sql`
plants a known code hash for a test session from the SQL Editor. The login then
completes through the real `verify_login_code()` — same hash comparison, same
attempt counter, same RLS — with no email. It changes no function, policy or
grant, so it tests the shipped authentication path rather than a substitute.

---

## Bucket C — needs Touchcore Systems' IT / domain administrator

| Test | Blocked on |
| --- | --- |
| Login code delivered to a real `@touchcore.in` mailbox | Verified sending domain |
| Delivery to Employee / Manager / HR / Super Admin mailboxes | Verified sending domain |
| Inbox placement, spam-folder behaviour, DKIM alignment | Corporate DNS records |
| Bounce and complaint handling | Resend account owned by Touchcore |
| Real employees completing first sign-in | HR onboarding |

See `DEPLOYMENT_PREREQUISITES.md`. The developer is an external contractor and
is not authorised to modify Touchcore's DNS, SPF, DKIM, DMARC or MX records.

**None of these is an application defect, and none requires a code change, a
migration or a redeploy.** The sender address is read from Supabase Vault at
send time; changing it is one SQL statement run by the project owner.

---

## Known non-blocking issues

| Issue | Severity | Note |
| --- | --- | --- |
| Main JS chunk is 694 kB (201 kB gzipped) | Low | Load-time only. Fix by code-splitting Recharts if the client asks. |

## Fixed during this pass

* Dialogs set an inline `min-width` of 420–440px with no cap, overflowing
  viewports under ~450px. `min-width` beats `max-width` in CSS, so a scoped
  `@media (max-width: 520px)` override was added in `globals.css`.
* The developer's password and two live login codes were hardcoded in three
  browser test scripts. Replaced with a runtime prompt. The files were never
  tracked by git, so nothing was ever committed.
