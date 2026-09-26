import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * The session id from an already-validated access token.
 *
 * Read from the token itself rather than the request body, so a caller cannot
 * claim a session that is not theirs. Signature verification is done by
 * getUser() before this value is used.
 */
function readSessionId(token: string): string | null {
  try {
    const part = token.split('.')[1]
    if (!part) return null
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const claims = JSON.parse(atob(padded)) as { session_id?: unknown }
    return typeof claims.session_id === 'string' ? claims.session_id : null
  } catch {
    return null
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Require the second factor. This client runs under the service role, which
    // bypasses RLS, so migration 022's policies do not cover this function — it
    // checks for itself. The session id comes from the JWT getUser() has just
    // validated, never from the request body.
    const sessionId = readSessionId(authHeader.replace('Bearer ', ''))
    const { data: secondFactorOk } = sessionId
      ? await supabase.rpc('session_second_factor_ok_for', {
          p_session_id: sessionId,
          p_user_id: user.id,
        })
      : { data: false }

    if (secondFactorOk !== true) {
      return new Response(JSON.stringify({ error: 'Verification required' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const { nominator_id: requested, nominee_id, core_value_id } = await req.json() as {
      nominator_id?: string
      nominee_id: string
      core_value_id: string
    }

    /*
      The nominator is the CALLER, resolved from the validated token -- the
      service role reads past RLS, so a nominator_id taken from the body would
      let anyone ask about somebody else's recognitions. The field is still
      accepted from older bundles, and only honoured when it is the caller.
    */
    const { data: callerEmp } = await supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!callerEmp || (requested && requested !== callerEmp.id)) {
      return new Response(JSON.stringify({ error: 'You can only check your own recognitions.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const nominator_id = callerEmp.id

    // Fetch anti-gaming window from config
    const { data: config } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', 'anti_gaming_window_days')
      .single()

    const windowDays = Number(config?.value ?? 30)
    const since = new Date()
    since.setDate(since.getDate() - windowDays)

    // Check for any prior approved recognition from this nominator → nominee × same core value in window
    const { count } = await supabase
      .from('nominations')
      .select('id', { count: 'exact', head: true })
      .eq('nominator_id', nominator_id)
      .eq('nominee_id', nominee_id)
      .eq('core_value_id', core_value_id)
      .eq('status', 'approved')
      .gte('approved_at', since.toISOString())

    const isDuplicate = (count ?? 0) > 0

    return new Response(JSON.stringify({
      is_duplicate: isDuplicate,
      window_days: windowDays,
      message: isDuplicate
        ? `You recently recognized this colleague for the same Core Value. You may continue with a different example, but please note this may not be approved.`
        : null,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('check-duplicate error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
