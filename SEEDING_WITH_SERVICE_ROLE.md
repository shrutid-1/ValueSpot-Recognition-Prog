# Seeding with Supabase Service Role Key

## Overview

The seeding CLI now uses a **Supabase Service Role Key** instead of the anonymous key. This allows the seeding script to bypass Row Level Security (RLS) policies and insert mock data, while keeping RLS fully enabled for the production application.

---

## Security Architecture

### The Problem
- Your Supabase database has RLS enabled on all tables (✅ correct)
- The anonymous key (used by the React app) cannot insert data (✅ secure)
- But you need to seed mock data during development (⚠️ need service role)

### The Solution
- **Frontend (React/Vite)**: Uses `VITE_SUPABASE_ANON_KEY` (limited permissions, respects RLS)
- **Seeding CLI**: Uses `SUPABASE_SERVICE_ROLE_KEY` (full permissions, bypasses RLS for seeding only)
- **Result**: Both work correctly, RLS is always enforced for production

### Security Guarantees
✅ Service role key is **NEVER** in frontend code  
✅ Service role key is **NOT** exposed via `VITE_` environment variables  
✅ Service role key is **ONLY** used in Node.js CLI scripts  
✅ `.env` file containing service role key is in `.gitignore`  
✅ RLS remains enabled on all tables  
✅ Production application continues to use anon key  

---

## How to Set Up

