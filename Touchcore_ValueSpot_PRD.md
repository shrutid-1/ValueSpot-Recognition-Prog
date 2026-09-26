**TOUCHCORE SYSTEMS PVT. LTD.**

**Touchcore ValueSpot**

Product Requirements Document

_Recognize the behaviour. Reinforce the value. Strengthen the culture._

| **Field**       | **Detail**                  |
| --------------- | --------------------------- |
| Product Name    | Touchcore ValueSpot         |
| Client          | Touchcore Systems Pvt. Ltd. |
| Version         | MVP 1.0                     |
| Document Status | Approved for Implementation |

**Contents**

# 1\. Product Purpose

Touchcore ValueSpot is an internal employee recognition and Core Values culture platform. It enables employees to recognize colleagues for demonstrating Touchcore's Core Values through specific, observable behaviours.

**Important:** This is NOT a performance management or appraisal system. It is a culture reinforcement tool.

# 2\. Fundamental Product Loop

Every recognition moves through the following sequence, from an observed behaviour to badge progression:

| **1**  | Observe behaviour                            |
| ------ | -------------------------------------------- |
| **2**  | Recognize colleague                          |
| **3**  | Select Core Value                            |
| **4**  | Select behaviour                             |
| **5**  | Select scenario                              |
| **6**  | Describe what happened                       |
| **7**  | Describe impact                              |
| **8**  | Manager validates                            |
| **9**  | Recognition published                        |
| **10** | Team celebrates                              |
| **11** | Recognition contributes to culture analytics |
| **12** | Core Value badge progresses                  |

# 3\. Primary Objectives

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

# 4\. Touchcore Core Values

## 4.1 Adaptable

