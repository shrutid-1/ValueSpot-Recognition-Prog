// =====================================================================
//  POST-DEPLOYMENT SECURITY TESTS  —  run in the browser console
//
//  Project URL and publishable key are filled in (both are public by design;
//  the publishable key already ships in the browser bundle).
//
//  Run ONE block at a time. After each, type   __r   and press Enter.
//  Nothing here writes application data.
// =====================================================================


// ===== BLOCK 1 — a password-only session must be POWERLESS =====
// Put your password in PASS, paste the whole block, then type: __r

window.__r = 'running...';
(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const MAIL = 'pdkaslikar29@gmail.com';
  const PASS = window.__pass || prompt('Password (typed once, never written to this file)');

  const dec = t => { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))); };

  const a = await (await fetch(URL_ + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MAIL, password: PASS }),
  })).json();
  if (!a.access_token) { window.__r = 'SIGN-IN FAILED: ' + JSON.stringify(a); return; }

  // Kept for the later blocks.
  window.__tok = a.access_token;
  window.__refresh = a.refresh_token;
  window.__uid = a.user.id;

  const A = { apikey: KEY, Authorization: 'Bearer ' + a.access_token, 'Content-Type': 'application/json' };
  const rpc = async (fn, b) => (await fetch(URL_ + '/rest/v1/rpc/' + fn,
    { method: 'POST', headers: A, body: JSON.stringify(b || {}) })).json();
  const read = async t => {
    const r = await fetch(URL_ + '/rest/v1/' + t + '?select=*&limit=2', { headers: A });
    const body = await r.text();
    return r.status + ' rows=' + ((body.match(/\{/g) || []).length);
  };

  const p = dec(a.access_token);
  window.__sid = p.session_id;

  // Try to mark our own session verified by writing the table directly.
  const forge = await fetch(URL_ + '/rest/v1/login_verifications', {
    method: 'POST', headers: A,
    body: JSON.stringify({
      session_id: p.session_id, user_id: a.user.id, email: MAIL,
      expires_at: '2030-01-01T00:00:00Z', verified_at: '2030-01-01T00:00:00Z',
    }),
  });

  window.__r = JSON.stringify({
    session_id:            p.session_id,
    amr:                   p.amr,
    has_user_role_claim:   ('user_role' in p),
    session_status:        await rpc('session_status'),
    current_employee_role: await rpc('current_employee_role'),
    claim_account:         await rpc('claim_employee_account'),
    read_employees:        await read('employees'),
    read_nominations:      await read('nominations'),
    read_notifications:    await read('notifications'),
    read_badges:           await read('employee_value_badges'),
    read_feed:             await read('v_recognition_feed'),
    read_app_config:       await read('app_config'),
    forge_verified_row:    forge.status + ' ' + (await forge.text()).slice(0, 70),
    request_code:          await rpc('request_login_code'),
  }, null, 2);
})()

// EXPECT
//   session_status.verified       false
//   current_employee_role         null
//   claim_account.status          "needs_verification"
//   every read_*                  rows=0
//   forge_verified_row            401 or 403   (never 201)
//   request_code.status           "ok"  -> a code is now in your inbox
//                                 "email_not_configured" -> Vault secrets missing


// ===== BLOCK 2 — enter the code, confirm access opens =====
// Put the 6-digit code from your email in CODE, paste, then type: __r

window.__r = 'running...';
(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const CODE = '';   // <-- paste the 6-digit code from your email

  const A = { apikey: KEY, Authorization: 'Bearer ' + window.__tok, 'Content-Type': 'application/json' };
  const rpc = async (fn, b) => (await fetch(URL_ + '/rest/v1/rpc/' + fn,
    { method: 'POST', headers: A, body: JSON.stringify(b || {}) })).json();
  const read = async t => {
    const r = await fetch(URL_ + '/rest/v1/' + t + '?select=*&limit=2', { headers: A });
    const body = await r.text();
    return r.status + ' rows=' + ((body.match(/\{/g) || []).length);
  };

  const wrong = await rpc('verify_login_code', { p_code: '000001' });
  const first = await rpc('verify_login_code', { p_code: CODE });

  window.__r = JSON.stringify({
    verify_wrong_first:    wrong,
    verify_correct:        first,
    session_status:        await rpc('session_status'),
    current_employee_role: await rpc('current_employee_role'),
    read_employees:        await read('employees'),
    read_nominations:      await read('nominations'),
    read_feed:             await read('v_recognition_feed'),
  }, null, 2);
})()

