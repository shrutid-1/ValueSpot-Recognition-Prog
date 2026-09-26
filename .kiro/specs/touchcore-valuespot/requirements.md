# Touchcore ValueSpot — Product Requirements

## Product Overview

**Product Name:** Touchcore ValueSpot
**Client:** Touchcore Systems Pvt. Ltd.
**Tagline:** Recognize the behaviour. Reinforce the value. Strengthen the culture.
**Version:** MVP 1.0
**Document Status:** Approved for Implementation

---

## 1. Product Purpose

Touchcore ValueSpot is an internal employee recognition and Core Values culture platform. It enables employees to recognize colleagues for demonstrating Touchcore's Core Values through specific, observable behaviours.

This is NOT a performance management or appraisal system. It is a culture reinforcement tool.

---

## 2. Fundamental Product Loop

```
Observe behaviour
        ↓
Recognize colleague
        ↓
Select Core Value
        ↓
Select behaviour
        ↓
Select scenario
        ↓
Describe what happened
        ↓
Describe impact
        ↓
Manager validates
        ↓
Recognition published
        ↓
Team celebrates
        ↓
Recognition contributes to culture analytics
        ↓
Core Value badge progresses
```

---

## 3. Primary Objectives

1. Increase adoption of Touchcore Core Values
2. Encourage peer recognition across teams
3. Make recognition easy (under 60 seconds) and meaningful
4. Reinforce observable, specific behaviours
5. Encourage cross-team appreciation
6. Give managers visibility into value-based behaviour
7. Give HR actionable culture analytics
8. Create a structured recognition history
9. Provide monthly, quarterly and annual reports
10. Create Core Value-specific recognition badges
11. Identify the most recognized employee for each Core Value
12. Make recognition rewarding without creating unhealthy competition

---

## 4. Touchcore Core Values

### 4.1 Adaptable
**Definition:** Adjusts positively and effectively to changing requirements, priorities, technologies, situations and business needs.

**Behaviours:**
- Quickly adapts to changing client requirements
- Learns new tools or processes
- Remains effective during uncertainty
- Helps others adapt to change
- Adjusts priorities when business needs change

