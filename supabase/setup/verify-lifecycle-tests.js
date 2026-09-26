// =====================================================================
//  CODE LIFECYCLE TESTS  —  run in the browser console
//
//  Uses ONE email for BLOCK 5 and one more for BLOCK 6.
//  Your hourly budget is 10 sends per account.
//
//  Run a block, then type   __r   to read the result.
// =====================================================================


// ===== BLOCK 5 — cross-session rejection, cooldown, lockout =====
//
// Signs in fresh (a NEW session), requests one code, then attacks it.
// Set PASS, and OLD_CODE to the code you already used in Block 2.

window.__r = 'running...';
(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const MAIL = 'pdkaslikar29@gmail.com';
  const PASS = window.__pass || prompt('Password (typed once, never written to this file)');
  const OLD_CODE = '';   // a code already redeemed by an earlier session

  const dec = t => { const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(b + '='.repeat((4 - b.length % 4) % 4))); };

  const a = await (await fetch(URL_ + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MAIL, password: PASS }),
  })).json();
  if (!a.access_token) { window.__r = 'SIGN-IN FAILED: ' + JSON.stringify(a); return; }

  window.__tok5 = a.access_token;              // BLOCK 6 reuses this session
  const sid = dec(a.access_token).session_id;
  window.__sid5 = sid;

  const A = { apikey: KEY, Authorization: 'Bearer ' + a.access_token, 'Content-Type': 'application/json' };
  const rpc = async (fn, b) => (await fetch(URL_ + '/rest/v1/rpc/' + fn,
    { method: 'POST', headers: A, body: JSON.stringify(b || {}) })).json();

  // 1. One code for THIS session (one email).
  const firstRequest = await rpc('request_login_code');

  // 2. Immediately ask again — the 60s cooldown must refuse.
  const secondRequest = await rpc('request_login_code');

  // 3. The other session's already-redeemed code must not work here.
  const crossSession = await rpc('verify_login_code', { p_code: OLD_CODE });

  // 4. Four more wrong codes: the fifth failure overall must lock it.
  const attempts = [crossSession];
  for (const guess of ['111111', '222222', '333333', '444444']) {
    attempts.push(await rpc('verify_login_code', { p_code: guess }));
  }

  // 5. A sixth try must be refused outright, not counted.
  const afterLock = await rpc('verify_login_code', { p_code: '555555' });

  window.__r = JSON.stringify({
    new_session_id:   sid,
    differs_from_old: sid !== window.__sid,
    first_request:    firstRequest,
    second_request:   secondRequest,
    cross_session:    crossSession,
    attempts:         attempts.map(a => a.status + (a.attempts_remaining !== undefined
                                     ? ' (' + a.attempts_remaining + ' left)' : '')),
    after_lock:       afterLock,
  }, null, 2);
})()

// EXPECT
//   differs_from_old   true                      (a login makes a new session)
//   first_request      status "ok"
//   second_request     status "cooldown", retry_after ~60
//   cross_session      status "invalid"          <- code from session A rejected
//   attempts           invalid (4 left), (3), (2), (1 left)
//   after_lock         status "locked"           <- fifth failure locked it


// ===== BLOCK 6 — a new code invalidates the previous one =====
//
// Run at least 60 seconds after BLOCK 5. Uses one more email.
// Put the code BLOCK 5 emailed you into CODE_FROM_BLOCK5 first — we prove it
// stops working once a newer one is issued.

window.__r = 'running...';
(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const CODE_FROM_BLOCK5 = '';   // <-- the code BLOCK 5 emailed you

  const A = { apikey: KEY, Authorization: 'Bearer ' + window.__tok5, 'Content-Type': 'application/json' };
  const rpc = async (fn, b) => (await fetch(URL_ + '/rest/v1/rpc/' + fn,
    { method: 'POST', headers: A, body: JSON.stringify(b || {}) })).json();

  // Requesting again both clears the lock and replaces the stored hash.
  const reissued = await rpc('request_login_code');

  // The previous code must no longer work.
  const oldCode = await rpc('verify_login_code', { p_code: CODE_FROM_BLOCK5 });

  window.__r = JSON.stringify({
    reissue:          reissued,
    old_code_after_reissue: oldCode,
    session_status:   await rpc('session_status'),
  }, null, 2);
})()

// EXPECT
//   reissue                  status "ok"      (lock cleared, new code sent)
//   old_code_after_reissue   status "invalid" <- superseded, not accepted
//   session_status.verified  false
//
// The newest emailed code will still verify this session if you want to finish.
