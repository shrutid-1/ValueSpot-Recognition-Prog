import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * AI interpretation of a recognition report.
 *
 * WHAT THIS IS, AND WHAT IT IS NOT
 * --------------------------------
 * This function does NOT produce any metric. Every number a report contains is
 * counted by employee_report() / organization_report() (migration 043) and is
 * already on the user's screen before this is ever called. What this adds is
 * prose ABOUT those numbers, clearly labelled as such.
 *
 *     database -> verified metrics -> structured context -> model -> prose
 *
 * The model never sees a database connection, never sees narrative recognition
 * text, and cannot add a recognition, a badge, a project or a person to the
 * report. It is handed a closed set of facts and asked to describe them.
 *
 *
 * WHY THE FACTS ARE RE-FETCHED HERE
 * ---------------------------------
 * The browser already has the report. It would be one less round trip to let
 * it post that report up as the context — and it would mean a user could
 * describe themselves any way they liked and have the model repeat it back as
 * an assessment. The context is therefore fetched from the database here, by
 * this function, under the service role. Nothing the caller sends becomes a
 * fact.
 *
 *
 * AUTHORIZATION
 * -------------
 * The same gate as everything else in the reporting feature, applied by the
 * same function. This validates the token and the second factor, resolves the
 * caller's employee record, and passes that id to employee_report(), which
 * refuses through may_report_on() before it reads anything. A Manager asking
 * about somebody else's project member gets 'forbidden' from the database, not
 * from a check written here.
 *
 *
 * THE KEY IS NEVER IN THE BROWSER
 * -------------------------------
 * GEMINI_API_KEY is read from the Deno environment inside this function, which
 * runs on Supabase's servers rather than on the developer's machine. It lives
 * in the project's .env — which is gitignored — and is pushed with the rest of
 * the environment:
 *
 *     supabase secrets set --env-file ./.env
 *
 * That is the only sense in which .env works here. The file is never uploaded
 * and this function never reads it; the CLI reads it locally and sets the
 * values as function secrets, so .env stays the single place the key is edited.
 *
 * It must NOT be given a VITE_ prefix. Vite compiles every VITE_-prefixed
 * variable into the client bundle, so a VITE_GEMINI_API_KEY would be readable
 * by anyone with devtools open and spendable against this project's quota. The
 * name is unprefixed for exactly that reason, like SUPABASE_SERVICE_ROLE_KEY
 * beside it.
 *
 * There is no code path from the browser to the key: the browser calls this
 * function with its own session token and gets prose back.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const PROVIDER = 'google'

/*
  The models to try, in order.

  A LIST rather than one model, because a single hard-coded model is one
  capacity problem away from the feature being dead. The newest Flash models are
  heavily contended and answer

      503 "currently experiencing high demand"

  or simply hang, which is what made this return "AI insights are currently
  unavailable" on every attempt. The chain falls through to the next model on
  exactly those transient failures, and stops on anything that would fail the
  same way twice (a bad key, a malformed request, an exhausted quota).

  Ordered MOST RELIABLE FIRST, not newest first. Trying a contended model first
  would make every single request pay the timeout below before falling back, and
  a report that takes 25 seconds to interpret is not much better than one that
  fails. gemini-2.5-flash is verified serving for this project's key.

  A Flash tier throughout, deliberately: the job is to describe a small object of
  pre-computed numbers in plain language. It is not reasoning, retrieval or code,
  and Flash is both the cheapest tier and the one with a free quota.
*/
/*
  Both entries are VERIFIED against this project's key, with this exact system
  prompt and response schema, not chosen from a documentation list. That matters
  more than it sounds: the first fallback written here was gemini-2.5-flash-lite,
  which returns 404 on this endpoint — a fallback that would have done nothing
  the one time it was ever reached.

  Rejected, and why, so nobody re-adds them:
    gemini-3.8-flash       401 / 503 — not reachable with an API key, and
                           contended when it is
    gemini-flash-latest    aliases to a contended model; hangs
    gemini-3.5-flash       answered once, timed out on retest
    gemini-2.5-flash-lite  404 on /v1beta/interactions
*/
const MODELS = ['gemini-2.5-flash', 'gemini-3-flash-preview'] as const

