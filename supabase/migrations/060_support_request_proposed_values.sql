-- ============================================================
-- 060 -- a correction request says exactly what it should become
--
-- Additive. Three nullable columns are added to recognition_support_requests,
-- requested_change becomes optional, and create_support_request() is
-- recreated with three new optional parameters. No row is changed, no policy
-- is touched, and the table stays RPC-only. Safe to run more than once.
-- Requires 001-059.
--
--
-- WHAT WAS WRONG
-- --------------
-- An employee picked "What is wrong?" (Wrong Core Value, Wrong Behaviour ...)
-- and typed the fix in a text box. Behaviours belong to a Core Value and
-- scenarios to a Behaviour, so moving a recognition to another Core Value
-- ALSO means choosing a new Behaviour and Scenario -- which the employee was
-- never asked for. The reviewer read "change it to Collaborative" and had to
-- guess the rest.
--
-- WHAT A REQUEST CARRIES NOW
-- --------------------------
-- proposed_core_value_id / proposed_behaviour_id / proposed_scenario_id: the
-- full Core Value > Behaviour > Scenario the employee wants the recognition to
-- have. They are one proposal, read together:
--
--   proposed_core_value_id IS NULL      no change to the value chain was asked
--                                       for (e.g. only the story is wrong)
--   proposed_core_value_id IS NOT NULL  this is the whole target; a NULL
--                                       scenario means "none of the listed
--                                       scenarios" (the wizard's "A different
--                                       situation")
--
-- The proposal is checked here, not trusted from the browser: every id must
-- be active and belong to the one above it, and a Behaviour is required. A
-- proposal identical to what the recognition already says is dropped rather
-- than stored as a change that is not one.
--
-- requested_change becomes optional: with a proposal it is "anything else HR
-- should know". Without one it is still required -- it is then the only
-- description of the fix.
--
-- issue_type is kept (old rows use it, and the column is NOT NULL) but is now
-- DERIVED from what the proposal changes, so it cannot disagree with it.
-- A caller that still sends p_issue_type (the previous app build, during a
-- deploy) keeps working.
--
-- Nothing about resolving changes: resolve_support_request() still applies
-- whatever the reviewer finally chooses. The proposal is what the review
-- dialog starts from.
-- ============================================================


-- ── 1. The proposal columns ─────────────────────────────────
--
-- SET NULL, not RESTRICT: a request must never stop HR retiring a catalogue
-- entry. Catalogue rows are archived rather than deleted in practice.

