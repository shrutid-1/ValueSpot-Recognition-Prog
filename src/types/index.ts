import type {
  Database,
  UserRole,
  NominationStatus,
  RecognitionSource,
  PeriodType,
  NotificationType,
  ValueCoinTransactionKind,
  ValueCoinAccount,
  RewardCategory,
  RewardAssignmentOrigin,
  RedemptionStatus,
  RedemptionLifecycleStatus,
} from '@/lib/supabase-types'

// Re-export base types
export type {
  UserRole, NominationStatus, RecognitionSource, PeriodType, NotificationType,
  ValueCoinTransactionKind, ValueCoinAccount,
  RewardCategory, RewardAssignmentOrigin, RedemptionStatus,
  RedemptionLifecycleStatus,
}

// === Row types (convenience aliases) ===
export type Department    = Database['public']['Tables']['departments']['Row']
export type Employee      = Database['public']['Tables']['employees']['Row']
export type Project       = Database['public']['Tables']['projects']['Row']
export type ProjectMember = Database['public']['Tables']['project_members']['Row']
export type CoreValue     = Database['public']['Tables']['core_values']['Row']
export type Behaviour     = Database['public']['Tables']['behaviours']['Row']
export type Scenario      = Database['public']['Tables']['scenarios']['Row']
export type Nomination    = Database['public']['Tables']['nominations']['Row']
export type BadgeDefinition     = Database['public']['Tables']['badge_definitions']['Row']
export type EmployeeValueBadge  = Database['public']['Tables']['employee_value_badges']['Row']
export type BadgeHistory        = Database['public']['Tables']['badge_history']['Row']
export type Notification        = Database['public']['Tables']['notifications']['Row']
export type AuditLog            = Database['public']['Tables']['audit_logs']['Row']
export type AppConfig           = Database['public']['Tables']['app_config']['Row']
export type Reward              = Database['public']['Tables']['rewards']['Row']
export type RewardAssignment    = Database['public']['Tables']['reward_assignments']['Row']

// === View types ===
export type RecognitionFeedItem = Database['public']['Views']['v_recognition_feed']['Row']

// === Enriched types (with joins) ===
export interface EmployeeWithDept extends Employee {
  department: Pick<Department, 'id' | 'name'> | null
}

export interface EmployeeSearchResult {
  id: string
  employee_id: string
  full_name: string
  email: string
  role: UserRole
  avatar_url: string | null
  department_name: string | null
  manager_name: string | null
}

export interface NominationWithDetails extends Nomination {
  nominator: Pick<Employee, 'id' | 'full_name' | 'avatar_url'>
  nominee: Pick<Employee, 'id' | 'full_name' | 'avatar_url'>
  // `slug` is selected by every consumer and drives CoreValueBadge styling.
  core_value: Pick<CoreValue, 'id' | 'name' | 'slug' | 'accent_color' | 'icon'>
  behaviour: Pick<Behaviour, 'id' | 'name'> | null
  project: Pick<Project, 'id' | 'name'> | null
  /*
    Who decided it, when there is a decision. Exactly one of the three is set,
    matching the status; the role they held at the time is on the row itself
    (approved_by_role and its siblings, migration 042).
  */
  approved_by: Pick<Employee, 'id' | 'full_name'> | null
  rejected_by: Pick<Employee, 'id' | 'full_name'> | null
  clarification_requested_by: Pick<Employee, 'id' | 'full_name'> | null
}

export interface BadgeSummary {
  core_value_id: string
  core_value_name: string
  core_value_slug: string
  core_value_color: string
  core_value_icon: string
  badge_level: number | null
  badge_name: string | null
  recognition_count: number
  unique_recognizer_count: number
  next_threshold: number | null
  next_badge_name: string | null
  period_start: string
  period_end: string
}

export interface CoreValueLeader {
  core_value_id: string
  core_value_name: string
  employee_id: string
  employee_name: string
  employee_avatar: string | null
  department_name: string | null
  recognition_count: number
  unique_recognizer_count: number
  cross_team_recognizer_count: number
  months_with_recognition: number
  badge_level: number | null
  badge_name: string | null
  is_joint: boolean
}

export interface RecognitionStats {
  total: number
  approved: number
  pending: number
  rejected: number
  clarification_requested: number
}

// === Auth types ===
export interface AuthUser {
  id: string          // Supabase auth.users.id
  email: string
  employee: Employee  // Linked employee record
}

// === Form types ===
export interface RecognitionFormData {
  nominee_id: string
  core_value_id: string
  behaviour_id: string | null
  scenario_id: string | null
  what_happened: string
  what_impact: string
  project_id: string | null
  idempotency_key: string
}

export interface ApprovalAction {
  nomination_id: string
  action: 'approve' | 'reject' | 'request_clarification'
  reason?: string
  clarification_note?: string
}