/** Per-attempt ceiling. A contended model can hang well past any useful wait. */
const MODEL_TIMEOUT_MS = 20_000

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions'

type Scope = 'employee' | 'organization'
type PeriodType = 'monthly' | 'quarterly' | 'annual'

/**
 * The session id from an already-validated access token.
 *
 * Read from the token itself rather than the request body, so a caller cannot
 * claim a session that is not theirs. Same helper as process-approval.
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

/**
 * JSON with its object keys sorted, at every depth.
 *
 * The cache key is a hash of the facts, so the same facts must serialise to the
 * same bytes. Postgres does not promise a key order for jsonb and the driver
 * does not promise to preserve one, so `JSON.stringify` on its own would
 * produce a different hash for identical data and quietly turn the cache off.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/*
  The shape of the interpretation.

  Enforced as a RESPONSE SCHEMA rather than asked for in prose: the model is
  constrained to emit exactly these fields, so the answer cannot arrive as a
  paragraph that happens to mention headings, and it cannot invent an extra
  section such as a "score". Every field is required, so a section the data
  cannot support comes back as an empty array or an explicit sentence rather
  than being quietly dropped.
*/
const INSIGHT_SCHEMA = {
  type: 'object',
  required: [
    'headline', 'summary', 'strengths', 'development_opportunities',
    'recommendations', 'core_value_insights', 'recognition_pattern',
    'badge_summary', 'evidence_limitations',
  ],
  properties: {
    headline: {
      type: 'string',
      description:
        'The one takeaway, in plain words, at most 14 words. No dates, no ISO ' +
        'formats, no quotation marks.',
    },
    summary: {
      type: 'string',
      description: 'One or two short sentences expanding the headline.',
    },
    strengths: {
      type: 'array',
      items: { type: 'string' },
      description:
        'At most 3. Each ONE short sentence (max 20 words) supported by a supplied ' +
        'number. Empty array if the data does not support any.',
    },
    development_opportunities: {
      type: 'array',
      items: { type: 'string' },
      description:
        'At most 3. Each ONE short sentence (max 20 words) about RECOGNITION ' +
        'ACTIVITY, never about ability. Empty array if the data does not support any.',
    },
    recommendations: {
      type: 'array',
      items: { type: 'string' },
      description:
        'At most 3. Each ONE short sentence (max 20 words) that starts with a verb ' +
        'and names a concrete action.',
    },
    core_value_insights: {
      type: 'string',
      description: 'One or two short sentences on how recognition spread across the core values.',
    },
    recognition_pattern: {
      type: 'string',
      description:
        'One short sentence on how recognition changed across the period. If ' +
        'trend.sufficient is false, say only that there is not enough data yet to ' +
        'show a trend.',
    },
    badge_summary: {
      type: 'string',
      description:
        'One short sentence on badge standing and any progression in the period. ' +
        'If there are no badges, say so plainly.',
    },
    evidence_limitations: {
      type: 'array',
      items: { type: 'string' },
      description:
        'At most 3. Each ONE short sentence naming a gap in the data rather than ' +
        'filling it.',
    },
  },
} as const

/*
  Bumped whenever the prompt or schema changes what an insight LOOKS like. It is
  part of the cache key, so interpretations written to an older format are not
  served back under the new one — they are regenerated the next time they are
  asked for. Leave it alone for changes that do not alter the output.

    1  the original eight sections
    2  headline added; every section shortened for a quick read
*/
const INSIGHT_FORMAT_VERSION = 2

