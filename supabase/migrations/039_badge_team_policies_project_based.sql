-- ============================================================
-- 039 -- a manager's team, for badges, is their PROJECTS
--
-- THE BUG
-- -------
-- Manager -> Team Badges was always empty. Not slow, not partial: empty, for
-- every manager, however many recognitions their people had received.
--
-- The application layer was never at fault. analyticsApi.getTeamBadges()
-- resolves the team through employeesApi.listTeamMemberIds(), which has been
-- project-based since 030 -- active projects the person manages, then the
-- active members of those projects -- and it passed the right employee ids to
-- the query.
--
-- The ROW-LEVEL POLICIES were still on the old model:
--
--   employee_id IN (
--     SELECT id FROM employees
--      WHERE manager_id = (auth.jwt()->>'employee_id')::uuid
--   )
--
-- `employees.manager_id` is the line-manager link that 030 deprecated for
-- exactly this purpose, and that the employee admin forms stopped writing at
-- the same time. On any workspace maintained since then that subquery matches
-- nobody, so the policy filtered every badge row away and the API returned an
-- empty array -- with no error, because an RLS filter is not an error.
--
-- 022 carried both policies forward when it added the second-factor gate. It
-- added the gate faithfully and preserved the stale membership test with it;
-- 030 then changed what "a manager's team" means and did not revisit them.
--
-- WHY THIS IS A POLICY FIX AND NOT AN APPLICATION FIX
-- ---------------------------------------------------
-- Because the database is where the answer has to be enforced. The manager id
-- in these policies comes from the JWT, never from the request, so a manager
-- cannot ask for another manager's team by changing an id in the browser --
-- and that property is worth keeping exactly as it is. What was wrong was the
-- DEFINITION of the team, not where it was applied.
--
-- WHAT IS DELIBERATELY NOT CHANGED
-- --------------------------------
--   evb_read_own / badge_history_read_own    an employee sees their own
--   evb_hr_read_all / badge_history_hr       HR and Super Admin see everything
--   the second-factor gate on all four       022, carried through unchanged
--   badge calculation                        calculateBadges() inside
--                                            process-approval already runs on
--                                            approval under the service role,
--                                            and writes the rows correctly.
--                                            Nothing here touches it.
--
-- The new test is the same one listTeamMemberIds() applies, so Team Badges,
-- Team Recognition and the Manager Dashboard now agree on who the team is by
-- construction rather than by coincidence.
-- ============================================================


-- ── Earned badges ───────────────────────────────────────────

ALTER POLICY "evb_read_team" ON employee_value_badges
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin')
    AND employee_id IN (
      /*
        The team, defined once: the active members of the ACTIVE projects this
        person manages. Both is_active tests matter --
          p.is_active   an archived project is not a team any more
          pm.is_active  somebody who has left the project is not on it
        -- and dropping either would show a manager people who are no longer
        theirs.

        `manager_id` here is projects.manager_id. employees.manager_id is not
        consulted, and must not be: see 030.
      */
      SELECT pm.employee_id
        FROM project_members pm
        JOIN projects p ON p.id = pm.project_id
       WHERE p.manager_id = (auth.jwt()->>'employee_id')::uuid
         AND p.is_active
         AND pm.is_active
    )
  );


-- ── Badge history ───────────────────────────────────────────
--
-- The same correction. Kept identical to the policy above on purpose: two
-- tests of "is this person on my team" that could drift apart is how one of
-- them ends up stale, which is the whole story of this migration.

ALTER POLICY "badge_history_read_team" ON badge_history
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('manager', 'hr_admin', 'super_admin')
    AND employee_id IN (
      SELECT pm.employee_id
        FROM project_members pm
        JOIN projects p ON p.id = pm.project_id
       WHERE p.manager_id = (auth.jwt()->>'employee_id')::uuid
         AND p.is_active
         AND pm.is_active
    )
  );


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Every boolean expected true.
-- ============================================================
SELECT '039 APPLIED' AS check,
       -- Both team policies now read project_members...
       (SELECT qual::text LIKE '%project_members%'
          FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'employee_value_badges'
           AND policyname = 'evb_read_team')                       AS evb_is_project_based,
       (SELECT qual::text LIKE '%project_members%'
          FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'badge_history'
           AND policyname = 'badge_history_read_team')             AS history_is_project_based,
       -- ...and neither consults employees.manager_id any more.
       (SELECT qual::text NOT LIKE '%employees%manager_id%'
          FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'employee_value_badges'
           AND policyname = 'evb_read_team')                       AS evb_drops_line_manager,
       -- The second factor is still required on both.
       (SELECT qual::text LIKE '%session_second_factor_ok%'
          FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'employee_value_badges'
           AND policyname = 'evb_read_team')                       AS evb_still_2fa_gated,
       (SELECT qual::text LIKE '%session_second_factor_ok%'
          FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'badge_history'
           AND policyname = 'badge_history_read_team')             AS history_still_2fa_gated,
       -- The employee's own view and HR's org-wide view are untouched.
       EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'employee_value_badges'
                  AND policyname = 'evb_read_own')                 AS own_view_intact,
       EXISTS (SELECT 1 FROM pg_policies
                WHERE schemaname = 'public' AND tablename = 'employee_value_badges'
                  AND policyname = 'evb_hr_read_all')              AS hr_view_intact,
       -- No policy was added or removed: this migration only redefines two.
       (SELECT count(*) FROM pg_policies
         WHERE schemaname = 'public'
           AND tablename IN ('employee_value_badges', 'badge_history')) = 6
                                                                   AS policy_count_unchanged;


-- ============================================================
-- ROLLBACK
--
-- Restore 022's definitions -- which is to say, restore the bug:
--
--   ALTER POLICY "evb_read_team" ON employee_value_badges USING (
--     public.session_second_factor_ok()
--     AND (auth.jwt()->>'user_role')::text IN ('manager','hr_admin','super_admin')
--     AND employee_id IN (SELECT id FROM employees
--                          WHERE manager_id = (auth.jwt()->>'employee_id')::uuid));
--
--   ALTER POLICY "badge_history_read_team" ON badge_history USING (... same ...);
-- ============================================================
