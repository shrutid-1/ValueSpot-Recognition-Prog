# Touchcore ValueSpot — Role & Permission Matrix

## Roles

| Code | Display Name | Description |
|---|---|---|
| `employee` | Employee | Standard employee, can give and receive recognition |
| `manager` | Manager | Employee + can approve/reject team nominations |
| `hr_admin` | HR Admin | Full HR operations, analytics, and configuration |
| `super_admin` | Super Admin | Technical/system administration |

---

## Permission Matrix

### Authentication & Session

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| Login | ✅ | ✅ | ✅ | ✅ |
| Logout | ✅ | ✅ | ✅ | ✅ |
| Password Reset | ✅ | ✅ | ✅ | ✅ |
| View own profile | ✅ | ✅ | ✅ | ✅ |
| Edit own profile | ✅ | ✅ | ✅ | ✅ |

---

### Recognition

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| Give recognition | ✅ | ✅ | ✅ | ✅ |
| Recognize own nominee | ❌ | ❌ | ❌ | ❌ |
| View own recognitions (given/received) | ✅ | ✅ | ✅ | ✅ |
| View approved recognition feed | ✅ | ✅ | ✅ | ✅ |
| Appreciate a recognition | ✅ | ✅ | ✅ | ✅ |
| View pending nominations (own) | ✅ | ✅ | ✅ | ✅ |
| View rejected nominations (own submitted) | ✅ | ✅ | ✅ | ✅ |
| View rejected nominations (own received) | ❌ | ❌ | ✅ | ✅ |
| View clarification requests (own) | ✅ | ✅ | ✅ | ✅ |
| Respond to clarification | ✅ | ✅ | ✅ | ✅ |
| View all nominations | ❌ | ❌ | ✅ | ✅ |
| Moderate/archive recognitions | ❌ | ❌ | ✅ | ✅ |

---

### Approval

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| View own approval queue | ❌ | ✅ | ✅ | ✅ |
| Approve nomination | ❌ | ✅ (own team) | ✅ | ✅ |
| Reject nomination | ❌ | ✅ (own team) | ✅ | ✅ |
| Request clarification | ❌ | ✅ (own team) | ✅ | ✅ |
| Approve own team member's nomination | ❌ | ✅ | ✅ | ✅ |
| Approve nomination for themselves | ❌ | ❌ | ❌ | ❌ |
| View team recognition analytics | ❌ | ✅ | ✅ | ✅ |

---

### Badges

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| View own badges | ✅ | ✅ | ✅ | ✅ |
| View own badge history | ✅ | ✅ | ✅ | ✅ |
| View own Core Value Journey | ✅ | ✅ | ✅ | ✅ |
| View team badges | ❌ | ✅ | ✅ | ✅ |
| View all employee badges | ❌ | ❌ | ✅ | ✅ |
| View badge analytics | ❌ | ❌ | ✅ | ✅ |
| Modify badge thresholds | ❌ | ❌ | ✅ | ✅ |
| View badge distribution | ❌ | ❌ | ✅ | ✅ |

---

### Notifications

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| View own notifications | ✅ | ✅ | ✅ | ✅ |
| Mark notifications as read | ✅ | ✅ | ✅ | ✅ |
| Mark all as read | ✅ | ✅ | ✅ | ✅ |

---

### Analytics

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| View own dashboard | ✅ | ✅ | ✅ | ✅ |
| View manager dashboard | ❌ | ✅ | ✅ | ✅ |
| View HR dashboard | ❌ | ❌ | ✅ | ✅ |
| View daily recognition leaders | ❌ | ❌ | ✅ | ✅ |
| View monthly leaders | ❌ | ❌ | ✅ | ✅ |
| View quarterly leaders | ❌ | ❌ | ✅ | ✅ |
| View annual Core Value leaders | ❌ | ❌ | ✅ | ✅ |
| View department analytics | ❌ | ❌ | ✅ | ✅ |
| View project analytics | ❌ | ❌ | ✅ | ✅ |
| View Core Value distribution | ❌ | ❌ | ✅ | ✅ |
| View recognition coverage | ❌ | ❌ | ✅ | ✅ |
| View cross-team recognition | ❌ | ❌ | ✅ | ✅ |
| View reciprocal flags | ❌ | ❌ | ✅ | ✅ |

---

### Reports

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| Generate monthly report | ❌ | ❌ | ✅ | ✅ |
| Generate quarterly report | ❌ | ❌ | ✅ | ✅ |
| Generate annual report | ❌ | ❌ | ✅ | ✅ |
| Generate custom report | ❌ | ❌ | ✅ | ✅ |
| Apply report filters | ❌ | ❌ | ✅ | ✅ |
| Export CSV | ❌ | ❌ | ✅ | ✅ |
| Export XLSX | ❌ | ❌ | ✅ | ✅ |

