-- ============================================================
-- 062 -- Store categories HR can change
--
-- Requires 001-061. Safe to run more than once.
--
--
-- WHAT WAS HERE
-- -------------
-- 051 gave every reward a `category` -- the shelf it sits on in the Value
-- Store -- as free text held to five values by a CHECK:
--
--     everyday, experiences, learning, wellness, recognition
--
-- The same five were then written out again in the browser: the HR form's
-- dropdown, the store's shelf row, and the glyph each shelf wears. Adding a
-- sixth meant a migration and a deploy.
--
--
-- WHAT THIS CHANGES
-- -----------------
-- The shelves become rows in `reward_categories`, which HR and a Super Admin
-- edit from the Rewards screen. The CHECK is replaced by a FOREIGN KEY, so the
-- rule "a reward sits on a shelf that exists" is still the database's, not the
-- form's.
--
-- `slug` is the key and is what `rewards.category` holds, exactly as before.
-- Every existing reward, every redemption that joins to its reward for the
-- shelf (list_my_redemptions, 052) and every row already on the wire keeps
-- working unchanged: the five slugs are seeded below with the labels and
-- glyphs the browser used to hard-code.
--
-- The slug never changes after creation. Renaming a shelf changes `label`
-- only, so nothing that points at the slug has to move.
--
--
-- WHO MAY CHANGE IT, AND HOW
-- --------------------------
--   read     anybody signed in with a verified session -- the store needs
--            the labels and glyphs to draw its shelves
--   create   create_reward_category()   HR / Super Admin
--   rename,  a plain UPDATE, under reward_categories_hr_update plus a
--   re-icon, trigger that re-reads the role from `employees` (the 052
--   reorder  precedent: "a claim is what a session says")
--   remove   delete_reward_category()   HR / Super Admin
--
-- There is no INSERT or DELETE policy at all, so those two go through their
-- functions or nowhere. That is deliberate for removal in particular: a shelf
-- with rewards on it cannot simply vanish, and the function is what moves
-- those rewards to another shelf in the same transaction as the delete.
-- ============================================================


-- ── 1. The table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reward_categories (
  /* What rewards.category holds. Lowercase words joined by hyphens, derived
     from the label when the shelf is created and never changed after. */
  slug          TEXT PRIMARY KEY,
  /* What people read: the dropdown, the shelf tab, the card. */
  label         TEXT NOT NULL,
  /* A key into the browser's glyph set (rewardMarks.ts). An unknown key is
     drawn as the fallback glyph rather than refused, so a glyph retired from
     the browser never breaks a shelf. */
  icon          TEXT NOT NULL DEFAULT 'gift',
  /* Shelf order in the store and the HR dropdown. Ties sort by label. */
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE reward_categories DROP CONSTRAINT IF EXISTS reward_categories_slug_shape;
ALTER TABLE reward_categories ADD CONSTRAINT reward_categories_slug_shape
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 48);

ALTER TABLE reward_categories DROP CONSTRAINT IF EXISTS reward_categories_label_shape;
ALTER TABLE reward_categories ADD CONSTRAINT reward_categories_label_shape
  CHECK (label = btrim(label) AND length(label) BETWEEN 1 AND 40);

ALTER TABLE reward_categories DROP CONSTRAINT IF EXISTS reward_categories_icon_shape;
ALTER TABLE reward_categories ADD CONSTRAINT reward_categories_icon_shape
  CHECK (icon ~ '^[a-z0-9-]{1,32}$');

-- Two shelves called "Wellness" and "wellness" would be one shelf twice.
CREATE UNIQUE INDEX IF NOT EXISTS reward_categories_label_unique
  ON reward_categories (lower(label));

DROP TRIGGER IF EXISTS set_reward_categories_updated_at ON reward_categories;
CREATE TRIGGER set_reward_categories_updated_at
  BEFORE UPDATE ON reward_categories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ── 2. The five shelves that already exist ──────────────────
--
-- The labels and glyphs the browser used to hard-code, so the store looks the
-- same the moment this is applied. Only into an EMPTY table: once HR has
-- renamed "Everyday" or removed "Wellness", a re-run must neither restore the
-- old label nor bring back a shelf somebody deliberately took away.

INSERT INTO reward_categories (slug, label, icon, display_order)
SELECT v.slug, v.label, v.icon, v.display_order
  FROM (VALUES
    ('everyday',    'Everyday',    'coffee',         1),
    ('experiences', 'Experiences', 'ticket',         2),
    ('learning',    'Learning',    'graduation-cap', 3),
    ('wellness',    'Wellness',    'heart-pulse',    4),
    ('recognition', 'Recognition', 'sparkles',       5)
  ) AS v(slug, label, icon, display_order)
 WHERE NOT EXISTS (SELECT 1 FROM reward_categories)
ON CONFLICT (slug) DO NOTHING;

