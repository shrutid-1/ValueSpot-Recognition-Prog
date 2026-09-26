# Developer setup

Getting a working copy of Touchcore ValueSpot on a new machine.

```bash
git clone <repo>
cd Core-Value-Recognition
npm install
cp .env.example .env      # then fill in the two values below
npm run setup
npm run dev
```

That's it. No pasting SQL into the Supabase dashboard, no running CLI commands
by hand, no checking migration status yourself.

---

## Environment

Two variables, both from **Supabase → Project Settings → API**:

| Variable | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | Project URL, `https://<ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | The **anon / public** key |

**Never put the `service_role` key in `.env`.** Anything prefixed `VITE_` is
compiled into the browser bundle and is public. `npm run setup` fails loudly if
it spots one.

The setup scripts need nothing else — migrations go through the Supabase CLI,
which uses its own linked-project credentials.

---

## Commands

| Command | What it does | Writes? |
| --- | --- | --- |
| `npm run setup` | Validate, show pending migrations, apply them on confirmation, verify | Yes, after you confirm |
| `npm run setup:check` | Everything above except applying anything | **No** |
| `npm run db:status` | Raw `supabase migration list` | No |
| `npm run db:verify` | Alias of `setup:check` | No |
| `npm run dev` | Runs a soft readiness check, then Vite | No |
| `npm run seed` | Demo employees and recognitions | Yes |

Flags for `npm run setup`:

```bash
npm run setup -- --yes      # skip the confirmation prompt
npm run setup -- --seed     # also run the demo seeders
npm run setup -- --check    # same as setup:check
```

### What `npm run setup` checks

1. **Environment** — both variables present and well-formed; no service-role key
2. **Tooling** — Supabase CLI available
3. **Migrations** — files on disk, which are applied, which are pending; applies
   pending ones *after you confirm*
4. **Seed data** — reference seeds are the CLI's job; demo seeding only on `--seed`
5. **Verification** — project reachable, core tables present, **RLS refusing
   anonymous reads**, privileged RPCs refusing anonymous callers, an
   administrator exists

---

## What it will not do

Deliberate omissions, not gaps:

- **No custom migration engine.** It shells out to the Supabase CLI. The files
  in `supabase/migrations/` are the only source of truth for schema, and
  `supabase_migrations.schema_migrations` is the only ledger. A second ledger
  disagreeing with the first is how schemas get corrupted.
- **Never resets, drops, truncates or deletes.** `scripts/setup/guard.ts`
  refuses those operations by name. If you genuinely need one, do it
  deliberately by hand.
- **Never writes without confirmation** against a hosted project, and never at
  all under `--check`. In a non-interactive shell the answer is no unless
  `--yes` is passed — it fails closed.
- **Never seeds unless asked.** `--seed` is opt-in, and seeding a hosted project
  asks again.

## `npm run dev` and the readiness check

`predev` runs `setup:check --soft`. Soft means it reports problems and then
**starts Vite anyway**. A readiness check that can block `npm run dev` is worse
than no check — being offline, or having the project paused, shouldn't stop you
editing CSS.

It never applies migrations. Only an explicit `npm run setup` does that.

---

## Database changes

Permanent schema changes are migration files, in Git:

```
supabase/migrations/028_add_something.sql
```

Never a change pasted into the dashboard and left there. The next person to run
`npm run setup` gets your change; anything applied by hand exists only on your
machine's idea of the database.

Write them **idempotent** where practical — `CREATE TABLE IF NOT EXISTS`,
`CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`,
`INSERT … ON CONFLICT DO NOTHING`.

### Security-critical verification

`npm run setup` verifies that the database is *reachable and migrated*. It does
**not** replace the security test suites:

```
supabase/setup/VERIFY_026.sql    who may create an employee record, at what role
supabase/setup/VERIFY_027.sql    who may send invitations, and where links point
```

Those impersonate signed-in sessions with `SET LOCAL ROLE` and must run in the
SQL Editor as an owner. Approximating them from a script would give false
confidence, so it doesn't try. Run them by hand after any change touching
roles, invitations or RLS.

---

## Troubleshooting

**"Could not read migration state"** — the project isn't linked. `npx supabase link`.

**"Core tables present — FAIL"** — migrations haven't run. `npm run setup`.

**"RLS refuses anonymous reads — FAIL"** — stop and investigate. It means
employee data is readable by anyone holding the public key.

**"An administrator exists — WARN"** — nobody has signed up yet. The first
account to complete signup becomes Super Admin; that's the intended bootstrap.