---

### Employee Management

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| View employee list | ❌ | ❌ | ✅ | ✅ |
| Add employee | ❌ | ❌ | ✅ | ✅ |
| Edit employee | ❌ | ❌ | ✅ | ✅ |
| Activate/deactivate employee | ❌ | ❌ | ✅ | ✅ |
| Assign manager | ❌ | ❌ | ✅ | ✅ |
| Assign department | ❌ | ❌ | ✅ | ✅ |
| Assign project | ❌ | ❌ | ✅ | ✅ |
| Assign role | ❌ | ❌ | ✅ | ✅ |
| Bulk import CSV | ❌ | ❌ | ✅ | ✅ |
| Export employee data | ❌ | ❌ | ✅ | ✅ |
| Change role to super_admin | ❌ | ❌ | ❌ | ✅ |

---

### Department & Project Management

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| Create department | ❌ | ❌ | ✅ | ✅ |
| Edit department | ❌ | ❌ | ✅ | ✅ |
| Create project | ❌ | ❌ | ✅ | ✅ |
| Edit project | ❌ | ❌ | ✅ | ✅ |
| Archive project | ❌ | ❌ | ✅ | ✅ |
| Manage project members | ❌ | ❌ | ✅ | ✅ |

---

### Core Value / Behaviour / Scenario Management

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| View active Core Values | ✅ | ✅ | ✅ | ✅ |
| View active behaviours | ✅ | ✅ | ✅ | ✅ |
| View active scenarios | ✅ | ✅ | ✅ | ✅ |
| Add/edit Core Value | ❌ | ❌ | ✅ | ✅ |
| Archive Core Value | ❌ | ❌ | ✅ | ✅ |
| Add/edit behaviour | ❌ | ❌ | ✅ | ✅ |
| Archive behaviour | ❌ | ❌ | ✅ | ✅ |
| Add/edit scenario | ❌ | ❌ | ✅ | ✅ |
| Archive scenario | ❌ | ❌ | ✅ | ✅ |
| Reorder Core Values | ❌ | ❌ | ✅ | ✅ |

---

### Rewards

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| View own rewards | ✅ | ✅ | ✅ | ✅ |
| Create reward types | ❌ | ❌ | ✅ | ✅ |
| Assign reward | ❌ | ❌ | ✅ | ✅ |
| Edit reward | ❌ | ❌ | ✅ | ✅ |

---

### System & Audit

| Permission | Employee | Manager | HR Admin | Super Admin |
|---|---|---|---|---|
| View audit logs | ❌ | ❌ | ✅ | ✅ |
| Configure approval rules | ❌ | ❌ | ✅ | ✅ |
| Configure financial year | ❌ | ❌ | ✅ | ✅ |
| Configure recognition limits | ❌ | ❌ | ✅ | ✅ |
| Configure timezone | ❌ | ❌ | ✅ | ✅ |
| Manage system roles | ❌ | ❌ | ❌ | ✅ |
| Security configuration | ❌ | ❌ | ❌ | ✅ |

---

## Navigation Map by Role

### Employee Navigation
```
Dashboard
Give Recognition
Recognition Feed
My Recognitions
My Core Value Journey
Notifications
─────────────
Profile
Settings
Logout
```

### Manager Navigation (includes Employee nav)
```
Dashboard
Give Recognition
Recognition Feed
My Recognitions
My Core Value Journey
Notifications
─────────────
[MANAGER]
Manager Dashboard
Pending Approvals
Team Recognition
Team Badges
─────────────
Profile
Settings
Logout
```

### HR Admin Navigation
```
Dashboard
Give Recognition
Recognition Feed
My Recognitions
My Core Value Journey
Notifications
─────────────
[MANAGER]
Pending Approvals
─────────────
[HR ADMIN]
HR Dashboard
Analytics
  └ Core Value Distribution
  └ Department Analytics
  └ Project Analytics
  └ Recognition Leaders
Badge Analytics
Reports
─────────────
[MANAGE]
Employees
Projects
Core Values
Behaviours
Scenarios
Rewards
─────────────
[SYSTEM]
Audit Logs
Settings
─────────────
Profile
Logout
```

---

## Escalation Authority Matrix

| Scenario | Approver |
|---|---|
| Standard nomination | Nominee's direct manager |
| Nominee IS their own manager | Next-level manager |
| Nominee's manager is inactive | Next-level manager |
| Nominee's manager is missing | HR fallback |
| Manager is nominated by their team | Manager's own manager |
| HR Admin nominated | Super Admin or peer HR |
| CEO/Top-level nominated | HR Admin |
| Nominator would be the approver | Escalate to next level |
