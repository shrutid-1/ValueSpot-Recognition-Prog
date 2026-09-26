-- ============================================================
-- DEVELOPMENT SEED DATA ONLY — demo nominations
-- Provides enough data to demonstrate:
--   badge progression, monthly/quarterly/annual reports,
--   Core Value leaders, badge distribution, feed
-- All dates are in 2026 (current demo year)
-- ============================================================

-- Helper: we reference behaviour IDs by looking them up inline
-- All nominations are pre-approved to populate analytics immediately

DO $$
DECLARE
  cv_adaptable     UUID;
  cv_transparent   UUID;
  cv_collaborative UUID;
  cv_innovative    UUID;
  cv_accountable   UUID;

  b_adapts_client  UUID;
  b_learns_tools   UUID;
  b_shares_info    UUID;
  b_owns_mistakes  UUID;
  b_supports_coll  UUID;
  b_shares_know    UUID;
  b_cross_team     UUID;
  b_new_solutions  UUID;
  b_automates      UUID;
  b_delivers       UUID;
  b_takes_resp     UUID;
  b_escalates      UUID;

BEGIN
  SELECT id INTO cv_adaptable     FROM core_values WHERE slug = 'adaptable';
  SELECT id INTO cv_transparent   FROM core_values WHERE slug = 'transparent';
  SELECT id INTO cv_collaborative FROM core_values WHERE slug = 'collaborative';
  SELECT id INTO cv_innovative    FROM core_values WHERE slug = 'innovative';
  SELECT id INTO cv_accountable   FROM core_values WHERE slug = 'accountable';

  SELECT id INTO b_adapts_client FROM behaviours WHERE name = 'Quickly adapts to changing client requirements' LIMIT 1;
  SELECT id INTO b_learns_tools  FROM behaviours WHERE name = 'Learns new tools or processes' LIMIT 1;
  SELECT id INTO b_shares_info   FROM behaviours WHERE name = 'Shares important information proactively' LIMIT 1;
  SELECT id INTO b_owns_mistakes FROM behaviours WHERE name = 'Owns mistakes' LIMIT 1;
  SELECT id INTO b_supports_coll FROM behaviours WHERE name = 'Supports colleagues' LIMIT 1;
  SELECT id INTO b_shares_know   FROM behaviours WHERE name = 'Shares knowledge' LIMIT 1;
  SELECT id INTO b_cross_team    FROM behaviours WHERE name = 'Helps solve cross-functional problems' LIMIT 1;
  SELECT id INTO b_new_solutions FROM behaviours WHERE name = 'Introduces new solutions' LIMIT 1;
  SELECT id INTO b_automates     FROM behaviours WHERE name = 'Automates repetitive work' LIMIT 1;
  SELECT id INTO b_delivers      FROM behaviours WHERE name = 'Delivers on commitments' LIMIT 1;
  SELECT id INTO b_takes_resp    FROM behaviours WHERE name = 'Takes responsibility for mistakes' LIMIT 1;
  SELECT id INTO b_escalates     FROM behaviours WHERE name = 'Escalates risks appropriately' LIMIT 1;

  -- =====================================================
  -- Amit (TC006) — Heavy Collaborative recognition (B5)
  -- =====================================================
  INSERT INTO nominations (nominator_id, nominee_id, core_value_id, behaviour_id, what_happened, what_impact, project_id,
    snapshot_nominator_dept, snapshot_nominee_dept, snapshot_nominee_manager_id, snapshot_core_value_name, snapshot_behaviour_name, snapshot_project_name,
    recognition_source, status, assigned_approver_id, approved_by_id, approved_at, published_at, submitted_at, idempotency_key)
  VALUES
    ('emp-0007-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_cross_team,
     'Amit stayed back on Thursday to help us resolve the client API integration issue that was blocking the entire launch.',
     'We were able to deliver on time and the client rated the integration as excellent in their feedback.',
     'proj-0001-0000-0000-000000000001','Engineering','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Helps solve cross-functional problems','ABC Client Portal',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-01-15T10:00:00Z','2026-01-15T10:01:00Z','2026-01-15T09:50:00Z', gen_random_uuid()),

    ('emp-0008-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_supports_coll,
     'Amit spent two hours helping me understand the new deployment pipeline when I joined the project.',
     'I was productive within days instead of weeks because of his patient knowledge sharing.',
     'proj-0002-0000-0000-000000000001','Product','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Supports colleagues','Internal Platform v2',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-01-28T11:00:00Z','2026-01-28T11:01:00Z','2026-01-28T10:50:00Z', gen_random_uuid()),

    ('emp-0009-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_shares_know,
     'Amit documented the entire authentication flow for the team and ran a knowledge sharing session.',
     'Three new team members were able to contribute independently within their first sprint.',
     NULL,'Product','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Shares knowledge',NULL,
     'peer','approved','emp-0004-0000-0000-000000000001','emp-0004-0000-0000-000000000001',
     '2026-02-10T09:00:00Z','2026-02-10T09:01:00Z','2026-02-10T08:50:00Z', gen_random_uuid()),

    ('emp-0010-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_cross_team,
     'Amit jumped on a call with our client services team to debug an integration issue even though it was outside his sprint.',
     'The client issue was resolved same day and we avoided an escalation.',
     'proj-0003-0000-0000-000000000001','Client Services','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Helps solve cross-functional problems','XYZ Analytics Dashboard',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-02-22T14:00:00Z','2026-02-22T14:01:00Z','2026-02-22T13:50:00Z', gen_random_uuid()),

    ('emp-0011-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_supports_coll,
     'Amit helped me with my first code review and gave very constructive, specific feedback.',
     'My PR quality improved significantly and I felt supported as a new team member.',
     NULL,'Client Services','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Supports colleagues',NULL,
     'peer','approved','emp-0005-0000-0000-000000000001','emp-0005-0000-0000-000000000001',
     '2026-03-05T10:00:00Z','2026-03-05T10:01:00Z','2026-03-05T09:50:00Z', gen_random_uuid()),

    ('emp-0012-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_cross_team,
     'Amit volunteered to help the product team understand technical constraints during sprint planning.',
     'We avoided two design directions that would have caused rework later in the sprint.',
     'proj-0002-0000-0000-000000000001','Engineering','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Helps solve cross-functional problems','Internal Platform v2',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-03-18T11:00:00Z','2026-03-18T11:01:00Z','2026-03-18T10:50:00Z', gen_random_uuid()),

    ('emp-0003-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_supports_coll,
     'Amit took on mentoring responsibilities for two junior engineers without being asked.',
     'Both engineers are now contributing independently and the team velocity has improved.',
     NULL,'Engineering','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Supports colleagues',NULL,
     'manager','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-04-02T09:00:00Z','2026-04-02T09:01:00Z','2026-04-02T08:50:00Z', gen_random_uuid()),

    ('emp-0013-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_cross_team,
     'Amit helped the HR team understand how to automate their onboarding checklist using our internal tools.',
     'Onboarding time for new employees reduced by 30%.',
     'proj-0005-0000-0000-000000000001','Operations','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Helps solve cross-functional problems','HR Digital Transformation',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-04-14T10:00:00Z','2026-04-14T10:01:00Z','2026-04-14T09:50:00Z', gen_random_uuid()),

    ('emp-0014-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_shares_know,
     'Amit ran a cross-team brown-bag session on API best practices that benefited the entire engineering org.',
     'Multiple teams started applying the patterns and we saw fewer integration bugs.',
     NULL,'Sales','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Shares knowledge',NULL,
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-05-01T11:00:00Z','2026-05-01T11:01:00Z','2026-05-01T10:50:00Z', gen_random_uuid()),

    ('emp-0015-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_supports_coll,
     'When Pooja was overwhelmed with the release deadline, Amit stepped in and pair-programmed for two days.',
     'The feature shipped on time and Pooja felt genuinely supported.',
     'proj-0001-0000-0000-000000000001','Engineering','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Supports colleagues','ABC Client Portal',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-05-20T09:00:00Z','2026-05-20T09:01:00Z','2026-05-20T08:50:00Z', gen_random_uuid()),

    ('emp-0016-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_cross_team,
     'Amit spent a full day helping the product team write acceptance criteria for a complex feature.',
     'The feature was delivered with zero rework because the requirements were crystal clear.',
     'proj-0004-0000-0000-000000000001','Product','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Helps solve cross-functional problems','DEF Mobile App',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-06-08T10:00:00Z','2026-06-08T10:01:00Z','2026-06-08T09:50:00Z', gen_random_uuid()),

    ('emp-0017-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_supports_coll,
     'Amit onboarded Sneha to the codebase in record time, spending evenings answering questions.',
     'Sneha shipped her first independent feature within 3 weeks of joining.',
     NULL,'Client Services','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Supports colleagues',NULL,
     'peer','approved','emp-0005-0000-0000-000000000001','emp-0005-0000-0000-000000000001',
     '2026-06-25T11:00:00Z','2026-06-25T11:01:00Z','2026-06-25T10:50:00Z', gen_random_uuid()),

    ('emp-0018-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_cross_team,
     'Amit collaborated with the operations team to design the data model for the new HR tools.',
     'The model has been extensible and we have not needed to refactor it in six months.',
     'proj-0005-0000-0000-000000000001','Operations','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Helps solve cross-functional problems','HR Digital Transformation',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-07-10T09:00:00Z','2026-07-10T09:01:00Z','2026-07-10T08:50:00Z', gen_random_uuid()),

    ('emp-0019-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_shares_know,
     'Amit set up a team wiki for the engineering team documenting all architectural decisions.',
     'New engineers can now self-serve answers to common questions and we spend less time in meetings.',
     NULL,'Sales','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Shares knowledge',NULL,
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-07-22T10:00:00Z','2026-07-22T10:01:00Z','2026-07-22T09:50:00Z', gen_random_uuid()),

    ('emp-0020-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_cross_team,
     'Amit volunteered to lead the cross-functional review of our API security posture.',
     'We identified and fixed three critical vulnerabilities before any external audit.',
     'proj-0002-0000-0000-000000000001','Engineering','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Helps solve cross-functional problems','Internal Platform v2',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-08-05T11:00:00Z','2026-08-05T11:01:00Z','2026-08-05T10:50:00Z', gen_random_uuid()),

    ('emp-0004-0000-0000-000000000001','emp-0006-0000-0000-000000000001', cv_collaborative, b_supports_coll,
     'Amit regularly volunteers to review code outside his own team, consistently improving quality org-wide.',
     'Code review turnaround across the engineering org has improved by 40%.',
     NULL,'Product','Engineering','emp-0003-0000-0000-000000000001','Collaborative','Supports colleagues',NULL,
     'manager','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-08-18T09:00:00Z','2026-08-18T09:01:00Z','2026-08-18T08:50:00Z', gen_random_uuid())

  ON CONFLICT (idempotency_key) DO NOTHING;

  -- =====================================================
  -- Priya (TC007) — Accountable recognition (B3 = 8)
  -- =====================================================
  INSERT INTO nominations (nominator_id, nominee_id, core_value_id, behaviour_id, what_happened, what_impact,
    snapshot_nominator_dept, snapshot_nominee_dept, snapshot_nominee_manager_id, snapshot_core_value_name, snapshot_behaviour_name,
    recognition_source, status, assigned_approver_id, approved_by_id, approved_at, published_at, submitted_at, idempotency_key)
  VALUES
    ('emp-0006-0000-0000-000000000001','emp-0007-0000-0000-000000000001', cv_accountable, b_delivers,
     'Priya committed to completing the migration script by Friday and delivered it Wednesday, ahead of schedule.',
     'We had two extra days of testing buffer which meant a smooth go-live.',
     'Engineering','Engineering','emp-0003-0000-0000-000000000001','Accountable','Delivers on commitments',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-02-14T10:00:00Z','2026-02-14T10:01:00Z','2026-02-14T09:50:00Z', gen_random_uuid()),

    ('emp-0012-0000-0000-000000000001','emp-0007-0000-0000-000000000001', cv_accountable, b_takes_resp,
     'When a bug was found in production, Priya immediately owned it, communicated to stakeholders, and had a fix deployed within the hour.',
     'The incident was resolved before most users noticed. Transparency and speed were exceptional.',
     'Engineering','Engineering','emp-0003-0000-0000-000000000001','Accountable','Takes responsibility for mistakes',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-03-01T11:00:00Z','2026-03-01T11:01:00Z','2026-03-01T10:50:00Z', gen_random_uuid()),

    ('emp-0003-0000-0000-000000000001','emp-0007-0000-0000-000000000001', cv_accountable, b_escalates,
     'Priya flagged a critical dependency risk two weeks before it would have blocked the sprint.',
     'We re-prioritized in time and the sprint was unaffected.',
     'Engineering','Engineering','emp-0003-0000-0000-000000000001','Accountable','Escalates risks appropriately',
     'manager','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-04-10T09:00:00Z','2026-04-10T09:01:00Z','2026-04-10T08:50:00Z', gen_random_uuid()),

    ('emp-0015-0000-0000-000000000001','emp-0007-0000-0000-000000000001', cv_accountable, b_delivers,
     'Priya took over a partially completed feature when a colleague went on leave and delivered it on time.',
     'No sprint commitment was missed despite the unexpected team change.',
     'Engineering','Engineering','emp-0003-0000-0000-000000000001','Accountable','Delivers on commitments',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-05-12T10:00:00Z','2026-05-12T10:01:00Z','2026-05-12T09:50:00Z', gen_random_uuid()),

    ('emp-0008-0000-0000-000000000001','emp-0007-0000-0000-000000000001', cv_accountable, b_takes_resp,
     'A data issue caused incorrect reports for two clients. Priya identified it, owned the fix, and personally called each client to explain.',
     'Both clients were impressed by the transparency and said it strengthened their trust in us.',
     'Product','Engineering','emp-0003-0000-0000-000000000001','Accountable','Takes responsibility for mistakes',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-06-03T11:00:00Z','2026-06-03T11:01:00Z','2026-06-03T10:50:00Z', gen_random_uuid()),

    ('emp-0020-0000-0000-000000000001','emp-0007-0000-0000-000000000001', cv_accountable, b_delivers,
     'Priya led the end-to-end delivery of the Q2 release while the team was understaffed.',
     'All committed features shipped and client satisfaction scores were the highest this year.',
     'Engineering','Engineering','emp-0003-0000-0000-000000000001','Accountable','Delivers on commitments',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-07-01T09:00:00Z','2026-07-01T09:01:00Z','2026-07-01T08:50:00Z', gen_random_uuid()),

    ('emp-0009-0000-0000-000000000001','emp-0007-0000-0000-000000000001', cv_accountable, b_escalates,
     'Priya raised a compliance risk she noticed in the new feature design before development started.',
     'We avoided a potential GDPR issue that would have required emergency patching.',
     'Product','Engineering','emp-0003-0000-0000-000000000001','Accountable','Escalates risks appropriately',
     'peer','approved','emp-0004-0000-0000-000000000001','emp-0004-0000-0000-000000000001',
     '2026-07-20T10:00:00Z','2026-07-20T10:01:00Z','2026-07-20T09:50:00Z', gen_random_uuid()),

    ('emp-0013-0000-0000-000000000001','emp-0007-0000-0000-000000000001', cv_accountable, b_delivers,
     'Priya completed the quarterly data audit two days early and documented her methodology for the team.',
     'Future audits will take half the time because of her documentation.',
     'Operations','Engineering','emp-0003-0000-0000-000000000001','Accountable','Delivers on commitments',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-08-10T11:00:00Z','2026-08-10T11:01:00Z','2026-08-10T10:50:00Z', gen_random_uuid())

  ON CONFLICT (idempotency_key) DO NOTHING;

  -- =====================================================
  -- Kavya (TC008) — Innovative recognition (B2 = 4)
  -- =====================================================
  INSERT INTO nominations (nominator_id, nominee_id, core_value_id, behaviour_id, what_happened, what_impact,
    snapshot_nominator_dept, snapshot_nominee_dept, snapshot_nominee_manager_id, snapshot_core_value_name, snapshot_behaviour_name,
    recognition_source, status, assigned_approver_id, approved_by_id, approved_at, published_at, submitted_at, idempotency_key)
  VALUES
    ('emp-0006-0000-0000-000000000001','emp-0008-0000-0000-000000000001', cv_innovative, b_automates,
     'Kavya automated the weekly status report generation that was taking the team three hours every Monday.',
     'We saved 12 person-hours per week immediately and morale improved noticeably.',
     'Engineering','Product','emp-0004-0000-0000-000000000001','Innovative','Automates repetitive work',
     'peer','approved','emp-0004-0000-0000-000000000001','emp-0004-0000-0000-000000000001',
     '2026-03-12T09:00:00Z','2026-03-12T09:01:00Z','2026-03-12T08:50:00Z', gen_random_uuid()),

    ('emp-0009-0000-0000-000000000001','emp-0008-0000-0000-000000000001', cv_innovative, b_new_solutions,
     'Kavya proposed using a completely different data visualisation approach for the client dashboard that made it 5x faster to load.',
     'Client retention for that product increased in the following quarter.',
     'Product','Product','emp-0004-0000-0000-000000000001','Innovative','Introduces new solutions',
     'peer','approved','emp-0004-0000-0000-000000000001','emp-0004-0000-0000-000000000001',
     '2026-05-08T10:00:00Z','2026-05-08T10:01:00Z','2026-05-08T09:50:00Z', gen_random_uuid()),

    ('emp-0004-0000-0000-000000000001','emp-0008-0000-0000-000000000001', cv_innovative, b_automates,
     'Kavya built a reusable test data generator that the QA team had been requesting for two years.',
     'Test environment setup time dropped from 4 hours to 10 minutes.',
     'Product','Product','emp-0004-0000-0000-000000000001','Innovative','Automates repetitive work',
     'manager','approved','emp-0004-0000-0000-000000000001','emp-0004-0000-0000-000000000001',
     '2026-06-22T11:00:00Z','2026-06-22T11:01:00Z','2026-06-22T10:50:00Z', gen_random_uuid()),

    ('emp-0016-0000-0000-000000000001','emp-0008-0000-0000-000000000001', cv_innovative, b_new_solutions,
     'Kavya introduced component-driven design to the frontend team and ran a workshop to get everyone aligned.',
     'UI consistency improved significantly and development speed increased in subsequent sprints.',
     'Product','Product','emp-0004-0000-0000-000000000001','Innovative','Introduces new solutions',
     'peer','approved','emp-0004-0000-0000-000000000001','emp-0004-0000-0000-000000000001',
     '2026-08-01T09:00:00Z','2026-08-01T09:01:00Z','2026-08-01T08:50:00Z', gen_random_uuid())

  ON CONFLICT (idempotency_key) DO NOTHING;

  -- =====================================================
  -- Rahul (TC012) — Adaptable recognition (B1 = 2)
  -- =====================================================
  INSERT INTO nominations (nominator_id, nominee_id, core_value_id, behaviour_id, what_happened, what_impact,
    snapshot_nominator_dept, snapshot_nominee_dept, snapshot_nominee_manager_id, snapshot_core_value_name, snapshot_behaviour_name,
    recognition_source, status, assigned_approver_id, approved_by_id, approved_at, published_at, submitted_at, idempotency_key)
  VALUES
    ('emp-0003-0000-0000-000000000001','emp-0012-0000-0000-000000000001', cv_adaptable, b_adapts_client,
     'Rahul was moved from one client project to a completely different tech stack mid-sprint with just two days notice.',
     'He was contributing meaningfully within his first day on the new project.',
     'Engineering','Engineering','emp-0003-0000-0000-000000000001','Adaptable','Quickly adapts to changing client requirements',
     'manager','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-04-18T10:00:00Z','2026-04-18T10:01:00Z','2026-04-18T09:50:00Z', gen_random_uuid()),

    ('emp-0015-0000-0000-000000000001','emp-0012-0000-0000-000000000001', cv_adaptable, b_learns_tools,
     'Rahul taught himself Kubernetes over a weekend because the project required it and we had no one else available.',
     'We did not need to bring in a contractor and the deployment went live on schedule.',
     'Engineering','Engineering','emp-0003-0000-0000-000000000001','Adaptable','Learns new tools or processes',
     'peer','approved','emp-0003-0000-0000-000000000001','emp-0003-0000-0000-000000000001',
     '2026-06-14T11:00:00Z','2026-06-14T11:01:00Z','2026-06-14T10:50:00Z', gen_random_uuid())

  ON CONFLICT (idempotency_key) DO NOTHING;

  -- =====================================================
  -- Deepak (TC010) — Transparent recognition (B1 = 1)
  -- =====================================================
  INSERT INTO nominations (nominator_id, nominee_id, core_value_id, behaviour_id, what_happened, what_impact,
    snapshot_nominator_dept, snapshot_nominee_dept, snapshot_nominee_manager_id, snapshot_core_value_name, snapshot_behaviour_name,
    recognition_source, status, assigned_approver_id, approved_by_id, approved_at, published_at, submitted_at, idempotency_key)
  VALUES
    ('emp-0011-0000-0000-000000000001','emp-0010-0000-0000-000000000001', cv_transparent, b_shares_info,
     'Deepak proactively shared a risk he identified with the client team before it was raised in a review.',
     'The client appreciated the heads up and we were able to adjust scope together rather than scrambling.',
     'Client Services','Client Services','emp-0005-0000-0000-000000000001','Transparent','Shares important information proactively',
     'peer','approved','emp-0005-0000-0000-000000000001','emp-0005-0000-0000-000000000001',
     '2026-05-25T09:00:00Z','2026-05-25T09:01:00Z','2026-05-25T08:50:00Z', gen_random_uuid())

  ON CONFLICT (idempotency_key) DO NOTHING;

  -- =====================================================
  -- Ananya (TC011) — Innovative (B2 = 3) + Accountable (B1 = 1)
  -- =====================================================
  INSERT INTO nominations (nominator_id, nominee_id, core_value_id, behaviour_id, what_happened, what_impact,
    snapshot_nominator_dept, snapshot_nominee_dept, snapshot_nominee_manager_id, snapshot_core_value_name, snapshot_behaviour_name,
    recognition_source, status, assigned_approver_id, approved_by_id, approved_at, published_at, submitted_at, idempotency_key)
  VALUES
    ('emp-0010-0000-0000-000000000001','emp-0011-0000-0000-000000000001', cv_innovative, b_new_solutions,
     'Ananya proposed using webhooks instead of polling for the real-time notifications feature.',
     'Server load dropped by 60% and response time improved dramatically.',
     'Client Services','Client Services','emp-0005-0000-0000-000000000001','Innovative','Introduces new solutions',
     'peer','approved','emp-0005-0000-0000-000000000001','emp-0005-0000-0000-000000000001',
     '2026-03-28T10:00:00Z','2026-03-28T10:01:00Z','2026-03-28T09:50:00Z', gen_random_uuid()),

    ('emp-0017-0000-0000-000000000001','emp-0011-0000-0000-000000000001', cv_innovative, b_automates,
     'Ananya automated the client onboarding checklist that was previously done manually in spreadsheets.',
     'Onboarding time reduced from 3 days to 4 hours.',
     'Client Services','Client Services','emp-0005-0000-0000-000000000001','Innovative','Automates repetitive work',
     'peer','approved','emp-0005-0000-0000-000000000001','emp-0005-0000-0000-000000000001',
     '2026-05-15T11:00:00Z','2026-05-15T11:01:00Z','2026-05-15T10:50:00Z', gen_random_uuid()),

    ('emp-0005-0000-0000-000000000001','emp-0011-0000-0000-000000000001', cv_innovative, b_new_solutions,
     'Ananya introduced a client health scoring model that helps us identify at-risk clients before they escalate.',
     'We reduced client churn by proactively addressing issues identified by the model.',
     'Client Services','Client Services','emp-0005-0000-0000-000000000001','Innovative','Introduces new solutions',
     'manager','approved','emp-0005-0000-0000-000000000001','emp-0005-0000-0000-000000000001',
     '2026-07-12T09:00:00Z','2026-07-12T09:01:00Z','2026-07-12T08:50:00Z', gen_random_uuid()),

    ('emp-0006-0000-0000-000000000001','emp-0011-0000-0000-000000000001', cv_accountable, b_delivers,
     'Ananya took full ownership of the XYZ client deliverable when the account manager was on leave.',
     'The client received everything on time and gave us a glowing review.',
     'Engineering','Client Services','emp-0005-0000-0000-000000000001','Accountable','Delivers on commitments',
     'peer','approved','emp-0005-0000-0000-000000000001','emp-0005-0000-0000-000000000001',
     '2026-08-15T10:00:00Z','2026-08-15T10:01:00Z','2026-08-15T09:50:00Z', gen_random_uuid())

  ON CONFLICT (idempotency_key) DO NOTHING;

  -- =====================================================
  -- Pending nomination — for testing approval flow
  -- =====================================================
  INSERT INTO nominations (nominator_id, nominee_id, core_value_id, behaviour_id, what_happened, what_impact,
    snapshot_nominator_dept, snapshot_nominee_dept, snapshot_nominee_manager_id, snapshot_core_value_name, snapshot_behaviour_name,
    recognition_source, status, assigned_approver_id, submitted_at, idempotency_key)
  VALUES
    ('emp-0007-0000-0000-000000000001','emp-0012-0000-0000-000000000001', cv_innovative, b_automates,
     'Rahul built a script that automatically generates release notes from Jira tickets. It used to take 2 hours manually.',
     'Every release now has well-formatted notes without anyone spending time on it.',
     'Engineering','Engineering','emp-0003-0000-0000-000000000001','Innovative','Automates repetitive work',
     'peer','pending','emp-0003-0000-0000-000000000001',
     '2026-08-24T08:00:00Z', gen_random_uuid())

  ON CONFLICT (idempotency_key) DO NOTHING;

END $$;

-- =====================================================
-- Now compute badge state from approved nominations
-- Uses a set-based approach: aggregates first, then
-- matches against badge_definitions thresholds.
-- =====================================================

-- Step 1: Build an aggregation CTE, then join to badge_definitions
WITH recognition_counts AS (
  SELECT
    n.nominee_id                        AS employee_id,
    n.core_value_id,
    COUNT(*)::INTEGER                   AS recognition_count,
    COUNT(DISTINCT n.nominator_id)::INTEGER AS unique_recognizer_count
  FROM nominations n
  WHERE n.status    = 'approved'
    AND n.approved_at >= '2026-01-01'
    AND n.approved_at <  '2027-01-01'
  GROUP BY n.nominee_id, n.core_value_id
),
badge_matches AS (
  SELECT
    rc.employee_id,
    rc.core_value_id,
    rc.recognition_count,
    rc.unique_recognizer_count,
    -- Select the highest badge level whose range includes the count
    (
      SELECT bd.level
      FROM badge_definitions bd
      WHERE bd.is_active = true
        AND rc.recognition_count >= bd.minimum_count
        AND (bd.maximum_count IS NULL OR rc.recognition_count <= bd.maximum_count)
      ORDER BY bd.level DESC
      LIMIT 1
    ) AS badge_level
  FROM recognition_counts rc
)
INSERT INTO employee_value_badges
  (employee_id, core_value_id, period_type, period_start, period_end,
   recognition_count, unique_recognizer_count, badge_level, last_updated)
SELECT
  bm.employee_id,
  bm.core_value_id,
  'annual'::TEXT          AS period_type,
  '2026-01-01'::DATE      AS period_start,
  '2026-12-31'::DATE      AS period_end,
  bm.recognition_count,
  bm.unique_recognizer_count,
  bm.badge_level,
  now()
FROM badge_matches bm
ON CONFLICT (employee_id, core_value_id, period_type, period_start)
DO UPDATE SET
  recognition_count       = EXCLUDED.recognition_count,
  unique_recognizer_count = EXCLUDED.unique_recognizer_count,
  badge_level             = EXCLUDED.badge_level,
  last_updated            = now();

-- Step 2: Insert badge_history records for each earned badge
INSERT INTO badge_history
  (employee_id, core_value_id, previous_level, new_level,
   recognition_count, achieved_at, period_type, period_start, period_end)
SELECT
  evb.employee_id,
  evb.core_value_id,
  NULL                AS previous_level,
  evb.badge_level     AS new_level,
  evb.recognition_count,
  now()               AS achieved_at,
  'annual'            AS period_type,
  evb.period_start,
  evb.period_end
FROM employee_value_badges evb
WHERE evb.period_type   = 'annual'
  AND evb.period_start  = '2026-01-01'
  AND evb.badge_level IS NOT NULL
ON CONFLICT DO NOTHING;