ALTER TABLE public.recognition_support_requests
  ADD COLUMN IF NOT EXISTS proposed_core_value_id uuid,
  ADD COLUMN IF NOT EXISTS proposed_behaviour_id  uuid,
  ADD COLUMN IF NOT EXISTS proposed_scenario_id   uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'recognition_support_requests_proposed_core_value_id_fkey') THEN
    ALTER TABLE public.recognition_support_requests
      ADD CONSTRAINT recognition_support_requests_proposed_core_value_id_fkey
      FOREIGN KEY (proposed_core_value_id) REFERENCES public.core_values(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'recognition_support_requests_proposed_behaviour_id_fkey') THEN
    ALTER TABLE public.recognition_support_requests
      ADD CONSTRAINT recognition_support_requests_proposed_behaviour_id_fkey
      FOREIGN KEY (proposed_behaviour_id) REFERENCES public.behaviours(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'recognition_support_requests_proposed_scenario_id_fkey') THEN
    ALTER TABLE public.recognition_support_requests
      ADD CONSTRAINT recognition_support_requests_proposed_scenario_id_fkey
      FOREIGN KEY (proposed_scenario_id) REFERENCES public.scenarios(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.recognition_support_requests
  ALTER COLUMN requested_change DROP NOT NULL;


-- ── 2. Raising a request ────────────────────────────────────
--
-- Recreated rather than replaced: the parameter list grows, and leaving the
-- four-argument version beside it would make a call by name ambiguous.

DROP FUNCTION IF EXISTS public.create_support_request(uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.create_support_request(
  p_nomination_id           uuid,
  p_description             text,
  p_requested_change        text DEFAULT NULL,
  p_proposed_core_value_id  uuid DEFAULT NULL,
  p_proposed_behaviour_id   uuid DEFAULT NULL,
  p_proposed_scenario_id    uuid DEFAULT NULL,
  -- Only for the previous app build. Ignored whenever a proposal is made.
  p_issue_type              text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  requester  employees%ROWTYPE;
  target     nominations%ROWTYPE;
  new_id     uuid;
  open_count integer;

  cv_id      uuid := p_proposed_core_value_id;
  b_id       uuid := p_proposed_behaviour_id;
  s_id       uuid := p_proposed_scenario_id;
  has_proposal boolean;
  issue      text;
  change_txt text := NULLIF(btrim(p_requested_change), '');
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RETURN jsonb_build_object('status', 'needs_verification');
  END IF;

  SELECT * INTO requester FROM employees WHERE auth_user_id = auth.uid() AND is_active LIMIT 1;
  IF requester.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF NULLIF(btrim(p_description), '') IS NULL THEN
    RETURN jsonb_build_object('status', 'incomplete');
  END IF;

  SELECT * INTO target FROM nominations WHERE id = p_nomination_id;
  IF target.id IS NULL THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  -- The participation rule.
  IF requester.id <> target.nominator_id AND requester.id <> target.nominee_id THEN
    RETURN jsonb_build_object('status', 'not_your_recognition');
  END IF;

  IF target.status = 'removed' THEN
    RETURN jsonb_build_object('status', 'recognition_removed');
  END IF;

  -- ── The proposal, checked top-down. ──
  -- A behaviour or scenario without a value is read against the value the
  -- recognition already has.
  IF cv_id IS NULL AND (b_id IS NOT NULL OR s_id IS NOT NULL) THEN
    cv_id := target.core_value_id;
  END IF;

  has_proposal := cv_id IS NOT NULL;

  IF has_proposal THEN
    IF NOT EXISTS (SELECT 1 FROM core_values WHERE id = cv_id AND is_active) THEN
      RETURN jsonb_build_object('status', 'unknown_core_value');
    END IF;

    IF b_id IS NULL THEN
      RETURN jsonb_build_object('status', 'behaviour_required');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM behaviours WHERE id = b_id AND is_active) THEN
      RETURN jsonb_build_object('status', 'unknown_behaviour');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM behaviours WHERE id = b_id AND core_value_id = cv_id) THEN
      RETURN jsonb_build_object('status', 'behaviour_mismatch');
    END IF;

    IF s_id IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM scenarios WHERE id = s_id AND is_active) THEN
        RETURN jsonb_build_object('status', 'unknown_scenario');
      END IF;
      IF NOT EXISTS (SELECT 1 FROM scenarios WHERE id = s_id AND behaviour_id = b_id) THEN
        RETURN jsonb_build_object('status', 'scenario_mismatch');
      END IF;
    END IF;

    -- Asking for what it already says is not a proposal.
    IF  cv_id = target.core_value_id
    AND b_id IS NOT DISTINCT FROM target.behaviour_id
    AND s_id IS NOT DISTINCT FROM target.scenario_id THEN
      has_proposal := false;
      cv_id := NULL; b_id := NULL; s_id := NULL;
    END IF;
  END IF;

  -- With no proposal, the text is the only description of the fix.
  IF NOT has_proposal AND change_txt IS NULL THEN
    RETURN jsonb_build_object('status', 'incomplete');
  END IF;

  -- The label follows the proposal, so it cannot contradict it.
  issue := CASE
    WHEN has_proposal AND cv_id <> target.core_value_id                      THEN 'core_value'
    WHEN has_proposal AND b_id IS DISTINCT FROM target.behaviour_id          THEN 'behaviour'
    WHEN has_proposal                                                        THEN 'scenario'
    WHEN p_issue_type IN ('core_value','behaviour','scenario','story',
                          'impact','project','other')                        THEN p_issue_type
    ELSE 'other'
  END;

  -- One open request per person per recognition.
  SELECT count(*) INTO open_count
    FROM recognition_support_requests
   WHERE nomination_id = p_nomination_id
     AND requester_id  = requester.id
     AND status IN ('open', 'in_progress');

  IF open_count > 0 THEN
    RETURN jsonb_build_object('status', 'already_open');
  END IF;

  INSERT INTO recognition_support_requests (
    nomination_id, requester_id, issue_type, description, requested_change,
    proposed_core_value_id, proposed_behaviour_id, proposed_scenario_id
  )
  VALUES (
    p_nomination_id, requester.id, issue,
    btrim(p_description), change_txt,
    cv_id, b_id, s_id
  )
  RETURNING id INTO new_id;

  -- Every HR admin and Super Admin, one row each; never the requester.
  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  SELECT
    e.id,
    'support_request_created',
    'Recognition correction requested',
    requester.full_name || ' asked for a correction to a recognition ('
      || replace(issue, '_', ' ') || ').',
    new_id,
    'support_request'
  FROM employees e
  WHERE e.role IN ('hr_admin', 'super_admin')
    AND e.is_active
    AND e.auth_user_id IS NOT NULL
    AND e.id <> requester.id;

  INSERT INTO audit_logs (
    actor_id, actor_email, action, entity_type, entity_id, new_value
  )
  VALUES (
    requester.id,
    lower(btrim(auth.jwt()->>'email')),
    'support_request.created',
    'support_request',
    new_id,
    jsonb_build_object(
      'nomination_id',          p_nomination_id,
      'issue_type',             issue,
      'proposed_core_value_id', cv_id,
      'proposed_behaviour_id',  b_id,
      'proposed_scenario_id',   s_id
    )
  );

  RETURN jsonb_build_object('status', 'ok', 'request_id', new_id);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.create_support_request(uuid, text, text, uuid, uuid, uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_support_request(uuid, text, text, uuid, uuid, uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
