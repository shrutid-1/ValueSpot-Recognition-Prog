# ValueSpot Mock Data → Database Seeding Plan

**Date**: September 1, 2026  
**Status**: Analysis & Planning (No Changes Yet)  
**File**: `src/data/valuespot-mock-data.json`  
**Database**: Supabase PostgreSQL (18 tables, 6 migrations)

---

## Executive Summary

The mock data file contains **~1,300 lines** of JSON across **16 top-level sections**. Of these:

- **Seedable to Database**: 4 sections (coreValues, badges, people, departments)
- **Derivable/Calculated**: 6 sections (journey, team, leaders, metrics, distributions)
- **UI-Only/Session State**: 6 sections (currentUser, notifications, feed display state, etc.)

### Seeding Sequence (Respecting FK Dependencies)

1. **app_config** — Load system-wide settings (already seeded via 002_app_config.sql)
2. **departments** — Organizational structure
3. **core_values** — The 5 company values
4. **behaviours** — Behavior definitions per Core Value
5. **scenarios** — Scenario definitions per behaviour
6. **projects** — Project contexts
7. **employees** — User accounts (with department & manager relationships)
8. **project_members** — Project membership
9. **nominations** — Recognition submissions (with snapshot fields)
10. **nomination_appreciations** — Appreciation reactions
11. **employee_value_badges** — Current badge states (calculated post-nomination)
12. **badge_history** — Badge transition history (calculated post-nomination)
13. **notifications** — User notifications (skip for seed; generated at runtime)
14. **audit_logs** — Audit trail (skip for seed; generated at runtime via Edge Functions)

---

## Section-by-Section Analysis

### ✅ SEEDABLE SECTIONS

---

## 1. **coreValues** → `core_values` table

**Status**: ✅ **FULLY SEEDABLE**

**Mock Data Structure**:
```json
"coreValues": [
  {
    "key": "adaptable",
    "name": "Adaptable",
    "tone": "var(--color-accent-500)",
    "hex": "#749dc4",
    "description": "Adjusts positively to changing requirements...",
    "scenario": "Requirements shifted late in a sprint...",
    "behaviours": ["Adapted to changing client requirements", ...]
  },
  // ... 4 more Core Values
]
```

**Database Target**: `public.core_values`

**Field Mapping**:

| Mock Field | DB Column | Type | Transformation | Notes |
|---|---|---|---|---|
| `key` | `slug` | TEXT | Use as-is (lowercase) | UNIQUE constraint |
| `name` | `name` | TEXT | Use as-is | UNIQUE constraint |
| `description` | `definition` | TEXT | Use as-is | ~60 char descriptions |
| `hex` | `accent_color` | TEXT | Use as-is (e.g., "#749dc4") | For UI badge rendering |
| N/A | `icon` | TEXT | Map per Core Value | Default icons: adaptable→Zap, transparent→Eye, collaborative→Users, innovative→Lightbulb, accountable→CheckCircle |
| N/A | `display_order` | INT | 1-5 in canonical order | Order: adaptable(1), transparent(2), collaborative(3), innovative(4), accountable(5) |
| N/A | `is_active` | BOOL | true | All seed values active |
| N/A | `archived_at` | TIMESTAMPTZ | NULL | Not archived on seed |
| N/A | `created_at` | TIMESTAMPTZ | now() | Auto-set |
| N/A | `updated_at` | TIMESTAMPTZ | now() | Auto-set |

**Mock `scenario` Field**: 
- This is **not stored** in the Core Value table
- Instead, it describes a **typical scenario** for the value
- Can be used in documentation or as reference text for creating scenario records later
- **Skip for seeding**

**Mock `behaviours` Array**:
- These are **behaviour names**, not full behaviour objects
- Used to generate the `behaviours` table (see next section)
- **Skip for direct seeding** (reference for behaviours section)

**Record Count**: 5 values  
**Dependencies**: None (foundation table)  
**Seeding Order**: **#3** (after app_config, departments)

**Data Quality Notes**:
- All 5 values present with complete data
- No missing fields
- Colors are valid hex values
- Descriptions are clear and concise

---

## 2. **badges** → `badge_definitions` table

**Status**: ✅ **FULLY SEEDABLE**

**Mock Data Structure**:
```json
"badges": [
  {
    "code": "B1",
    "name": "Cheers",
    "min": 1,
    "range": "1–2 recognitions"
  },
  // ... 4 more badge levels
]
```

**Database Target**: `public.badge_definitions`

**Field Mapping**:

| Mock Field | DB Column | Type | Transformation | Notes |
|---|---|---|---|---|
| `min` | `minimum_count` | INT | Use as-is | Threshold for badge unlock |
| N/A | `maximum_count` | INT | Derived from next badge's min-1 | B1: 2, B2: 5, B3: 10, B4: 15, B5: NULL |
| `name` | `name` | TEXT | Use as-is | Badge name (e.g., "Cheers") |
| `code` | N/A | TEXT | Skip | Code "B1" can be inferred from level |
| `range` | `description` | TEXT | Use mock `range` field | "1–2 recognitions" |
| N/A | `level` | INT | Extract from sequence | 1-5 in order |
| N/A | `icon` | TEXT | Map per badge | Default: Trophy icon for all |
| N/A | `accent_color` | TEXT | Use Core Value color | Map per value (TBD in schema) |
| N/A | `display_order` | INT | 1-5 | B1→1, B2→2, etc. |
| N/A | `is_active` | BOOL | true | All seed badges active |
| N/A | `created_at` | TIMESTAMPTZ | now() | Auto-set |
| N/A | `updated_at` | TIMESTAMPTZ | now() | Auto-set |

**Badge Levels**:

| Mock | DB Level | Min | Max | Name | 
|---|---|---|---|---|
| B1 | 1 | 1 | 2 | Cheers |
| B2 | 2 | 3 | 5 | Applause |
| B3 | 3 | 6 | 10 | Kudos |
| B4 | 4 | 11 | 15 | Spotlight |
| B5 | 5 | 16 | NULL | Value Ambassador |

