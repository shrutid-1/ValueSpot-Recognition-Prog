# Touchcore ValueSpot — Acceptance Criteria

## Definition of Done

A feature is complete when:
1. It functions correctly with real database data
2. RLS is enforced (tested with wrong-role JWT)
3. Empty, loading, and error states are handled
4. Mobile and desktop layouts work
5. Accessibility requirements are met
6. No console errors in production build

---

## AC-001: Authentication

| ID | Criterion | Test |
|---|---|---|
| AC-001-01 | Employee can log in with email and password | Login with employee@test.com |
| AC-001-02 | Invalid credentials show human-readable error | Login with wrong password |
| AC-001-03 | Employee can log out | Click logout → session cleared |
| AC-001-04 | Password reset email is sent | Request reset for valid email |
| AC-001-05 | Employee role routes to Employee Dashboard | Login as employee@test.com |
| AC-001-06 | Manager role routes to Manager Dashboard | Login as manager@test.com |
| AC-001-07 | HR Admin routes to HR Dashboard | Login as hr@test.com |
| AC-001-08 | Employee cannot access /hr/* routes | Navigate directly to /hr/dashboard |
| AC-001-09 | Session persists on refresh | Refresh browser → still logged in |
| AC-001-10 | Expired session redirects to login | Use expired token |

---

## AC-002: Recognition Wizard

| ID | Criterion | Test |
|---|---|---|
| AC-002-01 | Employee can search by name | Type "Amit" → results appear |
| AC-002-02 | Employee can search by department | Filter by Engineering |
| AC-002-03 | Employee cannot select themselves | Own name shown → select → error |
| AC-002-04 | All 5 Core Values display with correct names and colours | View Step 2 |
| AC-002-05 | Selecting a Core Value loads correct behaviours | Select Collaborative → see 7 behaviours |
| AC-002-06 | Selecting a behaviour loads relevant scenarios | Select behaviour → see scenarios |
| AC-002-07 | "Other" option available for behaviour | Visible in behaviour list |
| AC-002-08 | Recognition story fields are required | Submit empty → validation error |
| AC-002-09 | Preview shows all selected values | Complete wizard → check Step 6 |
| AC-002-10 | Submission creates database record | Submit → check nominations table |
| AC-002-11 | Idempotency key prevents double submit | Double-click submit → 1 record |
| AC-002-12 | Correct manager identified as approver | Check nominations.assigned_approver_id |
| AC-002-13 | Success state shown after submission | Submit → "Recognition submitted" |
| AC-002-14 | Rate limit prevents >5/day | Submit 6th → error message |
| AC-002-15 | Project tag is optional but stored | Complete with/without project |

---

## AC-003: Approval Workflow

| ID | Criterion | Test |
|---|---|---|
| AC-003-01 | Manager sees pending nominations in queue | Login as manager → check approvals |
| AC-003-02 | Manager can approve a nomination | Click Approve → status = approved |
| AC-003-03 | Approval publishes to recognition feed | Approve → check feed |
| AC-003-04 | Manager can request clarification | Click Clarify → nominator notified |
| AC-003-05 | Nominator can respond to clarification | Update → nomination back to pending |
| AC-003-06 | Manager can reject with reason | Reject + reason → status = rejected |
| AC-003-07 | Rejection reason NOT shown to employee | Login as employee → cannot see reason |
| AC-003-08 | Rejected nominations retained in DB | Check nominations table |
| AC-003-09 | Manager cannot approve own nomination | Self-nomination → escalated |
| AC-003-10 | Escalation routes to next-level manager | Nominee = approver → escalate |
| AC-003-11 | Missing manager routes to HR fallback | Employee with no manager → HR gets it |

---

## AC-004: Recognition Feed

| ID | Criterion | Test |
|---|---|---|
| AC-004-01 | Only approved recognitions appear in feed | Pending/rejected NOT in feed |
| AC-004-02 | Feed shows: nominator, nominee, Core Value, text, date | View feed card |
| AC-004-03 | Employee can appreciate a recognition | Click Appreciate → count increments |
| AC-004-04 | Feed is paginated | Scroll → more load |
| AC-004-05 | Employee can view their own recognition history | My Recognitions page |
| AC-004-06 | Recognitions from archived Core Values still show | Archive a CV → historical feed intact |

---

## AC-005: Badge System

| ID | Criterion | Test |
|---|---|---|
| AC-005-01 | 1 recognition = B1 Cheers | Approve 1st recognition → badge = B1 |
| AC-005-02 | 2 recognitions = B1 Cheers (still) | Approve 2nd → badge stays B1 |
| AC-005-03 | 3 recognitions = B2 Applause | Approve 3rd → badge upgrades to B2 |
| AC-005-04 | 5 recognitions = B2 Applause (still) | 5 total → badge stays B2 |
| AC-005-05 | 6 recognitions = B3 Kudos | 6th → B3 |
| AC-005-06 | 10 recognitions = B3 Kudos (still) | 10 total → stays B3 |
| AC-005-07 | 11 recognitions = B4 Spotlight | 11th → B4 |
| AC-005-08 | 15 recognitions = B4 Spotlight (still) | 15 total → stays B4 |
| AC-005-09 | 16 recognitions = B5 Value Ambassador | 16th → B5 |
| AC-005-10 | 50 recognitions = B5 (no downgrade) | 50 total → stays B5 |
| AC-005-11 | Badges are per Core Value (not combined) | Collab=B5, Innovative=B2 simultaneously |
| AC-005-12 | Rejected recognitions do NOT count | Reject a nomination → count unchanged |
| AC-005-13 | Draft/pending do NOT count | Pending → badge not updated yet |
| AC-005-14 | Badge history stored on each level change | Check badge_history table |
| AC-005-15 | Badge does not downgrade in same period | High count then no activity → stays |
| AC-005-16 | Badge thresholds come from DB, not frontend | Change threshold in DB → recalculates |
| AC-005-17 | Multiple employees can have same badge level | Not exclusive |
| AC-005-18 | Unique recognizer count is tracked | Check unique_recognizer_count |

---

## AC-006: Notifications

| ID | Criterion | Test |
|---|---|---|
| AC-006-01 | Manager notified when nomination assigned | Submit → manager gets notification |
| AC-006-02 | Nominator notified when approved | Approve → nominator gets notification |
| AC-006-03 | Nominee notified when recognition approved | Approve → nominee notified |
| AC-006-04 | Nominator notified on clarification request | Clarify → nominator notified |
| AC-006-05 | Nominator notified on rejection | Reject → nominator notified |
| AC-006-06 | Employee notified on badge unlock | New badge level → badge notification |
| AC-006-07 | Notification shows as unread | Check notification center |
| AC-006-08 | Mark as read works | Click notification → marked read |
| AC-006-09 | Mark all as read works | Mark all → all read |
| AC-006-10 | Notification count shows in top bar | Unread count visible |

---

## AC-007: Analytics

| ID | Criterion | Test |
|---|---|---|
| AC-007-01 | HR Dashboard metrics reflect real DB data | Add recognition → count increases |
| AC-007-02 | Total Recognitions count is correct | Count approved in DB vs dashboard |
| AC-007-03 | Recognition Coverage % calculates correctly | Recognized / active employees × 100 |
| AC-007-04 | Daily leaders show correct employees | Check approved today vs leaders shown |
| AC-007-05 | Monthly leaders calculate correctly | Filter by month → verify counts |
| AC-007-06 | Quarterly leaders use correct quarter dates | Q1=Apr-Jun in India FY |
| AC-007-07 | Annual leaders calculate with tie-breaking | Create tie scenario → verify resolution |
| AC-007-08 | Employee cannot access HR analytics | Login as employee → /hr/* blocked |
| AC-007-09 | Badge distribution shows real distribution | Add badges → chart updates |
| AC-007-10 | Cross-team recognition % is correct | Check cross-dept nominations |

---

## AC-008: Reports

| ID | Criterion | Test |
|---|---|---|
| AC-008-01 | Monthly report generates with real data | Generate Sept 2026 report |
| AC-008-02 | Quarterly report uses correct dates | Q2 = July–September |
| AC-008-03 | Annual report generates full sections | Generate 2026 annual report |
| AC-008-04 | Filters reduce report scope | Filter by Engineering dept |
| AC-008-05 | CSV export downloads with correct data | Export → open in Excel → verify |
| AC-008-06 | XLSX export downloads correctly | Export → open in Excel |
| AC-008-07 | Export respects active filters | Filter then export → only filtered data |
| AC-008-08 | Export does not include unauthorized data | Employee tries to export → blocked |

---

## AC-009: Anti-Gaming & Data Integrity

| ID | Criterion | Test |
|---|---|---|
| AC-009-01 | Anti-gaming rule prevents double-approval | Priya recognizes Amit twice for Collab in 30 days → 2nd stays pending |
| AC-009-02 | Different nominators CAN recognize same person | Priya AND Kavya both recognize Amit → both can be approved |
| AC-009-03 | Rate limit enforced server-side | Call Edge Function directly → still blocked |
| AC-009-04 | Self-recognition blocked at DB level | INSERT with nominator=nominee → constraint fails |
| AC-009-05 | Reciprocal pattern flagged for HR | Pattern detected → flag created in DB |
| AC-009-06 | Reciprocal flag NOT visible to employee | Login as employee → flag not surfaced |

---

## AC-010: Historical Data Integrity

| ID | Criterion | Test |
|---|---|---|
| AC-010-01 | Changing employee's manager doesn't change old recognition's approver snapshot | Change manager → check old nomination.snapshot_nominee_manager_id |
| AC-010-02 | Archiving a Core Value doesn't remove historical recognitions | Archive CV → feed still shows old recognitions |
| AC-010-03 | Deactivating employee doesn't delete their recognition history | Deactivate → recognitions still in feed |
| AC-010-04 | Archiving a behaviour preserves recognition text | Archive behaviour → nomination still shows snapshot_behaviour_name |
| AC-010-05 | Project membership history is preserved | Remove from project → old recognitions still show project |

---

## AC-011: Security

| ID | Criterion | Test |
|---|---|---|
| AC-011-01 | Employee cannot read other employees' private nominations | Direct API call with employee JWT |
| AC-011-02 | Employee cannot access rejected nomination details for self | API call for own rejected nominations |
| AC-011-03 | Manager cannot approve nominations outside their team | API call with manager JWT for other team nomination |
| AC-011-04 | No data returned when RLS denies access | Query nominations as wrong user → empty result |
| AC-011-05 | Service role key is not in any frontend file | Search codebase for SUPABASE_SERVICE_ROLE_KEY |
| AC-011-06 | Audit logs not readable by employee | API call for audit_logs with employee JWT → empty |
| AC-011-07 | Reciprocal flags not readable by employee | API call for flags with employee JWT → empty |

---

## AC-012: UX & Accessibility

| ID | Criterion | Test |
|---|---|---|
| AC-012-01 | Empty states shown when no data | New employee → all empty states shown |
| AC-012-02 | Skeleton loaders shown while data loads | Throttle network → loaders appear |
| AC-012-03 | Human-readable error messages shown | Break API → friendly error shown |
| AC-012-04 | Form validation messages are descriptive | Submit empty form |
| AC-012-05 | Keyboard navigation works throughout | Tab through recognition wizard |
| AC-012-06 | Focus states are visible | Tab key → focus ring visible |
| AC-012-07 | Mobile layout works for recognition wizard | Test on 375px viewport |
| AC-012-08 | Form fields have proper labels | Check aria-label / htmlFor |
| AC-012-09 | Colour is not the only differentiator | Core Values have text labels, not just colours |

---

## Test Accounts (Development)

| Email | Password | Role |
|---|---|---|
| employee@test.com | Test@1234 | employee |
| manager@test.com | Test@1234 | manager |
| hr@test.com | Test@1234 | hr_admin |
| admin@test.com | Test@1234 | super_admin |

These accounts must exist in seed data. Do not expose in production.
