# Touchcore ValueSpot
## Complete Project Handover & Setup Guide

| | |
|---|---|
| **Generated** | 2026-09-26, from the project owner's working copy of the repository |
| **Verified against** | `package.json`, `scripts/`, `supabase/migrations/` (53 files), `supabase/functions/` (6 functions), `src/`, and read-only checks against the linked Supabase project |
| **Audience** | A developer (or technically competent HR/IT person) setting ValueSpot up on a new Windows laptop, who has never seen the project |
| **Supersedes** | The setup steps in `README.md`, `DEVELOPER_SETUP.md`, `DEPLOYMENT_PREREQUISITES.md`, `AUTHENTICATION.md` and `ENVIRONMENT_VARIABLES_REFERENCE.md` where they disagree with this file (see §26 for the specific conflicts) |

---

## Table of contents

1. [Purpose of this document](#1-purpose-of-this-document)
2. [Project overview](#2-project-overview)
3. [Current architecture](#3-current-architecture)
4. [Prerequisites](#4-prerequisites)
5. [Clone the repository](#5-clone-the-repository)
6. [Install dependencies](#6-install-dependencies)
7. [Environment variables](#7-environment-variables)
8. [Supabase project connection](#8-supabase-project-connection)
9. [Database migrations](#9-database-migrations)
10. [Supabase Auth configuration](#10-supabase-auth-configuration)
11. [Email / Brevo configuration](#11-email--brevo-configuration)
12. [Gemini / AI configuration](#12-gemini--ai-configuration)
13. [Edge Functions](#13-edge-functions)
14. [Application startup](#14-application-startup)
15. [First login and test accounts](#15-first-login-and-test-accounts)
16. [Employee verification](#16-employee-verification)
17. [Manager verification](#17-manager-verification)
18. [HR verification](#18-hr-verification)
19. [Super Admin verification](#19-super-admin-verification)
20. [Security rules — DO NOT BREAK THESE](#20-security-rules--do-not-break-these)
21. [Development workflow](#21-development-workflow)
22. [Database safety](#22-database-safety)
23. [Production vs development](#23-production-vs-development)
24. [Troubleshooting](#24-troubleshooting)
25. [Final handover checklist](#25-final-handover-checklist)
26. [Known limitations / manual verification items](#26-known-limitations--manual-verification-items)
27. [Ownership / responsibilities](#27-ownership--responsibilities)
- [Handover Status](#handover-status)

---

## 1. Purpose of this document

This guide takes a person from **a new Windows laptop** to **a fully working ValueSpot development environment** connected to the project's hosted Supabase backend, and then walks through verifying every role (Employee, Manager, HR, Super Admin).

Everything here was taken from what the code actually does, not from older documentation. Where the older documents in the repository disagree with the code, this guide follows the code and says so.

### How to read it

- Commands are written for **Windows PowerShell** unless a block says otherwise. Run them from the project folder.
- Labels used throughout:

| Label | Meaning |
|---|---|
| **OWNER ACTION** | Something the current project owner must do (they hold the accounts and secrets). |
| **CLIENT / IT ACTION** | Something Touchcore IT must do (domains, DNS, company accounts). The developer is not assumed to have this access. |
| **Manual verification required.** | Could not be checked automatically from the repository or the CLI. A person must look. |
| `<OWNER_PROVIDES>` | A value the project owner hands over through a secure channel. |
| `<GET_FROM_SUPABASE>` | A value you copy from the Supabase dashboard yourself. |
| `<DO_NOT_COMMIT>` | A secret. It must never be committed, pasted in chat, or put behind a `VITE_` prefix. |
| `<SET_BY_OWNER>` | A configuration value the owner decides (for example, a production URL). |

### ⚠️ Blocking items — read before starting

These were found while inspecting the repository on 2026-09-26. **Until items 1 and 2 are done, a new laptop cannot follow this guide.**

1. **The current code is not on GitHub. — OWNER ACTION**
   - The owner's local `main` branch has exactly **one commit** (`470da1f`, "Initial ValueSpot application…"). Everything after that — **47 of the 53 migrations, 2 of the 6 Edge Functions (`delete-employee`, `generate-report-insights`), all of `scripts/setup/` and `scripts/verify/`, the entire `src/lib/api/` layer and `src/hooks/queries/`** — exists only as **uncommitted / untracked files** on the owner's machine.
   - The Git remote `origin` (`https://github.com/shrutid-1/Core-Value-Recognition.git`, branch `main`) has **diverged**: it contains 7 newer commits by another contributor (2026-09-21 → 2026-09-24) with a **different** `supabase/migrations/007_clarification_workflow.sql`, a `provision-employees` Edge Function, a `vercel.json`, and it references a **different Supabase project** (`fzierzafqmxhuhinjldv`).
   - Cloning `origin/main` today gives you **a different application that does not match the database** described in this guide.
   - **Owner must:** commit this working tree and publish it to a repository/branch the new developer can clone, and tell them the URL and branch (`<OWNER_PROVIDES>`). **Do not merge `origin/main`'s `007_clarification_workflow.sql` into this migration chain**: the linked database's migration ledger already records a version `007` (this tree's `007_rate_limits_and_config_access.sql`). Two different files with the same version number would corrupt the migration history.

2. **Supabase project access. — OWNER ACTION**
   The linked project (`kuyubrjsfujgfcznjvit`) belongs to the Supabase organization shown by the CLI as *"PushkarKaslikar's Project"*. The new developer's Supabase account must be **invited to that organization** (or the project transferred to a Touchcore-owned organization) before they can run any Supabase CLI command in this guide.

3. **Secrets are not in the repository (correctly). — OWNER ACTION**
   The Gemini API key and Brevo credentials must be handed over securely, or new ones issued by whoever will own those accounts. See §7, §11, §12.

4. **Self-registration is open to any email domain.** A read-only probe on 2026-09-26 returned `{"status": "open", "expected_role": "employee"}` for an `@example.org` address. This is fine for development, but must be restricted before production (§19, §23).

---

## 2. Project overview

**Touchcore ValueSpot** is an internal employee-recognition and Core Values platform for Touchcore Systems.

People recognise colleagues for living a Core Value, the recognition is routed to the right approver, and approved recognitions build badges, a public feed, reports and an internal currency (Value Coins) that can be spent in a Value Store.

### Features present in the code

| Area | What it does |
|---|---|
| Recognition wizard | Employee → Project → Core Value → Behaviour → Scenario → Story → Preview → Submit |
| Approval workflow | Approve / reject / request clarification, routed by **project**, decided server-side |
| Recognition feed | Approved recognitions, appreciations ("likes"), comments with one level of replies |
| Badges | Per employee × Core Value, maintained by database triggers |
| Value Coins | Budget (to give) and earned (received) balances; sending coins on a recognition; HR adjustments |
| Value Store | Rewards with prices and validity; employee redemption spends *earned* coins; HR decides |
| Reports | Employee and organisation reports, export, optional AI interpretation (Gemini) |
| Support & moderation | Employees request corrections; HR / Super Admin moderate recognitions |
| Administration | Super-Admin-only: administrators, HR roles, signup domains, security activity |
| Authentication | Password + **mandatory emailed 6-digit code on every sign-in** (session-bound 2FA) |
| Invitations | HR creates a record at a role and emails a setup link (Brevo) |

### Roles

| Role (database value) | Label in the UI | Portal / login page |
|---|---|---|
| `employee` | Employee | `/login` |
| `manager` | Manager | `/manager/login` |
| `hr_admin` | HR | `/hr/login` |
| `super_admin` | Super Admin | `/hr/login` (same HR portal, plus an **Administration** section) |

There is **no** separate Super Admin portal and **no** `/superadmin` route.

### Technology (versions actually installed on 2026-09-26)

| Layer | Technology |
|---|---|
| UI | React 18.3.1, TypeScript 5.9.3, Vite 5.4.21, Tailwind CSS 3, Radix UI, React Router 6 |
| Server state | TanStack React Query 5.102.8 |
| Backend | Supabase: PostgreSQL 17 + Row Level Security, RPC functions, Auth, Vault, `pg_net`, Storage, Realtime, Edge Functions (Deno) |
| Client SDK | `@supabase/supabase-js` 2.112.4 |
| Email | Brevo transactional email API, called **from inside the database** via `pg_net` |
| AI | Google Gemini API, called **only** from the `generate-report-insights` Edge Function |

There is **no Node/Express backend** and none is needed.

### Repository layout (what matters)

```
Core-Value-Recognition/
├─ src/
│  ├─ app/                 router.tsx (all routes + role guards), providers
│  ├─ pages/               auth/, employee/, manager/, hr/, admin/
│  ├─ components/          UI building blocks
│  ├─ context/             AuthContext (sign-in, 2FA, sign-out), notifications, coins
│  ├─ hooks/queries/       React Query hooks — one file per domain
│  ├─ lib/api/             Business API modules — the ONLY place that talks to Supabase (except auth)
│  ├─ lib/supabase.ts      The single Supabase client (reads the two VITE_ variables)
│  └─ lib/supabase-types.ts  Hand-maintained database types (do not regenerate — see §21)
├─ supabase/
│  ├─ migrations/          53 SQL migrations, 001 → 057 — the database schema
│  ├─ functions/           6 Edge Functions (Deno)
│  ├─ seed/                Reference/demo SQL (NOT used by the normal workflow)
│  ├─ setup/               Owner-only SQL/JS diagnostics — several are DESTRUCTIVE (§22)
│  ├─ setup_complete.sql   LEGACY concatenation of old migrations — never run (§9)
│  └─ config.toml          Supabase CLI config (local-stack settings; not used for hosted)
├─ scripts/
│  ├─ setup/               npm run setup / setup:check / db:migrate / db:verify
│  ├─ verify/              npm run verify:* — static checks of migrations + source
│  ├─ seeders/             npm run seed — demo data, needs the service-role key
│  └─ check-setup.mjs      npm run doctor — read-only probe of the hosted project
├─ .env.example            Template for .env
└─ package.json            All commands used in this guide
```

---

## 3. Current architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ Browser                                                              │
│   React + TypeScript + Vite (static SPA)                             │
│        │                                                             │
│        ▼                                                             │
│   React Query hooks          src/hooks/queries/*                     │
│        │                                                             │
│        ▼                                                             │
│   Business API modules       src/lib/api/*   (no authorization here) │
│        │                                                             │
│        ▼                                                             │
│   supabase-js client         src/lib/supabase.ts                     │
│        │   holds: project URL + publishable/anon key + user's JWT    │
└────────┼─────────────────────────────────────────────────────────────┘
         │ HTTPS
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│ Supabase (hosted project)                                            │
│                                                                      │
│  Auth (GoTrue) ── issues JWT; custom_access_token_hook adds          │
│                   user_role + employee_id claims                     │
│                                                                      │
│  PostgREST ──► PostgreSQL                                            │
│                 • RLS on every table, each policy gated by           │
│                   session_second_factor_ok()  (2FA)                  │
│                 • SECURITY DEFINER RPCs (role checks, coins, store,  │
│                   approvals, reports, invitations, 2FA codes)        │
│                 • Triggers (approval routing, nominee rules,         │
│                   badge maintenance, direct-write guards)            │
│                 • Vault  (brevo_api_key, brevo_sender)               │
│                 • pg_net ──► Brevo API  (2FA codes, invitations,     │
│                                          approval-request emails)    │
│                                                                      │
│  Edge Functions (Deno, service role) — each re-checks JWT + 2FA +    │
│   role itself:  process-approval, delete-employee,                   │
│                 generate-report-insights ──► Google Gemini API       │
│                 calculate-badges, check-duplicate, check-rate-limits │
└──────────────────────────────────────────────────────────────────────┘
```

### Where each concern lives

| Concern | Where | Notes |
|---|---|---|
| **Authentication** (who you are) | Supabase Auth (`signInWithPassword`, `signUp`) + the database 2FA functions `request_login_code()` / `verify_login_code()` | `src/context/AuthContext.tsx`, `src/components/auth/VerifyEmailStep.tsx` |
| **Authorization** (what you may do) | **PostgreSQL**: RLS policies, `SECURITY DEFINER` functions that re-read the caller's role from `employees`, and guard triggers. Edge Functions re-check for themselves. | The React route guards (`ProtectedRoute`) only decide what is *shown*. They are **not** the security boundary. |
| **Database logic** | `supabase/migrations/*.sql` (functions, triggers, policies) | Business rules such as approval routing, nominee eligibility, coin transfers and redemption live here. |
| **RLS enforcement** | Every protected table; the 2FA gate was added to all policies by migration `022` | An unverified session reads **zero rows**. |
| **Edge Functions** | `supabase/functions/` | Used where the service role or an external API is needed (§13). |
| **AI** | `generate-report-insights` Edge Function → Gemini | The browser never sees the key (§12). |
| **Email** | Inside PostgreSQL, via `pg_net` → Brevo, using Vault secrets | No Edge Function sends email (§11). |
| **Secrets** | Supabase **Vault** (Brevo), Supabase **Edge Function secrets** (Gemini), local `.env` (only for scripts) | Never in Git, never in the browser bundle. |

### What must NEVER be placed in the frontend

- The **service-role key** / **secret key** (bypasses all RLS).
- The **Gemini API key**.
- The **Brevo API key**.
- Any Supabase access token or database password.
- Any role decision the server does not re-check. (Roles are always read from the database.)

### What is safe to put in Vite (`VITE_*`) variables

Anything prefixed `VITE_` is compiled into the JavaScript bundle and **is readable by anyone who opens the site**. Only two exist, and both are public by design:

- `VITE_SUPABASE_URL` — the project URL.
- `VITE_SUPABASE_ANON_KEY` — the **publishable** (`sb_publishable_…`) or legacy **anon** (`eyJ…`) key. It grants nothing on its own; RLS and 2FA decide everything.

---

## 4. Prerequisites

### Summary

| Software | Needed for | Status |
|---|---|---|
| Windows 10 or 11 | — | **Required** |
| Git for Windows | Cloning, version control | **Required** |
| Node.js **22 LTS** (includes npm 10) | Installing and running everything | **Required** |
| Supabase account with access to the project | CLI login / link, migrations, functions | **Required** (OWNER ACTION to invite you) |
| Supabase CLI | Migrations, Edge Functions, secrets | **Required — but no separate install**: it runs through `npx supabase` |
| Internet access | The backend is hosted | **Required** |
| Visual Studio Code | Editing | Recommended (any editor works) |
| Docker Desktop | Only for a *local* Supabase stack (`supabase start`, `npm run supabase:types`) | **Not needed** for the normal workflow |

**Not needed:** Deno, a global Supabase CLI install, Python, a Node/Express server, a database client.

---

### 4.1 Git for Windows

1. **What:** Version control.
2. **Why:** To clone the repository and track changes.
3. **Install:** Download from <https://git-scm.com/download/win> and accept the defaults.
4. **Verify:** open a **new** PowerShell window:
   ```powershell
   git --version
   ```
5. **Expected:** `git version 2.x.x.windows.x` (the owner's machine has `2.51.1.windows.1`).
6. **Common problem:** `git : The term 'git' is not recognized…`
7. **Fix:** Close and reopen PowerShell (PATH is read at start-up). If it persists, reinstall and keep "Git from the command line and also from 3rd-party software" selected.

Also set your identity once:

```powershell
git config --global user.name  "Your Name"
git config --global user.email "you@example.com"
```

### 4.2 Node.js 22 LTS (with npm)

1. **What:** JavaScript runtime and package manager.
2. **Why:** Vite, TypeScript, ESLint, the setup/verify scripts (`tsx`) and `npx supabase` all run on Node. **Version 22 is required**: the installed `@supabase/supabase-js` 2.112.4 declares `"engines": { "node": ">=22.0.0" }`. (`README.md` says "Node 20" — that is out of date.)
3. **Install:** <https://nodejs.org> → **22.x LTS** Windows Installer (.msi). Accept the defaults. The optional "Tools for native modules" checkbox is **not** needed.
4. **Verify** (new PowerShell window):
   ```powershell
   node --version
   npm --version
   ```
5. **Expected:** `v22.x.x` and `10.x.x` (owner's machine: `v22.20.0`, `10.9.3`).
6. **Common problem A:** `npm : File C:\Program Files\nodejs\npm.ps1 cannot be loaded because running scripts is disabled on this system.`
   **Fix:** allow signed scripts for your user only, then reopen PowerShell:
   ```powershell
   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
   ```
   (Or use `npm.cmd` / `npx.cmd`, or run the commands from Command Prompt.)
7. **Common problem B:** `npm WARN EBADENGINE Unsupported engine … required: { node: '>=22.0.0' }` during install.
   **Fix:** you have an older Node. Uninstall it and install 22 LTS.

### 4.3 Supabase account and project access

1. **What:** The hosted backend (database, auth, functions).
2. **Why:** Every Supabase CLI command in this guide acts on the hosted project and needs your account to be a member of its organization.
3. **Install:** Create an account at <https://supabase.com/dashboard>, then ask the owner to invite you. — **OWNER ACTION** (see §1, item 2)
4. **Verify:** Sign in to the dashboard; you should see the project whose reference is `kuyubrjsfujgfcznjvit`.
5. **Expected:** The project is listed and opens.
6. **Common problem:** The project is not listed.
7. **Fix:** The invitation was not sent or not accepted, or it was sent to a different email. Ask the owner.

### 4.4 Supabase CLI (via `npx`, no separate install)

1. **What:** Supabase's command-line tool.
2. **Why:** The project's scripts call it as `npx supabase …` to read migration state, apply migrations, deploy functions and set secrets. It is **not** listed in `package.json`; `npx` downloads it on first use. (`scripts/setup/guard.ts` says it "ships as a dev dependency" — that message is inaccurate; it comes through `npx`.)
3. **Install:** nothing to install. On first use, `npx` asks permission to download it.
4. **Verify** (after §6 so you are in the project folder):
   ```powershell
   npx supabase --version
   ```
5. **Expected:** On the first run, `Need to install the following packages: supabase@2.x.x  Ok to proceed? (y)` → type `y`. Then a version number (owner's machine: `2.118.0`). The exact version is not pinned by the project.
6. **Common problem:** The command hangs or fails behind a corporate proxy.
7. **Fix:** Configure npm's proxy (`npm config set proxy …` / `https-proxy …`) — **CLIENT / IT ACTION** to supply the proxy address.

### 4.5 Visual Studio Code (recommended)

1. **What:** Code editor.
2. **Why:** Convenience only. The repository does not ship a `.vscode/extensions.json`, so **no extension is required**.
3. **Install:** <https://code.visualstudio.com/>. During setup, tick **"Add to PATH"**.
4. **Verify:** `code --version`
5. **Expected:** A version number.
6. **Common problem:** `code` is not recognised.
7. **Fix:** Reopen PowerShell, or in VS Code run *Shell Command: Install 'code' command in PATH* from the Command Palette.

Optional extensions that match the tooling in use: **ESLint** (`dbaeumer.vscode-eslint`) and **Tailwind CSS IntelliSense** (`bradlc.vscode-tailwindcss`). Neither is needed to build or run.

### 4.6 Docker Desktop — only for a local Supabase stack

The normal workflow uses the **hosted** Supabase project and does **not** need Docker. Docker is only needed if you deliberately run a local Supabase stack (`npx supabase start`) or the `npm run supabase:types` script (which uses `--local`). Neither is part of this handover; **don't install Docker for normal development.**

Deploying Edge Functions also works without Docker (see §13, `--use-api`).

---

## 5. Clone the repository

> ⚠️ Blocked until the owner publishes the current code (§1, item 1). The URL and branch below come from the owner.

### 5.1 Choose a location

Use a short path that is **not** synced by OneDrive (OneDrive fights with `node_modules`). For example:

```powershell
New-Item -ItemType Directory -Force C:\Projects
Set-Location C:\Projects
```

### 5.2 Clone

```powershell
git clone <REPOSITORY_URL — OWNER_PROVIDES> Core-Value-Recognition
Set-Location Core-Value-Recognition
```

If the owner published to a branch other than the default:

```powershell
git checkout <BRANCH — OWNER_PROVIDES>
```

### 5.3 Confirm you have the right code

Run these three checks. If any fails, **stop** — you have the wrong repository or branch (most likely the old `origin/main` described in §1).

```powershell
git branch --show-current
(Get-ChildItem supabase\migrations\*.sql).Count
Get-ChildItem supabase\functions -Directory | Select-Object -ExpandProperty Name
```

**Expected:**

- The branch the owner told you.
- `53`
- `calculate-badges`, `check-duplicate`, `check-rate-limits`, `delete-employee`, `generate-report-insights`, `process-approval`

Also confirm `scripts\setup\index.ts` exists:

```powershell
Test-Path scripts\setup\index.ts
```

**Expected:** `True`

### 5.4 Confirm the working tree is clean

```powershell
git status
```

**Expected:** `nothing to commit, working tree clean`.

### 5.5 Open it in VS Code

```powershell
code .
```

---

## 6. Install dependencies

### 6.1 Install

```powershell
npm install
```

**Expected:** `added N packages … in Xs`, possibly some `npm warn deprecated …` lines (harmless). There must be **no** `EBADENGINE` warning about Node (if there is, see §4.2).

`package-lock.json` is in sync with `package.json` (checked 2026-09-26), so after installing, `git status` should still show a clean tree. If `package-lock.json` shows as modified, you are probably on a different npm major version; do not commit that change — tell the owner.

### 6.2 Verify `node_modules`

```powershell
Test-Path node_modules\.bin\vite.cmd
Test-Path node_modules\.bin\tsx.cmd
npx vite --version
```

**Expected:** `True`, `True`, `vite/5.4.21 …`.

### 6.3 Accept the Supabase CLI download once

```powershell
npx supabase --version
```

Type `y` if asked (§4.4). Doing it now means later scripts don't pause on the prompt.

### 6.4 Run the project's own checks

These do **not** need `.env` or network access (the `verify:*` scripts only read files).

```powershell
npm run type-check
npm run lint
npm run verify:logic
npm run build
```

| Command | What it runs (from `package.json`) | Expected |
|---|---|---|
| `npm run type-check` | `tsc` over `tsconfig.app.json`, `tsconfig.node.json`, `tsconfig.seeders.json`, `tsconfig.setup.json` | No output after the header; exit code 0 |
| `npm run lint` | ESLint over all `.ts/.tsx`, `--max-warnings 0` | No output after the header. **Any warning fails.** |
| `npm run verify:logic` | 11 static suites (`verify:search` … `verify:security`) | Each ends with `All checks passed…` |
| `npm run build` | `tsc -b && vite build` | `✓ built in …s`; output in `dist/` |

All four passed on the owner's machine on 2026-09-26.

> **Note on type-checking.** Do **not** use `npx tsc --noEmit -p tsconfig.json`: the root `tsconfig.json` only holds project references, so that command checks nothing and always "passes". Use `npm run type-check` or `npx tsc -b`, and **read the output** — a clean run prints nothing.

After a build, `tsconfig.app.tsbuildinfo` / `tsconfig.node.tsbuildinfo` may appear as untracked files. They are build caches; do not commit them.

---

## 7. Environment variables

### 7.1 The complete list

Found by searching the whole repository for `import.meta.env`, `process.env` and `Deno.env`.

#### A. Local `.env` file (project root)

| Variable | Required? | Used by | Client/Server | Where to get it | Example / format | Secret? |
|---|---|---|---|---|---|---|
| `VITE_SUPABASE_URL` | **Yes** | `src/lib/supabase.ts` (browser), `scripts/setup/env.ts`, `scripts/check-setup.mjs`, `scripts/seeders/*` | **Client-safe** (compiled into the bundle) | Supabase Dashboard → your project → Project Settings → Data API / API → Project URL | `https://<project-ref>.supabase.co` — for the current project: `https://kuyubrjsfujgfcznjvit.supabase.co` | No (public) |
| `VITE_SUPABASE_ANON_KEY` | **Yes** | Same as above | **Client-safe** | Dashboard → Project Settings → API Keys → **Publishable key** (`sb_publishable_…`) or, under *Legacy API keys*, the **anon public** key (`eyJ…`). Either works; the owner's `.env` uses the publishable format. | `<GET_FROM_SUPABASE>` | No (public by design, RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** — only for `npm run seed`, `npm run seed:dev`, `npm run seed:verify` | `scripts/seeders/seed.ts`, `scripts/seeders/verify.ts` | **Server-only** (local scripts) | Dashboard → API Keys → **service_role** / secret key | `<DO_NOT_COMMIT>` | **YES — bypasses all RLS.** Leave it out of `.env` unless you are seeding a non-production project. |
| `GEMINI_API_KEY` | Only to **push** the AI key to Supabase (§12) | Not read locally by any code. `.env` is used as the source for `npx supabase secrets set --env-file ./.env`. | **Server-only** | Google AI Studio: <https://aistudio.google.com/apikey> (as documented in `.env.example`) — or from the owner | `<OWNER_PROVIDES>` / `<DO_NOT_COMMIT>` | **YES** |

`.env` and `.env.local` are git-ignored (`.gitignore`). Vite and `scripts/setup/env.ts` both read `.env` then `.env.local` (`.env.local` wins).

#### B. Edge Function runtime (Supabase servers — not in `.env`)

| Variable | Used by | Set by | Notes |
|---|---|---|---|
| `SUPABASE_URL` | All 6 functions | **Supabase, automatically** | Do not set it yourself. |
| `SUPABASE_SERVICE_ROLE_KEY` | All 6 functions | **Supabase, automatically** | Never leaves Supabase's servers. |
| `GEMINI_API_KEY` | `generate-report-insights` only | **You**, with `npx supabase secrets set` (§12) | Present on the linked project (confirmed by `npx supabase secrets list`, name only). |

#### C. Supabase Vault (inside the database — not environment variables)

| Secret name | Used by | Notes |
|---|---|---|
| `brevo_api_key` | `request_login_code()` (2FA), `send_employee_invitation()`, approval-request emails (056) | Presence **cannot** be checked from the CLI. **Manual verification required** (§11). |
| `brevo_sender` | Same | `noreply@example.com` or `Touchcore ValueSpot <noreply@example.com>` format. Must be verified in Brevo. |
| `resend_api_key`, `resend_sender` | **Nothing current.** Only migration 021's original `request_login_code()` read them; 025 replaced it. | Legacy. Referenced only by the obsolete diagnostics `supabase/setup/DIAGNOSE_OTP.sql` and `VERIFY_LIVE.sql`. |

#### D. Database configuration (`app_config` table — edited in the app or by the owner)

| Key | Purpose | Where it is changed |
|---|---|---|
| `app_base_url` | Origin used to build invitation links and the "Review" button in approval emails. Seeded **empty**; while empty, invitations refuse with `app_url_not_configured`. No trailing slash. | No UI. Owner sets it with SQL (§11.4). |
| `signup_allowed_domains` | Optional allowlist for self-registration | Super Admin → Administration → System configuration → Signup domains |
| `hr_fallback_employee_id` | HR approver used when a project's manager is a party to the recognition | Database only |
| `rate_limit_daily`, `rate_limit_monthly`, `anti_gaming_window_days`, `financial_year_q1_start` | Recognition rules | HR → Settings |
| `value_coin_*` (signup grant, monthly allowance, max per recognition, max per person per day, reset day, carry-over) | Value Coin policy | HR → Value Coins |

#### E. Not used by this project

`OPENAI_API_KEY`, `S3_*`, `SUPABASE_AUTH_*` appear in `supabase/config.toml` only as Supabase CLI template placeholders for a local stack. The application does not use them.

### 7.2 Create your `.env`

```powershell
Copy-Item .env.example .env
code .env
```

Fill in **only** what you need:

```dotenv
VITE_SUPABASE_URL=https://kuyubrjsfujgfcznjvit.supabase.co
VITE_SUPABASE_ANON_KEY=<GET_FROM_SUPABASE>

# Leave these two out unless you actually need them (see §7.1):
# SUPABASE_SERVICE_ROLE_KEY=<DO_NOT_COMMIT>
# GEMINI_API_KEY=<OWNER_PROVIDES>
```

> If the owner points you at a **different** Supabase project, use that project's URL and key instead. Everything else in this guide is the same.

### 7.3 NEVER put a server secret behind `VITE_`

Vite replaces every `import.meta.env.VITE_*` reference with its literal value **at build time**. The value ends up inside the JavaScript files in `dist/`, which every visitor downloads. Anyone can open DevTools and read it.

- A `VITE_SUPABASE_SERVICE_ROLE_KEY` would let anyone read and write every table, ignoring RLS and 2FA.
- A `VITE_GEMINI_API_KEY` would let anyone spend the project's AI quota.

Safety nets already in the repository:

- `npm run setup` / `setup:check` **fails** if a `VITE_` variable looks like a service-role key.
- `npm run verify:reporting` **fails** if any env file contains a `VITE_…GEMINI…` variable or if a Gemini key appears in `src/`.

### 7.4 Verify

```powershell
npm run setup:check
```

Section **1. Environment** must show:

```
  PASS  Environment variables present  kuyubrjsfujgfcznjvit.supabase.co
  ····  Target is a hosted project
```

If you see `FAIL  VITE_SUPABASE_URL — not set` or `FAIL VITE_SUPABASE_ANON_KEY — not set`, fix `.env` and re-run. (The rest of `setup:check` needs §8 first.)

---

## 8. Supabase project connection

### 8.1 Which project

| | |
|---|---|
| Project reference | `kuyubrjsfujgfcznjvit` |
| URL | `https://kuyubrjsfujgfcznjvit.supabase.co` |
| Organization (as the CLI reports it) | "PushkarKaslikar's Project" |
| Region (from the pooler host) | `ap-northeast-1` |
| Postgres | 17 |
| Purpose | The single hosted project used for development and testing. **There is no separate production project in this repository** (§23). |

The reference is not a secret: it is part of the URL that every browser receives. Where it comes from: the project URL (`https://<ref>.supabase.co`); on the owner's machine it is also recorded by the CLI in `supabase/.temp/project-ref` (git-ignored, so each machine links for itself).

### 8.2 Log the CLI in

```powershell
npx supabase login
```

**Expected:** a browser opens; approve the login. The terminal then prints `You are now logged in. Happy coding!`

**If it fails:** make sure your default browser is signed in to the same Supabase account that was invited (§4.3). On a locked-down machine you can instead create a personal access token in the dashboard (Account → Access Tokens) and run `npx supabase login --token <YOUR_TOKEN>` — `<DO_NOT_COMMIT>`.

### 8.3 Link this folder to the project

```powershell
npx supabase link --project-ref kuyubrjsfujgfcznjvit
```

The CLI may ask for the **database password**. Current CLI versions allow you to leave it blank; the CLI then connects through a temporary login role (observed on the owner's machine as `Initialising login role...`). If your CLI version insists on the password, ask the owner — `<OWNER_PROVIDES>`. **Do not reset the database password yourself**; anything else using it would break.

### 8.4 Verify the link

```powershell
Get-Content supabase\.temp\project-ref
npx supabase projects list
```

**Expected:** `kuyubrjsfujgfcznjvit`, and the projects list marks that project as linked.

> **Wrong project linked?** Re-run `npx supabase link --project-ref <correct-ref>`. Every CLI command in this guide acts on the linked project, so check this before running `npm run db:migrate` or any `functions deploy` / `secrets set`.

### 8.5 Verify `.env` and reachability

```powershell
npm run setup:check
```

**Expected (real output from 2026-09-26):**

```
Touchcore ValueSpot — project setup
read-only check; nothing will be written

1. Environment
  PASS  Environment variables present  kuyubrjsfujgfcznjvit.supabase.co
  ····  Target is a hosted project

2. Tooling
  PASS  Supabase CLI available  v2.118.0

3. Migrations
  PASS  53 migration file(s) on disk  001_core_tables.sql … 057_security_hardening.sql
  PASS  53 migration(s) already applied
  PASS  Database is up to date  nothing pending

4. Seed data
  ····  5 reference seed file(s) in supabase/seed/ (applied by the CLI)
  ····  Demo seeding skipped (pass --seed to run)

5. Verification
  PASS  Supabase project reachable  REST HTTP 401
  PASS  Core tables present  employees, nominations, core_values, app_config
  PASS  RLS refuses anonymous reads
  PASS  Privileged RPCs refuse anonymous callers
  PASS  An administrator exists

SETUP OK  (read-only check)
Next: npm run dev
```

`REST HTTP 401` is **correct** (the root REST path refuses anonymous callers; any HTTP answer proves the project is up).

A second, older read-only probe exists:

```powershell
npm run doctor
```

On 2026-09-26 it ended with `Everything required is in place.` It also checks two Auth settings (§10). Ignore its hints that say "Run … in the SQL Editor" — they pre-date the migration automation (§9.5).

### 8.6 Which Supabase credentials are safe where

| Credential | Browser / `.env` `VITE_` | Local `.env` (no prefix) | Supabase secrets / Vault | Never |
|---|---|---|---|---|
| Project URL | ✅ | — | auto | — |
| Publishable / anon key | ✅ | — | auto | — |
| Service-role / secret key | ❌ | Only while seeding a non-production project | auto (functions) | Git, chat, screenshots |
| Database password | ❌ | ❌ | — | Git, chat |
| CLI access token | ❌ | ❌ | — | Git, chat |
| Gemini key | ❌ | ✅ (source for `secrets set`) | ✅ `GEMINI_API_KEY` | Git |
| Brevo key | ❌ | ❌ | ✅ Vault `brevo_api_key` | Git, `.env`, migration files |

---

## 9. Database migrations

### 9.1 What is in the repository

- **53** files in `supabase/migrations/`, applied in filename order, from `001_core_tables.sql` to **`057_security_hardening.sql`** (the latest).
- **Numbers intentionally missing:** `008`, `010`, `019`, `020`.
  - `019` and `020` were written against the JWT `amr` claim and **never applied**; migration `022`'s header states they were superseded by `021`.
  - `008` and `010` have no file and no ledger entry. The repository does not record why. **Do not create files with these numbers.**
- **Superseded but still part of the chain:** e.g. `013_role_access_codes.sql` (access codes) was removed again by `018`. Superseded migrations stay; history is never rewritten.

### 9.2 Current state of the linked project (verified)

`npx supabase migration list` on 2026-09-26 showed **all 53 local migrations applied remotely** (local = remote for every version from `001` through `057`), with **no pending** and **no orphaned** migrations.

On a new laptop you therefore expect: **nothing to apply**.

### 9.3 The commands

All of these exist in `package.json`:

| Command | Runs | Writes to the database? |
|---|---|---|
| `npm run setup:check` | `tsx scripts/setup/index.ts --check` | **Never.** Safe any time. |
| `npm run db:verify` | Same as `setup:check` | **Never.** |
| `npm run db:status` | `npx supabase migration list` | **Never.** Raw CLI table/JSON. |
| `npm run db:migrate` | `tsx scripts/setup/index.ts --migrate` | **Only after you type `y`.** Applies pending migrations, then verifies. Never seeds. |
| `npm run setup` | `tsx scripts/setup/index.ts` | **Only after you type `y`.** Same as `db:migrate` plus the seed step (off unless `--seed`) and full verification. |
| `npm run dev` | Runs `predev` = `setup:check --soft`, then Vite | **Never.** Warns about pending migrations but cannot apply them. |

### 9.4 Checking and applying

**1. Check (always first):**

```powershell
npm run setup:check
```

- `PASS  Database is up to date  nothing pending` → **you are done. Do not run `db:migrate`.**
- `WARN  N migration(s) pending:` followed by file names → go to step 2.
- `WARN  Could not read migration state  The project may be unlinked…` → the state is **unknown**, not "up to date". Fix §8 first.

**2. Apply, only if something is pending and you are authorised to change the shared database:**

```powershell
npm run db:migrate
```

What happens (`scripts/setup/index.ts`, `migrations.ts`, `guard.ts`):

1. Validates `.env`, checks the CLI.
2. Reads migration state with `supabase migration list`.
3. Lists pending files, runs `supabase db push --dry-run` and shows what would be applied.
4. Asks: `Apply N migration(s) to kuyubrjsfujgfcznjvit.supabase.co? [y/N]`. Anything other than `y`/`yes` means **no**.
5. On `y`, runs `supabase db push`, then the verification probes.

Outcomes and exit codes:

| Final line | Meaning | Exit |
|---|---|---|
| `DATABASE UP TO DATE — nothing to apply` | Nothing pending | 0 |
| `NO CHANGES MADE — the database was not modified` | You declined (exit 0), or state was unreadable (exit 1) | 0 / 1 |
| `MIGRATIONS APPLIED` | Applied and verified | 0 |
| `MIGRATIONS APPLIED, VERIFICATION FAILED` | Applied, but a probe failed — read the FAIL lines | 1 |
| `MIGRATION FAILED — the database was not changed as intended.` | `db push` returned an error | 1 |

In a non-interactive shell (CI, piped input) the answer is automatically **no** unless `--yes` is passed. No npm script passes `--yes`. Don't add it casually.

**3. Verify afterwards:**

```powershell
npm run db:status
npm run setup:check
```

### 9.5 What NOT to do

- ❌ **Do not paste migration SQL into the Supabase SQL Editor.** It runs the SQL but does **not** record it in `supabase_migrations.schema_migrations`. The CLI then believes the migration is still pending, and the next `db:migrate` runs it a second time. Most migrations are written to be re-runnable, but not all are (for example, `018` drops tables), so the ledger must stay the only record of what ran.
- ❌ **Do not run `npx supabase db push` directly.** It skips the dry run, the confirmation and the post-apply verification. (One console message in `src/lib/api/client.ts` still suggests it — use `npm run db:migrate` instead.)
- ❌ **Do not follow the "run each migration in the SQL Editor" steps in `README.md`**, or the "Run … in the SQL Editor" hints printed by `npm run doctor`. They pre-date the automation.
- ❌ **Never run `supabase/setup_complete.sql`** (a legacy concatenation of early migrations) or **`supabase/setup/RUN_THIS.sql`** (a copy of migration 018).
- ❌ **Never edit or rename a migration that is already applied.** Add a new one instead (§21.4).
- ❌ **Never run `npx supabase db reset`, `migration repair`, or delete rows from `supabase_migrations.schema_migrations`** on the hosted project.
- ❌ **Do not apply `supabase/seed/*.sql`** to this project. It already holds its reference data (the app's own screens manage core values, behaviours, badges and settings).

### 9.6 Local vs hosted database

The repository's workflow targets the **hosted** project only. `supabase/config.toml` contains local-stack settings (ports 54321–54327) because the CLI requires the file, but:

- no script in `package.json` starts a local stack;
- `config.toml`'s `[db.seed] sql_paths = ["./seed.sql"]` points at a file that does not exist;
- the only local-stack script, `npm run supabase:types`, would overwrite the hand-maintained `src/lib/supabase-types.ts` (§21).

A local stack is therefore **not part of the supported workflow and was not verified**.

---

## 10. Supabase Auth configuration

### 10.1 How authentication works

**Sign-in (every role, every time):**

```
email + password  →  supabase.auth.signInWithPassword()
                     (session exists but is NOT verified — the database serves it nothing)
                  →  request_login_code()      6-digit code emailed via Brevo
                  →  verify_login_code(code)   checked against THIS session only
                  →  session verified
                  →  session_status() / employees row loaded  →  routed by role
```

| Property | Value (from migrations 021–025) |
|---|---|
| Code | 6 digits, generated in the database, stored only as `sha256(code || ':' || session_id)` |
| Lifetime | 10 minutes |
| Wrong attempts | 5, then locked |
| Resend cooldown | 60 seconds per session |
| Per account | 10 codes per hour |
| Bound to | The session that passed the password step. Password-less (`/auth/v1/otp`) sessions are refused. |
| Survives token refresh | Yes — `session_id` is stable across refresh; no re-prompt while the session lives |

**Sign-out:** `AuthContext.signOut()` first calls `revoke_login_verification(p_all_sessions => true)`, then `supabase.auth.signOut()`. This deletes **all** of that user's verification rows, so an access token copied before logout stops working immediately, and the user's other open sessions must enter a new code.

**Password reset:** `/reset-password`. Uses Supabase Auth's own `resetPasswordForEmail()` — this email is sent by **Supabase Auth's mailer, not Brevo** (§10.3). A reset session can change the password and nothing else; the person then signs in normally and gets a code.

**Deactivated employees:** `session_status()` reports `account_inactive`; the app signs them out with "Your employee record is not active. Please contact HR."

### 10.2 How accounts are created and roles assigned

The role is **always decided by the database** (`claim_employee_account()`, `check_signup_eligibility()`, guard triggers). The page URL, the portal picked, and anything the browser sends **never** grant a role.

| Who | How | Page | Rules |
|---|---|---|---|
| **Employee** | Public self-registration | `/signup` | No record exists → a new record is created at `employee` (a literal in the function). Blocked if a domain allowlist is set and the address doesn't match (`domain_blocked`). Department and project are asked on the form when lists exist. |
| **Manager** | **Invitation only** | `/manager/setup?email=…` | HR or Super Admin first creates the employee record at role `manager` (HR → Employees), then sends the invitation. The setup page passes `p_require_invited_role` so an uninvited person cannot get even an Employee account from this door. Full name must match the record exactly (`name_mismatch`). |
| **HR** | **Invitation only** | `/hr/setup?email=…` | Same, at role `hr_admin`. |
| **Super Admin** | Separate, protected | Signs in at `/hr/login` | The *first* usable account on an empty system became Super Admin (bootstrap, migration 015). **That has already happened** on the linked project (`An administrator exists`). Further Super Admins are appointed only by an existing Super Admin in Administration → Administrators. |

Who may create / change what (migrations 016, 017, 026):

| Actor | May **create** a record at | May **change** a role to |
|---|---|---|
| `super_admin` | employee, manager, hr_admin, super_admin | any role |
| `hr_admin` | employee, manager, hr_admin | employee, manager only |
| `manager`, `employee` | nothing | nothing |

The last active Super Admin cannot be demoted or deactivated. Every role change is written to `audit_logs`.

**Portal choice:** `/login`, `/manager/login`, `/hr/login` only decide the wording and which portal the person *asked* for. After the code, the app compares the **database role** with that portal: a role can enter its own portal and any below it (`src/lib/portals.ts`). Otherwise: "Your account does not have *X* access. You are registered as *Y* — select that to sign in." and the session is signed out.

### 10.3 Supabase dashboard settings the application depends on

| Setting (Dashboard → Authentication) | Required value | Verified? |
|---|---|---|
| Providers → Email: **enabled** | On | ✅ `/auth/v1/settings` reports `external.email: true` |
| Providers → Email: **Allow new users to sign up** | **On** (self-registration only ever yields `employee`) | ✅ `disable_signup: false` |
| Providers → Email: **Confirm email** | **Off** — ValueSpot sends its own code; Supabase confirmation would add a second, redundant email | ✅ `mailer_autoconfirm: true` |
| **Hooks → Custom Access Token** → `public.custom_access_token_hook` | **Enabled.** RLS policies read `auth.jwt()->>'user_role'` (e.g. migrations 022, 039, 048, 057). Without the hook every user looks like a plain employee to those policies: HR screens load but show nothing. | ❌ **Manual verification required** — cannot be read with the public key. |
| **URL Configuration → Site URL / Redirect URLs** | Must allow `http://localhost:5173/**` for development, and the production origin later. Used by `signUp(emailRedirectTo: <origin>/login)` and `resetPasswordForEmail(redirectTo: <origin>/reset-password)`. | ❌ **Manual verification required.** |
| **SMTP settings** (for password-reset emails) | Supabase's built-in mailer is heavily rate-limited; configure custom SMTP if password resets must be reliable. | ❌ **Manual verification required** — current value unknown. |
| Providers → Email: **Secure password change** | Listed as a client sign-off item in `DEPLOYMENT_PREREQUISITES.md` | ❌ **Manual verification required.** |

You can re-check the first three at any time with `npm run doctor` (section *Auth configuration*).

### 10.4 Supabase extensions the database relies on

Migrations call `net.http_post` (`pg_net`) and `vault.decrypted_secrets` (Supabase Vault) but **do not** enable those extensions. On the current project they are assumed enabled (email features were in use). **Manual verification required:** Dashboard → Database → Extensions → `pg_net` and `supabase_vault` are enabled. On any *new* project, enable them before relying on email.

---

## 11. Email / Brevo configuration

### 11.1 What Brevo is used for

Brevo (<https://www.brevo.com>) is a transactional email service. ValueSpot sends **three** kinds of email, all from **inside PostgreSQL** via `pg_net` → `https://api.brevo.com/v3/smtp/email`:

| Email | Sent by (database function) | Migration | When |
|---|---|---|---|
| 6-digit sign-in / signup code | `request_login_code()` | 021 → 025 | Every sign-in and signup |
| Invitation (setup link) | `send_employee_invitation()` | 027 | HR clicks "Send invitation" on the Employees page |
| "A recognition needs your review" | Approval notification triggers | 056 | A recognition is submitted (to the routed Project Manager, every active HR Admin and every active Super Admin), and when an author answers a clarification (to the approver) |

**Not** sent through Brevo: password-reset emails (Supabase Auth mailer, §10.3). No other notification is emailed; approvals, rejections, comments, coins and support stay in the in-app bell.

An email failure **never blocks** the action: the recognition is still submitted and the in-app notification still appears.

### 11.2 Where the credentials live

In **Supabase Vault**, read only by `SECURITY DEFINER` functions:

- `brevo_api_key` — the Brevo API key. `<DO_NOT_COMMIT>`
- `brevo_sender` — the sender address verified in Brevo, as `noreply@example.com` or `Touchcore ValueSpot <noreply@example.com>`. If no display name is given, `Touchcore ValueSpot` is used.

They are **not** in `.env`, the repository, the browser bundle or any migration. Edge Functions do not use them.

There is no difference between "local" and "production" here: your laptop never sends email. Whatever Supabase project `.env` points at sends it, using **that** project's Vault.

### 11.3 Obtaining and setting the credentials — OWNER ACTION

1. In Brevo: create/obtain an **API key** (Brevo → *SMTP & API* → *API Keys*) and **verify a sender** (Brevo → *Senders*). A single verified sender address works without any DNS change.
2. In Supabase: Dashboard → **Project Settings → Vault** (or *Integrations → Vault*) → add or edit the two secrets named exactly `brevo_api_key` and `brevo_sender`. The repository's own documented alternative (migration 025/027 comments), run by the owner in the SQL Editor:

   ```sql
   -- create (only if the secret does not exist yet)
   SELECT vault.create_secret('<OWNER_PROVIDES>', 'brevo_sender');

   -- update an existing one
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'brevo_sender'),
     '<OWNER_PROVIDES>'
   );
   ```

   Do the same for `brevo_api_key`. Never write the key into a file or a commit.

Changing the sender or key needs **no migration, no redeploy, no rebuild**.

**CLIENT / IT ACTION (production):** if the production sender must be an `@touchcoresystems.com` address, whoever administers that domain decides the sending identity and publishes any DNS records Brevo requires (SPF/DKIM). The developer is not assumed to have DNS access and must not change existing mail records.

### 11.4 `app_base_url` — required for invitations — OWNER ACTION

Invitation links are built from `app_config.app_base_url` + `/manager/setup` / `/hr/setup` / `/signup` + `?email=…`. Migration 027 seeds it **empty**, and while it is empty `send_employee_invitation()` returns `app_url_not_configured` (the UI shows "Automated email is not set up yet — the application address is missing…"). Approval emails still send, but without a "Review" button.

There is no UI for it. The current value is **unknown — Manual verification required**. To set it (owner, SQL Editor; this is configuration, not a migration):

```sql
UPDATE app_config SET value = '"<SET_BY_OWNER — e.g. http://localhost:5173 for development>"'::jsonb
 WHERE key = 'app_base_url';
```

No trailing slash. For production it must be the real deployed origin.

### 11.5 Verify email configuration

**Read-only check (owner, SQL Editor)** — prints presence only, never the key:

```sql
SELECT name, (length(btrim(decrypted_secret)) > 0) AS has_value
  FROM vault.decrypted_secrets
 WHERE name IN ('brevo_api_key', 'brevo_sender');

SELECT key, value FROM app_config WHERE key = 'app_base_url';
```

**Expected:** two rows with `has_value = true`, and a non-empty `app_base_url`.

**End-to-end check:** sign in (§15). If a code arrives, 2FA email works. Then have HR send an invitation to a test mailbox (§18).

**If a code does not arrive**, the sign-in screen asks the database (`login_code_delivery_status()`) what the provider answered and shows one of: "Email delivery is not set up for this workspace. Please contact IT." (secrets missing) · "We could not deliver a code to this address…" (provider refused the recipient) · "Too many emails are being sent right now…" (provider rate limit). Also check your Brevo plan's daily sending limit.

---

## 12. Gemini / AI configuration

### 12.1 What Gemini is used for

Only for the optional **AI interpretation** on the Reports pages (employee report and organisation report). It turns an already-computed report into short prose: highlights, patterns and suggestions.

| | |
|---|---|
| Edge Function | `generate-report-insights` |
| Called from | `src/lib/api/reports.ts` → `supabase.functions.invoke('generate-report-insights')` |
| Models (tried in order) | `gemini-2.5-flash`, then `gemini-3-flash-preview` |
| Endpoint | `https://generativelanguage.googleapis.com/v1beta/interactions` |
| Timeout | 20 s per model attempt |
| Secret name | `GEMINI_API_KEY` (Edge Function secret) |
| In the browser? | **Never.** The browser sends only its own session token and receives prose. |

### 12.2 Grounding — the database is the source of truth

```
database  →  verified metrics (employee_report / organization_report, migration 043)
          →  structured facts  →  Gemini  →  prose, clearly labelled as AI
```

- Every number on a report is counted by the database and is on screen **before** AI is asked anything.
- The function **re-fetches the facts itself** under the service role, passing the caller's identity to the same authorization (`may_report_on()`). Nothing the browser sends becomes a fact.
- The system prompt forbids inventing numbers, recognitions, badges, people or scores; treating recognition counts as performance data; mentioning protected characteristics; and making judgements about competence, promotion or termination.
- **Gemini is never the source of factual employee data.** Treat its text as commentary on facts that are already verified.

### 12.3 Caching and failure handling

- Results are cached in the `report_ai_insights` table, keyed by scope, subject, period and a SHA-256 hash of the facts (plus a format version). If a new recognition changes the facts, the hash changes and a fresh insight is generated.
- Every AI failure returns HTTP **503** and the **factual report keeps working**:

| Status | Message shown | Cause |
|---|---|---|
| `not_configured` | "AI insights are not configured on this workspace." | `GEMINI_API_KEY` secret missing |
| `bad_key` | "The AI provider rejected this workspace's API key. Ask IT to check GEMINI_API_KEY." | Invalid / revoked key |
| `provider_error` | "The AI provider refused this request…" | Other provider refusal (e.g. quota) |
| `model_busy` | "The AI models are busy right now…" | Both models timed out / overloaded |
| `unparseable` | "The AI returned a response this report could not read. Try again." | Malformed model output |

### 12.4 Configure the key safely

**Current state:** `npx supabase secrets list` on 2026-09-26 shows a secret named `GEMINI_API_KEY` on the linked project (set 2026-09-18). **You do not need to set it again** unless the key is rotated or you move to another project.

To set or rotate it (the method documented in `.env.example` and the function header):

1. Put the key in your local `.env` — **without** `VITE_`:
   ```dotenv
   GEMINI_API_KEY=<OWNER_PROVIDES>
   ```
2. Confirm the linked project (§8.4), then push:
   ```powershell
   npx supabase secrets set --env-file ./.env
   ```
   The CLI uploads the variables in the file as Edge Function secrets. Names beginning with `SUPABASE_` are reserved and are not uploaded. The two `VITE_` values are uploaded too; that is harmless (they are public) and matches the current project.
3. Verify (names and digests only, never values):
   ```powershell
   npx supabase secrets list
   ```
4. Functional check: open a report and request the AI insight (§18). **Manual verification required** — a live call to Gemini was not made while writing this guide.

---

## 13. Edge Functions

### 13.1 Inventory

| Function | Purpose | Required? | Invoked from | Secrets needed | Deployment command |
|---|---|---|---|---|---|
| `process-approval` | Approve / reject / request clarification. Calls `record_nomination_decision()` (042), sends in-app notifications, recalculates badges, flags reciprocal patterns. | **Required** (approvals fail without it) | Frontend — Pending Approvals | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (automatic) | `npx supabase functions deploy process-approval` |
| `delete-employee` | Permanent erasure: `purge_employee()` (035–037) then deletes the Auth user via the Admin API | **Required** for HR "Delete permanently" | Frontend — HR → Employees | automatic | `npx supabase functions deploy delete-employee` |
| `generate-report-insights` | AI interpretation of reports (§12) | Required **only for AI insights**; reports work without it | Frontend — Reports | automatic + **`GEMINI_API_KEY`** | `npx supabase functions deploy generate-report-insights` |
| `calculate-badges` | Bulk badge recalculation (HR/Super Admin only) | Optional — badges are also maintained by database triggers (044) | Frontend, after a moderation action; can be called manually by an HR/Super Admin session | automatic | `npx supabase functions deploy calculate-badges` |
| `check-duplicate` | Advisory duplicate warning in the recognition wizard | Optional — if unavailable the wizard treats it as "no duplicate" | Frontend — Give Recognition | automatic | `npx supabase functions deploy check-duplicate` |
| `check-rate-limits` | Advisory rate-limit message in the wizard (caller's own limits only) | Optional — the real limit is enforced by a database trigger (007) | Frontend — Give Recognition | automatic | `npx supabase functions deploy check-rate-limits` |

- **No function is scheduled** (no cron) and none is meant to be called by anything except a signed-in, 2FA-verified user.
- Every function validates the JWT, requires the second factor (`session_second_factor_ok_for`) and reads the caller's role from `employees` — because the service role bypasses RLS, each function must check for itself.

### 13.2 Current deployment state (verified)

`npx supabase functions list` on 2026-09-26:

| Function | Status | Version | `verify_jwt` | Last deployed (UTC) | Local file last modified (UTC) |
|---|---|---|---|---|---|
| process-approval | ACTIVE | 3 | true | 2026-09-25 19:24 | 2026-09-25 18:55 |
| delete-employee | ACTIVE | 4 | true | 2026-09-17 15:03 | 2026-09-17 14:43 |
| generate-report-insights | ACTIVE | 5 | true | 2026-09-24 16:28 | 2026-09-24 15:56 |
| calculate-badges | ACTIVE | 1 | true | 2026-09-21 17:36 | 2026-09-21 17:26 |
| check-duplicate | ACTIVE | 1 | true | 2026-09-25 19:24 | 2026-09-25 18:55 |
| check-rate-limits | ACTIVE | 1 | true | 2026-09-25 19:24 | 2026-09-25 18:55 |

Every function was deployed **after** its source file was last edited, so the deployed code is very likely current. Byte-for-byte identity was not proven.

**For the handover on this same project: do not deploy anything.** Deploy only when you change a function's code, or when setting up a different Supabase project.

### 13.3 How to deploy (when needed)

Confirm the linked project first (§8.4), then deploy **only the function you changed**:

```powershell
npx supabase functions deploy <function-name>
```

If the CLI complains that Docker is not available, add the flag that bundles on Supabase's servers (present in CLI 2.118.0):

```powershell
npx supabase functions deploy <function-name> --use-api
```

Never use:

- `--no-verify-jwt` — all six functions are deployed with JWT verification on;
- `--prune` — it deletes functions that exist in the project but not locally.

### 13.4 Verify

```powershell
npx supabase functions list
npm run doctor
```

- `functions list`: `STATUS ACTIVE`, `verify_jwt true`, version incremented.
- `doctor` probes four of them: `HTTP 401` = deployed and refusing anonymous callers (correct); `404` = not deployed. It does **not** probe `delete-employee` or `generate-report-insights` — use `functions list` for those.
- Logs: Dashboard → Edge Functions → *function* → Logs.

---

## 14. Application startup

### 14.1 The normal sequence (new laptop, existing hosted project)

| # | Step | Section | Writes anything? |
|---|---|---|---|
| 1 | Install Git, Node 22, (VS Code) | §4 | — |
| 2 | Clone the **owner-provided** repository/branch | §5 | — |
| 3 | `npm install` | §6 | — |
| 4 | `npm run type-check`, `lint`, `verify:logic`, `build` | §6.4 | No |
| 5 | Create `.env` (URL + publishable/anon key) | §7 | — |
| 6 | `npx supabase login`, `npx supabase link --project-ref kuyubrjsfujgfcznjvit` | §8 | No |
| 7 | `npm run setup:check` → expect **SETUP OK**, nothing pending | §8.5, §9 | No |
| 8 | Only if pending: `npm run db:migrate` (with authorisation) | §9.4 | Yes, after `y` |
| 9 | Confirm secrets (`npx supabase secrets list`; Vault — owner) | §11, §12 | No |
| 10 | Confirm functions (`npx supabase functions list`) — **no deploy needed** | §13 | No |
| 11 | `npm run dev` | below | No |

### 14.2 Start

```powershell
npm run dev
```

**What you should see:**

1. The `predev` readiness check (`setup:check --soft`) — same sections as §8.5. It can take several seconds because it asks the Supabase CLI for migration state. It **never blocks**: if something fails it prints `SETUP INCOMPLETE … Starting the dev server anyway (readiness check is advisory).`
2. Vite:
   ```
   VITE v5.4.21  ready in … ms
   ➜  Local:   http://localhost:5173/
   ```

Open <http://localhost:5173>. You land on the sign-in page (unknown URLs redirect by role; signed-out users go to `/login`).

### 14.3 Normal vs real problems

| You see | Normal? |
|---|---|
| `REST HTTP 401` in the readiness check | ✅ Normal |
| `WARN Custom access token hook cannot be probed from here` (doctor) | ✅ Normal — it's a reminder (§10.3) |
| `WARN Email Vault secrets cannot be probed from here` (doctor) | ✅ Normal — reminder (§11.5) |
| `WARN Migration 009 cannot be probed from here` (doctor) | ✅ Normal |
| Vite prints `Port 5173 is in use, trying another one...` and serves on 5174 | ⚠️ Works locally, but Auth redirect URLs and `app_base_url` expect 5173. Free port 5173 instead (§24). |
| Blank page; console: `Missing Supabase environment variables…` | ❌ `.env` missing/wrong — restart `npm run dev` after fixing (Vite reads `.env` at start) |
| `WARN N migration(s) pending` | ❌ Database behind the code — §9.4 |
| `WARN Could not read migration state` | ❌ Not logged in / not linked — §8 |

To stop the server: `Ctrl + C` in the terminal.

Other scripts: `npm run preview` serves the production build from `dist/` (Vite's default preview port, 4173). The same `.env` is baked in at build time.

---

## 15. First login and test accounts

### 15.1 What already exists

- The linked project **already has a Super Admin** (`An administrator exists`). **A new laptop does not create a Super Admin**, and signing up on a new laptop only ever creates an **Employee**.
- The owner provides test account details **securely** — `<OWNER_PROVIDES>`. This guide contains no passwords or codes.
- Each account needs a **real mailbox you can read**, because every sign-in requires the emailed code.

### 15.2 Getting an account per role

| Role | How to get one for testing |
|---|---|
| Employee | Sign up at `/signup` with an address you control (open registration is currently allowed for any domain). |
| Manager | A Super Admin or HR Admin creates the record at **Manager** in HR → Employees and sends the invitation; open the link from the email (or HR's "Copy link") and complete `/manager/setup`. |
| HR | Same, at **HR** — created by an HR Admin or Super Admin; complete `/hr/setup`. |
| Super Admin | Use the existing Super Admin (owner provides access), or have the existing Super Admin appoint you in Administration → Administrators. |

Gmail "plus" addresses (`name+manager@gmail.com`) are a convenient way to get several test identities into one inbox, as long as the signup domain allowlist permits them.

### 15.3 First sign-in walkthrough

1. Open the right page: `/login` (Employee), `/manager/login`, or `/hr/login` (HR and Super Admin).
2. Enter email and password → the code screen appears.
3. Enter the 6-digit code from the email (valid 10 minutes; "Resend code" after 60 s).
4. You land on your role's dashboard: `/dashboard`, `/manager/dashboard` or `/hr/dashboard`.

### 15.4 Do NOT use these for normal setup

- `supabase/setup/RESET_TEST_USERS.sql` — deletes every user except the Super Admin. **Destructive.**
- `supabase/setup/SET_ADMIN.sql` — changes roles directly in SQL, bypassing the in-app role controls.
- `supabase/setup/TEST_LOGIN_WITHOUT_EMAIL.sql` — writes a code hash by hand; development-only workaround from the Resend era.
- `npm run seed` — writes demo employees and recognitions into whatever project `.env` points at, **without asking**.

---

## 16. Employee verification

Sign in at `/login` as an **Employee**. The Employee experience uses its own dark theme with a top navigation bar.

| # | Check | Expected |
|---|---|---|
| 1 | Sign in + code | Code email arrives; lands on `/dashboard` |
| 2 | Wrong portal | Signing in at `/hr/login` with an Employee account → refused: "Your account does not have HR access. You are registered as Employee…" |
| 3 | Dashboard | The Employee dashboard loads with the person's own data, no errors |
| 4 | Give Recognition → **nominee** | Only **other Employees** can be chosen; managers/HR/Super Admins and yourself are not offered (and the database refuses them anyway — migration 041) |
| 5 | → **Project** | Choose any active project. A project with no active Manager is refused: "That project has no Project Manager, so there is nobody to approve this. Ask HR to assign one." |
| 6 | → Core Value → Behaviour → Scenario → Story → Preview | Each step populated from HR's configuration |
| 7 | Submit | Success; appears as pending in My Recognitions. The project's Manager, all HR Admins and all Super Admins get the in-app notification (and email, §11) |
| 8 | Duplicate / limit warnings | Advisory messages may appear before submitting |
| 9 | Recognition Feed | Approved recognitions; appreciate/un-appreciate; comment and reply |
| 10 | **Value Coins** | On a colleague's approved recognition, send coins to the person recognised; spends your **budget**, never your earned coins |
| 11 | **Wallet** (`/wallet`) | Budget and earned balances, history with the recognition each transfer came from |
| 12 | **Value Store** (`/store`) | Rewards with prices; redeeming spends **earned** coins only; requests needing approval show as pending until HR decides |
| 13 | My Core Value Journey | Progress per Core Value |
| 14 | Notifications (bell) | Live updates (realtime) |
| 15 | Support (`/support`) | Can raise a correction request about a recognition you took part in |
| 16 | Profile | Edit name/designation/location/skills, avatar/cover image |
| 17 | Sign out | Returns to sign-in; signing in again asks for a new code |

**Must NOT see or do:** any Manager/HR/Administration page (typing `/hr/employees` or `/manager/approvals` is refused by the route guard, and the data is refused by the database); recognise a Manager/HR/Super Admin or themselves; edit a published recognition; see other people's wallets.

---

## 17. Manager verification

Sign in at `/manager/login` as a **Manager** (a Project Manager is `projects.manager_id`; it must hold the Manager role).

| # | Check | Expected |
|---|---|---|
| 1 | Sign in + code | Lands on `/manager/dashboard` |
| 2 | **Pending Approvals** | Shows only recognitions filed against **projects this Manager manages** (routing is computed by the database from the chosen project, never from the browser) |
| 3 | Approve | Recognition published; nominee and nominator notified; badges updated |
| 4 | Reject | Requires a reason; only the nominator is notified |
| 5 | Request clarification | Requires a note; the author can answer, and it returns to the queue (approver notified, and emailed) |
| 6 | Race / already handled | If HR or a Super Admin decided first: "This recognition was already approved by HR — *name*." (only one decision can ever win) |
| 7 | Party to the recognition | A Manager named in a recognition cannot decide it; it is routed to the HR fallback |
| 8 | **My Projects** (`/manager/projects`) | The projects they manage and their members |
| 9 | Team Recognition / Team Badges | Members of their managed projects only |
| 10 | Reports (`/manager/reports`) | Only employees on their managed projects; **no organisation tab**; AI insight available (§12) |
| 11 | Menu group | The sidebar's **Menu** group is shared with every role: Dashboard, Give Recognition, Recognition Feed, My Recognitions, My Core Value Journey. (Wallet and Value Store are linked only from the Employee portal's navigation.) |

**Must NOT see or do:** recognitions routed to another Manager's projects; organisation-wide reports; HR → Employees/Projects/Settings/Value Coins/Audit Logs; Administration; change anyone's role.

---

## 18. HR verification

Sign in at `/hr/login` as **HR** (`hr_admin`).

| # | Area | Expected |
|---|---|---|
| 1 | Sign in + code | Lands on `/hr/dashboard` |
| 2 | Employees | List/search; create a record at Employee, Manager or HR; edit details; deactivate; change role **only between Employee and Manager**; "Delete permanently" (calls `delete-employee`; refuses self-deletion and the last administrator) |
| 3 | **Invitations** | "Send invitation" emails the setup link (needs Brevo + `app_base_url`, §11); "Copy link" works regardless |
| 4 | Projects | Create/edit/archive; assign the **Project Manager** (must hold the Manager role) and members |
| 5 | Departments | Create/edit/archive/remove |
| 6 | Core Values / Behaviours / Scenarios | Create/edit; changes appear in the recognition wizard |
| 7 | Rewards | Create/edit rewards with price and validity; the redemption queue on the same page lets HR approve or reject employees' requests |
| 8 | **Value Coins** (`/hr/value-coins`) | View wallets; adjust balances; set coin policy |
| 9 | **Approvals** | Pending Approvals shows **all** pending recognitions organisation-wide; can approve/reject/clarify |
| 10 | Reports (`/hr/reports`) | Any employee, **plus the Organisation report**; export; AI insight |
| 11 | Analytics / Badge Analytics | Organisation-wide charts |
| 12 | Support Requests | Claim, resolve (correct/remove recognition) or reject |
| 13 | Audit Logs | Read the log. **Cannot clear it** |
| 14 | Settings | Rate limits, anti-gaming window, financial year start |

**Must NOT see or do:** **Administration** (`/hr/administration` is Super Admin only); grant HR Admin or Super Admin via role change; change signup domains; see Security activity or the administrators list; clear the audit log.

---

## 19. Super Admin verification

Sign in at `/hr/login` as the **Super Admin**. Same HR portal plus an **Administration** section.

| # | Area | Expected |
|---|---|---|
| 1 | Sign in + code | Lands on `/hr/dashboard` |
| 2 | Everything in §18 | Works organisation-wide |
| 3 | Administration → **Administrators** | List Super Admins; appoint another; step down only after appointing a replacement (the last Super Admin is protected) |
| 4 | Administration → **Access & roles** | Grant/revoke HR Admin |
| 5 | Administration → **System configuration → Signup domains** | Set the self-registration allowlist. **Before production: add `touchcoresystems.com`** (the company address convention recorded in `AUTHENTICATION.md`) — **Manual verification required** that this is the intended domain. |
| 6 | Administration → **Security activity** | Permanent record of administrative-access changes |
| 7 | Employees | Can create a record at any role, including Super Admin |
| 8 | Audit Logs | Can clear the log (typed confirmation); one `audit_log.cleared` row remains recording who did it |
| 9 | Approvals / Reports | Organisation-wide, like HR |

**Protections to confirm:** an HR Admin cannot open `/hr/administration`; the last Super Admin cannot be demoted/deactivated/deleted; a Super Admin cannot delete their own account.

---

## 20. Security rules — DO NOT BREAK THESE

> **The frontend is never the security boundary.** Route guards, hidden buttons and dropdowns only decide what is *offered*. Anyone can call the Supabase REST API directly with the public key and their own token. Every rule below is enforced in the **database** or an **Edge Function**, and must stay there.

| Rule | Enforced in | Where |
|---|---|---|
| RLS on every table; unverified sessions read nothing | **Database** | Policies gated by `session_second_factor_ok()` (022); anonymous reads refused (`setup:check` probes this) |
| 2FA required for every sign-in; codes bound to the session | **Database** | `request_login_code()` / `verify_login_code()` (021, 025); `login_verifications` has RLS on, no policies, revoked from clients |
| Logout revokes verification immediately | **Database** + frontend call | `revoke_login_verification()` (023), called first in `signOut()` |
| Roles come from the database, never from URL/portal/payload | **Database** | `claim_employee_account()`, `check_signup_eligibility()`; `custom_access_token_hook` puts the DB role into the JWT |
| Self-registration can only create `employee` | **Database** | `claim_employee_account()` (literal `'employee'`) |
| Manager/HR accounts only from an HR-created record (invitation) | **Database** + frontend courtesy | 026 (`guard_employee_role_insert`, `p_require_invited_role`), setup pages |
| Who may create / change roles; Super Admin only by Super Admin; last admin protected | **Database** | `set_employee_role()`, guard triggers (016, 017, 026) |
| Invitation authority and link target decided server-side | **Database** | `send_employee_invitation()` (027): role and path from the stored record, origin from `app_base_url` |
| Approval routing by project | **Database** | `route_nomination_to_project_manager()` trigger (029/030) overwrites whatever the client sends |
| HR / Super Admin see and decide all approvals; one decision wins | **Database** + **Edge Function** | `nomination_decision_authority()`, `record_nomination_decision()` (042) with row lock; `process-approval` calls it with the token's identity |
| Employees may only recognise Employees; nobody recognises themselves | **Database** | 041 trigger + policy; `no_self_nomination` constraint (003) |
| Recognition rate limits | **Database** | `enforce_nomination_rate_limits` trigger (007); the Edge Function check is advisory |
| Direct REST writes to employees / nominations / reward assignments restricted | **Database** | Guard triggers in 057 |
| Value Coin transfers and HR adjustments | **Database** | `send_value_coins()`, `admin_adjust_value_coin_wallet()` — balances have no write policies; `CHECK (balance >= 0)` |
| Reward redemption spends earned coins only; HR decides | **Database** | `redeem_reward()`, `decide_reward_redemption()` (051, 052) |
| Report scope (Manager = own projects' members; org report HR/SA only) | **Database** | `may_report_on()`, `report_subjects()`, `organization_report()` (043) |
| AI key server-side only; AI never supplies facts | **Edge Function** | `generate-report-insights` (§12); `verify:reporting` guards the key |
| Service-role key never in the browser | Build + scripts | Only `Deno.env` in functions and `scripts/seeders`; `setup:check` fails on a `VITE_` service-role key |
| Edge Functions re-check JWT, 2FA and role | **Edge Function** | `session_second_factor_ok_for()` + role read from `employees` in every function |
| Audit log cannot be edited; clearing is Super-Admin-only and leaves a record | **Database** | No DELETE policy; `clear_audit_log()` (055) |

If you change any of these, the matching `npm run verify:*` suite should fail — treat that as a stop sign, not something to "fix" by editing the test.

---

## 21. Development workflow

### 21.1 Daily start

```powershell
git status
git pull            # if others push to the same branch
npm install         # only if package.json / package-lock.json changed
npm run dev
```

### 21.2 Architecture rule for new code

```
React page / component
   ↓
React Query hook          src/hooks/queries/useX.ts   (caching, invalidation)
   ↓
Business API module       src/lib/api/x.ts            (named operations; no table names in components)
   ↓
supabase-js               src/lib/supabase.ts
   ↓
Database (RLS / RPC / triggers)  or  Edge Function
```

- Components must not call `supabase.from(...)` / `.rpc(...)` directly. Add a named operation to the right `src/lib/api/*.ts` module and export it from `src/lib/api/index.ts`. (Deliberate exception: authentication — `AuthContext`, `LoginPage`, `SignUpPage`, `VerifyEmailStep` talk to `supabase.auth` and the 2FA RPCs directly.)
- The API layer adds **no** authorization. If a rule matters, it goes into SQL (a policy, a `SECURITY DEFINER` function that re-reads the role from `employees`, or a trigger).
- Map errors through `toApiError()` in `src/lib/api/client.ts`.
- **Do not add a Node/Express backend.** Nothing in the project requires one.

### 21.3 Frontend changes

Edit under `src/`, keep `npm run dev` running, then before committing run the checks in §21.7.

### 21.4 Database changes

1. Create a new file with the **next number**: `supabase/migrations/058_short_description.sql`.
2. Make it idempotent where practical (`CREATE OR REPLACE FUNCTION`, `CREATE TABLE IF NOT EXISTS`, `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`, `INSERT … ON CONFLICT DO NOTHING`).
3. Never edit an applied migration; write a new one that changes it.
4. Update `src/lib/supabase-types.ts` **by hand** (it is hand-maintained; `npm run supabase:types` would overwrite it from a local stack).
5. Commit the migration, then apply with `npm run db:migrate` (§9.4) — the shared database changes for everyone, so agree it with the owner first.
6. After a migration that touches roles, invitations or RLS, the owner should re-run `supabase/setup/VERIFY_026.sql` / `VERIFY_027.sql` (§22.1).

A `PGRST202` error / "This feature is not installed on your database yet" in the app almost always means a migration was written but not applied.

### 21.5 Edge Function changes

Edit `supabase/functions/<name>/index.ts`, then deploy only that function (§13.3) and check its logs in the dashboard. Keep the JWT + second-factor + role checks at the top of every function.

### 21.6 Environment variables

Never commit `.env`. If you add a variable, add a placeholder and an explanation to `.env.example`. Browser-visible → `VITE_` prefix and must be public. Anything secret → no prefix, and it belongs in Supabase secrets or Vault, not in the bundle.

### 21.7 Before every commit

```powershell
npm run type-check
npm run lint
npm run verify:logic
npm run build
git status
```

All must pass. Review `git status` for accidental files (`.env`, `dist/`, `*.tsbuildinfo`, `supabase/.temp/` should never be staged).

---

## 22. Database safety

### 22.1 Safe

| Action | Why it's safe |
|---|---|
| `npm run setup:check`, `npm run db:verify`, `npm run db:status`, `npm run doctor` | Read-only by construction |
| `npm run verify:*` | Reads local files only |
| Using the application normally | Every write passes RLS and the database's own rules |
| `npm run db:migrate` / `npm run setup` — **after reading the pending list** | Dry run + explicit `[y/N]`; refuses non-interactively; never resets/drops/truncates |
| `supabase/setup/VERIFY_026.sql`, `VERIFY_027.sql` — owner, SQL Editor | Run inside transactions that end in ROLLBACK. Note: `VERIFY_027.sql` may still queue real emails to `@localhost` addresses (pg_net runs outside the transaction); Brevo rejects them. |
| The read-only presence queries in §11.5 | `SELECT` only; never select the key's value |

### 22.2 Dangerous — do not do these against the shared/hosted project

| Action | Why |
|---|---|
| `npx supabase db reset` | Wipes the database. The setup scripts refuse it by name (`guard.ts`). |
| `TRUNCATE`, `DROP SCHEMA`, `DROP DATABASE`, `DELETE FROM auth.users` | Destroys data; also refused by the setup guard |
| Pasting migrations into the SQL Editor; `npx supabase db push` by hand | Bypasses the ledger / confirmation (§9.5) |
| `supabase migration repair`, editing `supabase_migrations.schema_migrations`, editing or renaming applied migrations | Corrupts migration history |
| Manually `UPDATE employees SET role = …` (e.g. `supabase/setup/SET_ADMIN.sql`) | SQL Editor sessions have no `auth.uid()`, so they bypass the in-app role controls and audit trail |
| Disabling RLS or dropping/altering policies by hand | Exposes employee data |
| `supabase/setup/RESET_TEST_USERS.sql` | Deletes every user except the Super Admin, with their recognitions. Development only, no undo. |
| `supabase/setup/TEST_LOGIN_WITHOUT_EMAIL.sql` | Hand-writes 2FA codes; development-only workaround |
| `supabase/setup/LIFECYCLE_CHECKS.sql` query 4 | Modifies a test row on purpose |
| `supabase/setup/CLEANUP.sql` | One-time hardening step; its target (`debug_session_auth()`) already answers 404 on the project, so it appears to have been run. Don't re-run without the owner. |
| `supabase/setup_complete.sql`, `supabase/setup/RUN_THIS.sql`, `supabase/seed/*.sql` | Legacy / duplicate / reference data — not for this project |
| `npm run seed`, `npm run seed:dev`, `npm run setup -- --seed` | Inserts demo employees/recognitions. `npm run seed` does **not** ask for confirmation. Nominations are `ON DELETE RESTRICT`, so demo data is hard to remove. |
| Deleting employees in production (HR → Delete permanently) | Irreversible erasure; use **Deactivate** for leavers |
| `npx supabase functions deploy --prune` | Deletes deployed functions that are not in your folder |
| Exposing the service-role key, DB password or CLI token anywhere | Full control of the project |

---

## 23. Production vs development

| Area | Development (current state) | Production |
|---|---|---|
| Supabase project | `kuyubrjsfujgfcznjvit` — the **only** project configured in this repository; used for development and testing | **Not set up.** No separate production project exists in the repository. `<SET_BY_OWNER>` / Touchcore decision |
| Project ownership | Owner's personal Supabase organization | Should be a Touchcore-owned organization — **CLIENT / IT ACTION** |
| Environment file | Local `.env` with the two `VITE_` values | The hosting platform's build environment variables (same two names), for the production project |
| Frontend hosting | `npm run dev` on `http://localhost:5173` | **Not configured in this repository.** `npm run build` produces a static SPA in `dist/`; the host must rewrite unknown paths to `index.html` (React Router uses browser routes). `<SET_BY_OWNER>` |
| AI key | `GEMINI_API_KEY` secret present on the project | A Touchcore-owned key, set with `npx supabase secrets set` on the production project |
| Email sender | Brevo, single verified sender (value in Vault; not visible from the repo) | A Touchcore sending identity decided by Touchcore IT; DNS by the domain owner — **CLIENT / IT ACTION** |
| `app_base_url` | Unknown (§11.4) | The production origin |
| Signup allowlist | **Open to any domain** (verified) | Restricted to the company domain (Super Admin → Administration) |
| Database migrations | 53/53 applied | Apply all 53 with `npm run db:migrate` against the new project, then configure Auth, hook, extensions, Vault |
| Edge Functions | All 6 deployed and ACTIVE | Deploy all 6 to the production project (§13.3) |
| Auth settings | Signup on, Confirm email off (verified); hook, redirect URLs, SMTP — manual | Same settings; Site URL / redirect URLs set to the production origin |
| Test users | Test mailboxes, Gmail aliases | Real `@touchcoresystems.com` accounts; no test accounts |
| Debugging | Browser console, `npm run doctor`, `setup:check`, function logs | Function logs and database logs in the dashboard; never debug with production data on a laptop |

---

## 24. Troubleshooting

Each entry: **SYMPTOM → CAUSE → CHECK → FIX**.

**npm install fails**
- SYMPTOM: `npm ERR!` during install.
- CAUSE: wrong Node version, network/proxy, or a OneDrive-synced/locked folder.
- CHECK: `node --version`; look for `EBADENGINE`, `ETIMEDOUT`, `EPERM`.
- FIX: install Node 22 (§4.2); configure the proxy (IT); move the project out of OneDrive; delete `node_modules` and run `npm install` again.

**Node version mismatch**
- SYMPTOM: `npm WARN EBADENGINE … @supabase/supabase-js … required: { node: '>=22.0.0' }`.
- CAUSE: Node older than 22.
- CHECK: `node --version`.
- FIX: install Node 22 LTS, reopen PowerShell, `npm install`.

**PowerShell refuses to run npm/npx**
- SYMPTOM: `npm.ps1 cannot be loaded because running scripts is disabled on this system`.
- CAUSE: Windows execution policy.
- CHECK: `Get-ExecutionPolicy -List`.
- FIX: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`, or use `npm.cmd`.

**Supabase CLI not found / not available**
- SYMPTOM: `FAIL Supabase CLI not available` in `setup:check`.
- CAUSE: `npx` could not download or run the `supabase` package (offline, proxy, first-run prompt).
- CHECK: `npx supabase --version`.
- FIX: run it interactively once and answer `y`; fix network/proxy.

**Supabase login fails**
- SYMPTOM: `npx supabase login` errors or the browser flow never completes.
- CAUSE: browser signed in to a different account; blocked browser launch.
- CHECK: which account the dashboard shows.
- FIX: sign in with the invited account; or use `npx supabase login --token <token>` (§8.2).

**Wrong project linked / "Could not read migration state"**
- SYMPTOM: `WARN Could not read migration state  The project may be unlinked`, or migration list shows unexpected versions.
- CAUSE: not logged in, not linked, linked to a different project, or no access to the organization.
- CHECK: `Get-Content supabase\.temp\project-ref`; `npx supabase projects list`.
- FIX: `npx supabase link --project-ref kuyubrjsfujgfcznjvit`; ask the owner for org access (§1).

**Migration pending**
- SYMPTOM: `WARN N migration(s) pending` or in-app "This feature is not installed on your database yet. Ask IT to apply the latest database migrations." (`PGRST202`).
- CAUSE: code is ahead of the database.
- CHECK: `npm run setup:check`.
- FIX: with authorisation, `npm run db:migrate` and answer `y` (§9.4).

**Migration mismatch / orphaned**
- SYMPTOM: `WARN N applied remotely with no local file`, or `db push` refuses because remote versions are missing locally.
- CAUSE: your checkout is missing migrations that were applied from elsewhere — typically the wrong branch (e.g. the old `origin/main`).
- CHECK: `(Get-ChildItem supabase\migrations\*.sql).Count` should be 53+; `npm run db:status`.
- FIX: get the correct branch from the owner. **Do not** run `migration repair` or create placeholder files.

**Missing environment variable**
- SYMPTOM: blank page, console `Missing Supabase environment variables. Copy .env.example to .env…`; or `FAIL VITE_SUPABASE_URL — not set`.
- CAUSE: no `.env`, typo in the name, or dev server started before `.env` was saved.
- CHECK: `Get-Content .env` (don't paste it anywhere).
- FIX: fix `.env` (§7.2), stop and restart `npm run dev`.

**Supabase connection failure**
- SYMPTOM: `FAIL Supabase project reachable` / doctor `Reach the Supabase project (got HTTP 0)`.
- CAUSE: wrong URL, no internet/proxy, or the project is **paused** (free-tier projects pause when idle).
- CHECK: open the dashboard — a paused project shows a Restore button.
- FIX: correct the URL; restore the project (owner); fix network.

**Authentication failure**
- SYMPTOM: "Incorrect email or password", "Your password is correct, but this account has no employee record yet. Please contact HR.", "Your account does not have *X* access…", "Your employee record is not active…".
- CAUSE: bad credentials; auth user not linked to an employee record; wrong portal; deactivated record.
- CHECK: HR → Employees for the person's record and role.
- FIX: correct password/reset; HR re-invites or reactivates; sign in at the portal matching the role.

**HR/Manager screens load but show no data**
- SYMPTOM: signed in fine, but lists and charts are empty for HR or Team Badges.
- CAUSE: the **Custom Access Token hook** is not enabled, so RLS doesn't see the `user_role` claim; or the role changed and the user's token is older.
- CHECK: Dashboard → Authentication → Hooks (§10.3).
- FIX: enable `public.custom_access_token_hook`; sign out and in again after role changes.

**2FA code not arriving**
- SYMPTOM: code screen waits; or "Email delivery is not set up for this workspace. Please contact IT." / "We could not deliver a code to this address…".
- CAUSE: Brevo Vault secrets missing, sender not verified, Brevo daily limit, spam folder, `pg_net` disabled.
- CHECK: spam folder; §11.5 queries (owner); Brevo dashboard logs.
- FIX: set/verify `brevo_api_key` / `brevo_sender`; enable `pg_net`; wait 60 s before "Resend code" (max 10 per hour — "Too many codes requested. Please wait an hour and try again.").

**Brevo configuration problem (invitations)**
- SYMPTOM: "Automated email is not set up yet — the application address is missing…" or "Automated email is not configured on this workspace…".
- CAUSE: `app_base_url` empty, or Brevo secrets missing.
- CHECK: §11.5.
- FIX: set `app_base_url` (§11.4) and the secrets (§11.3). Meanwhile use "Copy link".

**Gemini API problem**
- SYMPTOM: AI section shows "AI insights are not configured…", "…rejected this workspace's API key…", "The AI models are busy right now…".
- CAUSE: `GEMINI_API_KEY` secret missing / invalid / quota exhausted; model overload.
- CHECK: `npx supabase secrets list`; function logs for `generate-report-insights`.
- FIX: set a valid key (§12.4); wait and retry for `model_busy`. The factual report is unaffected.

**Edge Function not deployed**
- SYMPTOM: approvals or deletions fail; doctor reports `404`; browser shows a FunctionsHttpError.
- CAUSE: function missing on this project.
- CHECK: `npx supabase functions list`.
- FIX: `npx supabase functions deploy <name>` (§13.3).

**Edge Function unauthorized**
- SYMPTOM: 401 `Unauthorized` or 403 `Verification required` / `Insufficient permissions`.
- CAUSE: expired session; session not 2FA-verified; role not allowed for that function.
- CHECK: sign out and in again (with the code); confirm the role.
- FIX: expected behaviour for the wrong role. Never "fix" it with `--no-verify-jwt` or by removing checks.

**Recognition cannot be submitted**
- SYMPTOM: "That project has no Project Manager…", "…is not an active account…", "…no longer holds the Manager role…".
- CAUSE: the chosen project has no valid Manager.
- FIX: HR → Projects → assign an active Manager.

**Docker-related message**
- SYMPTOM: `functions deploy` complains Docker is not running; or `npm run supabase:types` fails.
- CAUSE: those paths default to Docker.
- FIX: use `--use-api` for deploys (§13.3). Don't run `supabase:types` (§21.4).

**localhost port conflict**
- SYMPTOM: `Port 5173 is in use, trying another one...`.
- CAUSE: another dev server (often a previous `npm run dev` still running).
- CHECK: `Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess`.
- FIX: close that terminal, or `Stop-Process -Id <OwningProcess>` after confirming it's your old dev server.

**TypeScript errors**
- SYMPTOM: `npm run type-check` prints `error TS…`.
- CAUSE: code/type mismatch — often `src/lib/supabase-types.ts` not updated after a migration.
- FIX: fix the code or update the types by hand. Don't trust `tsc -p tsconfig.json` (checks nothing).

**Build errors**
- SYMPTOM: `npm run build` fails.
- CAUSE: the `tsc -b` step (type errors) or Vite bundling.
- CHECK: the first error in the output.
- FIX: run `npm run type-check` and `npm run lint` and fix what they report.

---

## 25. Final handover checklist

### Before handover (owner)
- [ ] Current working tree committed and published; repository URL + branch given to the new developer (§1)
- [ ] Decision recorded on `origin/main` (`shrutid-1/Core-Value-Recognition`) and the conflicting `007` migration (§1)
- [ ] New developer invited to the Supabase organization (or project transferred)
- [ ] Secrets handed over securely or re-issued (Gemini, Brevo; service-role only if needed)
- [ ] Test accounts / credentials shared securely
- [ ] Personal email removed from `supabase/setup/*.js` test scripts before publishing, if desired (§26)

### Laptop
- [ ] Git installed (`git --version`)
- [ ] Node.js 22 installed (`node --version` → v22.x)
- [ ] npm working (`npm --version` → 10.x)
- [ ] VS Code installed (optional)
- [ ] Supabase CLI runs (`npx supabase --version`)

### Repository
- [ ] Repository cloned; correct branch; 53 migrations; 6 functions (§5.3)
- [ ] `npm install` succeeded; working tree still clean
- [ ] `.env` configured with URL + publishable/anon key only
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run verify:logic` passes
- [ ] `npm run build` passes

### Supabase
- [ ] `npx supabase login` done
- [ ] Linked to `kuyubrjsfujgfcznjvit` (or the owner's chosen project)
- [ ] `npm run setup:check` → SETUP OK, nothing pending
- [ ] All required migrations applied (53/53)
- [ ] Auth: signup on, confirm email off (`npm run doctor`)
- [ ] Auth: Custom Access Token hook enabled (manual)
- [ ] Auth: redirect URLs include `http://localhost:5173/**` (manual)
- [ ] Extensions `pg_net` and `supabase_vault` enabled (manual)
- [ ] Vault: `brevo_api_key`, `brevo_sender` present (manual)
- [ ] `app_base_url` set (manual)
- [ ] `GEMINI_API_KEY` secret present (`npx supabase secrets list`)
- [ ] Edge Functions: 6 ACTIVE (`npx supabase functions list`)

### Application
- [ ] `npm run dev` starts on `http://localhost:5173`
- [ ] Employee login + code works
- [ ] Manager login + code works
- [ ] HR login + code works
- [ ] Super Admin access verified
- [ ] 2FA code emails arrive
- [ ] Invitation email arrives and setup link works
- [ ] Recognition submission works (Employee → Employee only)
- [ ] Approval works (Manager scoped; HR/Super Admin organisation-wide)
- [ ] Reports work (Manager scoped; Organisation for HR/Super Admin)
- [ ] AI reporting works
- [ ] Value Coins send / wallet work
- [ ] Value Store redemption + HR decision work

### Final
- [ ] No secrets committed (`git status`, `git diff --cached`)
- [ ] `npm run type-check` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `npm run verify:logic` passes
- [ ] Git working tree reviewed
- [ ] Before production: signup domain allowlist set; production sender, project, hosting and `app_base_url` decided

---

## 26. Known limitations / manual verification items

### Could not be verified automatically

| Item | Why | How to verify |
|---|---|---|
| Custom Access Token hook enabled | Project configuration, not readable with the public key | Dashboard → Authentication → Hooks |
| Auth Site URL / Redirect URLs | Same | Dashboard → Authentication → URL Configuration |
| Password-reset email delivery (Supabase SMTP) | Same | Dashboard → Authentication → SMTP; test "Forgot password" |
| Brevo secrets present and sender verified | Vault is server-only | §11.5 query (owner); Brevo dashboard |
| `app_base_url` value | `app_config` is not readable anonymously | §11.5 query (owner) |
| `pg_net` / `supabase_vault` enabled | Same | Dashboard → Database → Extensions |
| Gemini key validity / quota | No live AI call was made | Request an insight on a report |
| Deployed Edge Function code identical to local | Only timestamps compared | Redeploy only if in doubt, after owner approval |
| Setup on a *fresh* laptop | This guide was produced on the owner's machine | Follow it end to end and note any gap |
| Role-by-role smoke tests (§16–§19) | Sign-in needs real mailboxes and codes | Manual |
| Whether migrations `008` and `010` ever existed | Not recorded in the repository | Ask the owner (don't create them) |

### Conflicts between old documents and the current code

| Document | Says | Current code |
|---|---|---|
| `README.md` | Node 20; run migrations one by one in the SQL Editor; run seed files | Node 22; `npm run db:migrate`; no seeding for this project |
| `DEVELOPER_SETUP.md` | Mostly current; example `028_…` for a new migration | Next number is `058` |
| `DEPLOYMENT_PREREQUISITES.md`, `AUTHENTICATION.md` | Email via **Resend**, secrets `resend_api_key` / `resend_sender`; "migrations 001–022 applied" | Email via **Brevo** (025), secrets `brevo_api_key` / `brevo_sender`; 53 migrations applied |
| `ENVIRONMENT_VARIABLES_REFERENCE.md` | Seeder path `src/data/seeders/`; example project ref `fzierzafqmxhuhinjldv` | `scripts/seeders/`; project `kuyubrjsfujgfcznjvit` |
| `scripts/check-setup.mjs` (`npm run doctor`) | Fix hints "Run … in the SQL Editor"; mentions Resend | Use `npm run db:migrate`; Brevo. Its PASS/FAIL probes are still useful. |
| `scripts/setup/guard.ts` | "Supabase CLI ships as a dev dependency" | CLI is fetched by `npx`; not in `package.json` |
| `src/lib/api/client.ts` console message | "Run `npx supabase db push`" | Use `npm run db:migrate` |
| `supabase/setup/DIAGNOSE_OTP.sql`, `VERIFY_LIVE.sql` | Check Resend secrets | Obsolete for Brevo |
| Many root `*_COMPLETE.md` / `*.txt` files | Historical notes from earlier phases | Not maintained; ignore for setup |

### Other notes

- **Open self-registration** (any domain) must be closed before production (§19).
- `supabase/setup/verify-*.js` and a few Markdown notes contain the owner's personal email address and the project's publishable key. The key is public by design; the email is personal data — **OWNER ACTION** to decide whether to strip it before publishing.
- `src/lib/supabase-types.ts` is hand-maintained; `npm run supabase:types` needs a local Docker stack and would overwrite it.
- Supabase free-tier projects pause after inactivity; a paused project makes every check fail with a connection error.
- Brevo's daily sending limit depends on the plan; heavy testing can exhaust it.

---

## 27. Ownership / responsibilities

| Responsibility | Owner (current developer) | New developer | Touchcore IT | Touchcore HR |
|---|---|---|---|---|
| Publish the current code to a clonable repository | ✅ | | | |
| Supabase organization membership / project transfer | ✅ (invite / transfer) | Accept invite | Own the target org (production) | |
| Hand over Gemini / Brevo / service-role secrets | ✅ | Store securely | Own production accounts | |
| Laptop setup, clone, install, `.env`, CLI link | | ✅ | Proxy / admin rights if needed | |
| Applying migrations to a shared database | Approves | Runs `npm run db:migrate` when agreed | | |
| Edge Function deploys | Approves | Runs deploy for changed functions | | |
| Auth dashboard settings (hook, URLs, SMTP) | ✅ verify now | Verify after access granted | Production values | |
| Vault secrets, `app_base_url` | ✅ | | Production values | |
| Production email sender / DNS | | | ✅ **CLIENT / IT ACTION** | |
| Production hosting and domain | | Implements when decided | ✅ Decides | |
| Signup domain allowlist | | | Confirms domain | Super Admin sets it |
| Real employee accounts, roles, core values, rewards | | | | ✅ |
| Test accounts for verification | ✅ provides | Uses | | Provides real mailboxes if needed |

---

## Handover Status

| Item | Status | Evidence |
|---|---|---|
| Documentation generated from repository | **YES** | `package.json`, `scripts/`, 53 migrations, 6 Edge Functions, `src/` inspected on 2026-09-26 |
| Setup commands verified | **YES — on the owner's machine; NO — not on a fresh laptop** | `type-check`, `tsc -b`, `lint`, `verify:logic`, `build`, `setup:check`, `doctor` all exited 0 on 2026-09-26 |
| Migration state verified | **YES** | `npx supabase migration list`: 53/53 applied (001–057, gaps 008/010/019/020), nothing pending, nothing orphaned |
| Edge Function state verified | **YES** | `npx supabase functions list`: 6/6 ACTIVE, `verify_jwt: true`, each deployed after its last local edit |
| Environment variables identified | **YES** | Full search of `import.meta.env`, `process.env`, `Deno.env`; Vault and `app_config` keys listed (§7) |
| Manual steps identified | **YES** | §1, §10.3, §10.4, §11, §26 |

**Remaining unknowns**

1. How and where the current code will be published (repository URL / branch), and what happens to the divergent `origin/main` — **blocking**.
2. Whether the new developer has been granted access to the Supabase organization — **blocking**.
3. Custom Access Token hook registration (project configuration; cannot be read with the public key).
4. Auth Site URL / Redirect URLs and SMTP configuration for password resets.
5. Presence of `brevo_api_key` / `brevo_sender` in Vault, and the verified sender identity.
6. Current value of `app_config.app_base_url`.
7. `pg_net` / `supabase_vault` extension status (assumed enabled).
8. Validity and quota of the deployed `GEMINI_API_KEY`.
9. Production Supabase project, hosting platform, domain and email sender — not decided in the repository.
10. The intended production signup domain (docs say `touchcoresystems.com`; confirm with Touchcore).
11. Why migration numbers `008` and `010` are absent.
