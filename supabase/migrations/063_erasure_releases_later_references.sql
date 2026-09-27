-- ============================================================
-- 063 -- Erasing an employee no longer fails on later references
--
-- Requires 001-062. Safe to run more than once.
--
--
-- WHAT WENT WRONG
-- ---------------
-- Deleting an employee (Employees -> Delete permanently) failed with:
--
--     update or delete on table "employees" violates foreign key constraint
--     "report_ai_insights_generated_by_fkey" on table "report_ai_insights"
--
-- purge_employee() (035, last revised in 037) releases every column that
-- pointed at employees WHEN IT WAS WRITTEN. Two columns added since then were
-- never taught to it, and both reference employees with no ON DELETE action,
-- so PostgreSQL refuses the delete for anybody who ever:
--
--   report_ai_insights.generated_by       (043)  generated an AI report summary
--   nominations.clarification_requested_by_id (042)  asked for clarification
--                                                    on a recognition
--
-- The whole purge is one transaction, so nothing was half-deleted: the
-- refusal rolled everything back, exactly as the dialog said.
--
--
-- THE FIX
-- -------
-- Both become ON DELETE SET NULL. Each records WHO DID something, and the
-- thing itself should outlive them: the AI summary is still a valid summary
-- of somebody else's report, and a recognition that went through a
-- clarification round is still that recognition. This is the same outcome
-- purge_employee() already produces by hand for approved_by_id,
-- rejected_by_id and the rest -- "the decision is kept and the name is
-- released".
--
-- Done on the constraint rather than by adding two more UPDATEs to
-- purge_employee(), so it holds for every path that deletes an employee, not
-- only the one that remembers to clear it first.
--
-- A report_ai_insights row whose SUBJECT is the erased person was already
-- removed (subject_id is ON DELETE CASCADE, 043) and is unaffected.
-- ============================================================

ALTER TABLE public.report_ai_insights
  DROP CONSTRAINT IF EXISTS report_ai_insights_generated_by_fkey;
ALTER TABLE public.report_ai_insights
  ADD CONSTRAINT report_ai_insights_generated_by_fkey
  FOREIGN KEY (generated_by) REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.nominations
  DROP CONSTRAINT IF EXISTS nominations_clarification_requested_by_id_fkey;
ALTER TABLE public.nominations
  ADD CONSTRAINT nominations_clarification_requested_by_id_fkey
  FOREIGN KEY (clarification_requested_by_id) REFERENCES public.employees(id) ON DELETE SET NULL;


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Both should be 'n' (SET NULL).
-- ============================================================
SELECT '063 APPLIED' AS check,
       (SELECT confdeltype = 'n' FROM pg_constraint
         WHERE conname = 'report_ai_insights_generated_by_fkey')           AS ai_insight_author_released,
       (SELECT confdeltype = 'n' FROM pg_constraint
         WHERE conname = 'nominations_clarification_requested_by_id_fkey') AS clarifier_released;
