# Environment Variables Reference

## Overview

Your project uses two types of environment variables:

1. **Frontend variables** (`VITE_*`) — Exposed in browser
2. **Backend variables** (others) — Hidden from browser

---

## Frontend Variables (In Browser)

### VITE_SUPABASE_URL

**Location**: `.env`

**Used By**: React application (`src/lib/supabase.ts`)

**Value**: Your Supabase project URL

**Example**:
```env
VITE_SUPABASE_URL=https://fzierzafqmxhuhinjldv.supabase.co
```

**Where to Get**:
- Supabase Dashboard → Settings → API → Project URL (copy it)

---

### VITE_SUPABASE_ANON_KEY

**Location**: `.env`

**Used By**: React application (`src/lib/supabase.ts`)

**Value**: Supabase anonymous/public key

**Example**:
```env
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**Properties**:
- ✅ Public (safe to expose)
- ✅ Limited permissions
- ✅ Respects RLS policies
- ✅ Safe for production

**Where to Get**:
- Supabase Dashboard → Settings → API → anon public key (copy it)

---

## Backend Variables (Hidden)

### SUPABASE_SERVICE_ROLE_KEY

**Location**: `.env` (local only)

**Used By**: Seeding CLI (`src/data/seeders/seed.ts`, `verify.ts`)

**Value**: Supabase service role key

**Example**:
```env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6aWVyemFmcW14aHVoaW5qbGR2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NzU2Mzg3NSwiZXhwIjoyMTA...
```

**Properties**:
- ⚠️ Secret (keep confidential)
- ⚠️ Full permissions (bypasses RLS)
- ⚠️ Development/admin only
- ⚠️ Never expose to frontend

**Where to Get**:
- Supabase Dashboard → Settings → API → service_role key (copy it)
- **IMPORTANT**: Get the one labeled "service_role", NOT "anon"

---

## Complete .env Template

Here's what your `.env` should look like:

```env
# Supabase Configuration
# ========================

# Frontend variables (used by React app)
# Get these from: Supabase Dashboard > Settings > API
VITE_SUPABASE_URL=https://fzierzafqmxhuhinjldv.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSI...

# Backend variable (used by seeding CLI only)
# ⚠️ WARNING: This key bypasses RLS. Keep it secret!
# Get this from: Supabase Dashboard > Settings > API > service_role key
# DO NOT commit this to git
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSI...
```

---

## Where to Find Each Key in Supabase

### Path: Settings > API

```
Supabase Dashboard
  ↓
Select your project
  ↓
Settings (⚙️ gear icon, bottom left)
  ↓
API (left sidebar)
  ↓
Project API keys section
  │
  ├─ anon public key ← VITE_SUPABASE_ANON_KEY
  │
  └─ service_role key ← SUPABASE_SERVICE_ROLE_KEY
```

### Project URL

```
Supabase Dashboard
  ↓
Select your project
  ↓
Settings (⚙️ gear icon, bottom left)
  ↓
API (left sidebar)
  ↓
Project URL
  │
  └─ https://... ← VITE_SUPABASE_URL
```

---

## How Each Key Is Used

### VITE_SUPABASE_URL

**Loaded By**: `src/lib/supabase.ts`

```typescript
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,      // ← Your Supabase URL
  import.meta.env.VITE_SUPABASE_ANON_KEY  // ← Anon key
)
```

**Usage**: All React app queries

```typescript
// Example: Fetch employees (respects RLS)
const { data } = await supabase
  .from('employees')
  .select('*')
  // ↑ RLS policy determines what rows are returned
```

---

### VITE_SUPABASE_ANON_KEY

**Loaded By**: `src/lib/supabase.ts`

**Client Creation**:
```typescript
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY  // ← Limited permissions
)
```

**Behavior**:
- Limited permissions based on role
- RLS policies are enforced
- Can only access own data + public data
- Safe for production

---

### SUPABASE_SERVICE_ROLE_KEY

**Loaded By**: `src/data/seeders/seed.ts`

```typescript
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey)
// ↑ Full permissions, bypasses RLS
```

**Usage**: `npm run seed` command

```bash
npm run seed
# Uses service role key to insert mock data
# Bypasses RLS for this single command
```

**NOT Used**: React app (never imported)

---

## Security: VITE_ Prefix

### Why Frontend Uses VITE_

Vite has a special rule: **Only variables starting with `VITE_` are exposed to the browser**

### Example

```env
VITE_SUPABASE_URL=...              ✅ EXPOSED (starts with VITE_)
VITE_SUPABASE_ANON_KEY=...         ✅ EXPOSED (starts with VITE_)
SUPABASE_SERVICE_ROLE_KEY=...      ✅ HIDDEN (no VITE_ prefix)
DATABASE_PASSWORD=...              ✅ HIDDEN (no VITE_ prefix)
SECRET_TOKEN=...                   ✅ HIDDEN (no VITE_ prefix)
```

### Result

When you build the app:
```bash
npm run build
```

Vite generates `dist/index.html` with embedded values:

```javascript
// In dist/main.js (after build)
const url = "https://fzierzafqmxhuhinjldv.supabase.co"  // ✅ OK to expose
const key = "eyJhbGciOi..."                             // ✅ Limited permissions

