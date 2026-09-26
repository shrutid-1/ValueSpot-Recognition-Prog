# Deployment Prerequisites — Touchcore ValueSpot

Who does what before ValueSpot goes live at Touchcore Systems.

This file exists because a small number of steps **cannot be performed by the
application developer**. They require control of Touchcore Systems' corporate
domain and Supabase project, which is a client responsibility. Everything else
is already built, applied and tested.

---

## 1. Split of responsibility

| Area | Owner | Status |
| --- | --- | --- |
| Application code, schema, RLS, 2FA design | Developer | Complete |
| Migrations 001–022 applied to the project | Developer | Complete |
| Security verification against the live project | Developer | Complete |
| **Production email sender domain** | **Touchcore IT / domain admin** | **Not started — see §2** |
| Production Supabase project ownership | Touchcore IT | Client decision |
| Real employee mailboxes for role testing | Touchcore HR | Client decision |

The developer building this application is an external contractor and is **not
authorised to modify Touchcore Systems' DNS, SPF, DKIM, DMARC or MX records**.
No such change has been made or attempted.

---

## 2. Production email sender — CLIENT IT STEP

ValueSpot sends one kind of email: the six-digit login code, delivered through
Resend from inside the database (migration 021, `pg_net` → Resend API).

### What is already done

* The sending mechanism is built, applied and proven working end to end.
* The API key and sender address live in **Supabase Vault**, never in the
  repository, never in the browser bundle, never in `.env`.
* The sender address is read at send time:

  ```sql
  SELECT decrypted_secret INTO sender
    FROM vault.decrypted_secrets WHERE name = 'resend_sender';
  ```

  Changing the sender is therefore a **one-line configuration change**, not a
  code change and not a migration.

### What Touchcore IT must do

**Nothing here assumes anything about Touchcore's existing email setup.** The
only thing known about it is the address convention `name@touchcoresystems.com`.
Whether they run Google Workspace, Microsoft 365, their own server, or something
else is unknown and does not need to be known — the decisions below belong to
whoever owns that infrastructure.

1. Decide which transactional email provider ValueSpot should send through.
   The application currently posts to Resend; a different provider would need a
   small migration to change the endpoint (see §3).
2. Decide which sending identity ValueSpot should use, and verify it with that
   provider according to the provider's own instructions.
3. Publish whatever DNS records the provider requires, wherever that domain's
   DNS is managed.
4. Do not disturb any existing mail configuration — SPF, DKIM or DMARC records
   already in place — without the owner's intent. Adding a sending identity
   should not require changing company-wide mail policy.
5. Once the provider reports the sender verified, set the two Vault secrets in
   the Supabase project:

   ```sql
   -- Run once, by the Supabase project owner, in the SQL Editor.
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'resend_api_key'),
     '<the Touchcore Resend API key>'
   );

   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'resend_sender'),
     'ValueSpot <valuespot@touchcoresystems.com>'
   );
   ```

   The developer must not be given this API key, and does not need it.

### Until that is done

Login codes are sent from the **developer's own verified Resend test sender**.
That sender can deliver to the developer's own mailbox only. This is a Resend
account limitation, not an application limitation, and it does **not** affect:

* the correctness of the code generation, hashing, expiry, cooldown, attempt
  lockout or single-use logic;
* any RLS policy;
* any role boundary;
* the second-factor enforcement in the database or the Edge Functions.

**Nothing in the application needs to change when the client sender is
configured.** No migration, no redeploy, no rebuild.

---

## 3. Security architecture — frozen, do not alter for email reasons

The following is settled and must not be modified in response to email or
domain configuration problems:

* Email **and** password as the first factor.
* A **session-bound** six-digit email code as the second factor, stored only as
  `sha256(code || ':' || session_id)`.
* Supabase passwordless OTP (`signInWithOtp` / `/auth/v1/otp`) is **never** the
  second factor. A passwordless session is refused at `request_login_code()`.
* The second factor is enforced in **RLS and SECURITY DEFINER functions**, not
  in React. The Edge Functions check it explicitly because the service role
  bypasses RLS.
* HR Admin and Super Admin share the **same HR portal**. Super Admin sees an
  additional Administration section.
* There is **no** separate Super Admin portal and **no** hidden Super Admin
  route.
* There is **no** access-code system.

---

> **Company domain corrected 2026-09-09.** This file previously said
> `touchcore.in`, which is not the company's domain. The confirmed employee
> email format is `name@touchcoresystems.com`. Allowlisting the old value would
> have rejected every real employee. Unrelated to the abandoned Clerk work; the
> finding stands on its own.

## 4. Open self-registration — MUST be closed before handover

`check_signup_eligibility` currently returns `{"status":"open"}` for **any**
email address, including `someone-else@gmail.com`. The signup domain allowlist
is unset, so anyone on the internet can register.

Self-registration can only ever produce the `employee` role, and the account
still has to pass the emailed code, so this is not a privilege-escalation path.
But an `employee` can read the recognition feed and the employee directory, so
leaving it open in production would expose internal data to outsiders.

**Fix — no code change, no migration.** As Super Admin:
**HR portal → Administration → Signup domains → add `touchcoresystems.com` → Save.**

Verify afterwards:

```bash
curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/check_signup_eligibility"   -H "apikey: $ANON_KEY" -H 'Content-Type: application/json'   -d '{"p_email":"someone-else@gmail.com","p_full_name":"Test"}'
# expect: {"status": "domain_blocked"}
```

Leave it open only while creating Gmail-alias test identities; close it before
handover.

---

## 5. Client sign-off checklist

- [ ] Signup domain allowlist set to touchcoresystems.com (see §4)
- [ ] Secure password change enabled (Auth > Providers > Email)
- [ ] Resend account owned by Touchcore Systems
- [ ] Sending domain verified in Resend by Touchcore's domain administrator
- [ ] `resend_api_key` set in Supabase Vault by the project owner
- [ ] `resend_sender` set to the verified Touchcore address
- [ ] One test login completed by a Touchcore employee on a company mailbox
- [ ] Supabase project ownership transferred to Touchcore Systems
- [ ] `supabase/setup/CLEANUP.sql` run to remove testing-only helpers
