-- ============================================================
-- 058 -- a correction keeps Core Value > Behaviour > Scenario consistent
--
-- Additive. One existing function, moderate_recognition(), is redefined with
-- the same signature and grants. No table, column, trigger or policy changes
-- and no row is changed. Safe to run more than once. Requires 001-057.
--
--
-- WHAT WAS BROKEN
-- ---------------
-- Resolving a correction request that moved a recognition to another Core
-- Value and Behaviour failed with "That scenario does not belong to the chosen
-- behaviour." -- as did moving it to another Core Value with "No behaviour".
-- Nothing could be corrected across Core Values at all.
--
-- moderate_recognition() (034) resolved each of the three ids on its own:
-- a field the caller did not name was KEPT. Neither correction screen has a
-- scenario field, so every Behaviour change carried the OLD scenario forward
-- onto the NEW behaviour -- a pair that cannot exist. Until 057 that orphan was
-- written silently; 057's guard_nomination_direct_update() now refuses it, and
-- the whole resolve rolled back.
--
-- THE RULE NOW
-- ------------
-- The three ids are resolved top-down, each against the one above it:
--
--   * named by the caller  -> used, and it must belong to its parent. If it
--                             does not, the call answers behaviour_mismatch or
--                             scenario_mismatch instead of writing anything.
--   * cleared by the caller -> NULL.
--   * not mentioned         -> kept only while it still belongs to its parent.
--                             A behaviour left behind by a Core Value change,
--                             or a scenario left behind by a Behaviour change,
--                             no longer describes the recognition and is
--                             dropped. The audit row records the drop.
--
-- The guard in 057 stays exactly as it is: it is the backstop, and after this
-- change the function never hands it an inconsistent row.
-- ============================================================