**Record Count**: 5 badges  
**Dependencies**: None (foundation table)  
**Seeding Order**: **#2** (after app_config)

**Data Quality Notes**:
- All 5 levels present
- Min/max ranges are valid and non-overlapping
- Names are clear and unique

---

## 3. **people** → `employees` table

**Status**: ✅ **MOSTLY SEEDABLE** (with transformations)

**Mock Data Structure**:
```json
"people": [
  {
    "id": "amit",
    "name": "Amit Deshpande",
    "role": "Senior QA Engineer",
    "dept": "Quality",
    "project": "ABC Client"
  },
  // ... 8 more employees
]
```

**Database Target**: `public.employees`

**Field Mapping**:

| Mock Field | DB Column | Type | Transformation | Notes |
|---|---|---|---|---|
| `id` | `employee_id` | TEXT | Use as-is (string ID) | UNIQUE, used for linking in other mock sections |
| `name` | `full_name` | TEXT | Use as-is | Full name |
| `role` | N/A (custom field) | — | Skip | This is job title, not system role |
| `dept` | `department_id` | UUID FK | Look up department by name; insert UUID | Must exist in departments table first |
| `project` | N/A (custom field) | — | Skip | This is initial project; membership handled separately |
| `self` | N/A | — | Skip | Used only to mark current user in UI |
| N/A | `auth_user_id` | UUID FK | NULL | No auth.users link in seed (would require real Auth setup) |
| N/A | `email` | TEXT | Generate from name (e.g., amit.deshpande@touchcore.in) | UNIQUE, can use pattern: `{firstname.lastname}@touchcore.in` |
| N/A | `avatar_url` | TEXT | NULL or placeholder | Not in mock data |
| N/A | `manager_id` | UUID FK | NULL for most; look up from structure | Need to infer from organizational hierarchy |
| N/A | `joined_at` | DATE | DEFAULT '2026-01-01' | No join date in mock; use consistent default |
| N/A | `role` (DB) | TEXT CHECK | Map from context | 'employee' or 'manager' (9/9 are employees; manager role inferred from "Manager" in job title) |
| N/A | `is_active` | BOOL | true | All seed employees active |
| N/A | `created_at` | TIMESTAMPTZ | now() | Auto-set |
| N/A | `updated_at` | TIMESTAMPTZ | now() | Auto-set |

**Employees in Mock Data**:

| ID | Name | Job Title | Dept | Project | Notes |
|---|---|---|---|---|---|
| amit | Amit Deshpande | Senior QA Engineer | Quality | ABC Client | —— |
| priya | Priya Nair | Product Designer | Design | Helix Portal | —— |
| rahul | Rahul Menon | Backend Engineer | Platform | Helix Portal | —— |
| shruti | Shruti Kulkarni | Implementation Lead | Delivery | ABC Client | **self: true** |
| farhan | Farhan Qureshi | Data Analyst | Insights | Nova Reporting | —— |
| meera | Meera Iyer | Engineering Manager | Platform | Helix Portal | **Manager** (role inference) |
| vikram | Vikram Rao | DevOps Engineer | Platform | Nova Reporting | —— |
| ananya | Ananya Sharma | Business Analyst | Delivery | ABC Client | —— |
| kiran | Kiran Joshi | Support Engineer | Service Desk | ABC Client | —— |

**Manager Inference**:
- Only `meera` has "Manager" in title
- Assume Meera (`meera_id`) is manager for Platform team members (Rahul, Vikram)
- **Need explicit manager assignments** (not derivable from mock data alone)

**Record Count**: 9 employees  
**Dependencies**: 
- `departments` (must exist first)
- `employees` (self-referencing manager_id; seed employees first, then backfill manager links)

**Seeding Order**: **#7** (after departments, core_values, behaviours, scenarios, projects)

**Data Quality Issues**:

| Issue | Severity | Resolution |
|---|---|---|
| Mock `role` is job title, not system role | Medium | Map "Manager" in title → role='manager'; else role='employee' |
| No manager assignments explicit | Medium | Infer from organizational context; Meera manages Platform team |
| No email addresses | Low | Generate using `{firstname.lastname}@touchcore.in` pattern |
| No avatar URLs | Low | Use NULL or placeholder URL |
| No auth_user_id | High | Keep NULL; real auth setup required separately |
| No joined_at dates | Low | Use consistent default (e.g., '2026-01-01') |

**Transformation Script Pseudocode**:
```typescript
people.forEach(person => {
  const dept = departments.find(d => d.name === person.dept);
  const systemRole = person.role.includes('Manager') ? 'manager' : 'employee';
  
  employees.push({
    employee_id: person.id,
    full_name: person.name,
    email: `${person.name.toLowerCase().replace(' ', '.')}@touchcore.in`,
    department_id: dept.id,
    role: systemRole,
    is_active: true,
    // Other fields: NULL or defaults
  });
});
```

---

## 4. **departments** → `departments` table

**Status**: ✅ **FULLY SEEDABLE**

**Mock Data Structure**:
- Not explicitly in mock JSON, but **inferred from `people[].dept` values**
- Departments appear in `departments` analytics section as percentages
- Department names: Platform, Delivery, Design, Quality, Insights, Service Desk

**Database Target**: `public.departments`

**Field Mapping**:

| Mock Field | DB Column | Type | Transformation | Notes |
|---|---|---|---|---|
| N/A | `name` | TEXT | Extract from people & analytics | UNIQUE, exact names from mock |
| N/A | `description` | TEXT | NULL or default | Not provided in mock; can use department-level descriptions |
| N/A | `is_active` | BOOL | true | All seed departments active |
| N/A | `created_at` | TIMESTAMPTZ | now() | Auto-set |
| N/A | `updated_at` | TIMESTAMPTZ | now() | Auto-set |

**Departments**:

