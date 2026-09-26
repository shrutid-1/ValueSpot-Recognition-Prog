-- ============================================================
-- 046 — COMMENTS ON A RECOGNITION
--
-- WHAT THIS ADDS
-- --------------
-- A recognition could be appreciated (one bit, per person) and nothing else.
-- Anyone reading the feed who wanted to say "I was on that call, this is
-- understated" had nowhere to put it. This adds the conversation: any
-- colleague — employee, Manager, HR, Super Admin alike — may leave a comment
-- on an approved recognition.
--
-- A SECOND TABLE, NOT A COLUMN
-- ----------------------------
-- Comments are rows, so they carry their own author, their own timestamp and
-- their own delete rule. nomination_appreciations (003) is the closest thing
-- in this schema and this table is deliberately shaped like it: cascade from
-- the nomination, reference the author, RLS that scopes writes to yourself.
--
-- The difference is the UNIQUE constraint, which is absent here. One person
-- appreciates once; one person may say several things.
--
-- WHAT IS NOT HERE
-- ----------------
-- No editing. A comment is a remark in a conversation other people have
-- already read and replied to, and silently rewriting one changes what those
-- replies appear to be answering. There is no UPDATE policy, so the database
-- refuses it rather than the UI merely not offering it.
--
-- No threading. Replies to replies need a parent, a depth bound and a
-- collapse rule in every renderer, and nothing in this product has asked for
-- them. A flat list is the whole of what is built.
--
-- WHO MAY DELETE
-- --------------
-- The author, always — the same "take back what you put there" rule that 045
-- gave appreciations. And HR or a Super Admin, because a comment on somebody
-- else's recognition is public, attributed and unedited, and the people who
-- can already remove an entire recognition (034) must be able to remove a
-- sentence under one. A Manager cannot: routing a recognition for approval is
-- not authority over what colleagues say about it afterwards.
--
-- ONLY ON WHAT IS VISIBLE
-- -----------------------
-- The insert policy requires the nomination to be approved. The feed shows
-- approved recognitions only (v_recognition_feed), so a comment on anything
-- else would be a remark nobody can see it under — and a pending recognition
-- is still in front of an approver, who should not be reading commentary on
-- a decision they have not made. Comments already written SURVIVE a later
-- moderation: the recognition leaves the feed and takes its conversation with
-- it, and if it is restored the conversation is still there.
-- ============================================================


-- ── 1. The table ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nomination_comments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nomination_id UUID NOT NULL REFERENCES nominations(id) ON DELETE CASCADE,
  author_id     UUID NOT NULL REFERENCES employees(id),
  body          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Bounded in the database, not only in the textarea. 1000 characters is
  -- room for a paragraph and well short of an essay; the empty case is
  -- rejected here so a comment of nothing but spaces cannot be stored.
  CONSTRAINT nomination_comments_body_length
    CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000)
);

-- The only way this table is ever read: one nomination's comments, oldest
-- first, the order a conversation is read in.
CREATE INDEX IF NOT EXISTS idx_nomination_comments_thread
  ON nomination_comments(nomination_id, created_at);

-- For "everything this person has said", which erasure needs.
CREATE INDEX IF NOT EXISTS idx_nomination_comments_author
  ON nomination_comments(author_id);


-- ── 2. Is this recognition one you may comment on? ──────────
--
-- SECURITY DEFINER, and that is the whole point of it existing.
--
-- The obvious way to write the rule below is an EXISTS subquery on
-- nominations inside the insert policy. It does not work, and it fails in the
-- worst possible direction: quietly, and only for the people the feature is
-- for. A policy expression is evaluated with RLS still in force on the tables
-- it reads, and the nominations SELECT policies (003) let an employee see
-- only the recognitions they gave, received or were assigned to approve. A
-- colleague commenting on somebody else's recognition — which is nearly every
-- comment — would find the subquery returning no row, and the insert refused,
-- while the author of that recognition could comment on it perfectly well.
--
-- The feed itself has the same shape of problem and solves it the same way:
-- v_recognition_feed reads nominations as its owner, not as the viewer, which
-- is what makes a company-wide feed possible at all.
--
-- What this exposes is one boolean about a row anyone can already read in
-- full through that view. It cannot be used to discover anything else: it
-- takes an id and answers whether that recognition is approved.

CREATE OR REPLACE FUNCTION public.nomination_is_approved(p_nomination_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM nominations
     WHERE id = p_nomination_id
       AND status = 'approved'
  );
$fn$;