**Accent colour:** Blue (#2563EB)

---

### 4.2 Transparent
**Definition:** Communicates openly, honestly and responsibly.

**Behaviours:**
- Shares important information proactively
- Communicates risks early
- Owns mistakes
- Gives honest and constructive feedback
- Communicates clearly with stakeholders

**Accent colour:** Teal (#14B8A6)

---

### 4.3 Collaborative
**Definition:** Works effectively with others and prioritizes collective success.

**Behaviours:**
- Supports colleagues
- Shares knowledge
- Helps solve cross-functional problems
- Gives credit to others
- Helps resolve conflicts
- Works across teams
- Prioritizes team success

**Accent colour:** Purple (#7C3AED)

---

### 4.4 Innovative
**Definition:** Challenges existing approaches and creates better ways of working.

**Behaviours:**
- Introduces new solutions
- Automates repetitive work
- Suggests process improvements
- Experiments with technology
- Finds better ways to solve problems
- Challenges inefficient processes constructively

**Accent colour:** Orange (#EA580C)

---

### 4.5 Accountable
**Definition:** Takes ownership of commitments, responsibilities, actions and outcomes.

**Behaviours:**
- Delivers on commitments
- Takes responsibility for mistakes
- Follows through
- Escalates risks appropriately
- Takes ownership beyond immediate responsibilities
- Keeps stakeholders informed

**Accent colour:** Green (#16A34A)

---

## 5. Functional Requirements

### FR-001: Authentication
- REQ-001-01: Users must be able to log in with email and password
- REQ-001-02: Users must be able to log out
- REQ-001-03: Password reset via email must work
- REQ-001-04: Sessions must be managed securely via Supabase Auth
- REQ-001-05: Route access must be role-restricted
- REQ-001-06: Architecture must support future SSO (Microsoft/Google) without refactoring

### FR-002: Recognition Giving
- REQ-002-01: Employee can search for a colleague by name, employee ID, department, or project
- REQ-002-02: Employee cannot recognize themselves
- REQ-002-03: Employee selects one Core Value
- REQ-002-04: Employee selects one behaviour linked to that Core Value
- REQ-002-05: Employee selects a scenario (or Other)
- REQ-002-06: Employee describes what happened (free text, required)
- REQ-002-07: Employee describes the impact (free text, required)
- REQ-002-08: Employee optionally tags a project
- REQ-002-09: Employee sees a preview before submitting
- REQ-002-10: Submission creates a nomination record in Supabase
- REQ-002-11: System identifies the correct approving manager
- REQ-002-12: The full wizard should be completable in under 60 seconds

### FR-003: Approval Workflow
- REQ-003-01: Nominated employee's manager receives a pending approval notification
- REQ-003-02: Manager can approve the nomination
- REQ-003-03: Manager can request clarification (returns to nominator)
- REQ-003-04: Manager can reject (reason required)
- REQ-003-05: If nominee IS the approver, escalate to next-level manager
- REQ-003-06: If no manager exists, escalate to HR fallback
- REQ-003-07: Rejected nominations are retained for audit purposes
- REQ-003-08: Approval rules must be configurable by HR Admin

### FR-004: Recognition Feed
- REQ-004-01: Only approved recognitions appear in the feed
- REQ-004-02: Feed shows: nominator, nominee, Core Value, recognition text, project, date
- REQ-004-03: Employees can react with "Appreciate" to published recognitions
- REQ-004-04: Comments are not included in MVP

### FR-005: Badge System
- REQ-005-01: Badges are calculated per Employee × Core Value × Period
- REQ-005-02: Default period is annual (January–December)
- REQ-005-03: Only approved and published recognitions count toward badges
- REQ-005-04: There are 5 badge levels: Cheers (B1), Applause (B2), Kudos (B3), Spotlight (B4), Value Ambassador (B5)
- REQ-005-05: Badge thresholds are database-driven and configurable
- REQ-005-06: Badges upgrade automatically, never downgrade within the same period
- REQ-005-07: Badge history is stored and not overwritten
- REQ-005-08: Badge unlock triggers an in-app notification
- REQ-005-09: Default thresholds: B1=1-2, B2=3-5, B3=6-10, B4=11-15, B5=16+

### FR-006: Notifications
- REQ-006-01: In-app notification center
- REQ-006-02: Notification types: nomination submitted, approval required, clarification requested, nomination approved, nomination rejected, recognition received, team recognition published, badge unlocked, monthly report ready
- REQ-006-03: Notifications have unread/read state
- REQ-006-04: User can mark all as read

### FR-007: Analytics
- REQ-007-01: HR dashboard with total recognitions, employees recognized, coverage %, pending approvals, most recognized value, cross-team %
- REQ-007-02: Daily recognition leaders per Core Value
- REQ-007-03: Monthly recognition leaders (Core Value × Employee × Count × Unique recognizers × Badge)
- REQ-007-04: Quarterly recognition leaders
- REQ-007-05: Annual Core Value recognition leaders with tie-breaking
- REQ-007-06: Department analytics
- REQ-007-07: Project analytics
- REQ-007-08: Badge distribution analytics
- REQ-007-09: Recognition source analytics (Peer / Manager / HR / Leadership)
- REQ-007-10: Cross-team recognition metric

### FR-008: Reports
- REQ-008-01: Monthly report
- REQ-008-02: Quarterly report (Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar)
- REQ-008-03: Annual report
- REQ-008-04: Custom period report
- REQ-008-05: All reports support filters: period, department, project, employee, Core Value, behaviour, source, status
- REQ-008-06: Export to CSV and XLSX
- REQ-008-07: Exports respect active filters and role-based data access

### FR-009: Employee Management (HR Admin)
- REQ-009-01: Add, edit, activate, deactivate employees
- REQ-009-02: Assign manager, department, project, role
- REQ-009-03: Bulk import via CSV
- REQ-009-04: Export employee list
- REQ-009-05: Historical relationships preserved on change

### FR-010: Anti-Gaming & Data Integrity
- REQ-010-01: Same nominator cannot have more than 1 approved recognition for the same nominee + same Core Value within 30 days (configurable)
- REQ-010-02: Rate limit: maximum 5 recognitions per employee per day (configurable)
- REQ-010-03: Rate limit: maximum 20 recognitions per employee per month (configurable)
- REQ-010-04: Duplicate detection warns if substantially similar recognition submitted within configurable period
- REQ-010-05: Reciprocal recognition patterns are tracked and flagged internally to HR (not visible to employees)
- REQ-010-06: Double-click and browser-refresh submission duplication must be prevented

### FR-011: Audit Logging
- REQ-011-01: All significant actions are logged: login, nomination lifecycle, approval decisions, employee changes, role changes, badge threshold changes, report generation
- REQ-011-02: Log stores: user, action, entity, entity_id, timestamp, previous_value, new_value
- REQ-011-03: Audit logs visible only to HR Admin and Super Admin

### FR-012: Admin Configuration
- REQ-012-01: Core Values manageable (add, edit, archive, reorder)
- REQ-012-02: Behaviours manageable per Core Value
- REQ-012-03: Scenarios manageable per behaviour
- REQ-012-04: Badge thresholds configurable
- REQ-012-05: Financial year configurable
- REQ-012-06: Approval rules configurable
- REQ-012-07: Recognition limits configurable
- REQ-012-08: Reward definitions manageable

---

## 6. Non-Functional Requirements

### NFR-001: Performance
- Dashboard initial load < 2s on standard connection
- Employee search results < 500ms
- Reports generate < 5s for standard date ranges
- Pagination for all list views (no full table loads in browser)

### NFR-002: Security
- All authorization enforced via Supabase RLS (not just frontend routing)
- No service-role keys in frontend code
- No sensitive data exposed to wrong role
- Rejected nominations, HR notes, audit logs not visible to employees
- Session tokens handled securely

### NFR-003: Accessibility
- WCAG 2.1 AA principles
- Keyboard navigation throughout
- Visible focus indicators
- Accessible form labels
- Sufficient colour contrast
- Semantic HTML
- Screen reader-friendly controls
- Meaning not communicated by colour alone

### NFR-004: Responsiveness
- Full support: Desktop, Laptop, Tablet, Mobile
- Recognition wizard excellent on mobile
- Admin analytics can prioritize desktop

### NFR-005: Data Integrity
- Historical records are never reconstructed from current relationships
- Archived Core Values, behaviours, scenarios retain association with historical recognitions
- Employee role/manager/department/project changes do not corrupt history

### NFR-006: Timezone
- All timestamps stored in UTC
- Displayed in IST (Asia/Kolkata) by default
- Timezone configurable

### NFR-007: Internationalisation
- MVP: English only
- Architecture must not preclude future internationalisation

---

## 7. Out of Scope for MVP

- Microsoft SSO / Google SSO (architecture prepared)
- Microsoft Teams integration
- Slack integration
- HRMS integration
- AI recognition assistant (architecture prepared)
- Email notifications (in-app notifications only for MVP)
- Push notifications
- Mobile native application
- Public API
- Power BI integration

---

## 8. Constraints

- Use Supabase for backend, auth, and database
- Use React + TypeScript + Vite + Tailwind + shadcn/ui
- No hard-coded dashboard numbers, badge thresholds, or report data
- Do not position this as a performance management system
- Financial year Q1=Apr, Q2=Jul, Q3=Oct, Q4=Jan — configurable, not hard-coded
- Annual badge period default: January–December (independent of financial year)