| Name | Source | Notes |
|---|---|---|
| Platform | people[].dept | Includes Rahul, Vikram; managed by Meera |
| Delivery | people[].dept | Includes Shruti, Ananya |
| Design | people[].dept | Includes Priya |
| Quality | people[].dept | Includes Amit |
| Insights | people[].dept | Includes Farhan |
| Service Desk | people[].dept | Includes Kiran |

**Record Count**: 6 departments  
**Dependencies**: None (foundation table)  
**Seeding Order**: **#2** (after app_config, before employees)

**Data Quality Notes**:
- All 6 departments extractable from mock data
- No conflicts or ambiguities
- Names match analytics section

---

### 🔄 DERIVABLE/CALCULATED SECTIONS

These sections represent **calculated analytics or UI state** derived from the seedable tables. **Do not seed directly**; instead, recalculate after seeding nominations.

---

## 5. **feed** → `v_recognition_feed` view (calculated from nominations)

**Status**: 🔄 **DERIVABLE** (not seeded; view recalculates)

**Mock Data Structure**:
```json
"feed": [
  {
    "id": "f1",
    "from": "Priya Nair",
    "to": "Amit Deshpande",
    "value": "Collaborative",
    "behaviour": "Shared knowledge",
    "story": "Amit walked me through...",
    "impact": "We closed the ABC Client requirement...",
    "project": "ABC Client",
    "date": "Today, 10:24",
    "appreciations": 12
  },
  // ... 5 more feed items
]
```

**What This Represents**:
- A **filtered feed of approved recognitions** with appreciation counts
- Rendered from `v_recognition_feed` view (joins nominations + appreciations)

**Mapping to Database**:

