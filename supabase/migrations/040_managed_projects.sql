-- ============================================================
-- 040 -- the projects a manager runs, and who is on them
--
-- One function for the Manager -> My Projects screen. No schema change: the
-- relationship it reads has existed since 001 and has been the source of truth
-- for a manager's team since 030.
--
--   projects.manager_id -> project_members -> employees
--
-- employees.manager_id is NOT consulted and must not be. Same rule as
-- listTeamMemberIds(), Team Recognition, Team Badges (039) and the Manager
-- Dashboard, so all five agree on who a manager's people are.
--
--
-- WHY A FUNCTION RATHER THAN A QUERY FROM THE CLIENT
-- -------------------------------------------------
-- The page could be built from `projects` with a nested select and
-- `.eq('manager_id', <id>)`. It would return the right rows. The difference is
-- that the id would come from the browser, so the request would carry the very
-- thing it is meant to be scoped by -- and "show me Manager B's projects"
-- would be a one-character edit in the network tab.
--
-- This takes NO ARGUMENTS. The manager is read from the session's JWT, so
-- there is nothing in the request to change. That is the whole reason it
-- exists; the shape of the result is a convenience.
--
--
-- WHY SECURITY INVOKER
-- --------------------
-- Deliberately not a definer function, and this is the important line in the
-- file: it grants NOTHING. Every row it returns is one the caller could
-- already read under their own policies --
--
--   projects_read_authenticated          any verified session, any project
--   project_members_read_authenticated   any verified session, any membership
--   employees_read_active                any verified session, active people
--
-- -- so this is a convenient shape for data the caller already has access to,
-- not a new door into data they do not. If those policies are ever tightened,
-- this function narrows with them automatically, which a definer function
-- would not.
--
-- Be plain about what that means for authorization: the scoping below is what
-- makes THIS API return only the caller's own projects. It is not what keeps
-- the underlying tables private, because on this schema they are not private
-- from any verified employee -- the directory, the project list and the
-- recognition feed are all company-wide by design (see 022). Nothing here
-- changes that posture in either direction.
--
--
-- ACTIVE, TWICE OVER
-- ------------------
--   p.is_active    an archived project is not something you still run
--   pm.is_active   somebody who has left the project is not on it
--   e.is_active    filtered by RLS already; stated anyway so the intent is
--                  readable here rather than inferred from a policy elsewhere
-- ============================================================


CREATE OR REPLACE FUNCTION public.managed_projects()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
  -- COALESCE so a manager with no projects gets [] rather than NULL: the page
  -- distinguishes "none" from "could not load", and needs a value for the
  -- first of those.
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id',           p.id,
        'name',         p.name,
        'description',  p.description,
        'project_code', p.project_code,
        'is_active',    p.is_active,
        'members',      COALESCE(m.members, '[]'::jsonb),
        'member_count', COALESCE(jsonb_array_length(m.members), 0)
      )
      ORDER BY p.name
    ),
    '[]'::jsonb
  )
  FROM projects p

  /*
    LATERAL, so the members of every project are gathered in ONE pass rather
    than a query per project. The page renders a card per project and a row per
    member; fetching members per card would be exactly the N+1 this avoids.

    LEFT, so a project with no members is still returned -- "no team members
    are currently assigned to this project" is a real state the screen shows,
    and dropping the row would render it as no project at all.
  */
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',         e.id,
               'full_name',  e.full_name,
               'email',      e.email,
               'role',       e.role,
               'avatar_url', e.avatar_url
             )
             ORDER BY e.full_name
           ) AS members
      FROM project_members pm
      JOIN employees e ON e.id = pm.employee_id
     WHERE pm.project_id = p.id
       AND pm.is_active
       AND e.is_active
  ) m ON true

  -- The scoping. From the session, never from an argument.
  WHERE p.manager_id = (auth.jwt()->>'employee_id')::uuid
    AND p.is_active;
$fn$;

COMMENT ON FUNCTION public.managed_projects() IS
  'Active projects run by the CALLING manager, each with its active members. Takes no arguments: the manager comes from the session, so there is nothing in the request to point at somebody else. SECURITY INVOKER -- grants no access the caller does not already have.';

REVOKE EXECUTE ON FUNCTION public.managed_projects() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.managed_projects() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Every boolean expected true.
-- ============================================================
SELECT '040 APPLIED' AS check,
       EXISTS (SELECT 1 FROM pg_proc
                WHERE pronamespace = 'public'::regnamespace
                  AND proname = 'managed_projects')                   AS function_installed,
       -- No arguments: nothing for a caller to steer it with.
       (SELECT pronargs = 0 FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'managed_projects')                          AS takes_no_arguments,
       -- INVOKER, not DEFINER: the caller's own policies still decide.
       (SELECT NOT prosecdef FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'managed_projects')                          AS is_security_invoker,
       -- Scoped by projects.manager_id from the JWT...
       (SELECT pg_get_functiondef(oid) LIKE '%p.manager_id = (auth.jwt()%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'managed_projects')                          AS scoped_by_session,
       -- ...and never by the deprecated line-manager column.
       (SELECT pg_get_functiondef(oid) NOT LIKE '%e.manager_id%'
          FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'managed_projects')                          AS no_line_manager,
       NOT has_function_privilege('anon', 'public.managed_projects()', 'EXECUTE')
                                                                      AS anon_refused,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public')  AS policies_untouched;
-- EXPECT every boolean true. No policy is created, altered or dropped here.


-- ============================================================
-- ROLLBACK
--
--   DROP FUNCTION IF EXISTS public.managed_projects();
--
-- Nothing else is created; no data is written by this migration.
-- ============================================================
