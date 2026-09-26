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
    // Validate auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // Use service role for rate limit queries
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    // Validate caller JWT
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

    /*
      Whose limits: the CALLER's, resolved from the validated token. The body's
      nominator_id used to be counted as given, which let any signed-in user
      read how many recognitions somebody else had submitted today and this
      month -- the service role reads past RLS. It is still accepted, so an
      older bundle keeps working, but it is only honoured when it is the caller.
    */
    const { nominator_id: requested } = await req.json().catch(() => ({})) as { nominator_id?: string }

    const { data: callerEmp } = await supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    if (!callerEmp) {
      return new Response(JSON.stringify({ error: 'Your employee record is not available.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    if (requested && requested !== callerEmp.id) {
      return new Response(JSON.stringify({ error: 'You can only check your own limits.' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }
    const nominator_id = callerEmp.id

    // Fetch limits from config
    const { data: configs } = await supabase
      .from('app_config')
      .select('key, value')
      .in('key', ['rate_limit_daily', 'rate_limit_monthly'])

    const configMap = Object.fromEntries(
      (configs ?? []).map(c => [c.key, Number(c.value)])
    )
    const dailyLimit = configMap['rate_limit_daily'] ?? 5
    const monthlyLimit = configMap['rate_limit_monthly'] ?? 20

    // Count today's submissions
    const today = new Date()
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).toISOString()
    const todayEnd   = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString()

    const { count: todayCount } = await supabase
      .from('nominations')
      .select('id', { count: 'exact', head: true })
      .eq('nominator_id', nominator_id)
      .gte('created_at', todayStart)
      .lt('created_at', todayEnd)

    if ((todayCount ?? 0) >= dailyLimit) {
      return new Response(JSON.stringify({
        allowed: false,
        reason: 'daily_limit_reached',
        limit: dailyLimit,
        message: `You've reached your daily recognition limit of ${dailyLimit}. Please come back tomorrow.`,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Count this month's submissions
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString()
    const monthEnd   = new Date(today.getFullYear(), today.getMonth() + 1, 1).toISOString()

    const { count: monthCount } = await supabase
      .from('nominations')
      .select('id', { count: 'exact', head: true })
      .eq('nominator_id', nominator_id)
      .gte('created_at', monthStart)
      .lt('created_at', monthEnd)

    if ((monthCount ?? 0) >= monthlyLimit) {
      return new Response(JSON.stringify({
        allowed: false,
        reason: 'monthly_limit_reached',
        limit: monthlyLimit,
        message: `You've reached your monthly recognition limit of ${monthlyLimit}. Your limit resets next month.`,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    return new Response(JSON.stringify({ allowed: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('check-rate-limits error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
