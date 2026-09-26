-- ============================================================
-- 044 — BADGES FOLLOW THE RECOGNITIONS THAT JUSTIFY THEM
--
-- THE DEFECT
-- ----------
-- A Super Admin removed a recognition. It left the feed, because
-- v_recognition_feed is filtered to status = 'approved'. But the employee's
-- dashboard and Core Value journey read employee_value_badges, which is a
-- STORED AGGREGATE, and nothing recomputed it. The nominee went on showing
-- "1 recognition · Cheers" for a Core Value whose only recognition had been
-- deleted.
--
-- remove_recognition() (034) sets status = 'removed' and writes an audit row.
-- It never touched employee_value_badges. moderate_recognition() can move a
-- recognition to a different Core Value and likewise left both the old and
-- the new value's aggregates untouched.
--
-- The intended repair path was the calculate-badges Edge Function, which the
-- browser calls after a moderation. Two things stopped it working:
--
--   1. It builds its work list by scanning nominations WHERE status =
--      'approved', then iterates that list. A pair whose last approved
--      recognition has just been removed produces NO entry, so its stored row
--      is never visited — precisely the row that needs correcting.
--   2. It applied "never downgrade", which would preserve a badge standing on
--      evidence an administrator had just deleted.
--
-- Both are fixed in the function as well, but a correction that depends on the
-- browser reaching an Edge Function is not a guarantee. This migration moves
-- the rule into the database, where the write that causes the drift and the
-- write that repairs it happen in the same transaction.
--
-- WHAT THIS DOES NOT CHANGE
-- -------------------------
-- No schema. No table, column, policy, role or grant is altered. No RLS is
-- relaxed: the recalculation function is SECURITY DEFINER and is executable by
-- NOBODY — it runs only from the trigger, which runs as the table owner.
-- Approval, routing and the 2FA gates are untouched.
-- ============================================================


-- ------------------------------------------------------------
-- The annual period, resolved the way the rest of the system resolves it.
--
-- app_config.badge_period_start_month decides when the year turns; it is
-- JSONB, and has been seeded both as a bare number and as a quoted string, so
-- the text form is taken and cast rather than trusting the JSON type.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.badge_period_bounds(
  OUT period_start date,
  OUT period_end   date
)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
DECLARE
  start_month int;
  this_year   int := EXTRACT(YEAR FROM current_date)::int;