### Step 1: Get Your Service Role Key

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Click **Settings** (gear icon, bottom left)
4. Click **API** in the left sidebar
5. Under "Project API keys", find:
   - `service_role key` (this is what you need)
   - `anon public key` (don't use this for seeding)
6. Copy the full `service_role key` value

**Important**: Look for the one labeled **"service_role"**, not "anon"

### Step 2: Add to Your Local .env

Open `.env` in the project root and add:

```env
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here
```

Example (with fake key):
```env
VITE_SUPABASE_URL=https://fzierzafqmxhuhinjldv.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSI...

# Service role key - ONLY for seeding
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSI...
```

**⚠️ IMPORTANT**: 
- `.env` is in `.gitignore` — it will never be committed
- Your service role key is only stored locally
- Never paste it in code, emails, or public places

### Step 3: Run Seeding

```bash
npm run seed
```

**Expected output**:
```
✅ Supabase project URL loaded
✅ Service role key loaded (for seeding only)

🌱 Starting seeding process...

[timestamp] DEPARTMENTS: Starting department seeding...
... (progress updates)

============================================================
SEEDING SUMMARY
============================================================
  departments          │ ✏️  6 inserted, 🔄 0 updated, ⏭️  0 skipped
  core_values          │ ✏️  5 inserted, 🔄 0 updated, ⏭️  0 skipped
  ... (more tables)
============================================================
Status: ✅ SUCCESS
Duration: 5234ms
============================================================
```

### Step 4: Verify

```bash
npm run seed:verify
```

**Expected output**:
```
🔍 Verifying seeded data...

✅ Departments: 6/6 departments seeded
✅ Core Values: 5/5 core values seeded
✅ Behaviours: 25/25 behaviours seeded
... (all checks)

============================================================
VERIFICATION SUMMARY
============================================================
✅ Passed: 14/14
============================================================

✅ All verifications passed!
```

### Step 5: Test in App

```bash
npm run dev
```

Navigate to:
- **Feed** → Should display seeded recognitions
- **Employees** → Should show all 9 employees
- **Core Values** → Should show all 5 values with behaviours

---

## Files Changed

### Modified Files

| File | Change | Security Impact |
|---|---|---|
| `src/data/seeders/seed.ts` | Now loads `SUPABASE_SERVICE_ROLE_KEY` instead of `VITE_SUPABASE_ANON_KEY` | ✅ Service role only used in CLI |
| `src/data/seeders/verify.ts` | Updated to use service role key (with fallback to anon key) | ✅ Allows full verification |
| `src/data/seeders/seedService.ts` | Renamed parameter for clarity (`supabaseKey` instead of `supabaseAnonKey`) | ✅ No security change |
| `.env` | Added `SUPABASE_SERVICE_ROLE_KEY` variable (empty) | ✅ You fill in locally |
| `.env.example` | Created with documentation | ✅ No secrets exposed |

### Not Changed

✅ Vite configuration (tsconfig.app.json)  
✅ React application code  
✅ Database schema  
✅ RLS policies (remain enabled)  
✅ Mock data structure  
✅ Frontend imports  

---

## Commands Reference

```bash
# Seed the database with mock data
npm run seed

# Verify all mock data was seeded correctly
npm run seed:verify

# Run both seed and verify
npm run seed && npm run seed:verify

# Start the development application
npm run dev

# Direct tsx execution (if npm script fails)
npx tsx --project tsconfig.seeders.json src/data/seeders/seed.ts
```

---

## How It Works Behind the Scenes

### Execution Flow

```
User runs: npm run seed
    ↓
tsx loads seed.ts
    ↓
seed.ts loads .env file
    ↓
seed.ts reads SUPABASE_SERVICE_ROLE_KEY from environment
    ↓
Validates both URL and service role key exist
    ↓
Creates Supabase client with service role key
    ↓
seedService.ts runs seeding with full permissions
    ↓
Service role bypasses RLS on each INSERT/UPDATE
    ↓
Mock data inserted successfully
    ↓
Seeders report success
    ↓
✅ Seeding complete
```

### Key Difference from Before

**Before (RLS Error)**:
```
seed.ts → VITE_SUPABASE_ANON_KEY → 
  INSERT to departments → 
  RLS policy blocks (no row-level access) → 
  ❌ ERROR: "new row violates row-level security policy"
```

**After (Success)**:
```
seed.ts → SUPABASE_SERVICE_ROLE_KEY → 
  INSERT to departments → 
  RLS bypassed (service role has full access) → 
  ✅ SUCCESS: 6 departments inserted
```

---

## Environment Variables

### Frontend (React/Vite)
```env
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_ANON_KEY=eyJ...
```
- Used by `src/lib/supabase.ts`
- Exposed in browser (safe: limited permissions)
- Respects all RLS policies

### Seeding CLI (Node.js)
```env
VITE_SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```
- Used by `src/data/seeders/seed.ts`
- **NOT** exposed in browser
- **NOT** a `VITE_` variable (can't leak to frontend)
- Bypasses RLS (development/seeding only)

---

## Troubleshooting

### "SUPABASE_SERVICE_ROLE_KEY is not defined"

**Solution**:
1. Open `.env` in project root
2. Add the line: `SUPABASE_SERVICE_ROLE_KEY=your_key_here`
3. Replace `your_key_here` with your actual service role key from Supabase Dashboard
4. Run: `npm run seed`

### "Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY"

**Same solution as above** — the seed script is telling you it's missing

### "row violates row-level security policy"

**Possible causes**:
1. You used the **anon key** instead of **service role key**
   - Solution: Get the correct service role key from Supabase Dashboard
2. You didn't add it to `.env`
   - Solution: Add `SUPABASE_SERVICE_ROLE_KEY=...` to `.env`
3. The key is malformed
   - Solution: Copy the full key from Supabase (should start with `eyJ...`)

### "Failed to connect to Supabase"

**Possible causes**:
1. `VITE_SUPABASE_URL` is missing or incorrect
   - Solution: Verify your Supabase URL in `.env`
2. Invalid service role key
   - Solution: Get a fresh key from Supabase Dashboard
3. Network/firewall issue
   - Solution: Check internet connection, try from a different network

### Verify script shows 0 records

**Possible causes**:
1. Seeding didn't actually run (check for errors above)
2. You used the anon key for verify (respects RLS)
   - Solution: Use service role key, or just re-run `npm run seed`

---

## Compliance Checklist

✅ Service role key is **NOT** in frontend code  
✅ Service role key is **NOT** exposed via `VITE_` prefix  
✅ Service role key is **ONLY** in `.env` (local, gitignored)  
✅ `.env` is in `.gitignore` (never committed)  
✅ Seed scripts validate key exists before using  
✅ Clear documentation on how to obtain the key  
✅ RLS remains enabled on all tables  
✅ Production app unaffected (uses anon key)  

---

## Next Steps

1. **Get your service role key** from Supabase Dashboard
2. **Add it to .env**: `SUPABASE_SERVICE_ROLE_KEY=...`
3. **Run seeding**: `npm run seed`
4. **Verify**: `npm run seed:verify`
5. **Test app**: `npm run dev`

That's it! Your database is now seeded with mock data. 🚀

---

## Reference: Where to Find Service Role Key

**Path**: Supabase Dashboard → Select Project → Settings → API

**Screenshot location**:
```
┌─ Supabase Dashboard (supabase.com)
│
├─ Select your project
│
├─ Settings (gear icon, bottom left)
│   └─ API (sidebar)
│       ├─ Project API keys
│       │   ├─ service_role key  ← COPY THIS
│       │   └─ anon public key (not this one)
│       │
│       └─ (other settings)
```

The service_role key is a long JWT token starting with `eyJ...`

---

## Security Notes

**Why service role key is safe for seeding:**
- ✅ Never committed to git (in .gitignore)
- ✅ Only stored locally
- ✅ Only used in development
- ✅ Not exposed in network requests from browser
- ✅ Not accessible to other developers (each has their own .env)
- ✅ Cannot be discovered by inspecting frontend code

**Why RLS is still secure:**
- ✅ RLS policies remain enabled on all tables
- ✅ Production application still uses anon key (limited permissions)
- ✅ Service role key is only used in CLI (not in production)
- ✅ Even if service role key is compromised, it only affects development

---

## Support

For issues with seeding:
1. Check this guide's Troubleshooting section
2. Verify `.env` has both `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
3. Run `npm run seed --verbose` (if you need detailed logs)
4. Check Supabase Dashboard for any alerts or issues

---

**Status**: ✅ Ready to seed  
**Last Updated**: September 1, 2026
