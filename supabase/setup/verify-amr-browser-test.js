// OBSOLETE — the AMR-based second-factor design this probes was abandoned.
// Kept only as the record of why: amr cannot bind a password login to an OTP.
// The live design is migration 021 + verify-live-browser-tests.js.

// ===== BLOCK A — password only. No email involved, cannot be rate limited. =====
// Put your password on the PASS line, paste the whole block, then copy the printed text.

(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const MAIL = 'pdkaslikar29@gmail.com';
  const PASS = window.__pass || prompt('Password (typed once, never written to this file)');

  const debug = async (t) => (await fetch(URL_ + '/rest/v1/rpc/debug_session_auth', {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: '{}',
  })).json();

  const a = await (await fetch(URL_ + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MAIL, password: PASS }),
  })).json();

  if (!a.access_token) { console.log('BLOCK A FAILED: ' + JSON.stringify(a)); return; }
  console.log('=== BLOCK A RESULT ===');
  console.log(JSON.stringify(await debug(a.access_token), null, 2));
})()


// ===== BLOCK B — send the email. Only run when the 429 has cleared. =====

(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const MAIL = 'pdkaslikar29@gmail.com';

  const r = await fetch(URL_ + '/auth/v1/otp', {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: MAIL, create_user: false }),
  });
  console.log(r.status === 429
    ? 'Still rate limited. Wait and try again later.'
    : 'Sent (HTTP ' + r.status + '). Open the email, click the link, then run BLOCK C here.');
})()


// ===== BLOCK C — after clicking the emailed link, in the app tab. =====

(async () => {
  const URL_ = 'https://kuyubrjsfujgfcznjvit.supabase.co';
  const KEY  = 'sb_publishable_lBCEqLlxdjb09sAUltNXTg_xamcz003';
  const REF  = 'kuyubrjsfujgfcznjvit';

  const debug = async (t) => (await fetch(URL_ + '/rest/v1/rpc/debug_session_auth', {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' },
    body: '{}',
  })).json();

  const stored = JSON.parse(localStorage.getItem('sb-' + REF + '-auth-token') || 'null');
  const token = stored?.access_token || stored?.currentSession?.access_token;
  if (!token) { console.log('BLOCK C: no session in this tab — did the link open this app?'); return; }
  console.log('=== BLOCK C RESULT ===');
  console.log(JSON.stringify(await debug(token), null, 2));
})()
