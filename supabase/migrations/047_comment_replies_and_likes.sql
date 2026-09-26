-- ============================================================
-- 047 — REPLIES, AND LIKES ON A COMMENT
--
-- 046 built a flat conversation and said so in as many words: "No threading.
-- Replies to replies need a parent, a depth bound and a collapse rule in
-- every renderer, and nothing in this product has asked for them."
--
-- Something has now asked for them. This migration adds the parent, the depth
-- bound and — in the dialog that renders it — the collapse rule.
--
-- ONE LEVEL, ENFORCED
-- -------------------
-- A reply may hang off a comment. Nothing may hang off a reply. That is not a
-- convention the UI observes, it is a trigger that refuses the insert, which
-- matters because the alternative is unbounded depth: nothing about a
-- self-referencing column stops a chain a hundred deep, and every renderer
-- downstream would need its own indent cap and its own opinion about what to
-- do past it. One level means a thread is always two lists, and "See 52
-- replies" always means the same thing.
--
-- The same trigger pins a reply to its parent's recognition. Without it a
-- reply could name nomination A while its parent lives on nomination B, and
-- the thread would render under one post with its parent under another.
--
-- LIKES, NOT REACTIONS
-- --------------------
-- A like is a row: one person, one comment, present or absent. There is no
-- dislike. The design this follows has one, and in a product whose entire
-- subject is recognising colleagues, a public tally of downvotes under
-- somebody's remark about a colleague's recognition is a different object
-- than it is under a video — so the button that would produce it does not
-- exist. Taking a like back is the whole of the disagreement this affords,
-- which is also all Instagram affords, and that is the reference here.
--
-- The count is not stored. Same reasoning as appreciation_count and
-- comment_count before it: counted at read time, correct by construction,
-- no trigger to miss.
-- ============================================================


-- ── 1. The parent ───────────────────────────────────────────

ALTER TABLE nomination_comments
  ADD COLUMN IF NOT EXISTS parent_comment_id UUID
    REFERENCES nomination_comments(id) ON DELETE CASCADE;

-- Deleting a comment takes its replies with it (ON DELETE CASCADE above).
-- The alternative — orphaned replies promoted to top level — silently
-- reattributes an answer to a question nobody can see any more.

-- Reading one comment's replies, oldest first.
CREATE INDEX IF NOT EXISTS idx_nomination_comments_parent
  ON nomination_comments(parent_comment_id, created_at)
  WHERE parent_comment_id IS NOT NULL;


/*
  The depth bound and the thread's integrity, in one trigger.

  BEFORE INSERT so the row never exists in a state that would have to be
  cleaned up, and a plain exception rather than a silent correction: an insert
  that would have created a reply-to-a-reply is a bug in whatever sent it, and
  quietly reparenting it to the top of the thread would hide that while
  changing what the author appeared to be answering.
*/
CREATE OR REPLACE FUNCTION public.enforce_comment_depth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  parent RECORD;
BEGIN
  IF NEW.parent_comment_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id, nomination_id, parent_comment_id
    INTO parent
    FROM nomination_comments
   WHERE id = NEW.parent_comment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The comment being replied to no longer exists.'
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF parent.parent_comment_id IS NOT NULL THEN
    RAISE EXCEPTION 'A reply cannot be replied to. Reply to the comment instead.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF parent.nomination_id <> NEW.nomination_id THEN
    RAISE EXCEPTION 'A reply must belong to the same recognition as the comment it answers.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_enforce_comment_depth ON nomination_comments;
CREATE TRIGGER trg_enforce_comment_depth
  BEFORE INSERT ON nomination_comments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_comment_depth();


-- ── 2. Likes ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nomination_comment_likes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id  UUID NOT NULL REFERENCES nomination_comments(id) ON DELETE CASCADE,
  employee_id UUID NOT NULL REFERENCES employees(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- One person, one like. The toggle in the UI is this constraint seen from
  -- the front: liking twice is not a second row, it is the same row.
  UNIQUE(comment_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_likes_comment
  ON nomination_comment_likes(comment_id);

CREATE INDEX IF NOT EXISTS idx_comment_likes_employee
  ON nomination_comment_likes(employee_id);

ALTER TABLE nomination_comment_likes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comment_likes_read_all_authenticated" ON nomination_comment_likes;
CREATE POLICY "comment_likes_read_all_authenticated" ON nomination_comment_likes
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "comment_likes_insert_own" ON nomination_comment_likes;
CREATE POLICY "comment_likes_insert_own" ON nomination_comment_likes
  FOR INSERT WITH CHECK (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND employee_id = (auth.jwt()->>'employee_id')::uuid
  );

-- Your own only. A moderator who objects to a comment removes the comment
-- (046); editing the count under somebody else's is not a moderation action,
-- it is rewriting what other people thought.
DROP POLICY IF EXISTS "comment_likes_delete_own" ON nomination_comment_likes;
CREATE POLICY "comment_likes_delete_own" ON nomination_comment_likes
  FOR DELETE USING (
    public.session_second_factor_ok()
    AND employee_id = (auth.jwt()->>'employee_id')::uuid
  );

-- No UPDATE policy. A like has nothing to change: it is there or it is not.


-- ── 3. Who hears about a reply ──────────────────────────────

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'nomination_submitted',
    'approval_required',
    'clarification_requested',
    'nomination_approved',
    'nomination_rejected',
    'recognition_received',
    'team_recognition_published',
    'badge_unlocked',
    'monthly_report_ready',
    -- Added by 034.
    'support_request_created',
    'support_request_resolved',
    'support_request_rejected',
    -- Added by 046.
    'recognition_commented',
    -- Added by 047.
    'comment_replied'
  ));