| Feed Field | Source | Derivation |
|---|---|---|
| `id` | `nominations.id` | UUID from DB |
| `from` | `nominations.nominator_id` → employees.full_name | Join on nominator |
| `to` | `nominations.nominee_id` → employees.full_name | Join on nominee |
| `value` | `nominations.core_value_id` → core_values.name | Join on core_value |
| `behaviour` | `nominations.behaviour_id` → behaviours.name | Join on behaviour |
| `story` | `nominations.what_happened` | Direct column |
| `impact` | `nominations.what_impact` | Direct column |
| `project` | `nominations.project_id` → projects.name` OR `snapshot_project_name` | Join or use snapshot |
| `date` | `nominations.approved_at` | Convert to relative date ("Today, 10:24") |
| `appreciations` | COUNT of nomination_appreciations | Aggregate count |

**Seeding Approach**:
1. **Seed nomination records** (see section 9 below) with status='approved'
2. **Seed nomination_appreciations** (see section 10)
3. **View recalculates** automatically; no seed needed for feed section

**Why Not Seed Directly**: 
- Feed is a **computed view**, not a table
- Seeding recognitions will automatically populate the feed
- Sourcing feed from nominations ensures consistency with all other derived analytics

**Feed Items in Mock** → **Corresponding Nominations to Seed**:

| Feed | From | To | Value | Behaviour | Status | Notes |
|---|---|---|---|---|---|---|
| f1 | Priya | Amit | Collaborative | Shared knowledge | approved | 12 appreciations |
| f2 | Rahul | Shruti | Accountable | Delivered on commitment | approved | 9 appreciations |
| f3 | Ananya | Farhan | Innovative | Automated repetitive work | approved | 15 appreciations |
| f4 | Meera | Vikram | Transparent | Flagged a risk early | approved | 7 appreciations |
| f5 | Kiran | Priya | Adaptable | Adapted to changing requirements | approved | 11 appreciations |
| f6 | Amit | Ananya | Collaborative | Worked across teams | approved | 6 appreciations |

---

## 6. **journey** → Calculated from nominations (per employee)

**Status**: 🔄 **DERIVABLE** (recalculate from employee_value_badges)

**Mock Data Structure**:
```json
"journey": [
  {
    "key": "collaborative",
    "count": 18,
    "recognizers": 11,
    "last": "2 Aug"
  },
  // ... 4 more values
]
```

**What This Represents**:
- **Current user's (Shruti's) recognition count** per Core Value in current year
- Recognizers = unique employees who recognized for this value
- Last = most recent recognition date

**Mapping to Database**:

| Mock Field | Source | Derivation |
|---|---|---|
| `key` | Core Value slug | From core_values.slug |
| `count` | Approved nominations where nominee=current_user | SELECT COUNT(*) FROM nominations WHERE nominee_id=shruti_id AND status='approved' AND EXTRACT(YEAR FROM approved_at) = YEAR(NOW()) GROUP BY core_value_id |
| `recognizers` | Distinct nominators | SELECT COUNT(DISTINCT nominator_id) FROM ... |
| `last` | Most recent approval date | SELECT MAX(approved_at) FROM ... |

**Seeding Approach**:
1. **Seed nominations** for Shruti as nominee
2. **View/query recalculates** from nominations
3. **No seed data needed** for journey section

---

## 7. **team** → Calculated from nominations (per team member)

**Status**: 🔄 **DERIVABLE** (recalculate from employee_value_badges or nominations)

**Mock Data Structure**:
```json
"team": [
  {
    "name": "Rahul Menon",
    "role": "Backend Engineer",
    "counts": [2, 1, 9, 3, 5]  // [adaptable, transparent, collaborative, innovative, accountable]
  },
  // ... 4 more team members
]
```

**What This Represents**:
- **Manager's team recognition summary** (Meera's Platform team)
- Counts array = recognition count per value in canonical order

**Mapping to Database**:

| Mock Field | Source | Derivation |
|---|---|---|
| `name` | employees.full_name | Direct |
| `role` | employees.full_name (inferred from people[].role) | Note: DB stores job title differently |
| `counts[0]` | Adaptable | SELECT COUNT(*) FROM nominations WHERE nominee_id=rahul_id AND core_value_id=adaptable_id AND status='approved' |
| `counts[1]` | Transparent | Similar query for transparent |
| ... | ... | ... |
| `counts[4]` | Accountable | Similar query for accountable |

**Seeding Approach**:
1. **Seed nominations** with various employees as nominatees
2. **Query recalculates** per team member
3. **No seed data needed** for team section

---

## 8. **leaders** → Calculated from nominations (org-wide)

**Status**: 🔄 **DERIVABLE** (recalculate from nominations)

**Mock Data Structure**:
```json
"leaders": [
  {
    "name": "Priya Nair",
    "dept": "Design",
    "value": "Collaborative",
    "count": 31
  },
  // ... 4 more leaders
]
```

**What This Represents**:
- **Top 5 recognition leaders** org-wide (most recognized per value)
- Used for HR analytics dashboard

**Mapping to Database**:

| Mock Field | Source | Derivation |
|---|---|---|
| `name` | employees.full_name | Direct |
| `dept` | employees.department_id → departments.name | Join on department |
| `value` | core_values.name | From nominations.core_value_id |
| `count` | Approved nominations | SELECT COUNT(*) FROM nominations WHERE nominee_id=X AND core_value_id=Y AND status='approved' AND EXTRACT(YEAR FROM approved_at)=YEAR(NOW()) |

**Seeding Approach**:
1. **Seed nominations** with various nominatees
2. **Query recalculates** top leaders
3. **No seed data needed** for leaders section

---

## 9. **metrics** → Calculated from nominations & employee_value_badges

**Status**: 🔄 **DERIVABLE** (recalculate from aggregations)

**Mock Data Structure**:
```json
"hrMetrics": [
  {
    "label": "Recognitions this month",
    "value": "318",
    "note": "+12% on July"
  },
  // ... 3 more metrics
],
"employeeMetrics": [
  {
    "label": "Recognitions received",
    "value": "7",
    "note": "Across 4 core values"
  },
  // ... 3 more metrics
]
```

**What This Represents**:
- HR dashboard metrics (org-wide recognitions, participation, badges awarded)
- Employee dashboard metrics (personal recognitions given/received, most recognized value)

**Mapping to Database**:

| Metric | Source | Derivation |
|---|---|---|
| Recognitions this month | nominations | SELECT COUNT(*) FROM nominations WHERE status='approved' AND EXTRACT(YEAR_MONTH FROM approved_at)=CURRENT_YEAR_MONTH |
| Participation | employees & nominations | SELECT COUNT(DISTINCT nominator_id) FROM nominations WHERE status='approved' UNION SELECT total employees |
| Approval rate | nominations | SELECT COUNT(*) WHERE status='approved' / COUNT(*) WHERE status IN ('approved', 'rejected') |
| Badges awarded YTD | employee_value_badges | SELECT COUNT(*) FROM employee_value_badges WHERE badge_level IS NOT NULL AND period_type='annual' |

**Seeding Approach**:
1. **Seed nominations** with various statuses
2. **Queries recalculate** metrics on demand
3. **No seed data needed** for metrics section

---

## 10. **valueDistribution** & **badgeDistribution** → Calculated

**Status**: 🔄 **DERIVABLE** (recalculate from aggregations)

**Mock Data Structures**:
```json
"valueDistribution": [
  {"key": "collaborative", "count": 1284},
  // ... 4 more values
],
"badgeDistribution": [
  {"code": "B1", "count": 312},
  // ... 4 more badges
]
```

**What This Represents**:
- Organization-wide distribution of recognitions per Core Value
- Organization-wide distribution of badge levels across all employees

**Mapping to Database**:

| Distribution | Source | Query |
|---|---|---|
| valueDistribution | nominations | SELECT core_value_id, COUNT(*) FROM nominations WHERE status='approved' GROUP BY core_value_id |
| badgeDistribution | employee_value_badges | SELECT badge_level, COUNT(*) FROM employee_value_badges WHERE period_type='annual' AND badge_level IS NOT NULL GROUP BY badge_level |

**Seeding Approach**:
1. **Seed nominations** and employee_value_badges
2. **Queries recalculate** distributions
3. **No seed data needed** for distribution sections

---

### ❌ UI-ONLY / SESSION STATE SECTIONS

These sections represent **UI state**, **user session context**, or **runtime notifications**. **Never seed these**; they're generated at request time or stored in session.

---

## 11. **currentUser** → Session/auth context (UI-only)

**Status**: ❌ **UI-ONLY** (never seed)

**Mock Data**:
```json
"currentUser": "shruti"
```

**Purpose**: Identifies logged-in user in the UI

**Why Not Seed**: 
- This is **session state**, determined by who's logged in
- Generated from `auth.users` and `employees` join at request time
- Never stored in static seed data

---

## 12. **clarificationCallout** → Transient UI state (UI-only)

**Status**: ❌ **UI-ONLY** (never seed)

**Mock Data**:
```json
"clarificationCallout": {
  "title": "Your recognition for Vikram needs a little more context",
  "quote": "Meera Iyer asked: \"Please provide a little more context about the impact of this behaviour.\""
}
```

**Purpose**: Highlights a specific nomination awaiting clarification (transient message)

**Why Not Seed**: 
- This is derived from a specific **pending nomination** with status='clarification_requested'
- The callout is **computed per user**, not stored
- If you seed a nomination with status='clarification_requested', the UI will regenerate this callout automatically

---

## 13. **notifications** → Runtime-generated (UI-only)

**Status**: ❌ **UI-ONLY** (never seed; generated at runtime)

**Mock Data Structure**:
```json
"notifications": [
  {
    "title": "Priya recognized Amit for Collaborative",
    "body": "Your team is being noticed — open the feed to appreciate it.",
    "time": "10m",
    "kind": "recognition"
  },
  // ... 4 more notifications
]
```

**Purpose**: User notification center with different event types

**Why Not Seed**:
- Notifications are **generated by Edge Functions** when events occur
- Examples:
  - `recognition` → when a nomination is approved and affects a team member
  - `approval` → when a nomination submitted by user is approved
  - `badge` → when a nomination causes a badge level to increase
  - `system` → HR config changes
- **Seeding nominations will trigger notification generation** if Edge Functions are deployed

**Note**: The `notifications` table **can** be seeded if you want static test notifications, but it's not necessary for core functionality.

---

## 14. **given** & **received** → Nomination workflow state (UI-only)

**Status**: ⚠️ **PARTIALLY SEEDABLE** (core is seedable; status display is UI-only)

**Mock Data Structure**:
```json
"given": [
  {
    "to": "Amit Deshpande",
    "value": "Collaborative",
    "behaviour": "Shared knowledge",
    "date": "Today",
    "status": "Pending"  // or "Clarification", "Approved", "Not approved"
  },
  // ... 4 more given recognitions
],
"received": [
  {
    "from": "Rahul Menon",
    "value": "Accountable",
    "behaviour": "Delivered on a commitment",
    "project": "Nova Reporting",
    "date": "Today",
    "story": "Shruti owned the migration cutover..."
  },
  // ... 2 more received recognitions
]
```

**Purpose**: 
- **given**: Recognitions submitted by current user (Shruti), showing their workflow status
- **received**: Recognitions where current user is nominee, already approved

**Mapping to Database**:

| Field | Source | Seedability |
|---|---|---|
| `to`/`from` | employees.full_name | ✅ Seed from nominations |
| `value` | core_values.name | ✅ Seed from nominations |
| `behaviour` | behaviours.name | ✅ Seed from nominations |
| `date` | nominations.created_at or submitted_at | ✅ Seed from nominations |
| `status` | nominations.status | ✅ Seed status='pending', 'clarification_requested', 'approved', 'rejected' |
| `story` | nominations.what_happened | ✅ Seed from nominations |
| `project` | nominations.project_id → projects.name | ✅ Seed from nominations |

**Seeding Approach**:
1. **Seed nominations** with various statuses (pending, clarification_requested, approved, rejected)
2. **Frontend filters** these nominations per current user:
   - `given` = nominations WHERE nominator_id = current_user_id
   - `received` = nominations WHERE nominee_id = current_user_id AND status='approved'
3. **No special seed needed** for given/received sections; they're computed from nominations

**Data Quality Note**: 
- Mock `given` includes statuses like "Not approved" (rejected)
- When seeding, use `status` values: 'draft', 'pending', 'clarification_requested', 'approved', 'rejected'

---

## 15. **approvals** → Pending approvals queue (UI-only, HR/Manager context)

**Status**: ⚠️ **PARTIALLY SEEDABLE** (core is seedable; queue is computed)

**Mock Data Structure**:
```json
"approvals": [
  {
    "id": "a1",
    "from": "Shruti Kulkarni",
    "to": "Vikram Rao",
    "person": "shruti",
    "value": "Accountable",
    "behaviour": "Escalated a risk responsibly",
    "story": "Vikram caught the certificate expiry...",
    "impact": "A weekend outage that never happened...",
    "meta": "Helix Portal · submitted 2 hours ago",
    "age": "2h"
  },
  // ... 3 more pending approvals
]
```

**Purpose**: Approvals dashboard showing nominations pending review by current user (approver or manager)

**Mapping to Database**:

| Field | Source | Seedability |
|---|---|---|
| `id` | nominations.id | ✅ Seed from nominations |
| `from` | nominations.nominator_id → employees.full_name | ✅ Seed |
| `to` | nominations.nominee_id → employees.full_name | ✅ Seed |
| `person` | nominations.assigned_approver_id or nominee.manager_id | ✅ Inferred during seed |
| `value` | core_values.name | ✅ Seed |
| `behaviour` | behaviours.name | ✅ Seed |
| `story` | nominations.what_happened | ✅ Seed |
| `impact` | nominations.what_impact | ✅ Seed |
| `meta` | nominations.project_id + submitted_at | ✅ Seed |
| `age` | nominations.submitted_at | ✅ Seed |

**Seeding Approach**:
1. **Seed nominations** with status='pending' and assigned_approver_id set
2. **Frontend filters** pending nominations where assigned_approver_id = current_user_id
3. **No special seed needed** for approvals section; computed from nominations

**Data Quality Note**:
- Mock uses mock user IDs like "shruti", "priya"
- DB uses UUID; map from employee.employee_id (text) to UUID lookup

---

## 16. **quietPeople** → Calculated from nominations (HR analytics)

**Status**: 🔄 **DERIVABLE** (calculated per organizational context)

**Mock Data**:
```json
"quietPeople": [
  {
    "name": "Ananya Sharma",
    "role": "Business Analyst · Delivery"
  },
  {
    "name": "Kiran Joshi",
    "role": "Support Engineer · Service Desk"
  }
]
```

**Purpose**: HR dashboard showing employees with low recognition activity (not recognized in 90 days)

**Mapping to Database**:

| Field | Source | Derivation |
|---|---|---|
| `name` | employees.full_name | Direct |
| `role` | Custom format | `{job_title} · {department_name}` |

**Derivation Query**:
```sql
SELECT e.full_name, e.employee_id
FROM employees e
WHERE e.is_active = true
  AND NOT EXISTS (
    SELECT 1 FROM nominations n
    WHERE (n.nominee_id = e.id OR n.nominator_id = e.id)
      AND n.status = 'approved'
      AND n.approved_at > NOW() - INTERVAL '90 days'
  )