// EXPECT
//   verify_wrong_first.status      "invalid", attempts_remaining 4
//   verify_correct.status          "ok"
//   session_status.verified        true
//   current_employee_role          "super_admin"
//   read_*                         rows > 0


// ===== BLOCK 3 — verification survives an access-token refresh =====

window.__r = 'running...';
(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';

  const dec = t => { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))); };

  const r = await (await fetch(URL_ + '/auth/v1/token?grant_type=refresh_token', {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: window.__refresh }),
  })).json();
  if (!r.access_token) { window.__r = 'REFRESH FAILED: ' + JSON.stringify(r).slice(0, 200); return; }

  const p2 = dec(r.access_token);
  const A = { apikey: KEY, Authorization: 'Bearer ' + r.access_token, 'Content-Type': 'application/json' };
  const rpc = async fn => (await fetch(URL_ + '/rest/v1/rpc/' + fn,
    { method: 'POST', headers: A, body: '{}' })).json();
  const emp = await fetch(URL_ + '/rest/v1/employees?select=id&limit=1', { headers: A });
  const empBody = await emp.text();

  window.__r = JSON.stringify({
    session_id_before: window.__sid,
    session_id_after:  p2.session_id,
    session_id_stable: window.__sid === p2.session_id,
    still_verified:    await rpc('session_status'),
    read_employees:    emp.status + ' rows=' + ((empBody.match(/\{/g) || []).length),
  }, null, 2);
})()

// EXPECT  session_id_stable true, still_verified.verified true, rows > 0
//         -> the user is never asked for a second code after a token refresh


// ===== BLOCK 4a — passwordless attack: send an email-only OTP =====

window.__r = 'running...';
(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const MAIL = 'pdkaslikar29@gmail.com';

  const r = await fetch(URL_ + '/auth/v1/otp', {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MAIL, create_user: false }),
  });
  window.__r = r.status === 429
    ? 'RATE LIMITED — wait and retry'
    : 'HTTP ' + r.status + ' — open the email, RIGHT-CLICK the link, Copy link address, then run BLOCK 4b';
})()


// ===== BLOCK 4b — try to use that passwordless session =====
// Paste the copied link into LINK.

window.__r = 'running...';
(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const LINK = 'PASTE_THE_LINK_HERE';

  const dec = t => { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))); };

  const u = new URL(LINK);
  const hash = u.searchParams.get('token') || u.searchParams.get('token_hash');
  const v = await (await fetch(URL_ + '/auth/v1/verify', {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hash }),
  })).json();
  if (!v.access_token) { window.__r = 'VERIFY FAILED: ' + JSON.stringify(v).slice(0, 200); return; }

  const A = { apikey: KEY, Authorization: 'Bearer ' + v.access_token, 'Content-Type': 'application/json' };
  const rpc = async fn => (await fetch(URL_ + '/rest/v1/rpc/' + fn,
    { method: 'POST', headers: A, body: '{}' })).json();
  const emp = await fetch(URL_ + '/rest/v1/employees?select=id&limit=1', { headers: A });
  const empBody = await emp.text();

  window.__r = JSON.stringify({
    amr:            dec(v.access_token).amr,
    request_code:   await rpc('request_login_code'),
    session_status: await rpc('session_status'),
    read_employees: emp.status + ' rows=' + ((empBody.match(/\{/g) || []).length),
  }, null, 2);
})()

// EXPECT
//   amr                     WITHOUT "password"
//   request_code.status     "password_required"   <- the critical assertion
//   session_status.verified false
//   read_employees          rows=0
//
// If request_code returns "ok" here, STOP — email alone can reach the app.