CREATE OR REPLACE FUNCTION public.moderate_recognition(
  p_nomination_id uuid,
  p_core_value_id uuid    DEFAULT NULL,
  p_behaviour_id  uuid    DEFAULT NULL,
  p_scenario_id   uuid    DEFAULT NULL,
  p_what_happened text    DEFAULT NULL,
  p_what_impact   text    DEFAULT NULL,
  p_project_id    uuid    DEFAULT NULL,
  p_clear_behaviour boolean DEFAULT false,
  p_clear_scenario  boolean DEFAULT false,
  p_clear_project   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor_id   uuid;
  actor_role text := public.current_employee_role();
  before_row nominations%ROWTYPE;
  after_row  nominations%ROWTYPE;
  changed    jsonb := '{}'::jsonb;
  prev       jsonb := '{}'::jsonb;

  new_core_value uuid;
  new_behaviour  uuid;
  new_scenario   uuid;
  new_project    uuid;
BEGIN
  IF NOT public.can_moderate_recognitions() THEN
    RETURN jsonb_build_object('status', 'forbidden');
  END IF;

  SELECT id INTO actor_id FROM employees WHERE auth_user_id = auth.uid() LIMIT 1;

  SELECT * INTO before_row FROM nominations WHERE id = p_nomination_id;
  IF before_row.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  IF before_row.status = 'removed' THEN
    RETURN jsonb_build_object('status', 'removed');
  END IF;

  -- ── Core Value: mandatory on the table. ──
  new_core_value := COALESCE(p_core_value_id, before_row.core_value_id);

  IF NOT EXISTS (SELECT 1 FROM core_values WHERE id = new_core_value) THEN
    RETURN jsonb_build_object('status', 'unknown_core_value');
  END IF;

  -- ── Behaviour: named, cleared, or kept while it still fits. ──
  IF p_clear_behaviour THEN
    new_behaviour := NULL;
  ELSIF p_behaviour_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM behaviours WHERE id = p_behaviour_id) THEN
      RETURN jsonb_build_object('status', 'unknown_behaviour');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM behaviours
                    WHERE id = p_behaviour_id AND core_value_id = new_core_value) THEN
      RETURN jsonb_build_object('status', 'behaviour_mismatch');
    END IF;
    new_behaviour := p_behaviour_id;
  ELSE
    SELECT id INTO new_behaviour
      FROM behaviours
     WHERE id = before_row.behaviour_id AND core_value_id = new_core_value;
  END IF;

  -- ── Scenario: the same, against the behaviour just settled. ──
  IF p_clear_scenario THEN
    new_scenario := NULL;
  ELSIF p_scenario_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM scenarios WHERE id = p_scenario_id) THEN
      RETURN jsonb_build_object('status', 'unknown_scenario');
    END IF;
    IF new_behaviour IS NULL OR NOT EXISTS (
         SELECT 1 FROM scenarios
          WHERE id = p_scenario_id AND behaviour_id = new_behaviour) THEN
      RETURN jsonb_build_object('status', 'scenario_mismatch');
    END IF;
    new_scenario := p_scenario_id;
  ELSE
    SELECT id INTO new_scenario
      FROM scenarios
     WHERE id = before_row.scenario_id AND behaviour_id = new_behaviour;
  END IF;

  -- ── Project: independent of the value chain. ──
  new_project := CASE WHEN p_clear_project THEN NULL
                      ELSE COALESCE(p_project_id, before_row.project_id) END;

  IF new_project IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM projects WHERE id = new_project) THEN
    RETURN jsonb_build_object('status', 'unknown_project');
  END IF;

  /*
    The write. Unchanged from 034: no status, no approver, no participant, no
    timestamp of record, and every snapshot moves with its id.
  */
  UPDATE nominations
     SET core_value_id            = new_core_value,
         behaviour_id             = new_behaviour,
         scenario_id              = new_scenario,
         project_id               = new_project,
         what_happened            = COALESCE(NULLIF(btrim(p_what_happened), ''), what_happened),
         what_impact              = COALESCE(NULLIF(btrim(p_what_impact),   ''), what_impact),
         snapshot_core_value_name = (SELECT name FROM core_values WHERE id = new_core_value),
         snapshot_behaviour_name  = (SELECT name FROM behaviours  WHERE id = new_behaviour),
         snapshot_scenario_name   = (SELECT name FROM scenarios   WHERE id = new_scenario),
         snapshot_project_name    = (SELECT name FROM projects    WHERE id = new_project)
   WHERE id = p_nomination_id
  RETURNING * INTO after_row;

  IF after_row.core_value_id IS DISTINCT FROM before_row.core_value_id THEN
    prev    := prev    || jsonb_build_object('core_value', before_row.snapshot_core_value_name);
    changed := changed || jsonb_build_object('core_value', after_row.snapshot_core_value_name);
  END IF;
  IF after_row.behaviour_id IS DISTINCT FROM before_row.behaviour_id THEN
    prev    := prev    || jsonb_build_object('behaviour', before_row.snapshot_behaviour_name);
    changed := changed || jsonb_build_object('behaviour', after_row.snapshot_behaviour_name);
  END IF;
  IF after_row.scenario_id IS DISTINCT FROM before_row.scenario_id THEN
    prev    := prev    || jsonb_build_object('scenario', before_row.snapshot_scenario_name);
    changed := changed || jsonb_build_object('scenario', after_row.snapshot_scenario_name);
  END IF;
  IF after_row.project_id IS DISTINCT FROM before_row.project_id THEN
    prev    := prev    || jsonb_build_object('project', before_row.snapshot_project_name);
    changed := changed || jsonb_build_object('project', after_row.snapshot_project_name);
  END IF;
  IF after_row.what_happened IS DISTINCT FROM before_row.what_happened THEN
    prev    := prev    || jsonb_build_object('what_happened', before_row.what_happened);
    changed := changed || jsonb_build_object('what_happened', after_row.what_happened);
  END IF;
  IF after_row.what_impact IS DISTINCT FROM before_row.what_impact THEN
    prev    := prev    || jsonb_build_object('what_impact', before_row.what_impact);
    changed := changed || jsonb_build_object('what_impact', after_row.what_impact);
  END IF;

  IF changed = '{}'::jsonb THEN
    RETURN jsonb_build_object('status', 'ok', 'changed', changed, 'no_op', true);
  END IF;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, previous_value, new_value
  )
  VALUES (
    actor_id,
    lower(btrim(auth.jwt()->>'email')),
    'recognition.moderated',
    'nomination',
    p_nomination_id,
    prev,
    changed || jsonb_build_object('_actor_role', actor_role)
  );

  RETURN jsonb_build_object('status', 'ok', 'changed', changed, 'previous', prev);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.moderate_recognition(uuid, uuid, uuid, uuid, text, text, uuid, boolean, boolean, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.moderate_recognition(uuid, uuid, uuid, uuid, text, text, uuid, boolean, boolean, boolean) TO authenticated;
