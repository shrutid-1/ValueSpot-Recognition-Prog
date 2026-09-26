-- ============================================================
--  VERIFY BEFORE ENFORCING  —  run this first, apply nothing else yet
--
--  Everything in migration 019/020 rests on one assumption:
--
--      Supabase records HOW a session authenticated, in the JWT's `amr`
--      claim, and the database can read it.
--
--  If that is not true on this project, the enforcement migrations would lock
--  every user out. This file proves it either way. It only creates two
--  read-only helper functions and changes no policy, no table and no data.
--
--  HOW TO RUN
--  ----------
--  Step 1.  Run this whole file in the SQL Editor. It is safe.
--  Step 2.  Follow the browser test in the comment at the bottom.
--  Step 3.  Send me both results. Do not apply 019 or 020 until then.
-- ============================================================


-- ── The two functions the enforcement depends on ────────────

CREATE OR REPLACE FUNCTION public.session_auth_methods()
RETURNS text[]
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT e->>'method'
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(auth.jwt()->'amr') = 'array'
                    THEN auth.jwt()->'amr'
                    ELSE '[]'::jsonb
               END
             ) e
       WHERE e->>'method' IS NOT NULL
    ),
    ARRAY[]::text[]
  );
$$;

GRANT EXECUTE ON FUNCTION public.session_auth_methods() TO authenticated;


CREATE OR REPLACE FUNCTION public.session_email_verified()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM unnest(public.session_auth_methods()) m
     WHERE m IN ('otp', 'magiclink', 'email', 'recovery', 'totp', 'mfa')
  );
$$;

GRANT EXECUTE ON FUNCTION public.session_email_verified() TO authenticated;


-- ── Diagnostic, readable from the browser ───────────────────
--
-- Returns everything needed to judge whether enforcement is safe, including
-- the raw claim so nothing has to be taken on trust.

CREATE OR REPLACE FUNCTION public.debug_session_auth()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'user_id',           auth.uid(),
    'email',             auth.jwt()->>'email',
    'amr_present',       (auth.jwt() ? 'amr'),
    'amr_raw',           auth.jwt()->'amr',
    'aal',               auth.jwt()->>'aal',
    'methods',           to_jsonb(public.session_auth_methods()),
    'verified',          public.session_email_verified(),
    'has_user_role',     (auth.jwt() ? 'user_role'),
    'has_employee_id',   (auth.jwt() ? 'employee_id')
  );
$$;

GRANT EXECUTE ON FUNCTION public.debug_session_auth() TO authenticated;


-- ============================================================
--  TEST 1 — run right here in the SQL Editor
--
--  The SQL Editor has no end-user session, so this must come back with
--  amr_present = false and verified = false. That only confirms the function
--  runs; it proves nothing about real sessions.
-- ============================================================

SELECT public.debug_session_auth() AS sql_editor_context;


-- ============================================================
--  TEST 2 — the one that actually matters. Run in the BROWSER.
--
--  Open the app, press F12 for the console, and paste this. It signs in with
--  a password only, reads the claim, then signs out again. Use a real account.
--
--    const url  = 'https://YOUR-PROJECT.supabase.co'
--    const key  = 'YOUR-ANON-KEY'
--    const mail = 'you@example.com'
--    const pass = 'your-password'
--
--    const call = async (tok, fn) => (await fetch(`${url}/rest/v1/rpc/${fn}`, {
--      method: 'POST',
--      headers: { apikey: key, Authorization: `Bearer ${tok}`,
--                 'Content-Type': 'application/json' },
--      body: '{}',
--    })).json()
--
--    // --- password only ---
--    const r1 = await (await fetch(`${url}/auth/v1/token?grant_type=password`, {
--      method: 'POST',
--      headers: { apikey: key, 'Content-Type': 'application/json' },
--      body: JSON.stringify({ email: mail, password: pass }),
--    })).json()
--
--    console.log('PASSWORD-ONLY :', await call(r1.access_token, 'debug_session_auth'))
--
--  EXPECTED:  amr_present true, methods ["password"], verified false
--
--  Then trigger an email code and verify it, and run the same call again with
--  the new token:
--
--    await fetch(`${url}/auth/v1/otp`, {
--      method: 'POST',
--      headers: { apikey: key, 'Content-Type': 'application/json' },
--      body: JSON.stringify({ email: mail, create_user: false }),
--    })
--    // read the 6-digit code from your inbox, then:
--    const r2 = await (await fetch(`${url}/auth/v1/verify`, {
--      method: 'POST',
--      headers: { apikey: key, 'Content-Type': 'application/json' },
--      body: JSON.stringify({ type: 'email', email: mail, token: 'PASTE_CODE' }),
--    })).json()
--
--    console.log('AFTER CODE    :', await call(r2.access_token, 'debug_session_auth'))
--
--  EXPECTED:  methods includes "otp", verified true
--
--  ------------------------------------------------------------
--  WHAT THE RESULTS MEAN
--
--  Both as expected
--      Enforcement is safe. Apply 018, then 019, then 020.
--
--  amr_present = false on both
--      This project does not expose the claim. Do NOT apply 019 or 020 —
--      they would lock everyone out. Send me the output and I will switch
--      to the alternative (a verification record written server-side at
--      verifyOtp time, checked the same way).
--
--  verified = true after password only
--      The method list is not distinguishing the two. Do NOT apply.
--      Send me `amr_raw` from both runs.
-- ============================================================
