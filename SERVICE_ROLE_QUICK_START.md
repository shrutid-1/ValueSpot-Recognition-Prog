# Service Role Key - Quick Start

## TL;DR - Get Started in 2 Minutes

### 1️⃣ Get Service Role Key

```
Supabase Dashboard → Settings (gear) → API (sidebar) → Copy "service_role key"
```

### 2️⃣ Add to .env

Edit `.env` and add:
```env
SUPABASE_SERVICE_ROLE_KEY=your_key_here
```

### 3️⃣ Run Seeding

```bash
npm run seed
```

That's it! 🎉

---

## Step-by-Step

### Get the Key

1. Open [app.supabase.com](https://app.supabase.com)
2. Click your project
3. Bottom left: **Settings** (⚙️ gear icon)
4. Left sidebar: **API**
5. Under "Project API keys", find **"service_role key"** (long JWT string)
6. Click copy icon

### Add to .env

**File**: `.env` (in project root)

**Add this line**:
```
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Replace the example with your actual key.

### Run Seeding

```bash
npm run seed
```

Should see: `✅ SUCCESS`

### Verify It Worked

```bash
npm run seed:verify
```

Should see: `✅ Passed: 14/14`

---

## Common Issues

| Problem | Solution |
|---|---|
| "SUPABASE_SERVICE_ROLE_KEY is not defined" | Add `SUPABASE_SERVICE_ROLE_KEY=...` to `.env` |
| "row violates row-level security policy" | Make sure you're using the **service_role key**, not the anon key |
| "Failed to connect" | Check `.env` has both `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` |

---

## Files Modified

✅ `src/data/seeders/seed.ts` — Now uses `SUPABASE_SERVICE_ROLE_KEY`  
✅ `src/data/seeders/verify.ts` — Updated to support service role key  
✅ `src/data/seeders/seedService.ts` — Parameter name clarified  
✅ `.env` — Added `SUPABASE_SERVICE_ROLE_KEY` variable  
✅ `.env.example` — Created with documentation  

**Not changed**: React app, RLS policies, database schema

---

## Security ✅

- Service role key is **NEVER** in frontend code
- Service role key is **NOT** a `VITE_` variable (can't leak to browser)
- `.env` is in `.gitignore` (never committed)
- RLS remains enabled (frontend still uses anon key)

---

## Commands

```bash
npm run seed         # Seed database
npm run seed:verify  # Verify data
npm run dev          # Start app
```

---

**Status**: Ready to seed 🚀

For full details, see: `SEEDING_WITH_SERVICE_ROLE.md`