<div class="joplin-table-wrapper"><table><tbody><tr><th><p><strong>Definition: </strong>Adjusts positively and effectively to changing requirements, priorities, technologies, situations and business needs.</p><p><strong>Behaviours</strong></p><ul><li>Quickly adapts to changing client requirements</li><li>Learns new tools or processes</li><li>Remains effective during uncertainty</li><li>Helps others adapt to change</li><li>Adjusts priorities when business needs change</li></ul><p><strong>Accent colour: </strong>■ Blue (#2563EB)</p></th></tr></tbody></table></div>

## 4.2 Transparent

<div class="joplin-table-wrapper"><table><tbody><tr><th><p><strong>Definition: </strong>Communicates openly, honestly and responsibly.</p><p><strong>Behaviours</strong></p><ul><li>Shares important information proactively</li><li>Communicates risks early</li><li>Owns mistakes</li><li>Gives honest and constructive feedback</li><li>Communicates clearly with stakeholders</li></ul><p><strong>Accent colour: </strong>■ Teal (#14B8A6)</p></th></tr></tbody></table></div>

## 4.3 Collaborative

<div class="joplin-table-wrapper"><table><tbody><tr><th><p><strong>Definition: </strong>Works effectively with others and prioritizes collective success.</p><p><strong>Behaviours</strong></p><ul><li>Supports colleagues</li><li>Shares knowledge</li><li>Helps solve cross-functional problems</li><li>Gives credit to others</li><li>Helps resolve conflicts</li><li>Works across teams</li><li>Prioritizes team success</li></ul><p><strong>Accent colour: </strong>■ Purple (#7C3AED)</p></th></tr></tbody></table></div>

## 4.4 Innovative

<div class="joplin-table-wrapper"><table><tbody><tr><th><p><strong>Definition: </strong>Challenges existing approaches and creates better ways of working.</p><p><strong>Behaviours</strong></p><ul><li>Introduces new solutions</li><li>Automates repetitive work</li><li>Suggests process improvements</li><li>Experiments with technology</li><li>Finds better ways to solve problems</li><li>Challenges inefficient processes constructively</li></ul><p><strong>Accent colour: </strong>■ Orange (#EA580C)</p></th></tr></tbody></table></div>

## 4.5 Accountable

<div class="joplin-table-wrapper"><table><tbody><tr><th><p><strong>Definition: </strong>Takes ownership of commitments, responsibilities, actions and outcomes.</p><p><strong>Behaviours</strong></p><ul><li>Delivers on commitments</li><li>Takes responsibility for mistakes</li><li>Follows through</li><li>Escalates risks appropriately</li><li>Takes ownership beyond immediate responsibilities</li><li>Keeps stakeholders informed</li></ul><p><strong>Accent colour: </strong>■ Green (#16A34A)</p></th></tr></tbody></table></div>

# 5\. Functional Requirements

## FR-001: Authentication

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-001-01</strong></code></pre></td><td><p>Users must be able to log in with email and password</p></td></tr><tr><td><pre><code><strong>REQ-001-02</strong></code></pre></td><td><p>Users must be able to log out</p></td></tr><tr><td><pre><code><strong>REQ-001-03</strong></code></pre></td><td><p>Password reset via email must work</p></td></tr><tr><td><pre><code><strong>REQ-001-04</strong></code></pre></td><td><p>Sessions must be managed securely via Supabase Auth</p></td></tr><tr><td><pre><code><strong>REQ-001-05</strong></code></pre></td><td><p>Route access must be role-restricted</p></td></tr><tr><td><pre><code><strong>REQ-001-06</strong></code></pre></td><td><p>Architecture must support future SSO (Microsoft/Google) without refactoring</p></td></tr></tbody></table></div>

## FR-002: Recognition Giving

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-002-01</strong></code></pre></td><td><p>Employee can search for a colleague by name, employee ID, department, or project</p></td></tr><tr><td><pre><code><strong>REQ-002-02</strong></code></pre></td><td><p>Employee cannot recognize themselves</p></td></tr><tr><td><pre><code><strong>REQ-002-03</strong></code></pre></td><td><p>Employee selects one Core Value</p></td></tr><tr><td><pre><code><strong>REQ-002-04</strong></code></pre></td><td><p>Employee selects one behaviour linked to that Core Value</p></td></tr><tr><td><pre><code><strong>REQ-002-05</strong></code></pre></td><td><p>Employee selects a scenario (or Other)</p></td></tr><tr><td><pre><code><strong>REQ-002-06</strong></code></pre></td><td><p>Employee describes what happened (free text, required)</p></td></tr><tr><td><pre><code><strong>REQ-002-07</strong></code></pre></td><td><p>Employee describes the impact (free text, required)</p></td></tr><tr><td><pre><code><strong>REQ-002-08</strong></code></pre></td><td><p>Employee optionally tags a project</p></td></tr><tr><td><pre><code><strong>REQ-002-09</strong></code></pre></td><td><p>Employee sees a preview before submitting</p></td></tr><tr><td><pre><code><strong>REQ-002-10</strong></code></pre></td><td><p>Submission creates a nomination record in Supabase</p></td></tr><tr><td><pre><code><strong>REQ-002-11</strong></code></pre></td><td><p>System identifies the correct approving manager</p></td></tr><tr><td><pre><code><strong>REQ-002-12</strong></code></pre></td><td><p>The full wizard should be completable in under 60 seconds</p></td></tr></tbody></table></div>

## FR-003: Approval Workflow

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-003-01</strong></code></pre></td><td><p>Nominated employee's manager receives a pending approval notification</p></td></tr><tr><td><pre><code><strong>REQ-003-02</strong></code></pre></td><td><p>Manager can approve the nomination</p></td></tr><tr><td><pre><code><strong>REQ-003-03</strong></code></pre></td><td><p>Manager can request clarification (returns to nominator)</p></td></tr><tr><td><pre><code><strong>REQ-003-04</strong></code></pre></td><td><p>Manager can reject (reason required)</p></td></tr><tr><td><pre><code><strong>REQ-003-05</strong></code></pre></td><td><p>If nominee IS the approver, escalate to next-level manager</p></td></tr><tr><td><pre><code><strong>REQ-003-06</strong></code></pre></td><td><p>If no manager exists, escalate to HR fallback</p></td></tr><tr><td><pre><code><strong>REQ-003-07</strong></code></pre></td><td><p>Rejected nominations are retained for audit purposes</p></td></tr><tr><td><pre><code><strong>REQ-003-08</strong></code></pre></td><td><p>Approval rules must be configurable by HR Admin</p></td></tr></tbody></table></div>

## FR-004: Recognition Feed

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-004-01</strong></code></pre></td><td><p>Only approved recognitions appear in the feed</p></td></tr><tr><td><pre><code><strong>REQ-004-02</strong></code></pre></td><td><p>Feed shows: nominator, nominee, Core Value, recognition text, project, date</p></td></tr><tr><td><pre><code><strong>REQ-004-03</strong></code></pre></td><td><p>Employees can react with "Appreciate" to published recognitions</p></td></tr><tr><td><pre><code><strong>REQ-004-04</strong></code></pre></td><td><p>Comments are not included in MVP</p></td></tr></tbody></table></div>

## FR-005: Badge System

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-005-01</strong></code></pre></td><td><p>Badges are calculated per Employee × Core Value × Period</p></td></tr><tr><td><pre><code><strong>REQ-005-02</strong></code></pre></td><td><p>Default period is annual (January–December)</p></td></tr><tr><td><pre><code><strong>REQ-005-03</strong></code></pre></td><td><p>Only approved and published recognitions count toward badges</p></td></tr><tr><td><pre><code><strong>REQ-005-04</strong></code></pre></td><td><p>There are 5 badge levels: Cheers (B1), Applause (B2), Kudos (B3), Spotlight (B4), Value Ambassador (B5)</p></td></tr><tr><td><pre><code><strong>REQ-005-05</strong></code></pre></td><td><p>Badge thresholds are database-driven and configurable</p></td></tr><tr><td><pre><code><strong>REQ-005-06</strong></code></pre></td><td><p>Badges upgrade automatically, never downgrade within the same period</p></td></tr><tr><td><pre><code><strong>REQ-005-07</strong></code></pre></td><td><p>Badge history is stored and not overwritten</p></td></tr><tr><td><pre><code><strong>REQ-005-08</strong></code></pre></td><td><p>Badge unlock triggers an in-app notification</p></td></tr><tr><td><pre><code><strong>REQ-005-09</strong></code></pre></td><td><p>Default thresholds: B1=1-2, B2=3-5, B3=6-10, B4=11-15, B5=16+</p></td></tr></tbody></table></div>

### Default Badge Levels

| **Level** | **Badge Name**   | **Recognitions (per Core Value, per period)** |
| --------- | ---------------- | --------------------------------------------- |
| B1        | Cheers           | 1–2                                           |
| B2        | Applause         | 3–5                                           |
| B3        | Kudos            | 6–10                                          |
| B4        | Spotlight        | 11–15                                         |
| B5        | Value Ambassador | 16+                                           |

## FR-006: Notifications

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-006-01</strong></code></pre></td><td><p>In-app notification center</p></td></tr><tr><td><pre><code><strong>REQ-006-02</strong></code></pre></td><td><p>Notification types: nomination submitted, approval required, clarification requested, nomination approved, nomination rejected, recognition received, team recognition published, badge unlocked, monthly report ready</p></td></tr><tr><td><pre><code><strong>REQ-006-03</strong></code></pre></td><td><p>Notifications have unread/read state</p></td></tr><tr><td><pre><code><strong>REQ-006-04</strong></code></pre></td><td><p>User can mark all as read</p></td></tr></tbody></table></div>

## FR-007: Analytics

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-007-01</strong></code></pre></td><td><p>HR dashboard with total recognitions, employees recognized, coverage %, pending approvals, most recognized value, cross-team %</p></td></tr><tr><td><pre><code><strong>REQ-007-02</strong></code></pre></td><td><p>Daily recognition leaders per Core Value</p></td></tr><tr><td><pre><code><strong>REQ-007-03</strong></code></pre></td><td><p>Monthly recognition leaders (Core Value × Employee × Count × Unique recognizers × Badge)</p></td></tr><tr><td><pre><code><strong>REQ-007-04</strong></code></pre></td><td><p>Quarterly recognition leaders</p></td></tr><tr><td><pre><code><strong>REQ-007-05</strong></code></pre></td><td><p>Annual Core Value recognition leaders with tie-breaking</p></td></tr><tr><td><pre><code><strong>REQ-007-06</strong></code></pre></td><td><p>Department analytics</p></td></tr><tr><td><pre><code><strong>REQ-007-07</strong></code></pre></td><td><p>Project analytics</p></td></tr><tr><td><pre><code><strong>REQ-007-08</strong></code></pre></td><td><p>Badge distribution analytics</p></td></tr><tr><td><pre><code><strong>REQ-007-09</strong></code></pre></td><td><p>Recognition source analytics (Peer / Manager / HR / Leadership)</p></td></tr><tr><td><pre><code><strong>REQ-007-10</strong></code></pre></td><td><p>Cross-team recognition metric</p></td></tr></tbody></table></div>

## FR-008: Reports

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-008-01</strong></code></pre></td><td><p>Monthly report</p></td></tr><tr><td><pre><code><strong>REQ-008-02</strong></code></pre></td><td><p>Quarterly report (Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar)</p></td></tr><tr><td><pre><code><strong>REQ-008-03</strong></code></pre></td><td><p>Annual report</p></td></tr><tr><td><pre><code><strong>REQ-008-04</strong></code></pre></td><td><p>Custom period report</p></td></tr><tr><td><pre><code><strong>REQ-008-05</strong></code></pre></td><td><p>All reports support filters: period, department, project, employee, Core Value, behaviour, source, status</p></td></tr><tr><td><pre><code><strong>REQ-008-06</strong></code></pre></td><td><p>Export to CSV and XLSX</p></td></tr><tr><td><pre><code><strong>REQ-008-07</strong></code></pre></td><td><p>Exports respect active filters and role-based data access</p></td></tr></tbody></table></div>

## FR-009: Employee Management (HR Admin)

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-009-01</strong></code></pre></td><td><p>Add, edit, activate, deactivate employees</p></td></tr><tr><td><pre><code><strong>REQ-009-02</strong></code></pre></td><td><p>Assign manager, department, project, role</p></td></tr><tr><td><pre><code><strong>REQ-009-03</strong></code></pre></td><td><p>Bulk import via CSV</p></td></tr><tr><td><pre><code><strong>REQ-009-04</strong></code></pre></td><td><p>Export employee list</p></td></tr><tr><td><pre><code><strong>REQ-009-05</strong></code></pre></td><td><p>Historical relationships preserved on change</p></td></tr></tbody></table></div>

## FR-010: Anti-Gaming & Data Integrity

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-010-01</strong></code></pre></td><td><p>Same nominator cannot have more than 1 approved recognition for the same nominee + same Core Value within 30 days (configurable)</p></td></tr><tr><td><pre><code><strong>REQ-010-02</strong></code></pre></td><td><p>Rate limit: maximum 5 recognitions per employee per day (configurable)</p></td></tr><tr><td><pre><code><strong>REQ-010-03</strong></code></pre></td><td><p>Rate limit: maximum 20 recognitions per employee per month (configurable)</p></td></tr><tr><td><pre><code><strong>REQ-010-04</strong></code></pre></td><td><p>Duplicate detection warns if substantially similar recognition submitted within configurable period</p></td></tr><tr><td><pre><code><strong>REQ-010-05</strong></code></pre></td><td><p>Reciprocal recognition patterns are tracked and flagged internally to HR (not visible to employees)</p></td></tr><tr><td><pre><code><strong>REQ-010-06</strong></code></pre></td><td><p>Double-click and browser-refresh submission duplication must be prevented</p></td></tr></tbody></table></div>

## FR-011: Audit Logging

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-011-01</strong></code></pre></td><td><p>All significant actions are logged: login, nomination lifecycle, approval decisions, employee changes, role changes, badge threshold changes, report generation</p></td></tr><tr><td><pre><code><strong>REQ-011-02</strong></code></pre></td><td><p>Log stores: user, action, entity, entity_id, timestamp, previous_value, new_value</p></td></tr><tr><td><pre><code><strong>REQ-011-03</strong></code></pre></td><td><p>Audit logs visible only to HR Admin and Super Admin</p></td></tr></tbody></table></div>

## FR-012: Admin Configuration

<div class="joplin-table-wrapper"><table><thead><tr><th><p><strong>Req. ID</strong></p></th><th><p><strong>Requirement</strong></p></th></tr></thead><tbody><tr><td><pre><code><strong>REQ-012-01</strong></code></pre></td><td><p>Core Values manageable (add, edit, archive, reorder)</p></td></tr><tr><td><pre><code><strong>REQ-012-02</strong></code></pre></td><td><p>Behaviours manageable per Core Value</p></td></tr><tr><td><pre><code><strong>REQ-012-03</strong></code></pre></td><td><p>Scenarios manageable per behaviour</p></td></tr><tr><td><pre><code><strong>REQ-012-04</strong></code></pre></td><td><p>Badge thresholds configurable</p></td></tr><tr><td><pre><code><strong>REQ-012-05</strong></code></pre></td><td><p>Financial year configurable</p></td></tr><tr><td><pre><code><strong>REQ-012-06</strong></code></pre></td><td><p>Approval rules configurable</p></td></tr><tr><td><pre><code><strong>REQ-012-07</strong></code></pre></td><td><p>Recognition limits configurable</p></td></tr><tr><td><pre><code><strong>REQ-012-08</strong></code></pre></td><td><p>Reward definitions manageable</p></td></tr></tbody></table></div>

# 6\. Non-Functional Requirements

## NFR-001: Performance

- Dashboard initial load < 2s on standard connection
- Employee search results < 500ms
- Reports generate < 5s for standard date ranges
- Pagination for all list views (no full table loads in browser)

## NFR-002: Security

- All authorization enforced via Supabase RLS (not just frontend routing)
- No service-role keys in frontend code
- No sensitive data exposed to wrong role
- Rejected nominations, HR notes, audit logs not visible to employees
- Session tokens handled securely

## NFR-003: Accessibility

- WCAG 2.1 AA principles
- Keyboard navigation throughout
- Visible focus indicators
- Accessible form labels
- Sufficient colour contrast
- Semantic HTML
- Screen reader-friendly controls
- Meaning not communicated by colour alone

## NFR-004: Responsiveness

- Full support: Desktop, Laptop, Tablet, Mobile
- Recognition wizard excellent on mobile
- Admin analytics can prioritize desktop

## NFR-005: Data Integrity

- Historical records are never reconstructed from current relationships
- Archived Core Values, behaviours, scenarios retain association with historical recognitions
- Employee role/manager/department/project changes do not corrupt history

## NFR-006: Timezone

- All timestamps stored in UTC
- Displayed in IST (Asia/Kolkata) by default
- Timezone configurable

## NFR-007: Internationalisation

- MVP: English only
- Architecture must not preclude future internationalisation

# 7\. Out of Scope for MVP

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

# 8\. Constraints

- Use Supabase for backend, auth, and database
- Use React + TypeScript + Vite + Tailwind + shadcn/ui
- No hard-coded dashboard numbers, badge thresholds, or report data
- Do not position this as a performance management system
- Financial year Q1=Apr, Q2=Jul, Q3=Oct, Q4=Jan — configurable, not hard-coded
- Annual badge period default: January–December (independent of financial year)