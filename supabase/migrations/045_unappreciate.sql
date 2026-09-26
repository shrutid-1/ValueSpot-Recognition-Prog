-- ============================================================
-- 045 — AN APPRECIATION CAN BE TAKEN BACK
--
-- THE GAP
-- -------
-- nomination_appreciations (003) has RLS enabled and exactly two policies:
-- read for any authenticated session, insert for your own row. There is no
-- DELETE policy, and under RLS an absent policy is a denial — so an
-- appreciation, once recorded, could not be removed by the person who
-- recorded it. The button in the feed reflected that faithfully: it disabled
-- itself the moment it was pressed.
--
-- That is not the behaviour people expect of a one-tap reaction. A misclick,
-- or a change of mind, left a permanent row.
--
-- WHAT THIS CHANGES
-- -----------------
-- One policy: a session may delete the appreciation rows that carry its own
-- employee_id, under the same second factor every other table write in this
-- schema requires (022). Nobody gains the ability to remove somebody else's
-- appreciation — not a Manager, not HR, not a Super Admin. The only row you
-- can take back is the one you put there.
--
-- Nothing else needs to move. appreciation_count is not a stored aggregate:
-- v_recognition_feed (006, redefined in 022) counts the rows in a subquery,
-- so a deleted row lowers the count on the next read with no recalculation
-- and no trigger. No badge, notification or audit record is derived from an
-- appreciation, so removing one has no further consequence.
--
-- The UNIQUE(nomination_id, employee_id) constraint stays exactly as it was:
-- appreciating again after taking it back inserts a fresh row, which is what
-- the insert policy already permits.
-- ============================================================

DROP POLICY IF EXISTS "appreciations_delete_own" ON nomination_appreciations;

CREATE POLICY "appreciations_delete_own" ON nomination_appreciations
  FOR DELETE USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND employee_id = (auth.jwt()->>'employee_id')::uuid
  );
