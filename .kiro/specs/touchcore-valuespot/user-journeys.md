# Touchcore ValueSpot — User Journeys

## Journey 1: Employee Gives Recognition

**Actor:** Priya (Employee)
**Goal:** Recognize Amit for helping resolve an integration issue

### Steps

1. Priya logs in → lands on Employee Dashboard
2. Priya sees "Good morning, Priya" + summary stats
3. Priya clicks **+ Give Recognition** (primary CTA)
4. **Step 1 — Who to recognize?**
   - Priya types "Amit" in the search field
   - System shows matching employees with department and avatar
   - Priya selects "Amit Sharma — Engineering"
   - System validates: Amit ≠ Priya ✅
5. **Step 2 — Core Value**
   - Five Core Value cards appear: Adaptable, Transparent, Collaborative, Innovative, Accountable
   - Priya selects **Collaborative** (purple accent)
   - Card highlights with selected state
6. **Step 3 — Behaviour**
   - Behaviours for Collaborative load: "Supports colleagues", "Shares knowledge", "Helps solve cross-functional problems", etc.
   - Priya selects **"Helps solve cross-functional problems"**
7. **Step 4 — Scenario**
   - Relevant scenarios load: "Resolved a cross-team technical blocker", "Supported another team during a critical deadline", etc.
   - Priya selects **"Resolved a cross-team technical blocker"**
8. **Step 5 — Recognition Story**
   - Field: "What happened?" — Priya writes: "Amit stayed back on Thursday to help us resolve the client integration issue..."
   - Field: "What was the impact?" — Priya writes: "We were able to deliver on time and the client was impressed..."
   - Optional: Priya selects project "ABC Client"