```

**Seeding Approach**:
1. **Seed nominations** with specific employees as nominatees
2. **Query recalculates** who hasn't been recognized recently
3. **No seed data needed** for quietPeople section

---

## 17. **managerMetrics** → Calculated for manager dashboard (UI-only)

**Status**: 🔄 **DERIVABLE** (calculated per manager context)

**Mock Data**:
```json
"managerMetrics": [
  {
    "label": "Pending approvals",
    "value": "live count",
    "note": "Oldest waiting 3 days"
  },
  {
    "label": "Published this month",
    "value": "23",
    "note": "+6 on July"
  },
  {
    "label": "Team members recognized",
    "value": "9 / 11",
    "note": "2 not recognized in 90 days"
  },
  {
    "label": "Median review time",
    "value": "11h",
    "note": "Target under 48h"
  }
]
```

**Purpose**: Dashboard metrics specific to a manager's team

**Mapping to Database**:

| Metric | Query | Derivation |
|---|---|---|
| Pending approvals | SELECT COUNT(*) FROM nominations WHERE assigned_approver_id = manager_id AND status = 'pending' | Computed |
| Published this month | SELECT COUNT(*) FROM nominations WHERE assigned_approver_id = manager_id AND status = 'approved' AND EXTRACT(YEAR_MONTH FROM approved_at) = CURRENT_YEAR_MONTH | Computed |
| Team members recognized | SELECT COUNT(DISTINCT nominee_id) FROM nominations WHERE nominee.manager_id = manager_id AND status='approved' | Computed |
| Median review time | SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (approved_at - submitted_at))) FROM nominations WHERE assigned_approver_id = manager_id AND status = 'approved' | Computed |

**Seeding Approach**:
1. **Seed nominations** with various statuses and assigned approvers
2. **Queries recalculate** per manager at request time
3. **No seed data needed** for managerMetrics section

---

## 18. **employeeStats** → Calculated for employee badge visualization

**Status**: 🔄 **DERIVABLE** (calculated per employee)

**Mock Data**:
```json
"employeeStats": {
  "_format": "[received, given] — 'Highest badge' column uses badgeFor(round(received / 3))",
  "amit": [19, 14],
  "priya": [31, 22],
  // ... 7 more employees
}
```

**Purpose**: Quick stat showing recognitions received/given per employee (used for visualization)

**Mapping to Database**:

| Stat | Source | Derivation |
|---|---|---|
| `received` | nominations where nominee_id=X | SELECT COUNT(*) FROM nominations WHERE nominee_id=X AND status='approved' AND EXTRACT(YEAR FROM approved_at)=CURRENT_YEAR |
| `given` | nominations where nominator_id=X | SELECT COUNT(*) FROM nominations WHERE nominator_id=X AND status='approved' AND EXTRACT(YEAR FROM approved_at)=CURRENT_YEAR |

**Seeding Approach**:
1. **Seed nominations** with various nominators/nominatees
2. **Queries recalculate** per employee
3. **No seed data needed** for employeeStats section

---

## 19. **unlockDialog** → Transient UI state (UI-only)

**Status**: ❌ **UI-ONLY** (never seed)

**Mock Data**:
```json
"unlockDialog": {
  "kicker": "New Core Value badge unlocked",
  "badge": "Kudos",
  "value": "Accountable",
  "level": 3,
  "body": "You've been recognized 8 times for taking ownership of commitments. Applause → Kudos."
}
```

**Purpose**: Shows when a user's badge level increases

**Why Not Seed**: 
- This is **computed in real-time** when a nomination is approved
- Edge Function calculates new badge level and triggers unlock dialog
- Never stored as static data

---

## 20. **loginDefaults** → Auth/UI context (UI-only)

**Status**: ❌ **UI-ONLY** (never seed)

**Mock Data**:
```json
"loginDefaults": {
  "email": "shruti.kulkarni@touchcore.in",
  "password": "••••••••••"
}
```

**Purpose**: Pre-fill login form for demo purposes

**Why Not Seed**: 
- This is **demo UX**, not data
- Passwords never stored in seed data
- Can be hard-coded in login component for demo

---

## 21. **org** → Metadata (UI-only)

**Status**: ❌ **UI-ONLY** / ⚠️ **PARTIALLY SEEDABLE**

**Mock Data**:
```json
"org": {
  "company": "Touchcore Systems",
  "employees": 412,
  "departments": 6,
  "period": "August 2026"
}
```

**Purpose**: Organization metadata displayed in headers/footers

**Mapping to Database**:

| Field | Source | Seedability |
|---|---|---|
| `company` | Static (company name) | ❌ Hard-code in UI or app_config |
| `employees` | Count of active employees | 🔄 Computed: SELECT COUNT(*) FROM employees WHERE is_active=true |
| `departments` | Count of active departments | 🔄 Computed: SELECT COUNT(*) FROM departments WHERE is_active=true |
| `period` | Current fiscal period | 🔄 Computed from app_config.badge_period_start_month |

**Seeding Approach**:
- Don't seed `org` section; it's calculated from app_config and employee/department counts at request time

---

## Summary Table: Seedable vs. Derived vs. UI-Only

| Section | Type | Action | Target | Record Count |
|---|---|---|---|---|
| **coreValues** | ✅ Seedable | Seed | core_values | 5 |
| **badges** | ✅ Seedable | Seed | badge_definitions | 5 |
| **people** | ✅ Seedable | Seed + Transform | employees | 9 |
| **departments** | ✅ Seedable | Seed | departments | 6 |
| **feed** | 🔄 Derivable | Skip (computed from nominations) | v_recognition_feed view | N/A |
| **journey** | 🔄 Derivable | Skip (computed per-user) | Query aggregate | N/A |
| **team** | 🔄 Derivable | Skip (computed per-manager) | Query aggregate | N/A |
| **leaders** | 🔄 Derivable | Skip (computed org-wide) | Query aggregate | N/A |
| **metrics** | 🔄 Derivable | Skip (computed on-demand) | Query aggregate | N/A |
| **valueDistribution** | 🔄 Derivable | Skip (computed org-wide) | Query aggregate | N/A |
| **badgeDistribution** | 🔄 Derivable | Skip (computed org-wide) | Query aggregate | N/A |
| **currentUser** | ❌ UI-Only | Skip (session state) | Session/Auth | N/A |
| **clarificationCallout** | ❌ UI-Only | Skip (transient) | Computed from nominations | N/A |
| **notifications** | ❌ UI-Only | Skip (runtime-generated) | Edge Functions | N/A |
| **given** | ⚠️ Partial | Seed nominations only | nominations | 5 |
| **received** | ⚠️ Partial | Seed nominations only | nominations | 3 |
| **approvals** | ⚠️ Partial | Seed nominations only | nominations | 4 |
| **quietPeople** | 🔄 Derivable | Skip (computed from absence) | Query aggregate | N/A |
| **managerMetrics** | 🔄 Derivable | Skip (computed per-manager) | Query aggregate | N/A |
| **employeeStats** | 🔄 Derivable | Skip (computed per-employee) | Query aggregate | N/A |
| **unlockDialog** | ❌ UI-Only | Skip (Edge Function trigger) | Edge Functions | N/A |
| **loginDefaults** | ❌ UI-Only | Skip (hard-code in UI) | Hard-coded | N/A |
| **org** | ⚠️ UI-Only | Skip (computed from counts) | Query aggregate | N/A |

---

## Seeding Order (Respecting FK Dependencies)

**Sequence**:

1. **app_config** ← Already seeded via `002_app_config.sql` (contains badge thresholds, rate limits, etc.)
2. **badge_definitions** ← From mock `badges` section (no dependencies)
3. **departments** ← From mock `people[].dept` + `departments[]` sections (no dependencies)
4. **core_values** ← From mock `coreValues` section (no dependencies)
5. **behaviours** ← From mock `coreValues[].behaviours` + future seed data (FK: core_values)
6. **scenarios** ← From future seed data (FK: behaviours, core_values)
7. **projects** ← From mock `people[].project` (no critical dependencies; optional manager_id)
8. **employees** ← From mock `people` section (FK: departments; optional: manager_id for backfill)
9. **project_members** ← Link employees to projects (FK: projects, employees)
10. **nominations** ← From mock `feed`, `given`, `received`, `approvals` sections (FK: employees, core_values, behaviours, scenarios, projects)
11. **nomination_appreciations** ← From mock `feed[].appreciations` counts (FK: nominations, employees)
12. **employee_value_badges** ← Calculated post-nomination (FK: employees, core_values, badge_definitions)
13. **badge_history** ← Calculated post-nomination (FK: employees, core_values, badge_definitions)
14. **notifications** ← Skip for seed; generated at runtime by Edge Functions
15. **audit_logs** ← Skip for seed; generated at runtime by Edge Functions

---

## Data Transformation Rules

### Rule 1: UUID Generation for Foreign Keys

Mock data uses **string IDs** (e.g., `amit`, `priya`). Database uses **UUIDs**.

**Transformation**:
- Generate or map employee string IDs to UUIDs:
  - `amit` → UUID generated on insert; store mapping `amit → <uuid-1>`
  - Reference in nominations: `nominator_id: <uuid-1>` (not string "amit")

**Implementation**:
```sql
-- Mapping table (temporary for seed)
CREATE TEMP TABLE employee_id_map (
  mock_id TEXT,
  real_id UUID
);