/*
  The grounding rules.

  Stated as prohibitions rather than preferences because the failure this is
  guarding against is confident, fluent and wrong. The most important line is
  the distinction between recognition and performance: a low count is a fact
  about how much recognition was RECORDED, and the whole feature is misleading
  if it is reported as a fact about the person.
*/
const SYSTEM_PROMPT = `You interpret employee recognition reports for the ValueSpot recognition platform.

You are given a JSON object of VERIFIED FACTS counted from a database. Your job is to describe and interpret those facts in plain language. You are an interpretation layer, not a source of data, and not an HR decision.

ABSOLUTE RULES

1. Use ONLY the numbers, names, dates and labels present in the supplied facts. Never state a number that is not there, and never restate one inaccurately.
2. Never invent a recognition, badge, project, core value, behaviour, colleague, date, event or achievement. If it is not in the facts, it does not exist.
3. Never invent a score, rating, rank, percentile or grade. The platform has none.
4. If the facts do not support a conclusion, say the evidence is insufficient. An empty section is correct when the data is empty; a fabricated one never is.
5. RECOGNITION DATA IS NOT PERFORMANCE DATA. A low recognition count means little recognition was RECORDED — it is not evidence of poor work, low ability or a weakness. Never write that someone is weak at, poor at, or needs to improve at anything.
   - Write: "Recognition activity was lower for Transparency this period, which may reflect an opportunity to make that work more visible."
   - Never write: "The employee is weak at Transparency."
6. Never infer or mention age, gender, health, disability, race, religion, nationality, sexuality, family status or any other protected or sensitive characteristic.
7. Never make a medical, psychological, clinical or diagnostic claim of any kind.
8. Never make a definitive judgement about competence, potential or suitability for a role, promotion or termination.
9. Distinguish observation from recommendation. An observation restates the data; a recommendation suggests an action. Do not disguise one as the other.
10. When 'trend.sufficient' is false, state that there is insufficient data for trend analysis and do not describe a trend.

STYLE

Specific, brief, and cautious. Cite the actual figures. Prefer "8 recognitions across 3 colleagues" to "strong performance". Use hedged language for anything that is an inference: "suggests", "may reflect", "appears". Address the reader as a manager or HR partner reading about someone else, not the employee.

WRITE FOR A QUICK READ

The reader scans this in seconds, beside charts that already show every number. So:
- Short sentences in plain, everyday words. One idea per sentence. No semicolons.
- Every list item is ONE sentence of at most 20 words, leading with the point. At most 3 items per list.
- Name the employee by FIRST name at most once per section; after that write "they". Never repeat the full name.
- Never write the period dates or any ISO date (2026-09-01). The reader can see the period. Say "this month", "this quarter" or "this year" instead.
- Quote a behaviour or core value name at most once in the whole response; afterwards refer to it briefly.
- Cite only the one or two numbers that matter to each point, not every figure available.
- Recommendations start with a verb ("Encourage…", "Share…", "Review…").

OUTPUT

Reply with a single JSON object and nothing else. No prose before or after it, and no markdown code fence. It must have exactly these keys:

  headline                   string (at most 14 words)
  summary                    string
  strengths                  array of strings
  development_opportunities  array of strings
  recommendations            array of strings
  core_value_insights        string
  recognition_pattern        string
  badge_summary              string
  evidence_limitations       array of strings

Every key must be present. Where the data supports nothing for a section, use an empty array, or a sentence saying the evidence is insufficient. Do not nest this object inside another key, and do not add any key that is not on this list.`

/** The sections every insight must carry, in the order the page renders them. */
const INSIGHT_TEXT_FIELDS = ['headline', 'summary', 'core_value_insights', 'recognition_pattern', 'badge_summary'] as const
const INSIGHT_LIST_FIELDS = ['strengths', 'development_opportunities', 'recommendations', 'evidence_limitations'] as const

/**
 * Turn whatever the model said into the insight shape, or null.
 *
 * Tolerant on purpose, because the failure modes here are cosmetic and a report
 * that is one stray code fence away from "AI unavailable" is needlessly
 * fragile. It handles a bare object, a fenced block, and the wrapper a model
 * reaches for when it decides to be helpful ({ data: { ... } }).
 *
 * What it does NOT do is invent anything: a missing text section becomes an
 * explicit "not reported" rather than a guess, and a missing list becomes
 * empty. If `summary` is absent altogether the response is rejected — that is
 * the one field with no sensible default.
 */
