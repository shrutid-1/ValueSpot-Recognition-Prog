# Touchcore ValueSpot

**Recognize the behaviour. Reinforce the value. Strengthen the culture.**

An internal employee recognition and Core Values culture platform for Touchcore Systems Pvt. Ltd.

---

## Prerequisites

- Node.js 20 LTS or later: https://nodejs.org
- A Supabase project: https://supabase.com

---

## Setup — Step by Step

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and add your Supabase project URL and anon key:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

Find these in your Supabase dashboard → Project Settings → API.

### 3. Set up the database

In your Supabase dashboard, open the **SQL Editor** and run each migration in order:

1. `supabase/migrations/001_core_tables.sql`
2. `supabase/migrations/002_core_values.sql`
3. `supabase/migrations/003_nominations.sql`
4. `supabase/migrations/004_badges.sql`
5. `supabase/migrations/005_supporting.sql`
6. `supabase/migrations/006_views_and_auth.sql`
7. `supabase/migrations/007_rate_limits_and_config_access.sql`
8. `supabase/migrations/009_approval_notifications_and_clarification.sql`
9. `supabase/migrations/011_auth_complete.sql`  ← **authentication; nothing works without it**
10. `supabase/migrations/012_self_service_signup.sql`  ← **open registration; without it signup is invite-only**
11. `supabase/migrations/013_role_access_codes.sql`  ← **lets managers and HR register themselves**
12. `supabase/migrations/014_signup_domains.sql`  ← **domain allowlist, editable from HR Settings**
13. `supabase/migrations/015_first_admin_bootstrap.sql`  ← **creates your first Super Admin**

Then run the seed files:

1. `supabase/seed/001_badge_definitions.sql`
2. `supabase/seed/002_app_config.sql`
3. `supabase/seed/003_core_values.sql`

For development demo data (optional but recommended):

4. `supabase/seed/004_demo_data.sql`
5. `supabase/seed/005_demo_nominations.sql`

### 4. Configure the Auth hook

In Supabase dashboard → Authentication → Hooks, add a custom access token hook pointing to the `custom_access_token_hook` function created in migration 006.

This adds `user_role` and `employee_id` to JWT tokens, which is required for RLS policies to work.

### 5. Auth settings

In Authentication → Providers → Email:

- **"Allow new users to sign up"** — leave **ON**.
- **"Confirm email"** — **OFF** for the intended experience. Signing up then
  signs the person straight in with no confirmation email. Turn it ON if you
  want mailbox ownership proven as a second check; the app supports both.

Signup being open is safe here because a person who registers themselves can
only ever receive the `employee` role. The role is written by the database in
`claim_employee_account()`, never sent by the browser, so no request to
`/auth/v1/signup` can produce a manager, HR or admin account.

### 6. How accounts are created

Nobody is created by hand in the Supabase dashboard. There are four ways in,
and the **database decides the role in every one of them**:

| Situation | What happens | Role |
|---|---|---|
| **No administrator exists yet** | **This account bootstraps the system** | **`super_admin`** |
| HR added you already | Your record is linked; full name must match it | whatever HR set |
| You hold an access code | A record is created at the code's role | `manager` / `hr_admin` |
| Nobody added you | A record is created for you | `employee` |

**Setting up for the first time:** just sign up. Until a usable administrator
exists — one that is active *and* has a login attached — the next person to
register becomes the Super Admin, whatever else is already in the table. The
signup screen says so while that window is open, and the window closes for good
the moment it is used. No SQL, no seeded credentials, no code compiled into the
app.

```
Person opens /signup
        ↓
Picks a portal, enters full name + company email + password
        ↓   (Manager / HR also enter an access code)
Supabase creates the auth user
        ↓
claim_employee_account() links or creates the employee record
        ↓
Signed in, on the dashboard for their real role
```

**The portal selector is verified, not obeyed.** Choosing "HR Admin" on the
form grants nothing. At signup the role is read off the employee record or the
redeemed access code; at login the selection only narrows where you land and is
refused if your real role does not permit it.

#### Access codes

Employee accounts need nothing. Manager and HR accounts need a code, issued
from **HR → Settings → Manager & HR access codes**:

- `super_admin` may issue **manager** and **hr_admin** codes.
- `hr_admin` may issue **manager** codes only.
- Anyone else may issue nothing.