-- Belt and braces: 051's CHECK made any other value impossible, but if a
-- database somehow holds one, give it a shelf rather than fail the key below.
INSERT INTO reward_categories (slug, label, icon, display_order)
SELECT DISTINCT r.category, initcap(replace(r.category, '-', ' ')), 'gift', 100
  FROM rewards r
 WHERE r.category ~ '^[a-z0-9]+(-[a-z0-9]+)*$'
   AND NOT EXISTS (SELECT 1 FROM reward_categories c WHERE c.slug = r.category)
ON CONFLICT DO NOTHING;


-- ── 3. rewards.category points at a shelf that exists ───────

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS rewards_category_check;

/*
  No DEFAULT any more. 'everyday' was a safe default while it could not be
  removed; now it can, and a default naming a shelf that has gone would fail
  on the key below with a message about a constraint. Every writer already
  names a category explicitly.
*/
ALTER TABLE rewards ALTER COLUMN category DROP DEFAULT;

ALTER TABLE rewards DROP CONSTRAINT IF EXISTS rewards_category_fkey;
ALTER TABLE rewards ADD CONSTRAINT rewards_category_fkey
  FOREIGN KEY (category) REFERENCES reward_categories(slug);

CREATE INDEX IF NOT EXISTS idx_rewards_category ON rewards(category);


-- ── 4. Reading and editing ──────────────────────────────────

