-- ============================================================
-- 059 -- every behaviour gets scenarios
--
-- Additive. Rows are inserted into scenarios; no table, column, function,
-- trigger or policy changes and no existing row is changed. Safe to run more
-- than once. Requires 001-058.
--
--
-- WHAT WAS MISSING
-- ----------------
-- The reference catalogue has 25 behaviours (five per Core Value) but its
-- scenarios only ever covered 12 of them. For the other 13 -- "Gives credit
-- to others" among them -- Step 4 of Give Recognition offered nothing but
-- "A different situation", and the correction dialog offered only
-- "No scenario".
--
-- This adds three scenarios to each of those 13, in the same voice as the
-- existing ones.
--
-- HOW IT STAYS SAFE ON A CATALOGUE HR HAS EDITED
-- ----------------------------------------------
--   * Behaviours are matched by Core Value slug and behaviour name. One that
--     HR has renamed or removed simply matches nothing and is left alone.
--   * A scenario is added only if that behaviour has no scenario of the same
--     name already -- active or archived, so one HR archived is not revived.
--     scenarios has no unique key, so this test is what makes a re-run a
--     no-op.
--   * New scenarios are ordered after any the behaviour already has.
--
-- Afterwards, any active behaviour that still has no active scenario (for
-- example one HR added under a new name) is listed as a NOTICE. HR can add
-- scenarios for it under Admin -> Scenarios.
-- ============================================================

