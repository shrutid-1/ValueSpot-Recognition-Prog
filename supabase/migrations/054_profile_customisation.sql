-- ============================================================
-- 054 -- the profile a person keeps themselves
--
-- WHAT THIS ADDS
-- --------------
-- Four columns on `employees`:
--
--   designation  what the person DOES -- "Software Engineer", "QA Engineer".
--                Not the same thing as `role`, and deliberately kept apart
--                from it: `role` is an access level (employee / manager /
--                hr_admin / super_admin) that decides what someone may see
--                and approve, and is only ever changed by set_employee_role().
--                A designation grants nothing. Anybody may write their own,
--                and HR may correct it from the Employees screen.
--   location     free text, shown under the name on the profile
--   skills       a short list of chips, shown on the profile
--   cover_url    the banner image behind the profile header
--
-- plus `avatar_url`, which already existed and simply had no way to be set.
--
-- Two functions for the person themselves:
--
--   update_my_profile(name, designation, location, skills)
--   set_my_profile_image(kind, url)
--
-- and a public storage bucket, `profile-media`, for the two images.
--
-- WHY FUNCTIONS RATHER THAN A PLAIN UPDATE
-- ----------------------------------------
-- The same reasoning as set_own_department() in 031. `employees_update_own`
-- would permit a whole-row self-update constrained only on `role`; a profile
-- editor has no business touching email, employee_id or is_active on the way
-- past. Each function writes exactly the columns it names, and resolves the
-- caller from auth.uid() rather than from any argument, so there is nothing in
-- the request that could point it at somebody else.
--
-- THE IMAGES
-- ----------
-- Uploaded by the browser straight to storage, into a folder named after the
-- caller's auth user id -- `profile-media/<auth.uid()>/avatar-<ts>.webp`. The
-- storage policies below let a person write and delete inside their own folder
-- and nowhere else. The bucket is public for READS because every screen that
-- shows a face renders it with a plain <img>; an avatar is not a secret, and a
-- signed URL per face per render would be a request per row of every list.
--
-- set_my_profile_image() then refuses any URL whose path is not inside the
-- caller's own folder of this bucket, so the profile editor cannot be pointed
-- at somebody else's upload. The HOST is not pinned (see the function); this
-- is a narrowing of what the editor writes, not a content filter.
-- ============================================================


-- ── 1. Columns ──────────────────────────────────────────────

ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS designation TEXT,
  ADD COLUMN IF NOT EXISTS location    TEXT,
  ADD COLUMN IF NOT EXISTS skills      TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cover_url   TEXT;

-- The limits live on the table, not only in the function, because HR writes
-- designation directly through employees_hr_full.
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_designation_len;
ALTER TABLE public.employees ADD  CONSTRAINT employees_designation_len
  CHECK (designation IS NULL OR char_length(designation) BETWEEN 1 AND 60);

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_location_len;
ALTER TABLE public.employees ADD  CONSTRAINT employees_location_len
  CHECK (location IS NULL OR char_length(location) BETWEEN 1 AND 80);

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_skills_count;
ALTER TABLE public.employees ADD  CONSTRAINT employees_skills_count
  CHECK (cardinality(skills) <= 12);

ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS employees_image_url_len;
ALTER TABLE public.employees ADD  CONSTRAINT employees_image_url_len
  CHECK (
    (avatar_url IS NULL OR char_length(avatar_url) <= 1024) AND
    (cover_url  IS NULL OR char_length(cover_url)  <= 1024)
  );

COMMENT ON COLUMN public.employees.designation IS
  'Job title, e.g. Software Engineer. Descriptive only -- grants nothing. Access is `role`.';
COMMENT ON COLUMN public.employees.cover_url IS
  'Profile banner image, in the profile-media bucket under the owner''s folder.';


-- ── 2. update_my_profile() ──────────────────────────────────
--
-- Writes the four text fields together, because the Edit Profile form saves
-- them together. Blank strings become NULL, so clearing a field removes it
-- rather than storing an empty value the profile would render as a gap.
--
-- Skills are trimmed, blanks dropped, and de-duplicated case-insensitively
-- keeping the first spelling and the order given -- "React, react" is one
-- skill. Over the limit is refused rather than truncated: silently dropping
-- the person's last three skills is worse than telling them.

CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_full_name   text,
  p_designation text,
  p_location    text,
  p_skills      text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid         uuid := auth.uid();
  emp         employees%ROWTYPE;
  v_name      text := NULLIF(btrim(regexp_replace(COALESCE(p_full_name,   ''), '\s+', ' ', 'g')), '');
  v_title     text := NULLIF(btrim(regexp_replace(COALESCE(p_designation, ''), '\s+', ' ', 'g')), '');
  v_location  text := NULLIF(btrim(regexp_replace(COALESCE(p_location,    ''), '\s+', ' ', 'g')), '');
  v_skills    text[];
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RETURN jsonb_build_object('status', 'needs_verification');
  END IF;

  IF v_name IS NULL OR char_length(v_name) < 2 THEN
    RETURN jsonb_build_object('status', 'invalid', 'field', 'full_name',
                              'reason', 'Your name needs at least 2 characters.');
  END IF;
  IF char_length(v_name) > 80 THEN
    RETURN jsonb_build_object('status', 'invalid', 'field', 'full_name',
                              'reason', 'Your name can be at most 80 characters.');
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) > 60 THEN
    RETURN jsonb_build_object('status', 'invalid', 'field', 'designation',
                              'reason', 'Designation can be at most 60 characters.');
  END IF;
  IF v_location IS NOT NULL AND char_length(v_location) > 80 THEN
    RETURN jsonb_build_object('status', 'invalid', 'field', 'location',
                              'reason', 'Location can be at most 80 characters.');
  END IF;

  -- Normalise the skills: trim, drop blanks, first spelling wins, order kept.
  SELECT COALESCE(array_agg(s.skill ORDER BY s.first_pos), '{}')
    INTO v_skills
    FROM (
      SELECT DISTINCT ON (lower(t.skill)) t.skill, t.pos AS first_pos
        FROM (
          SELECT btrim(regexp_replace(x, '\s+', ' ', 'g')) AS skill, ord AS pos
            FROM unnest(COALESCE(p_skills, '{}')) WITH ORDINALITY AS u(x, ord)
        ) t
       WHERE t.skill <> ''
       ORDER BY lower(t.skill), t.pos
    ) s;

  IF cardinality(v_skills) > 12 THEN
    RETURN jsonb_build_object('status', 'invalid', 'field', 'skills',
                              'reason', 'You can list up to 12 skills.');
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_skills) AS k WHERE char_length(k) > 30) THEN
    RETURN jsonb_build_object('status', 'invalid', 'field', 'skills',
                              'reason', 'Each skill can be at most 30 characters.');
  END IF;

  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;

  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_employee_record');
  END IF;
  IF NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  UPDATE employees
     SET full_name   = v_name,
         designation = v_title,
         location    = v_location,
         skills      = v_skills
   WHERE id = emp.id;

  RETURN jsonb_build_object(
    'status',      'ok',
    'full_name',   v_name,
    'designation', v_title,
    'location',    v_location,
    'skills',      to_jsonb(v_skills)
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.update_my_profile(text, text, text, text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.update_my_profile(text, text, text, text[]) TO authenticated;


-- ── 3. set_my_profile_image() ───────────────────────────────
--
-- p_kind is 'avatar' or 'cover'. A NULL url removes the image.
--
-- The URL must be a public object URL in this bucket, inside the caller's own
-- folder: `.../storage/v1/object/public/profile-media/<auth.uid()>/<file>`.
-- The host is not pinned -- the database does not know which hostname the
-- project is served on, and a local stack differs from the hosted one -- but
-- the path is, and the folder is the caller's by construction.

CREATE OR REPLACE FUNCTION public.set_my_profile_image(p_kind text, p_url text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  uid      uuid := auth.uid();
  emp      employees%ROWTYPE;
  v_url    text := NULLIF(btrim(COALESCE(p_url, '')), '');
  previous text;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('status', 'not_authenticated');
  END IF;

  IF NOT public.session_second_factor_ok() THEN
    RETURN jsonb_build_object('status', 'needs_verification');
  END IF;

  IF p_kind IS NULL OR p_kind NOT IN ('avatar', 'cover') THEN
    RETURN jsonb_build_object('status', 'invalid', 'reason', 'Unknown image kind.');
  END IF;

  IF v_url IS NOT NULL AND (
       char_length(v_url) > 1024
    OR v_url !~ ('^https?://[^/\s]+/storage/v1/object/public/profile-media/'
                 || uid::text || '/[A-Za-z0-9._-]+$')
  ) THEN
    RETURN jsonb_build_object('status', 'invalid',
                              'reason', 'That image is not one you uploaded.');
  END IF;

  SELECT * INTO emp FROM employees WHERE auth_user_id = uid LIMIT 1;

  IF emp.id IS NULL THEN
    RETURN jsonb_build_object('status', 'no_employee_record');
  END IF;
  IF NOT emp.is_active THEN
    RETURN jsonb_build_object('status', 'inactive');
  END IF;

  IF p_kind = 'avatar' THEN
    previous := emp.avatar_url;
    UPDATE employees SET avatar_url = v_url WHERE id = emp.id;
  ELSE
    previous := emp.cover_url;
    UPDATE employees SET cover_url = v_url WHERE id = emp.id;
  END IF;

  -- `previous` goes back so the browser can delete the file it replaced. It
  -- can only delete inside its own folder, so a previous value pointing
  -- anywhere else (a seeded avatar, say) is simply left alone by storage.
  RETURN jsonb_build_object('status', 'ok', 'url', v_url, 'previous', previous);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.set_my_profile_image(text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_my_profile_image(text, text) TO authenticated;


-- ── 4. The bucket ───────────────────────────────────────────
--
-- 5 MB and three raster types. The browser re-encodes every image before
-- upload (a 512px square avatar, a 1600x400 banner), so a real upload is a
-- small fraction of this; the limit is the backstop for a hand-made request.
-- No SVG: an SVG is a document that can carry script.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-media', 'profile-media', true, 5242880,
        ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
   SET public             = EXCLUDED.public,
       file_size_limit    = EXCLUDED.file_size_limit,
       allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Writes and deletes: own folder only. SELECT is needed as well because the
-- storage API reads the object before it deletes it. Public reads of the
-- images go through the public endpoint and do not consult these policies.
-- No UPDATE policy: uploads use a fresh file name each time, never overwrite.

DROP POLICY IF EXISTS "profile_media_insert_own" ON storage.objects;
CREATE POLICY "profile_media_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'profile-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.session_second_factor_ok()
  );

DROP POLICY IF EXISTS "profile_media_select_own" ON storage.objects;
CREATE POLICY "profile_media_select_own" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "profile_media_delete_own" ON storage.objects;
CREATE POLICY "profile_media_delete_own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'profile-media'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.session_second_factor_ok()
  );


-- ── 5. Designation on My Projects ───────────────────────────
--
-- managed_projects() (040) unchanged except for one field on each member, so
-- a manager sees what each person on the team does, not just their access
-- level.

CREATE OR REPLACE FUNCTION public.managed_projects()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $fn$
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
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(
             jsonb_build_object(
               'id',          e.id,
               'full_name',   e.full_name,
               'email',       e.email,
               'role',        e.role,
               'designation', e.designation,
               'avatar_url',  e.avatar_url
             )
             ORDER BY e.full_name
           ) AS members
      FROM project_members pm
      JOIN employees e ON e.id = pm.employee_id
     WHERE pm.project_id = p.id
       AND pm.is_active
       AND e.is_active
  ) m ON true
  WHERE p.manager_id = (auth.jwt()->>'employee_id')::uuid
    AND p.is_active;
$fn$;

REVOKE EXECUTE ON FUNCTION public.managed_projects() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.managed_projects() TO authenticated;

NOTIFY pgrst, 'reload schema';


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Every boolean expected true.
-- ============================================================
SELECT '054 APPLIED' AS check,
       (SELECT count(*) = 4 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'employees'
           AND column_name IN ('designation', 'location', 'skills', 'cover_url'))
                                                                        AS columns_added,
       (SELECT prosecdef FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'update_my_profile')                           AS update_is_definer,
       (SELECT prosecdef FROM pg_proc
         WHERE pronamespace = 'public'::regnamespace
           AND proname = 'set_my_profile_image')                        AS image_is_definer,
       NOT has_function_privilege('anon',
             'public.update_my_profile(text, text, text, text[])', 'EXECUTE')
                                                                        AS anon_cannot_update,
       NOT has_function_privilege('anon',
             'public.set_my_profile_image(text, text)', 'EXECUTE')     AS anon_cannot_set_image,
       EXISTS (SELECT 1 FROM storage.buckets
                WHERE id = 'profile-media' AND public)                  AS bucket_ready,
       (SELECT count(*) = 3 FROM pg_policies
         WHERE schemaname = 'storage' AND tablename = 'objects'
           AND policyname LIKE 'profile_media_%')                       AS storage_policies;
