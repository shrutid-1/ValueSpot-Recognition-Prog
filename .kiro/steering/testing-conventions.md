---
inclusion: always
---

# Touchcore ValueSpot — Testing Conventions

## Testing Philosophy

Test behaviour, not implementation. A test should verify that the system does what users and the product spec require — not that specific internal functions were called.

## What to Test

### Priority 1: Business rules
- Badge calculation logic (all 5 levels, edge cases)
- Anti-gaming rule enforcement
- Rate limiting logic
- Tie-breaking logic for leaders
- Escalation routing logic
- Historical snapshot integrity

### Priority 2: Security
- RLS policies (each role, each table)
- Self-nomination prevention
- Rejection reason privacy

### Priority 3: Integration
- Recognition wizard submission flow (end-to-end)
- Approval flow (end-to-end)
- Badge calculation after approval

### Priority 4: UI
- Form validation messages
- Empty states render correctly
- Loading states render correctly

## Badge Calculation Test Matrix

The following scenarios MUST be tested:

| Recognitions | Expected Badge |
|---|---|
| 0 | No badge |
| 1 | B1 Cheers |
| 2 | B1 Cheers |
| 3 | B2 Applause |
| 5 | B2 Applause |
| 6 | B3 Kudos |
| 10 | B3 Kudos |
| 11 | B4 Spotlight |
| 15 | B4 Spotlight |
| 16 | B5 Value Ambassador |
| 50 | B5 Value Ambassador |

### Multi-value badge test

An employee should simultaneously be able to have:
- Collaborative: B5
- Innovative: B2
- Accountable: B1
- Transparent: No badge
- Adaptable: No badge

These are independent calculations.

### Period independence test

- Annual badge count: uses Jan–Dec (configurable)
- Quarterly analytics: uses FY quarters (Apr/Jul/Oct/Jan)
- These must produce different numbers for the same time range

## Anti-Gaming Test Cases

1. Priya → Amit (Collaborative) — approved ✅
2. Priya → Amit (Collaborative) within 30 days — second should flag, first approver blocks
3. Kavya → Amit (Collaborative) within same 30 days — allowed (different nominator) ✅
4. Priya → Amit (Innovative) within 30 days — allowed (different Core Value) ✅

## RLS Test Pattern

For each sensitive table, test with:
1. Unauthenticated request → 0 rows / 401
2. Employee JWT for own data → correct rows
3. Employee JWT for another employee's data → 0 rows
4. Manager JWT for their team → correct rows
5. Manager JWT for another team → 0 rows
6. HR Admin JWT → all rows

## Test Accounts

These accounts must exist in the development seed:

| Email | Role | Employee |
|---|---|---|
| employee@test.com | employee | Test Employee (no team) |
| manager@test.com | manager | Test Manager (has a team) |
| hr@test.com | hr_admin | HR Admin |
| admin@test.com | super_admin | Super Admin |

## Manual QA Checklist for Each Phase

Before marking a phase complete:

- [ ] Happy path works end-to-end
- [ ] Empty state renders when no data
- [ ] Loading state renders while fetching
- [ ] Error state renders when fetch fails
- [ ] Mobile layout works at 375px
- [ ] Keyboard navigation works
- [ ] No console errors in browser
- [ ] RLS blocks unauthorized access
- [ ] No hard-coded data (verify by changing DB values)

## Regression Tests for Known Edge Cases

These must not be broken by any future change:

1. **Rejected nomination stays in DB** — soft delete only
2. **Historical recognition survives** — change employee department, check old recognition still shows original dept
3. **Badge does not downgrade** — once B3, cannot go back to B2 in same period
4. **Self-nomination blocked** — at database level, not just frontend
5. **Idempotency key** — double-clicking submit creates only one nomination
6. **Approval escalation** — when nominee = manager, routes to next level