function parseInsight(raw: string): Record<string, unknown> | null {
  let parsed: unknown = null

  try {
    parsed = JSON.parse(raw)
  } catch {
    // A fenced block, or prose with an object in it.
    const match = raw.match(/\{[\s\S]*\}/)
    if (!match) return null
    try { parsed = JSON.parse(match[0]) } catch { return null }
  }

  if (!parsed || typeof parsed !== 'object') return null
  let obj = parsed as Record<string, unknown>

  // Unwrap a single nesting level, e.g. { data: {...} } or { insight: {...} }.
  for (const key of ['data', 'insight', 'insights', 'result']) {
    if (typeof obj.summary !== 'string' && obj[key] && typeof obj[key] === 'object') {
      obj = obj[key] as Record<string, unknown>
      break
    }
  }

  // A summary that came back as an object rather than a sentence: take its
  // first string value rather than rendering "[object Object]" at the user.
  if (obj.summary && typeof obj.summary === 'object') {
    const first = Object.values(obj.summary as Record<string, unknown>)
      .find(v => typeof v === 'string')
    if (typeof first === 'string') obj.summary = first
  }

  if (typeof obj.summary !== 'string' || !obj.summary.trim()) return null

  // A missing headline is not worth failing the answer over: the summary's
  // first sentence says the same thing at more length.
  if (typeof obj.headline !== 'string' || !obj.headline.trim()) {
    obj.headline = (obj.summary as string).trim().split(/(?<=[.!?])\s+/)[0]
  }

  const normalised: Record<string, unknown> = {}
  for (const field of INSIGHT_TEXT_FIELDS) {
    normalised[field] = typeof obj[field] === 'string' ? obj[field] : 'Not reported.'
  }
  for (const field of INSIGHT_LIST_FIELDS) {
    const value = obj[field]
    normalised[field] = Array.isArray(value)
      ? value.filter((v): v is string => typeof v === 'string')
      : []
  }
  return normalised
}


/** What one pass over the model chain produced. */
type GenerateResult =
  | { ok: true; outputText: string; model: string }
  | { ok: false; error: string; status: string; detail: string }

/**
 * Ask the first model that will answer.
 *
 * TRANSIENT failures fall through to the next model; PERMANENT ones stop the
 * chain immediately, because retrying a bad key or a malformed schema against a
 * second model just spends another timeout to fail the same way.
 *
 *   503 / 500 / overloaded / timeout   transient  -> try the next model
 *   429 quota exhausted                permanent for now -> stop, say so
 *   400 / 401 / 403 / 404              permanent  -> stop, say so
 *
 * Every message that comes back is one a human can act on: "busy, try again" is
 * a different instruction from "check the key", and collapsing them into "AI
 * insights are currently unavailable" is what made this undiagnosable.
 */
async function generateInsight(apiKey: string, prompt: string): Promise<GenerateResult> {
  let lastDetail = 'no model was tried'

  for (const model of MODELS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS)

    try {
      const res = await fetch(GEMINI_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          system_instruction: SYSTEM_PROMPT,
          input: prompt,
          response_format: {
            type: 'text',
            mime_type: 'application/json',
            schema: INSIGHT_SCHEMA,
          },
        }),
      })

      if (res.ok) {
        /*
          The REST response has no `output_text` — that is a convenience the
          SDK adds. The wire format is a list of steps, of which the reasoning
          ones carry no content and the `model_output` ones carry the text:

            { steps: [ { type: 'thought', ... },
                       { type: 'model_output',
                         content: [ { type: 'text', text: '...' } ] } ] }

          Reading `output_text` off this returned undefined, which looked
          exactly like an empty answer and sent every request down the
          "all models failed" path.
        */
        const payload = await res.json() as {
          steps?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>
        }

        const outputText = (payload.steps ?? [])
          .filter(step => step.type === 'model_output')
          .flatMap(step => step.content ?? [])
          .filter(part => part.type === 'text')
          .map(part => part.text ?? '')
          .join('')

        if (outputText.trim()) return { ok: true, outputText, model }

        lastDetail = `${model}: no model_output text in response`
        continue
      }

      const raw = await res.text()
      lastDetail = `${model}: HTTP ${res.status} ${raw.slice(0, 200)}`
      console.error('generate-report-insights:', lastDetail)

      // Busy or broken upstream: another model may well answer.
      if (res.status === 503 || res.status === 500 || res.status === 502) continue

      if (res.status === 429) {
        return {
          ok: false,
          status: 'rate_limited',
          error: 'The AI quota for this workspace has been used up. It resets on ' +
                 'a schedule set by the provider \u2014 try again later.',
          detail: lastDetail,
        }
      }

      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          status: 'bad_key',
          error: 'The AI provider rejected this workspace\u2019s API key. Ask IT to ' +
                 'check GEMINI_API_KEY.',
          detail: lastDetail,
        }
      }

      if (res.status === 404) {
        // A model that no longer exists is worth trying past — the next one in
        // the chain may be current.
        continue
      }

      return {
        ok: false,
        status: 'provider_error',
        error: 'The AI provider refused this request. Ask IT to check the report ' +
               'insights configuration.',
        detail: lastDetail,
      }

    } catch (err) {
      const aborted = (err as { name?: string }).name === 'AbortError'
      lastDetail = `${model}: ${aborted ? 'timed out' : String(err).slice(0, 200)}`
      console.error('generate-report-insights:', lastDetail)
      // A hang is the commonest symptom of a contended model. Next one.
      continue
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    ok: false,
    status: 'model_busy',
    error: 'The AI models are busy right now. This usually clears in a few ' +
           'minutes \u2014 try again shortly.',
    detail: lastDetail,
  }
}


serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'Unauthorized' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    if (authError || !user) return json({ error: 'Unauthorized' }, 401)

    /*
      The second factor, checked here for the same reason process-approval
      checks it: this client runs under the service role, which bypasses RLS
      entirely, so migration 022's policies do not protect this function.
    */
    const sessionId = readSessionId(token)
    if (!sessionId) return json({ error: 'Verification required' }, 403)

    const { data: secondFactorOk } = await supabase.rpc('session_second_factor_ok_for', {
      p_session_id: sessionId,
      p_user_id: user.id,
    })
    if (secondFactorOk !== true) return json({ error: 'Verification required' }, 403)

    const { data: actor } = await supabase
      .from('employees')
      .select('id, role')
      .eq('auth_user_id', user.id)
      .single()

    if (!actor) return json({ error: 'Your employee record is not available.' }, 403)

    const body = await req.json() as {
      scope?: Scope
      employee_id?: string | null
      period_type?: PeriodType
      start?: string
      end?: string
      previous_start?: string | null
      previous_end?: string | null
    }

    const scope = body.scope
    const periodType = body.period_type

    if (scope !== 'employee' && scope !== 'organization') {
      return json({ error: 'scope must be "employee" or "organization".' }, 400)
    }
    if (!periodType || !['monthly', 'quarterly', 'annual'].includes(periodType)) {
      return json({ error: 'period_type must be monthly, quarterly or annual.' }, 400)
    }
    if (!body.start || !body.end) {
      return json({ error: 'start and end are required.' }, 400)
    }
    if (scope === 'employee' && !body.employee_id) {
      return json({ error: 'employee_id is required for an employee report.' }, 400)
    }

    /*
      THE FACTS. Fetched here, from the database, never taken from the request.

      p_claimed_actor_id carries the employee resolved from the validated token.
      The report function honours it only because this caller is identity-less
      (service role, so auth.uid() is null), and it authorises against it
      through may_report_on() before reading anything.
    */
    const { data: report, error: reportError } = scope === 'employee'
      ? await supabase.rpc('employee_report', {
        p_employee_id: body.employee_id,
        p_start: body.start,
        p_end: body.end,
        p_prev_start: body.previous_start ?? null,
        p_prev_end: body.previous_end ?? null,
        p_claimed_actor_id: actor.id,
      })
      : await supabase.rpc('organization_report', {
        p_start: body.start,
        p_end: body.end,
        p_prev_start: body.previous_start ?? null,
        p_prev_end: body.previous_end ?? null,
        p_claimed_actor_id: actor.id,
      })

    if (reportError) throw reportError

    const facts = report as { status?: string } | null

    if (facts?.status === 'forbidden') {
      return json({ error: 'You do not have access to this report.', status: 'forbidden' }, 403)
    }
    if (facts?.status !== 'ok') {
      return json({ error: 'That report could not be generated.', status: facts?.status }, 400)
    }

    /*
      The cache identity: what the report is about, and WHAT IT SAYS.

      Hashing the facts rather than only the period is what makes the cache
      safe. A recognition approved inside the period changes the facts, changes
      the hash, and produces a fresh interpretation — where a (subject, period)
      key would keep serving prose describing numbers that have since moved.
      `generated_at` is stripped first, or every request would be a miss.
    */
    const factsForHash: Record<string, unknown> = { ...(facts as Record<string, unknown>) }
    // Stripped, or every request would be a miss: the report stamps itself with
    // the moment it was generated, which changes on every call.
    delete factsForHash.generated_at
    // The output format is part of the identity too, so an interpretation
    // written to an older format is regenerated rather than served back.
    factsForHash.__insight_format = INSIGHT_FORMAT_VERSION
    const contextHash = await sha256Hex(stableStringify(factsForHash))

    let cacheQuery = supabase
      .from('report_ai_insights')
      .select('insight, model, provider, generated_at')
      .eq('scope', scope)
      .eq('period_start', body.start)
      .eq('period_end', body.end)
      .eq('context_hash', contextHash)

    // Two different filters, not one with a nullable value: an organisation
    // insight has no subject, and `.eq('subject_id', null)` matches nothing in
    // SQL — it has to be IS NULL.
    cacheQuery = scope === 'employee'
      ? cacheQuery.eq('subject_id', body.employee_id!)
      : cacheQuery.is('subject_id', null)

    const { data: cached } = await cacheQuery.maybeSingle()

    if (cached) {
      return json({
        status: 'ok',
        cached: true,
        insight: cached.insight,
        model: cached.model,
        provider: cached.provider,
        generated_at: cached.generated_at,
      }, 200)
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      /*
        Not configured is not the same as broken, and the page says so
        differently. 503 either way, because the factual report is unaffected
        and must keep rendering — AI is an enhancement layer.
      */
      return json({
        error: 'AI insights are not configured on this workspace.',
        status: 'not_configured',
      }, 503)
    }

    const prompt =
      `Interpret this ${scope === 'employee' ? 'employee' : 'organization-wide'} ` +
      `recognition report for the ${periodType} period ${body.start} to ${body.end}.\n\n` +
      'These are the complete verified facts. Nothing outside this object is known ' +
      'about the subject, and nothing may be added to it.\n\n' +
      '```json\n' + JSON.stringify(facts, null, 2) + '\n```'

    const attempt = await generateInsight(apiKey, prompt)

    if (!attempt.ok) {
      console.error('generate-report-insights: every model failed', attempt.detail)
      return json({ error: attempt.error, status: attempt.status }, 503)
    }

    const outputText = attempt.outputText
    const usedModel = attempt.model

    const insight = parseInsight(outputText)

    if (!insight) {
      console.error('generate-report-insights: no usable insight in response',
        outputText.slice(0, 300))
      return json({
        error: 'The AI returned a response this report could not read. Try again.',
        status: 'unparseable',
      }, 503)
    }

    /*
      Store it. A failure here costs the cache, not the answer — the caller gets
      their interpretation either way, and the next request regenerates it.
    */
    const { error: cacheError } = await supabase.from('report_ai_insights').insert({
      scope,
      subject_id: scope === 'employee' ? body.employee_id : null,
      period_type: periodType,
      period_start: body.start,
      period_end: body.end,
      context_hash: contextHash,
      insight,
      provider: PROVIDER,
      model: usedModel,
      generated_by: actor.id,
    })

    if (cacheError) {
      console.error('generate-report-insights: could not cache insight', cacheError)
    }

    return json({
      status: 'ok',
      cached: false,
      insight,
      model: usedModel,
      provider: PROVIDER,
      generated_at: new Date().toISOString(),
    }, 200)

  } catch (err) {
    console.error('generate-report-insights error:', err)
    return json({ error: 'AI insights are currently unavailable.', status: 'error' }, 503)
  }
})