WITH wanted (value_slug, behaviour, ord, name, description) AS (
  VALUES
  -- Adaptable
  ('adaptable', 'Remains effective during uncertainty', 1,
   'Kept delivering while requirements were still unclear',
   'Made steady progress and sound decisions before the full picture was known'),
  ('adaptable', 'Remains effective during uncertainty', 2,
   'Stayed productive through a reorganisation or team change',
   'Maintained quality and pace while roles, teams or reporting lines were shifting'),
  ('adaptable', 'Remains effective during uncertainty', 3,
   'Held steady through an unexpected disruption',
   'Stayed calm and effective through an outage, the loss of a key person or another sudden setback'),

  ('adaptable', 'Helps others adapt to change', 1,
   'Guided colleagues through a new tool or process',
   'Helped teammates get comfortable with a change they were finding difficult'),
  ('adaptable', 'Helps others adapt to change', 2,
   'Created materials that eased a transition',
   'Wrote guides, FAQs or walkthroughs that made a change easier for everyone'),
  ('adaptable', 'Helps others adapt to change', 3,
   'Helped a colleague settle into a new role or team',
   'Supported someone through a move so they became effective quickly'),

  ('adaptable', 'Adjusts priorities when business needs change', 1,
   'Reprioritised work to meet an urgent business need',
   'Set aside planned work to focus on what the business needed most'),
  ('adaptable', 'Adjusts priorities when business needs change', 2,
   'Re-planned quickly after a change in direction',
   'Reworked plans clearly and without delay when strategy or priorities moved'),
  ('adaptable', 'Adjusts priorities when business needs change', 3,
   'Paused lower-value work to free up capacity',
   'Recognised what could wait and redirected effort to where it mattered most'),

  -- Transparent
  ('transparent', 'Owns mistakes', 1,
   'Admitted a mistake before anyone else found it',
   'Raised their own error early instead of waiting for it to be discovered'),
  ('transparent', 'Owns mistakes', 2,
   'Shared lessons learned from something that went wrong',
   'Turned a mistake into a learning the whole team could use'),
  ('transparent', 'Owns mistakes', 3,
   'Corrected information they had given earlier',
   'Went back to stakeholders to set the record straight once they realised it was wrong'),

  ('transparent', 'Gives honest and constructive feedback', 1,
   'Gave candid feedback that improved a piece of work',
   'Shared an honest view that led to a better outcome'),
  ('transparent', 'Gives honest and constructive feedback', 2,
   'Raised a difficult concern respectfully',
   'Addressed an uncomfortable issue directly and with care'),
  ('transparent', 'Gives honest and constructive feedback', 3,
   'Gave balanced feedback in a review or retrospective',
   'Recognised what went well and was clear about what needed to change'),

  ('transparent', 'Communicates clearly with stakeholders', 1,
   'Explained a complex issue in plain language',
   'Made a technical or complicated topic easy for stakeholders to understand'),
  ('transparent', 'Communicates clearly with stakeholders', 2,
   'Kept stakeholders updated through a critical phase',
   'Gave clear, regular updates when the stakes were high'),
  ('transparent', 'Communicates clearly with stakeholders', 3,
   'Set realistic expectations with a client or stakeholder',
   'Was upfront about scope, timelines or constraints from the start'),

  -- Collaborative
  ('collaborative', 'Gives credit to others', 1,
   'Publicly acknowledged a colleague''s contribution',
   'Called out someone''s work in a meeting, channel or company forum'),
  ('collaborative', 'Gives credit to others', 2,
   'Shared the credit for a team success',
   'Made sure everyone who contributed was recognised, not just themselves'),
  ('collaborative', 'Gives credit to others', 3,
   'Highlighted behind-the-scenes work',
   'Made visible the effort of someone whose work usually goes unnoticed'),

  ('collaborative', 'Prioritizes team success', 1,
   'Put team goals ahead of personal priorities',
   'Set aside their own work to help the team reach a shared objective'),
  ('collaborative', 'Prioritizes team success', 2,
   'Took on unglamorous work so the team could deliver',
   'Handled the tasks nobody wanted so the team could succeed'),
  ('collaborative', 'Prioritizes team success', 3,
   'Helped the team agree on a shared goal',
   'Brought differing views together so the team could move forward as one'),

  -- Innovative
  ('innovative', 'Suggests process improvements', 1,
   'Proposed a change that made a process faster',
   'Suggested an improvement that saved the team time or effort'),
  ('innovative', 'Suggests process improvements', 2,
   'Identified and removed an unnecessary step',
   'Spotted work that added no value and helped eliminate it'),
  ('innovative', 'Suggests process improvements', 3,
   'Improved a team workflow or way of working',
   'Introduced a better way of planning, reviewing or delivering work'),

  ('innovative', 'Experiments with technology', 1,
   'Built a prototype or proof of concept',
   'Tried out a new idea quickly to test whether it would work'),
  ('innovative', 'Experiments with technology', 2,
   'Evaluated a new tool and shared the findings',
   'Investigated a technology and helped the team decide whether to adopt it'),
  ('innovative', 'Experiments with technology', 3,
   'Ran an experiment that led to a better outcome',
   'Tested an alternative approach and used the results to improve the work'),

  ('innovative', 'Challenges inefficient processes constructively', 1,
   'Questioned an outdated practice and proposed an alternative',
   'Challenged the way things had always been done and offered a better option'),
  ('innovative', 'Challenges inefficient processes constructively', 2,
   'Used data to make the case for change',
   'Backed up a process concern with evidence that helped others see the problem'),
  ('innovative', 'Challenges inefficient processes constructively', 3,
   'Turned a recurring frustration into an improvement',
   'Took a common complaint and worked with others to fix the underlying cause'),

  -- Accountable
  ('accountable', 'Takes ownership beyond immediate responsibilities', 1,
   'Stepped in to fill a gap nobody else owned',
   'Took charge of something that was falling through the cracks'),
  ('accountable', 'Takes ownership beyond immediate responsibilities', 2,
   'Saw an issue through to resolution outside their role',
   'Followed a problem to the end even though it was not formally theirs'),
  ('accountable', 'Takes ownership beyond immediate responsibilities', 3,
   'Took ownership of a shared problem',
   'Volunteered to lead on an issue that affected the whole team'),

  ('accountable', 'Keeps stakeholders informed', 1,
   'Gave progress updates without being chased',
   'Kept stakeholders informed proactively throughout the work'),
  ('accountable', 'Keeps stakeholders informed', 2,
   'Flagged a delay early with a recovery plan',
   'Warned of a slip in good time and explained how it would be addressed'),
  ('accountable', 'Keeps stakeholders informed', 3,
   'Closed the loop after completing a request',
   'Confirmed back to stakeholders when the work was done and what the outcome was')
),
target AS (
  SELECT w.*, b.id AS behaviour_id, b.core_value_id
    FROM wanted w
    JOIN core_values cv ON cv.slug = w.value_slug
    JOIN behaviours  b  ON b.core_value_id = cv.id
                       AND lower(btrim(b.name)) = lower(btrim(w.behaviour))
)
INSERT INTO scenarios (core_value_id, behaviour_id, name, description, display_order)
SELECT t.core_value_id,
       t.behaviour_id,
       t.name,
       t.description,
       COALESCE((SELECT max(s.display_order) FROM scenarios s
                  WHERE s.behaviour_id = t.behaviour_id), 0) + t.ord
  FROM target t
 WHERE NOT EXISTS (
         SELECT 1 FROM scenarios s
          WHERE s.behaviour_id = t.behaviour_id
            AND lower(btrim(s.name)) = lower(btrim(t.name)));


-- Report what is still uncovered, without failing: a behaviour HR created
-- under its own name is theirs to fill in.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT cv.name AS value_name, b.name AS behaviour_name
      FROM behaviours b
      JOIN core_values cv ON cv.id = b.core_value_id
     WHERE b.is_active AND cv.is_active
       AND NOT EXISTS (SELECT 1 FROM scenarios s
                        WHERE s.behaviour_id = b.id AND s.is_active)
     ORDER BY cv.display_order, b.display_order
  LOOP
    RAISE NOTICE 'Behaviour still has no active scenario: % -> %', r.value_name, r.behaviour_name;
  END LOOP;
END $$;