/*
  Replacing the 046 trigger function rather than adding a second trigger,
  because the two cases are one decision and splitting them across two
  functions is how they drift.

  A TOP-LEVEL COMMENT tells the two people the recognition is about — nominee
  and nominator — which is what 046 did and still does.

  A REPLY tells the author of the comment it answers, and nobody else. Not the
  nominee and nominator as well: on a post with an active thread they would
  hear about every remark anyone made to anyone, which is the fastest way to
  make somebody turn notifications off entirely. The recognition is theirs;
  the conversation underneath it is not addressed to them.

  Nobody is ever told about their own writing.

  Likes send nothing at all. A like is the cheapest thing in the product to
  produce and a notification is one of the most expensive things to receive.
*/
CREATE OR REPLACE FUNCTION public.notify_recognition_commented()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nom            RECORD;
  author_name    TEXT;
  parent_author  UUID;
  preview        TEXT;
BEGIN
  SELECT full_name INTO author_name FROM employees WHERE id = NEW.author_id;
  author_name := COALESCE(author_name, 'Someone');

  -- Enough of the comment to decide whether to go and read it.
  preview := CASE
    WHEN char_length(btrim(NEW.body)) > 120
      THEN left(btrim(NEW.body), 117) || '...'
    ELSE btrim(NEW.body)
  END;

  -- ── A reply. One recipient: the person being answered. ──
  IF NEW.parent_comment_id IS NOT NULL THEN
    SELECT author_id INTO parent_author
      FROM nomination_comments
     WHERE id = NEW.parent_comment_id;

    INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
    SELECT
      parent_author,
      'comment_replied',
      author_name || ' replied to your comment',
      author_name || ' replied: "' || preview || '"',
      NEW.nomination_id,
      'nomination'
    FROM employees e
    WHERE e.id = parent_author
      AND parent_author IS DISTINCT FROM NEW.author_id
      AND e.is_active
      AND e.auth_user_id IS NOT NULL;

    RETURN NEW;
  END IF;

  -- ── A comment. The two people the recognition is about. ──
  SELECT n.nominee_id, n.nominator_id, nominee.full_name AS nominee_name
    INTO nom
    FROM nominations n
    JOIN employees nominee ON nominee.id = n.nominee_id
   WHERE n.id = NEW.nomination_id;

  INSERT INTO notifications (recipient_id, type, title, body, related_id, related_type)
  SELECT
    r.recipient,
    'recognition_commented',
    author_name || ' commented on a recognition',
    CASE
      WHEN r.recipient = nom.nominee_id
        THEN author_name || ' commented on the recognition you received: "' || preview || '"'
      ELSE author_name || ' commented on the recognition you gave '
             || COALESCE(nom.nominee_name, 'a colleague') || ': "' || preview || '"'
    END,
    NEW.nomination_id,
    'nomination'
  FROM (
    -- DISTINCT so that a recognition whose two sides are somehow the same
    -- person produces one notification rather than two identical ones.
    SELECT DISTINCT unnest(ARRAY[nom.nominee_id, nom.nominator_id]) AS recipient
  ) r
  JOIN employees e ON e.id = r.recipient
  WHERE r.recipient IS DISTINCT FROM NEW.author_id
    AND e.is_active
    AND e.auth_user_id IS NOT NULL;

  RETURN NEW;
END;
$fn$;


-- ── 4. Erasure takes the likes too ──────────────────────────
--
-- Extends the 046 trigger. nomination_comment_likes.employee_id references
-- employees with no ON DELETE action, so the same foreign key that would have
-- blocked purge_employee() on comments now blocks it on likes. Likes ON the
-- person's own comments cascade when those comments go; their likes on OTHER
-- people's comments are the rows this has to remove.

CREATE OR REPLACE FUNCTION public.erase_employee_comments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM nomination_comment_likes WHERE employee_id = OLD.id;
  DELETE FROM nomination_comments WHERE author_id = OLD.id;
  RETURN OLD;
END;
$fn$;