-- Seed employees, storing mapping
INSERT INTO employees (employee_id, full_name, ...)
VALUES ('amit', 'Amit Deshpande', ...)
RETURNING employee_id, id INTO employee_id_map;
```

### Rule 2: Email Generation

Mock data has no email addresses. Generate using pattern:

```
{firstname.lastname@touchcore.in}

Amit Deshpande → amit.deshpande@touchcore.in
Priya Nair → priya.nair@touchcore.in
```

### Rule 3: Manager Assignment

Mock data doesn't explicitly specify manager relationships. Infer from organizational structure:

- **Meera Iyer** (Engineering Manager in Platform) → manages:
  - Rahul Menon (Backend Engineer, Platform)
  - Vikram Rao (DevOps Engineer, Platform)

**Seed approach**:
1. Seed all employees first with manager_id = NULL
2. Post-seed, update manager relationships:
   ```sql
   UPDATE employees SET manager_id = (SELECT id FROM employees WHERE employee_id='meera')
   WHERE employee_id IN ('rahul', 'vikram');
   ```

### Rule 4: Snapshot Fields on Nominations

When seeding nominations, **capture snapshot fields at insert time**:

```sql
INSERT INTO nominations (
  nominator_id, nominee_id, core_value_id, behaviour_id,
  what_happened, what_impact,
  snapshot_nominator_dept,
  snapshot_nominee_dept,
  snapshot_core_value_name,
  snapshot_behaviour_name,
  status, approved_at, submitted_at
) VALUES (
  (SELECT id FROM employees WHERE employee_id='priya'),
  (SELECT id FROM employees WHERE employee_id='amit'),
  (SELECT id FROM core_values WHERE slug='collaborative'),
  (SELECT id FROM behaviours WHERE name='Shared knowledge'),
  'Amit walked me through...',
  'We closed the ABC Client requirement...',
  (SELECT d.name FROM employees e JOIN departments d ON e.department_id=d.id WHERE e.employee_id='priya'),
  (SELECT d.name FROM employees e JOIN departments d ON e.department_id=d.id WHERE e.employee_id='amit'),
  'Collaborative',
  'Shared knowledge',
  'approved',
  NOW(),
  NOW()
);
```

### Rule 5: Nomination Status Values

Mock `given[].status` uses user-friendly labels:
- "Pending" → DB: `pending`
- "Clarification" → DB: `clarification_requested`
- "Approved" → DB: `approved`
- "Not approved" → DB: `rejected`

**Seed mapping**:
```json
{
  "Pending": "pending",
  "Clarification": "clarification_requested",
  "Approved": "approved",
  "Not approved": "rejected"
}
```

### Rule 6: Timestamp Defaults

Mock data uses relative dates ("Today", "Yesterday", "2 days ago"). Seed with absolute timestamps:

```
Mock: "Today, 10:24" → DB: NOW()
Mock: "Yesterday" → DB: NOW() - INTERVAL '1 day'
Mock: "2 days ago" → DB: NOW() - INTERVAL '2 days'
```

### Rule 7: Appreciation Counts

Mock `feed[].appreciations` indicates the count of likes/appreciations on an approved nomination.

**Seed approach**:
1. Create nomination with status='approved'
2. For each appreciation count, insert N rows into nomination_appreciations:
   ```sql
   INSERT INTO nomination_appreciations (nomination_id, employee_id, created_at)
   SELECT <nom_id>, id, NOW()
   FROM employees
   WHERE employee_id IN (<list of N employees>)
   LIMIT <appreciation_count>;
   ```

---

## Data Quality Issues & Resolutions

| Issue | Severity | Impact | Resolution |
|---|---|---|---|
| Mock `role` is job title, not system role | High | Can't determine manager vs employee | Infer from title (contains "Manager" → manager role) |
| No explicit manager assignments | High | Can't seed manager_id correctly | Infer from organizational context; backfill post-seed |
| No email addresses | Low | Can't populate employee.email | Generate: firstname.lastname@touchcore.in |
| No avatar URLs | Low | Empty avatars in UI | Use NULL or placeholder URL |
| No auth.users linking | High | Can't authenticate users | Leave auth_user_id = NULL; require separate auth setup |
| Mock `scenario` field in feed not used | Low | Context only | Use for documentation; skip in seed |
| Mock dates are relative ("Today") | Medium | Hard to seed with absolute dates | Convert to NOW(), NOW()-1 day, etc. |
| Appreciation counts as integers, not employee lists | Medium | Can't seed which employees appreciated | Generate synthetic appreciation records; pick random employees |
| No explicit project assignments in mock | Low | Can omit project_id or leave NULL | Optional; can leave NULL for seed |
| Mock `person` field uses string IDs | Medium | Need to map to UUIDs | Create temp mapping table during seed |

---

## Seeding Script Outline (Pseudocode)

```typescript
/**
 * Seed ValueSpot mock data into Supabase
 * Sequence respects FK dependencies
 */

