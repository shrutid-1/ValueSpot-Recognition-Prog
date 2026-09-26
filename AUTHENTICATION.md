# ValueSpot Authentication

Final architecture. Supersedes every earlier evaluation — Clerk and
TOTP/authenticator MFA were both assessed and rejected.

---

## The flow

```
email + password
      |
      v
supabase.auth.signInWithPassword()        <- password is ALWAYS first
      |
      v
authenticated session, NOT yet verified   <- reads no application data
      |
      v
request_login_code()                      <- refuses non-password sessions
      |
      v
6-digit code, emailed via pg_net -> Resend
      |
      v
verify_login_code(code)                   <- checked against THIS session
      |
      v
verified session
      |
      v
employee profile loads, routed by role
```

No QR codes, no authenticator apps, no TOTP, no third-party identity provider,
and **no passwordless OTP login**.

---

## Why the second factor cannot replace the password

`request_login_code()` refuses outright unless the session already
authenticated with a password:

```sql
IF NOT ('password' = ANY(methods)) THEN
  RETURN jsonb_build_object('status', 'password_required');
END IF;
```

A session created by Supabase's passwordless `/auth/v1/otp` carries
`amr: ['otp']` and stops there. **Inbox access alone can never produce
application access.** The application never calls `signInWithOtp()`.

---

## Session binding

The code is stored only as:

```
sha256(code || ':' || session_id)
```

`session_id` is taken from the verified JWT (`current_session_id()`), never from
the browser. A code issued for session A therefore cannot verify session B —
the hash simply will not match.

`session_id` is stable across access-token refresh, which is what lets
verification survive a refresh without re-prompting.

---

## Where security is actually enforced

**In the database, not in React.** Migration 022 gates 43 policies plus a
recreated `employees_read_active` on one function:

```sql
USING ( public.session_second_factor_ok() AND <original condition> )
```

An unverified session reads **zero rows** from every protected table, even
holding a `super_admin` role claim. The frontend's `verified` flag is
presentation only — `AuthContext` derives it from the `session_status()` RPC,
never by decoding the token.

`login_verifications` and `login_code_sends` have RLS enabled with **no
policies**, plus `REVOKE ALL ... FROM anon, authenticated`. The browser cannot
read them, and cannot insert a row to mark itself verified.

---

## Codes

| Property | Value |
| --- | --- |
| Length | 6 digits |
| Source | `gen_random_uuid()` → 60 bits → mod 1e6 (CSPRNG) |
| Storage | SHA-256, salted with `session_id`. Never plaintext |
| Lifetime | 10 minutes, checked server-side |
| Wrong attempts | 5, then locked; further attempts refused without counting |
| On success | `verified_at` set, `code_hash` set to NULL — cannot be replayed |
| On reissue | The row is overwritten, so the previous code stops working |

Codes never appear in logs, source, `localStorage`, or any `SELECT` reachable
by a client.

---

## Rate limiting

| Control | Limit |
| --- | --- |
| Resend cooldown | 60 seconds per session |
| Per account | 10 codes per hour |
| Verify attempts | 5 per code |

Enforced in `request_login_code()` / `verify_login_code()`, so the limits hold
whether the caller is the UI or a script. `verify_login_code()` takes a
`FOR UPDATE` row lock, so two submissions racing cannot both spend an attempt or
slip past the ceiling.

The UI reflects the server's actual response (`cooldown`, `rate_limited`,
`locked`) rather than running its own timer.

---

## Token refresh

A refreshed access token keeps the same `session_id`, so
`session_second_factor_ok()` still finds the verification row. **No code is
requested on navigation, on re-render, on API calls, or on token refresh.**
Verified live earlier in this project: `session_id` was stable across refresh
and the session stayed verified.

---

## Logout

`signOut()` revokes the refresh token, but the access token already in the
browser stays cryptographically valid until it expires — PostgREST checks a
signature and an expiry, not a revocation list.

Migration **023** closes that window. `AuthContext.signOut()` calls
`revoke_login_verification()` **before** signing out, while the session can
still authenticate the call. The verification row is deleted, so 022's policies
refuse that token immediately rather than an hour later.

The function acts only on the caller's own rows — `auth.uid()` from the verified
JWT, with no user or session parameter — so it cannot be turned against anyone
else's session.