ALTER TABLE reward_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reward_categories_read" ON reward_categories;
CREATE POLICY "reward_categories_read" ON reward_categories
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "reward_categories_hr_update" ON reward_categories;
CREATE POLICY "reward_categories_hr_update" ON reward_categories
  FOR UPDATE
  USING (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  )
  WITH CHECK (
    public.session_second_factor_ok()
    AND (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
  );

/*
  The policy reads the role from the token; this re-reads it from the table,
  as guard_reward_configuration() (052) does for `rewards`. It also holds the
  slug still: rewards point at it, and a rename is a change of label.
*/
CREATE OR REPLACE FUNCTION public.guard_reward_category_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor      UUID := (auth.jwt()->>'employee_id')::uuid;
  actor_role TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.slug IS DISTINCT FROM OLD.slug THEN
    RAISE EXCEPTION 'A store category keeps its key once created. Rename its label instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Migrations and seeds run with no session and are not what this guards.
  IF actor IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor;

  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only HR and a Super Admin can change the store categories.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$fn$;

DROP TRIGGER IF EXISTS guard_reward_category_write_trg ON reward_categories;
CREATE TRIGGER guard_reward_category_write_trg
  BEFORE INSERT OR UPDATE OR DELETE ON reward_categories
  FOR EACH ROW EXECUTE FUNCTION public.guard_reward_category_write();


-- ── 5. Creating a shelf ─────────────────────────────────────
--
-- A function rather than an INSERT policy so the slug and the position are
-- the database's to decide: the slug is derived from the label and made
-- unique here, and a new shelf goes on the end of the row.

CREATE OR REPLACE FUNCTION public.create_reward_category(
  p_label TEXT,
  p_icon  TEXT DEFAULT 'gift'
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor      UUID := (auth.jwt()->>'employee_id')::uuid;
  actor_role TEXT;
  clean      TEXT := btrim(regexp_replace(COALESCE(p_label, ''), '\s+', ' ', 'g'));
  icon_key   TEXT := lower(btrim(COALESCE(p_icon, '')));
  base_slug  TEXT;
  new_slug   TEXT;
  n          INTEGER := 1;
  next_order INTEGER;
  created    reward_categories;
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor AND is_active;

  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only HR and a Super Admin can change the store categories.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF length(clean) = 0 THEN
    RAISE EXCEPTION 'Give the category a name.' USING ERRCODE = 'check_violation';
  END IF;

  IF length(clean) > 40 THEN
    RAISE EXCEPTION 'Keep the category name to 40 characters or fewer.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF icon_key !~ '^[a-z0-9-]{1,32}$' THEN
    icon_key := 'gift';
  END IF;

  /*
    Serialise creation. Two HR admins adding "Travel" at the same moment
    would otherwise both pass the name check below and one would fail on
    the unique index with a message about an index.
  */
  LOCK TABLE reward_categories IN SHARE ROW EXCLUSIVE MODE;

  IF EXISTS (SELECT 1 FROM reward_categories WHERE lower(label) = lower(clean)) THEN
    RAISE EXCEPTION 'There is already a category called %.', clean
      USING ERRCODE = 'check_violation';
  END IF;

  base_slug := btrim(regexp_replace(lower(clean), '[^a-z0-9]+', '-', 'g'), '-');
  base_slug := left(base_slug, 40);
  base_slug := btrim(base_slug, '-');
  -- A name with no Latin letters or digits in it ("आरोग्य") still needs a key.
  IF base_slug = '' THEN
    base_slug := 'category';
  END IF;

  new_slug := base_slug;
  WHILE EXISTS (SELECT 1 FROM reward_categories WHERE slug = new_slug) LOOP
    n := n + 1;
    new_slug := base_slug || '-' || n;
  END LOOP;

  SELECT COALESCE(MAX(display_order), 0) + 1 INTO next_order FROM reward_categories;

  INSERT INTO reward_categories (slug, label, icon, display_order)
  VALUES (new_slug, clean, icon_key, next_order)
  RETURNING * INTO created;

  RETURN row_to_json(created);
END;
$fn$;

REVOKE ALL ON FUNCTION public.create_reward_category(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_reward_category(TEXT, TEXT) TO authenticated;


-- ── 6. Removing a shelf ─────────────────────────────────────
--
-- The rewards on it move to p_move_to in the same transaction as the delete.
-- Nothing else about them changes -- price, validity, approval, and every
-- redemption already made keep exactly what they had. A redemption's shelf
-- is read through its reward, so it simply shows the new shelf.
--
-- Refused, with a sentence, when:
--   * it is the last shelf (a reward must sit on one, so the store needs one)
--   * rewards are on it and no destination was named -- the count is re-read
--     here under a lock, so a reward added since the screen looked is not
--     silently swept along somewhere nobody chose
--   * the destination is itself, or does not exist

CREATE OR REPLACE FUNCTION public.delete_reward_category(
  p_slug    TEXT,
  p_move_to TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  actor       UUID := (auth.jwt()->>'employee_id')::uuid;
  actor_role  TEXT;
  target      reward_categories;
  destination reward_categories;
  on_shelf    INTEGER;
  moved       INTEGER := 0;
BEGIN
  IF NOT public.session_second_factor_ok() THEN
    RAISE EXCEPTION 'This session has not completed its second step.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT role INTO actor_role FROM employees WHERE id = actor AND is_active;

  IF actor_role IS NULL OR actor_role NOT IN ('hr_admin', 'super_admin') THEN
    RAISE EXCEPTION 'Only HR and a Super Admin can change the store categories.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Serialise against another removal and against create_reward_category(),
  -- so "is this the last shelf?" cannot be answered twice at once.
  LOCK TABLE reward_categories IN SHARE ROW EXCLUSIVE MODE;

  SELECT * INTO target FROM reward_categories WHERE slug = p_slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That category has already been removed.' USING ERRCODE = 'no_data_found';
  END IF;

  IF (SELECT count(*) FROM reward_categories) <= 1 THEN
    RAISE EXCEPTION 'The Value Store needs at least one category. Add another before removing %.', target.label
      USING ERRCODE = 'check_violation';
  END IF;

  -- Lock the rewards on this shelf so none is added or moved onto it
  -- between counting them and moving them.
  PERFORM 1 FROM rewards WHERE category = target.slug FOR UPDATE;
  SELECT count(*) INTO on_shelf FROM rewards WHERE category = target.slug;

  IF on_shelf > 0 THEN
    IF p_move_to IS NULL OR btrim(p_move_to) = '' THEN
      RAISE EXCEPTION '% % in %. Choose which category % should move to.',
        on_shelf,
        CASE WHEN on_shelf = 1 THEN 'reward is' ELSE 'rewards are' END,
        target.label,
        CASE WHEN on_shelf = 1 THEN 'it' ELSE 'they' END
        USING ERRCODE = 'check_violation';
    END IF;

    IF p_move_to = target.slug THEN
      RAISE EXCEPTION 'Choose a different category to move the rewards to.'
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT * INTO destination FROM reward_categories WHERE slug = p_move_to;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The category you chose to move the rewards to no longer exists.'
        USING ERRCODE = 'check_violation';
    END IF;

    UPDATE rewards SET category = destination.slug WHERE category = target.slug;
    GET DIAGNOSTICS moved = ROW_COUNT;
  END IF;

  DELETE FROM reward_categories WHERE slug = target.slug;

  RETURN json_build_object(
    'status', 'ok',
    'removed', target.slug,
    'rewards_moved', moved,
    'moved_to', CASE WHEN moved > 0 THEN destination.slug END
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.delete_reward_category(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_reward_category(TEXT, TEXT) TO authenticated;


-- ============================================================
-- Verification
--
-- Printed when the migration runs. Same shape as 033.
-- ============================================================
SELECT '062 APPLIED' AS check,
       (SELECT count(*) FROM reward_categories) >= 1                      AS has_categories,
       NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'rewards_category_check')             AS fixed_list_removed,
       EXISTS (SELECT 1 FROM pg_constraint
                WHERE conname = 'rewards_category_fkey')                  AS rewards_point_at_a_category,
       NOT EXISTS (SELECT 1 FROM rewards r
                    WHERE NOT EXISTS (SELECT 1 FROM reward_categories c
                                       WHERE c.slug = r.category))        AS every_reward_on_a_shelf,
       NOT has_function_privilege('anon', 'public.create_reward_category(text, text)', 'EXECUTE')
                                                                           AS anon_cannot_create,
       NOT has_function_privilege('anon', 'public.delete_reward_category(text, text)', 'EXECUTE')
                                                                           AS anon_cannot_delete;