// Step 1: Load app_config (already done via 002_app_config.sql)
// Step 2: Seed badge_definitions from mock.badges
await seedBadgeDefinitions(mockData.badges);

// Step 3: Seed departments (inferred from mock.people[].dept)
const departments = extractUniqueDepartments(mockData.people);
await seedDepartments(departments);

// Step 4: Seed core_values from mock.coreValues
await seedCoreValues(mockData.coreValues);

// Step 5: Seed behaviours
// (Note: not in mock; would need separate seed or derive from mock.coreValues[].behaviours)
// await seedBehaviours(derivedBehaviours);

// Step 6: Seed scenarios (not in mock; skip or use placeholder)
// await seedScenarios(derivedScenarios);

// Step 7: Seed projects (inferred from mock.people[].project)
const projects = extractUniqueProjects(mockData.people);
await seedProjects(projects);

// Step 8: Seed employees from mock.people
const employeeMap = await seedEmployees(
  mockData.people,
  {
    departmentMap, // from step 3
    projectMap,    // from step 7
  }
);

// Step 9: Backfill manager relationships
await seedManagerRelationships(employeeMap);

// Step 10: Seed project_members
await seedProjectMembers(mockData.people, employeeMap, projectMap);

// Step 11: Seed nominations from mock.feed + mock.given + mock.received + mock.approvals
const nominationMap = await seedNominations(
  mockData,
  {
    employeeMap,
    coreValueMap,
    behaviourMap,
    scenarioMap,
    projectMap,
  }
);