BEGIN
  SELECT NULLIF(btrim(value #>> '{}', '"'), '')::int
    INTO start_month
    FROM app_config
   WHERE key = 'badge_period_start_month';

  IF start_month IS NULL OR start_month < 1 OR start_month > 12 THEN
    start_month := 1;
  END IF;

  -- A period beginning in month M runs M .. M+11. Before M we are still
  -- inside the period that opened last year.
  IF EXTRACT(MONTH FROM current_date)::int < start_month THEN
    this_year := this_year - 1;
  END IF;

  period_start := make_date(this_year, start_month, 1);
  period_end   := (period_start + interval '1 year' - interval '1 day')::date;
END;
$fn$;


-- ------------------------------------------------------------
-- Recompute one employee × core value for the current annual period.
--
-- Counts only APPROVED nominations, so a removal, a rejection or a move to
-- another Core Value all drop out of the figure by construction rather than
-- by anyone remembering to subtract.
--
-- THE RECOUNT IS AUTHORITATIVE — IT MAY LOWER A BADGE.
-- REQ-005-06 ("badges never downgrade within a period") belongs to the
-- incremental approval path, where it stops ordinary churn from taking
-- somebody's badge away. It must not apply here. This runs when an
-- administrator has removed or re-filed the recognition the badge rested on,
-- and carrying the old level forward at that moment would make moderation
-- cosmetic.
--
-- badge_history is deliberately left alone. It records levels REACHED, the
-- revocation is already in audit_logs via the moderation function, and
-- rewriting history from a trigger is not something to do quietly.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_value_badge(
  p_employee_id   uuid,
  p_core_value_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_start date;
  v_end   date;
  v_count integer;
  v_uniq  integer;
  v_level integer;
BEGIN
  IF p_employee_id IS NULL OR p_core_value_id IS NULL THEN
    RETURN;
  END IF;

  SELECT period_start, period_end INTO v_start, v_end FROM public.badge_period_bounds();

  SELECT count(*)::int, count(DISTINCT nominator_id)::int
    INTO v_count, v_uniq
    FROM nominations
   WHERE nominee_id    = p_employee_id
     AND core_value_id = p_core_value_id
     AND status        = 'approved'
     AND approved_at  >= v_start::timestamptz
     AND approved_at   < (v_end + 1)::timestamptz;

  -- Highest active badge whose range contains the count. At zero nothing
  -- matches, because every threshold has minimum_count >= 1, so the level
  -- correctly becomes NULL.
  SELECT level
    INTO v_level
    FROM badge_definitions
   WHERE is_active
     AND v_count >= minimum_count
     AND (maximum_count IS NULL OR v_count <= maximum_count)
   ORDER BY minimum_count DESC
   LIMIT 1;

  IF v_count = 0 THEN
    /*
      Zeroed, not deleted. The employee still belongs to the period, the
      screens render a zero correctly, and nothing has to be recreated if
      they are recognised for this value again. No row is inserted when none
      exists — a value nobody has ever been recognised for needs no record.
    */
    UPDATE employee_value_badges
       SET recognition_count       = 0,
           unique_recognizer_count = 0,
           badge_level             = NULL,
           last_updated            = now()
     WHERE employee_id   = p_employee_id
       AND core_value_id = p_core_value_id
       AND period_type   = 'annual'
       AND period_start  = v_start
       AND (recognition_count <> 0 OR badge_level IS NOT NULL);
    RETURN;
  END IF;

  INSERT INTO employee_value_badges (
    employee_id, core_value_id, period_type, period_start, period_end,
    recognition_count, unique_recognizer_count, badge_level, last_updated
  )
  VALUES (
    p_employee_id, p_core_value_id, 'annual', v_start, v_end,
    v_count, v_uniq, v_level, now()
  )
  ON CONFLICT (employee_id, core_value_id, period_type, period_start)
  DO UPDATE SET
    recognition_count       = EXCLUDED.recognition_count,
    unique_recognizer_count = EXCLUDED.unique_recognizer_count,
    badge_level             = EXCLUDED.badge_level,
    period_end              = EXCLUDED.period_end,
    last_updated            = now();
END;
$fn$;

-- Internal only. The trigger executes it as the function owner, so no role
-- needs EXECUTE — and nothing outside the database can invoke it.
REVOKE ALL ON FUNCTION public.recalculate_value_badge(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.badge_period_bounds() FROM PUBLIC, anon, authenticated;


-- ------------------------------------------------------------
-- The trigger.
--
-- Attached to the TABLE rather than called from each moderation function, so
-- every present and future path that changes what counts — remove, edit,
-- support-request resolution, an approval, a direct correction — keeps the
-- aggregate honest without anyone having to remember.
--
-- It fires only when something that affects the count actually moved. An
-- edit to the story text or the impact changes nothing here and does no work.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nominations_sync_value_badges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'approved' THEN
      PERFORM public.recalculate_value_badge(OLD.nominee_id, OLD.core_value_id);
    END IF;
    RETURN OLD;
  END IF;

  -- INSERT of an already-approved row (seeding, backfills).
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'approved' THEN
      PERFORM public.recalculate_value_badge(NEW.nominee_id, NEW.core_value_id);
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE: only the four columns that can change the figure.
  IF OLD.status        IS DISTINCT FROM NEW.status
  OR OLD.core_value_id IS DISTINCT FROM NEW.core_value_id
  OR OLD.nominee_id    IS DISTINCT FROM NEW.nominee_id
  OR OLD.approved_at   IS DISTINCT FROM NEW.approved_at THEN

    -- Where it came from...
    PERFORM public.recalculate_value_badge(OLD.nominee_id, OLD.core_value_id);

    -- ...and where it went, when a correction moved it.
    IF OLD.nominee_id    IS DISTINCT FROM NEW.nominee_id
    OR OLD.core_value_id IS DISTINCT FROM NEW.core_value_id THEN
      PERFORM public.recalculate_value_badge(NEW.nominee_id, NEW.core_value_id);
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_nominations_sync_value_badges ON nominations;

CREATE TRIGGER trg_nominations_sync_value_badges
AFTER INSERT OR UPDATE OR DELETE ON nominations
FOR EACH ROW
EXECUTE FUNCTION public.nominations_sync_value_badges();


-- ------------------------------------------------------------
-- One-time repair of the drift already in the table.
--
-- Every pair that HAS a stored row for the current period, plus every pair
-- with an approved recognition in it. The first set catches the aggregates
-- left behind by removals — the reported defect — and the second catches
-- anything a failed Edge Function call never wrote.
-- ------------------------------------------------------------
DO $backfill$
DECLARE
  v_start date;
  v_end   date;
  pair    record;
  fixed   int := 0;
BEGIN
  SELECT period_start, period_end INTO v_start, v_end FROM public.badge_period_bounds();

  FOR pair IN
    SELECT employee_id, core_value_id
      FROM employee_value_badges
     WHERE period_type  = 'annual'
       AND period_start = v_start
    UNION
    SELECT nominee_id AS employee_id, core_value_id
      FROM nominations
     WHERE status       = 'approved'
       AND approved_at >= v_start::timestamptz
       AND approved_at  < (v_end + 1)::timestamptz
  LOOP
    PERFORM public.recalculate_value_badge(pair.employee_id, pair.core_value_id);
    fixed := fixed + 1;
  END LOOP;

  RAISE NOTICE '[044] reconciled % employee-value pair(s) for % .. %', fixed, v_start, v_end;
END;
$backfill$;