A code is shown **once**, at the moment it is created. Only its SHA-256 hash is
stored, so a leak of the table yields nothing usable and even an administrator
cannot read a code back — lost codes are revoked and reissued, never recovered.
Every code carries an expiry, a use limit, and a revoke switch, and redemption
is rate limited per account so codes cannot be brute forced through the API.

This is where credentials are separated by role. Passwords themselves stay in
`auth.users`, hashed by Supabase, exactly once — a second password table would
mean hand-rolling password storage and letting one person exist twice with two
different passwords.

#### What stands between a stranger and elevated access

- **Self-registration mints only the lowest privilege.** `'employee'` is
  hard-coded in `claim_employee_account()`; no argument, JWT claim or metadata
  field can raise it.
- **The name check on invited records.** If HR entered someone as a manager,
  knowing the address is not enough to claim it — the full name must match.
- **An optional domain allowlist** for self-registration, managed in
  **HR → Settings → Who can register**. Invited addresses and code holders are
  unaffected.

  Left empty (the default), any address may register as an employee. Set it
  before going to production if the app is reachable from the public internet;
  the card warns while it is empty.

HR's **Invite Employee** action pre-creates the employee record with the right
role and department, so that person needs no code at all.

For the demo data in `004_demo_data.sql`, sign up with an email address from
that file and the matching full name.

### 7. Deploy Edge Functions

Signup does **not** need an Edge Function — `claim_employee_account()` handles it.
`process-approval` is required for the manager approval workflow; the rest are
optional enhancements the app degrades gracefully without.

```bash
npx supabase functions deploy process-approval   # required for approvals
npx supabase functions deploy check-rate-limits  # optional (DB trigger also enforces limits)
npx supabase functions deploy calculate-badges   # optional (backfill/reseed)
npx supabase functions deploy check-duplicate    # optional (advisory warning)
```

### 8. Verify the setup

```bash
npm run doctor
```

Probes the project read-only and lists anything still missing, with the exact
fix for each. Run it whenever sign-up or sign-in misbehaves — most problems are
an unapplied migration or an auth toggle rather than an application bug.

### 9. Start the development server

```bash
npm run dev
```

Open http://localhost:5173

---

## Test Accounts

There are no pre-made credentials.

To exercise a specific role, register through `/signup` using an email address
from `supabase/seed/004_demo_data.sql` together with that employee's exact full
name. The role comes from the seeded record, so signing up against a `manager`
row lands you on the manager dashboard.

Registering with any other address gives you an ordinary `employee` account.

Sign in afterwards with the same address.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start development server |
| `npm run build` | Production build |
| `npm run type-check` | TypeScript validation |
| `npm run lint` | ESLint |
| `npm run preview` | Preview production build |
| `npm run supabase:types` | Regenerate DB types from schema |
| `npm run doctor` | Check the Supabase project setup and report what is missing |

---

## Project Structure

```
src/
├── app/           Router, providers
├── components/    UI, layout, shared components
│   ├── ui/        Base UI components
│   ├── layout/    AppShell, Sidebar, TopBar
│   ├── recognition/ Recognition wizard components
│   ├── badges/    Badge display components
│   ├── notifications/ Notification center
│   └── shared/    EmptyState, Skeleton, etc.
├── context/       AuthContext, NotificationContext
├── hooks/         Custom React hooks
├── lib/           Supabase client, utilities, constants
├── pages/         Page-level components
│   ├── auth/      Login, Reset Password
│   ├── employee/  Dashboard, Give Recognition, Feed, Journey
│   ├── manager/   Approvals, Team views
│   └── hr/        HR Dashboard, Analytics, Reports, Admin
├── styles/        Global CSS
└── types/         TypeScript types
supabase/
├── migrations/    Database schema migrations (run in order)
├── seed/          Seed data (production + dev demo)
└── functions/     Edge Functions
```

---

## Architecture Notes

- **Authorization is database-enforced** via Supabase RLS. Frontend route guards are UX only.
- **No hard-coded thresholds** — badge levels, rate limits, and financial year config are all read from the database.
- **Historical data integrity** — nominations carry snapshot fields so records remain accurate after employee relationship changes.
- **Badge calculation** runs in the `process-approval` Edge Function after each approval, using database-driven thresholds.

---

## Security

- Never commit `.env` (it's in `.gitignore`)
- `SUPABASE_SERVICE_ROLE_KEY` is only used in Edge Functions via `Deno.env.get()`
- It must never appear in any file under `src/`