// Variables WITHOUT VITE_ prefix are NOT included
// SUPABASE_SERVICE_ROLE_KEY is never in dist/ folder
```

This is intentional: the anon key is meant to be public!

---

## What Gets Exposed (and What Doesn't)

### Exposed in Browser (Safe ✅)

```
VITE_SUPABASE_URL          ← Project URL (public)
VITE_SUPABASE_ANON_KEY     ← Public key (limited permissions)
```

**Why Safe**: 
- URL is public (anyone can see it from network tab)
- Anon key has limited permissions (respects RLS)
- Can't do anything harmful

### Hidden from Browser (Secure ✅)

```
SUPABASE_SERVICE_ROLE_KEY  ← Service key (full permissions)
```

**Why Hidden**:
- Bypasses RLS
- Would be dangerous if exposed
- Only Node.js/CLI needs it

---

## Step-by-Step: Adding Keys to .env

### 1. Open `.env` File

File: `.env` (in project root)

### 2. Add VITE_SUPABASE_URL

From Supabase: Settings → API → Project URL

```env
VITE_SUPABASE_URL=https://fzierzafqmxhuhinjldv.supabase.co
```

### 3. Add VITE_SUPABASE_ANON_KEY

From Supabase: Settings → API → anon public key

```env
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 4. Add SUPABASE_SERVICE_ROLE_KEY

From Supabase: Settings → API → service_role key

```env
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 5. Save File

Save and close.

### 6. Verify

```bash
npm run seed
```

Should work now! ✅

---

## Checking Your Variables

### Quick Check

```bash
grep SUPABASE .env
```

Should show:
```
VITE_SUPABASE_URL=https://...
VITE_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Detailed Check

```bash
# Frontend variables (should work)
npm run dev

# Backend variables (should work)
npm run seed
```

---

## Troubleshooting

### "Cannot find module 'src/lib/supabase'"

**Cause**: Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY

**Fix**:
```bash
grep VITE_SUPABASE .env
# If empty or missing, add them from Supabase Dashboard
```

### "Missing SUPABASE_SERVICE_ROLE_KEY"

**Cause**: Not added to .env (for seeding)

**Fix**:
```bash
echo "SUPABASE_SERVICE_ROLE_KEY=your_key_here" >> .env
```

### Variables Loaded in Wrong Order

**Check**: Load order is correct

```typescript
// In seed.ts
fs.readFileSync('.env')  // ← Reads all env vars first
process.env.SUPABASE_SERVICE_ROLE_KEY  // ← Then accesses them
```

---

## Reference: Key Formats

### URL Format

```
https://[PROJECT_ID].supabase.co
        ↑
   26-character alphanumeric string
```

**Example**:
```
https://fzierzafqmxhuhinjldv.supabase.co
```

### Anon Key Format

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IiIsInJvbGUiOiJhbm9uIiwiaWF0IjoxNzg3NTYzODc1LCJleHAiOjIxMDMxMzk4NzV9.[signature]
```

- Starts with: `eyJ...`
- JWT format (3 parts separated by `.`)
- Contains: `"role":"anon"`
- Length: ~200+ characters

### Service Role Key Format

```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IiIsInJvbGUiOiJzZXJ2aWNlX3JvbGUiLCJpYXQiOjE3ODc1NjM4NzUsImV4cCI6MjEwMzEzOTg3NX0.[signature]
```

- Starts with: `eyJ...`
- JWT format (3 parts separated by `.`)
- Contains: `"role":"service_role"`
- Length: ~200+ characters

**Key Difference**: "anon" vs "service_role" in the JWT payload

---

## Summary Table

| Variable | Prefix | Exposed | Permission | Used By | Source |
|---|---|---|---|---|---|
| VITE_SUPABASE_URL | VITE_ | ✅ Yes | N/A | React | Settings > API |
| VITE_SUPABASE_ANON_KEY | VITE_ | ✅ Yes | Limited | React | Settings > API |
| SUPABASE_SERVICE_ROLE_KEY | None | ❌ No | Full | CLI | Settings > API |

---

## Next Steps

1. Open Supabase Dashboard
2. Go to Settings → API
3. Copy all three values
4. Add to `.env` as shown above
5. Run `npm run seed`
6. Done! ✅

---

**Last Updated**: September 1, 2026  
**Status**: ✅ Ready to use
