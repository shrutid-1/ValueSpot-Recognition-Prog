# Next Steps: Get Your Service Role Key and Seed

## 🎯 What You Need to Do Right Now

Your seeding system is ready, but it needs one thing: your **Supabase Service Role Key**.

This key is required to bypass RLS during development seeding.

---

## Step 1: Get Your Service Role Key (2 minutes)

### Open Supabase Dashboard

1. Go to: https://app.supabase.com
2. Click your project name (in top left dropdown)

### Find the Service Role Key

3. **Settings** (gear icon ⚙️ at bottom left) → Click it
4. **API** (left sidebar) → Click it
5. **Project API keys** section

You'll see:
- `anon public key` ← **DON'T use this**
- `service_role key` ← **COPY THIS ONE**

### Copy the Key

6. Look for the long text starting with `eyJ...`
7. Under "service_role key", click the copy icon (📋)
8. Keep it copied

---

## Step 2: Add to Your .env File (1 minute)

### Open .env

In your project root, open the `.env` file

### Find This Line

```env
SUPABASE_SERVICE_ROLE_KEY=
```

### Paste Your Key

Replace the empty value:

```env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSI...
```

(Paste your actual key where it says `eyJ...`)

### Save the File

Save the file. Done! ✅

---

## Step 3: Run Seeding (30 seconds)

### Open Terminal

In your project directory, open a terminal/PowerShell

### Run Seeding Command

```bash
npm run seed
```

### Watch It Work

You'll see output like:

```
✅ Supabase project URL loaded
✅ Service role key loaded (for seeding only)

🌱 Starting seeding process...

[timestamp] DEPARTMENTS: Starting department seeding...
[timestamp] DEPARTMENTS: Inserted Platform, Support, Product...
... (more progress)

============================================================
SEEDING SUMMARY
============================================================
  departments          │ ✏️  6 inserted, 🔄 0 updated, ⏭️  0 skipped
  core_values          │ ✏️  5 inserted, 🔄 0 updated, ⏭️  0 skipped
  behaviours           │ ✏️  25 inserted, 🔄 0 updated, ⏭️  0 skipped
  scenarios            │ ✏️  25 inserted, 🔄 0 updated, ⏭️  0 skipped
  projects             │ ✏️  3 inserted, 🔄 0 updated, ⏭️  0 skipped
  employees            │ ✏️  9 inserted, 🔄 0 updated, ⏭️  0 skipped
  manager_backfill     │ ✏️  0 inserted, 🔄 9 updated, ⏭️  0 skipped
  project_members      │ ✏️  27 inserted, 🔄 0 updated, ⏭️  0 skipped
  nominations          │ ✏️  16 inserted, 🔄 0 updated, ⏭️  0 skipped
  appreciations        │ ✏️  58 inserted, 🔄 0 updated, ⏭️  0 skipped
============================================================
Status: ✅ SUCCESS
Duration: 3456ms
============================================================
```

If you see `✅ SUCCESS`, you're done! 🎉

---

## Step 4: Verify (10 seconds)

### Run Verification

```bash
npm run seed:verify
```

### Expected Output

```
🔍 Verifying seeded data...

✅ Departments: 6/6 departments seeded
✅ Core Values: 5/5 core values seeded
✅ Behaviours: 25/25 behaviours seeded
✅ Scenarios: 25/25 scenarios seeded
✅ Projects: 3/3 projects seeded
✅ Employees: 9/9 employees seeded
✅ Project Members: 9/9 project members linked
✅ Nominations: 16/16 nominations seeded
✅ Approved Nominations: 9/9 approved recognitions
✅ Appreciations: 50/50 appreciation reactions
✅ FK Integrity: 16/16 nominations with valid FKs
✅ Feed View: 1/1 feed view returns data
✅ Badge Definitions: 5/5 badge levels defined
✅ App Config: 5/5 system configuration loaded

============================================================
VERIFICATION SUMMARY
============================================================
✅ Passed: 14/14
============================================================

✅ All verifications passed!
```

Perfect! ✅ Your data is seeded.

---

## Step 5: Test in App (1 minute)

### Start Dev Server

```bash
npm run dev
```

### Open App

Open the URL shown (usually http://localhost:5173)

### Check Your Data

Navigate to:

- **Feed** → Should show recognitions
- **Employees** → Should show 9 employees
- **Core Values** → Should show 5 values with behaviours
- **Analytics** (if HR role) → Should show charts with data

All seeded data is now in your app! 🚀

---

## 📋 Quick Checklist

- [ ] Got service role key from Supabase Dashboard
- [ ] Added `SUPABASE_SERVICE_ROLE_KEY=...` to `.env`
- [ ] Ran `npm run seed` → Saw `✅ SUCCESS`
- [ ] Ran `npm run seed:verify` → Saw `✅ Passed: 14/14`
- [ ] Ran `npm run dev` → Saw data in app

Done! ✅

---

## ❓ Issues?

### "SUPABASE_SERVICE_ROLE_KEY is not defined"

Add it to `.env`:
```env
SUPABASE_SERVICE_ROLE_KEY=your_key_here
```

### "row violates row-level security policy"

You're using the wrong key. Make sure it's the **service_role key**, not the anon key.

### "Can't find the key in Supabase"

Path: Settings (⚙️) → API → Project API keys → **service_role key**

### Still stuck?

Read the full guides:
- `SERVICE_ROLE_QUICK_START.md` — 5-minute guide
- `SEEDING_WITH_SERVICE_ROLE.md` — Complete guide
- `RLS_SEEDING_IMPLEMENTATION.md` — Technical details

---

## 🔒 Security

✅ Your service role key is only in your local `.env`  
✅ `.env` is ignored by git (never committed)  
✅ The app still uses the anon key (RLS is respected)  
✅ Service role key is only used for development seeding  

You're safe! 🔐

---

## 🚀 You're Ready!

Just 2 minutes to get the key, and you're all set.

**Next**: Go get your service role key from Supabase Dashboard, add it to `.env`, and run `npm run seed`!

---

**Total Time**: ~5 minutes  
**Difficulty**: Easy ✅  
**Result**: 156+ mock records in your database 🎉