9. **Step 6 — Preview**
   - Priya sees the full recognition card preview
   - Recognizing: Amit Sharma
   - Core Value: Collaborative
   - Behaviour: Helps solve cross-functional problems
   - Scenario: Resolved a cross-team technical blocker
   - Recognition: [Priya's text]
   - Impact: [Priya's text]
   - Project: ABC Client
   - Priya clicks **Submit Recognition**
10. Success state:
    - "Recognition submitted 🎉"
    - "Your recognition has been sent to [Rohan - Amit's manager] for validation."
    - Nomination record created in Supabase (status: pending)
    - Manager notified

**Happy path time:** < 60 seconds

---

## Journey 2: Manager Approves Recognition

**Actor:** Rohan (Manager, Amit's manager)
**Goal:** Review and approve Priya's recognition of Amit

### Steps

1. Rohan logs in → lands on Manager Dashboard
2. Rohan sees badge: "1 Pending Approval"
3. Rohan clicks **Pending Approvals** in nav
4. Approval queue shows Priya's nomination:
   - From: Priya
   - For: Amit
   - Core Value: Collaborative
   - Preview of recognition text
5. Rohan clicks **Review**
6. Full nomination detail opens:
   - All recognition content visible
   - Three action buttons: **Approve** | **Request Clarification** | **Reject**
7. Rohan reads the recognition — it's accurate and meaningful
8. Rohan clicks **Approve**
9. Confirmation: "Recognition approved and published"
10. System:
    - Status → `approved`
    - Recognition published to feed
    - Amit notified: "You received a recognition!"
    - Priya notified: "Your recognition was approved"
    - Badge recalculated for Amit × Collaborative
    - If Amit reaches new badge level → badge unlock notification

---

## Journey 3: Manager Requests Clarification

**Actor:** Rohan (Manager)
**Goal:** Request more detail before approving

### Steps

1. Rohan reviews nomination
2. The recognition is vague — "Amit was really helpful"
3. Rohan clicks **Request Clarification**
4. Modal: "What additional information would help?"
5. Rohan writes: "Could you describe specifically what Amit did and the business impact?"
6. Rohan submits
7. System:
   - Status → `clarification_requested`
   - Priya notified: "Rohan has requested clarification on your recognition of Amit"
8. Priya logs in → sees notification
9. Priya opens the nomination → sees clarification note
10. Priya updates the recognition story with more detail
11. Priya resubmits → status → `pending` again
12. Rohan sees it back in queue

---

## Journey 4: Manager Rejects Recognition

**Actor:** Rohan (Manager)
**Goal:** Reject an inaccurate nomination

### Steps

1. Rohan reviews nomination
2. The recognition is factually incorrect — the project doesn't exist
3. Rohan clicks **Reject**
4. Modal: "Reason for rejection (required)"
5. Rohan writes the reason
6. Rohan submits
7. System:
   - Status → `rejected`
   - Rejection reason stored (not visible to nominee or other employees)
   - Priya notified: "Your recognition was not approved"
   - Nomination retained in database for audit

---

## Journey 5: Employee Views Core Value Journey

**Actor:** Shruti (Employee)
**Goal:** Understand her current badge status

### Steps

1. Shruti clicks **My Core Value Journey** in nav
2. Page shows five Core Value cards:
   - **Adaptable** — Cheers 🏅 — 2 recognitions — 2 unique recognizers — Progress: 2/3 for Applause
   - **Transparent** — No badge — 0 recognitions — "1 recognition unlocks Cheers"
   - **Collaborative** — Value Ambassador 🏆 — 18 recognitions — 11 unique recognizers — "Highest badge achieved"
   - **Innovative** — Applause 👏 — 4 recognitions — 3 unique recognizers — Progress: 4/6 for Kudos
   - **Accountable** — Kudos ⭐ — 8 recognitions — 5 unique recognizers — Progress: 8/11 for Spotlight
3. Shruti clicks on Collaborative card → expands to show recognition history for that value

---

## Journey 6: Badge Unlock

**Actor:** Rahul (Employee)
**Goal:** Receives his first Accountable badge

### Steps

1. Rahul receives his 1st approved recognition for Accountable
2. Edge Function calculates: 1 recognition → B1 Cheers
3. badge_history record created
4. Notification created: type = 'badge_unlocked'
5. Rahul is online → Realtime notification appears
6. Badge unlock toast:
   - "🎉 You've unlocked a new Core Value badge!"
   - "You've been recognized 1 time for Accountable this year."
   - "You've unlocked: Cheers"
7. Rahul's Core Value Journey updates immediately

---

## Journey 7: HR Views Analytics

**Actor:** Meera (HR Admin)
**Goal:** Understand how Core Values are being demonstrated

### Steps

1. Meera logs in → HR Dashboard
2. Dashboard shows top metrics:
   - Total Recognitions: 127
   - Employees Recognized: 15 (75% of 20 active employees)
   - Recognition Coverage: 75%
   - Pending Approvals: 3
   - Most Recognized Value: Collaborative (47 recognitions)
   - Cross-Team Recognition: 38%
3. Meera scrolls:
   - "Most Recognized Today" — one leader per Core Value
   - Core Value Distribution chart
   - Recognition Trend (last 12 months)
   - Badge Distribution chart
   - Monthly Leaders table
   - Recent Recognitions feed (last 10)
4. Meera clicks **Analytics** in nav
5. Sees detailed breakdowns by department, project, Core Value
6. Filters by: Q2 (Jul–Sep), Department: Engineering
7. Data filters instantly

---

## Journey 8: HR Generates Monthly Report

**Actor:** Meera (HR Admin)
**Goal:** Generate September 2026 recognition report

### Steps

1. Meera navigates to **Reports**
2. Report type: **Monthly**
3. Selects: September 2026
4. Filters: All departments, All Core Values
5. Clicks **Generate Report**
6. System queries database — shows report:
   - 34 nominations this month
   - 28 approved, 3 rejected, 3 pending
   - 12 employees recognized
   - 60% recognition coverage
   - Core Value breakdown chart
   - Department breakdown
   - Monthly Core Value leaders
7. Meera clicks **Export XLSX**
8. File downloads with real data from the database

---

## Journey 9: Self-Recognition Prevention

**Actor:** Arjun (Employee)
**Goal:** Tries to recognize himself

### Steps

1. Arjun opens Give Recognition wizard
2. Step 1: Arjun searches for himself
3. His own name appears in results
4. Arjun tries to select himself
5. System shows: "You cannot recognize yourself"
6. Arjun cannot proceed — validation at both frontend and backend

---

## Journey 10: Duplicate Recognition Warning

**Actor:** Priya (Employee)
**Goal:** Tries to recognize Amit again for Collaborative within 30 days

### Steps

1. Priya opens Give Recognition
2. Priya selects Amit, selects Collaborative
3. System detects: Priya has 1 approved recognition for Amit × Collaborative in last 30 days
4. Warning appears:
   > "You recently recognized this colleague for similar behaviour."
   > "Different example → Continue"
   > "Cancel"
5. If Priya continues: the recognition uses a different example
6. The new recognition IS accepted — the warning is informational only (duplicate check is enforced at APPROVAL stage, the anti-gaming rule prevents the second from being approved by design)

---

## Journey 11: Escalation Edge Case

**Actor:** Deepak (Manager, nominated by his own direct report Kavya)
**Goal:** System correctly routes approval

### Steps

1. Kavya recognizes Deepak for Accountable
2. System: Deepak's approver = Deepak himself → escalation triggered
3. System finds Deepak's manager: Sunita
4. Nomination routed to Sunita for approval
5. Sunita sees it in her approval queue
6. Standard approval flow proceeds

---

## Journey 12: HR Admin Manages Employees

**Actor:** Meera (HR Admin)
**Goal:** Add a new employee joining Touchcore

### Steps

1. Meera navigates to **Employees**
2. Clicks **Add Employee**
3. Form: full name, email, employee ID, role, department, manager, projects
4. Meera fills in details and submits
5. Record created in `employees` table
6. Invitation email sent via Supabase Auth (invite user)
7. New employee appears in employee list
8. New employee can receive recognitions immediately

---

## Journey 13: Annual Tie-Breaking

**Actor:** HR (viewing Annual Core Value Leaders)
**Goal:** Determine who is Collaborative Recognition Leader

### Scenario

Priya: 12 recognitions, 8 unique recognizers
Ananya: 12 recognitions, 10 unique recognizers

### Resolution

1. Both have 12 recognitions — tie on primary metric
2. Tie-breaker 1: Unique recognizers → Ananya: 10, Priya: 8 → Ananya wins

### If still tied after all 4 tie-breakers:

Both shown as joint Recognition Leaders with "Joint" indicator.

---

## Journey 14: Rate Limit Reached

**Actor:** Vikram (Employee)
**Goal:** Tries to submit 6th recognition in a day

### Steps

1. Vikram has already submitted 5 recognitions today (daily limit = 5)
2. Vikram opens Give Recognition wizard
3. At submission (Step 6), Edge Function check-rate-limits is called
4. Response: `{ allowed: false, reason: 'daily_limit_reached', limit: 5 }`
5. Error message shown:
   > "You've reached your daily recognition limit of 5. Please come back tomorrow."
6. Form is NOT submitted — rate limit enforced server-side