REVOKE ALL ON FUNCTION public.nomination_is_approved(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nomination_is_approved(UUID) TO authenticated;


-- ── 3. Row-level security ───────────────────────────────────

ALTER TABLE nomination_comments ENABLE ROW LEVEL SECURITY;

-- Readable company-wide, like the feed the comments hang under.
DROP POLICY IF EXISTS "comments_read_all_authenticated" ON nomination_comments;
CREATE POLICY "comments_read_all_authenticated" ON nomination_comments
  FOR SELECT USING (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
  );

-- You may write as yourself, on an approved recognition, and that is all.
DROP POLICY IF EXISTS "comments_insert_own" ON nomination_comments;
CREATE POLICY "comments_insert_own" ON nomination_comments
  FOR INSERT WITH CHECK (
    public.session_second_factor_ok()
    AND auth.role() = 'authenticated'
    AND author_id = (auth.jwt()->>'employee_id')::uuid
    AND public.nomination_is_approved(nomination_id)
  );

-- Your own, or a moderator's removal.
DROP POLICY IF EXISTS "comments_delete_own_or_moderator" ON nomination_comments;
CREATE POLICY "comments_delete_own_or_moderator" ON nomination_comments
  FOR DELETE USING (
    public.session_second_factor_ok()
    AND (
      author_id = (auth.jwt()->>'employee_id')::uuid
      OR (auth.jwt()->>'user_role')::text IN ('hr_admin', 'super_admin')
    )
  );

-- No UPDATE policy. See "WHAT IS NOT HERE" above; the omission is the rule.


-- ── 4. The feed carries the count ───────────────────────────
--
-- Same treatment appreciation_count already gets: a subquery on the view, not
-- a stored counter on nominations. A stored counter needs a trigger on insert
-- AND delete, drifts the first time one of them is missed, and buys nothing
-- at this size. The count is correct by construction here.
--
-- CREATE OR REPLACE VIEW can add columns at the END of the list, which is why
-- comment_count goes last and every column above it is reproduced exactly as
-- 022 left it.

CREATE OR REPLACE VIEW v_recognition_feed AS
SELECT
  n.id,
  n.approved_at,
  n.published_at,
  n.what_happened,
  n.what_impact,
  n.recognition_source,

  nominator.id             AS nominator_id,
  nominator.full_name      AS nominator_name,
  nominator.avatar_url     AS nominator_avatar,

  nominee.id               AS nominee_id,
  nominee.full_name        AS nominee_name,
  nominee.avatar_url       AS nominee_avatar,

  cv.id                    AS core_value_id,
  cv.name                  AS core_value_name,
  cv.accent_color          AS core_value_color,
  cv.icon                  AS core_value_icon,

  COALESCE(n.snapshot_behaviour_name, b.name) AS behaviour_name,
  COALESCE(n.snapshot_scenario_name, s.name)  AS scenario_name,
  COALESCE(n.snapshot_project_name, p.name)   AS project_name,
  n.project_id,

  (SELECT COUNT(*) FROM nomination_appreciations na WHERE na.nomination_id = n.id)::integer AS appreciation_count,
  (SELECT COUNT(*) FROM nomination_comments nc WHERE nc.nomination_id = n.id)::integer      AS comment_count

FROM nominations n
JOIN employees nominator ON n.nominator_id = nominator.id
JOIN employees nominee   ON n.nominee_id = nominee.id
JOIN core_values cv       ON n.core_value_id = cv.id
LEFT JOIN behaviours b    ON n.behaviour_id = b.id
LEFT JOIN scenarios s     ON n.scenario_id = s.id
LEFT JOIN projects p      ON n.project_id = p.id

WHERE n.status = 'approved'
  AND public.session_second_factor_ok();

GRANT SELECT ON v_recognition_feed TO authenticated;


-- ── 5. The two people are told ──────────────────────────────

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
    'recognition_commented'
  ));

/*
  Who hears about a comment.

  The nominee and the nominator — the two people the recognition is about —
  and never the person who just wrote it. Nobody else: not previous
  commenters, because a busy thread would then notify everyone who ever
  touched it, and not approvers, whose involvement ended at the decision.

  A trigger rather than a second write from the browser. The notification is
  part of what it MEANS to comment, and a client that inserts the comment and
  then fails to insert the notification leaves a remark nobody is told about.

  SECURITY DEFINER because the author is writing rows addressed to other
  people, which notifications_own quite correctly forbids them to do directly.
*/
CREATE OR REPLACE FUNCTION public.notify_recognition_commented()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  nom         RECORD;
  author_name TEXT;
  preview     TEXT;
BEGIN
  SELECT n.nominee_id, n.nominator_id, nominee.full_name AS nominee_name
    INTO nom
    FROM nominations n
    JOIN employees nominee ON nominee.id = n.nominee_id
   WHERE n.id = NEW.nomination_id;

  SELECT full_name INTO author_name FROM employees WHERE id = NEW.author_id;
  author_name := COALESCE(author_name, 'Someone');

  -- Enough of the comment to decide whether to go and read it.
  preview := CASE
    WHEN char_length(btrim(NEW.body)) > 120
      THEN left(btrim(NEW.body), 117) || '...'
    ELSE btrim(NEW.body)
  END;

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

DROP TRIGGER IF EXISTS trg_notify_recognition_commented ON nomination_comments;
CREATE TRIGGER trg_notify_recognition_commented
  AFTER INSERT ON nomination_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_recognition_commented();


-- ── 6. Erasure takes the comments with it ───────────────────
--
-- author_id references employees with no ON DELETE action, so the moment this
-- table has a row, `DELETE FROM employees` fails on the constraint — and that
-- is the last statement of purge_employee() (035, fixed in 037). Erasing
-- somebody would start, delete their nominations, badges and memberships, and
-- then abort on a foreign key.
--
-- A trigger rather than a fourth copy of purge_employee(). That function is
-- two hundred lines of ordered deletions and reproducing it to add one more
-- would put every other line at risk of being transcribed wrongly; worse, the
-- next erasure path added would have to remember this table again. A BEFORE
-- DELETE trigger on employees is true of every path by construction.
--
-- Comments on a recognition the person RECEIVED or GAVE need no handling
-- here: those nominations are deleted by the purge and the cascade on
-- nomination_id takes their comments.

CREATE OR REPLACE FUNCTION public.erase_employee_comments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  DELETE FROM nomination_comments WHERE author_id = OLD.id;
  RETURN OLD;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_erase_employee_comments ON employees;
CREATE TRIGGER trg_erase_employee_comments
  BEFORE DELETE ON employees
  FOR EACH ROW EXECUTE FUNCTION public.erase_employee_comments();