// Step 12: Seed nomination_appreciations from mock.feed[].appreciations
await seedAppreciations(mockData.feed, nominationMap, employeeMap);

// Step 13: Calculate employee_value_badges (Edge Function post-seed)
// await calculateBadges(); // Triggered by Edge Function

// Step 14: Calculate badge_history (Edge Function post-seed)
// await calculateBadgeHistory(); // Triggered by Edge Function

console.log("Seed complete!");
```

---

## Next Steps (After Planning Approval)

1. **Review & Validate Mapping**: Confirm all field mappings and transformations
2. **Create Seed Script**: Build SQL or TypeScript script implementing transformations
3. **Test on Development DB**: Seed to dev environment; verify data integrity
4. **Validate Relationships**: Confirm all FKs resolve correctly
5. **Verify Views & Queries**: Run feed, metrics, leaders queries; compare to mock expectations
6. **Test RLS Policies**: Verify employees can/cannot see expected data
7. **Run E2E Tests**: Verify UI works with seeded data
8. **Document Seed Data**: Record what was seeded for future reference

---

## Appendix: Mock Data Statistics

- **Total sections**: 21
- **Seedable sections**: 4 (coreValues, badges, people, departments)
- **Derivable sections**: 9 (feed, journey, team, leaders, metrics, valueDistribution, badgeDistribution, quietPeople, managerMetrics, employeeStats)
- **UI-only sections**: 8 (currentUser, notifications, clarificationCallout, unlockDialog, loginDefaults, org)
- **Partial sections**: 3 (given, received, approvals)

- **Total database tables**: 18
- **Tables to seed**: 13 (app_config, badge_definitions, departments, core_values, behaviours, scenarios, projects, employees, project_members, nominations, nomination_appreciations, employee_value_badges, badge_history)
- **Tables to skip**: 3 (notifications, audit_logs, reciprocal_recognition_flags — runtime-generated or HR-only)

- **Records to seed**:
  - badge_definitions: 5
  - departments: 6
  - core_values: 5
  - behaviours: ~25 (not in mock; TBD)
  - scenarios: ~40+ (not in mock; TBD)
  - projects: 3 (ABC Client, Helix Portal, Nova Reporting)
  - employees: 9
  - project_members: ~15-20 (derived from people[].project)
  - nominations: ~16 (from feed + given + received + approvals)
  - nomination_appreciations: ~58 (sum of feed[].appreciations)

---

## Definitions

**Seedable**: Data that exists in mock JSON and maps directly to database tables; ready to insert.

**Derivable**: Data that is calculated from seeded records (recognitions, badges) or aggregated on-demand; not stored as seed.

**UI-Only**: Data that represents session state, transient messages, or real-time computations; never stored in seed.

**Partial**: Data where some aspects are seedable (recognition content) but presentation is computed (status, counts).

**Snapshot Fields**: Immutable fields on nominations that capture related data at insertion time (e.g., employee department name) to preserve historical accuracy.

**Edge Function**: Serverless function triggered by database events; used for badge calculations, notifications, approvals, audit logs.