---

## Recovery

Losing a phone is irrelevant here: the second factor is the user's **email
inbox**, which they recover through their normal mail provider. This is the main
practical advantage over TOTP, which has no backup codes in Supabase and would
have required an admin reset path.

Password reset is Supabase's own flow (`resetPasswordForEmail`). It resets a
password; it does not bypass the second factor.

---

## Development vs production

|  | Development | Production |
| --- | --- | --- |
| Accounts | Any test addresses (Gmail etc.) | `@touchcoresystems.com` |
| Restriction | Allowlist empty (open) | Allowlist set to the company domain |
| Sender | A domain **the developer** controls, verified in their own provider account | Decided by whoever owns Touchcore email |
| DNS | On the developer's own domain only | Not assumed — see below |

**Nothing here touches or assumes Touchcore infrastructure.** The development
sender lives on a domain the developer owns; the production sender is a separate
decision by the infrastructure owner. The only known fact about production is the
address convention `name@touchcoresystems.com`.

The restriction is **data, not code** — `app_config.signup_allowed_domains`,
edited by a Super Admin at **Administration → Signup domains**. Nothing is
hardcoded, so development with Gmail keeps working while production can be
locked to the company domain without a code change or a deploy.

Placeholders and seeded demo data use `@touchcoresystems.com`, the correct
company convention.

### ⚠️ Production prerequisite — self-registration is currently open

The allowlist is unset, so **any** address can register today. That is correct
for development and **must not ship**. Self-registration only ever grants the
`employee` role and still requires the emailed code, so it is not a privilege
escalation — but an `employee` can read the recognition feed and directory.

Before handover: **Administration → Signup domains → add `touchcoresystems.com`.**

### Resend

`resend_api_key` and `resend_sender` live in **Supabase Vault**, read inside
`request_login_code()`. They are never in the repository, the browser bundle,
`.env`, or any migration.

**The sender identity decides who can receive a code.** A provider's shared test
sender (`onboarding@resend.dev`) delivers **only to the address that owns the
provider account** — one mailbox, no DNS needed.

**To test with multiple accounts** (several employees, managers and HR at once),
verify a domain **you control** in your own provider account and point the sender
at it:

```sql
SELECT vault.update_secret(
  (SELECT id FROM vault.secrets WHERE name = 'resend_sender'),
  'ValueSpot <noreply@a-domain-you-control.com>'
);
```

That is the entire change: **no migration, no RLS change, no function change, no
frontend change, no redeploy.** The recipient always comes from the verified JWT,
so nothing about who receives a code is configurable or spoofable.

The production sender is a separate decision for whoever owns Touchcore's email
infrastructure — see `DEPLOYMENT_PREREQUISITES.md`. Nothing in this project
assumes what that infrastructure is.

**One thing is not configurable:** the provider endpoint is hard-coded at
`021_session_bound_2fa.sql:280` (`https://api.resend.com/emails`). Switching to a
different email provider would need a new migration to change that URL and the
request shape. Changing the *sender* does not.

---

## Security assumptions

1. The Supabase JWT signing key is not compromised.
2. Supabase Vault protects the Resend key at rest.
3. The user's email account is not already compromised — the inbox *is* the
   second factor.
4. The service-role key never reaches the browser. It appears in no frontend
   source and in no build output.
5. `custom_access_token_hook` stays registered; without it RLS sees everyone as
   an ordinary employee.

---

## Roles

`employee` · `manager` · `hr_admin` · `super_admin`

Super Admin uses the **same HR portal** plus an Administration section at
`/hr/administration`, guarded by `requiredRole={['super_admin']}` and re-checked
in the database on every action. **There is no `/superadmin` route.** No role
can bypass the second factor: every policy carries the same gate.

---

## Migrations

| Migration | Role |
| --- | --- |
| `021_session_bound_2fa.sql` | Tables, code generation, verification, rate limits |
| `022_two_factor_everywhere.sql` | Applies the gate to 43 policies |
| `023_finalize_email_2fa.sql` | Logout revokes the verification immediately |

021 and 022 are **applied and must never be edited**. 023 is additive: one new
function, no table, policy, or existing function changed. Rollback is
`DROP FUNCTION public.revoke_login_verification(boolean);`.
