/**
 * The frontend API layer.
 *
 * Components import from here and nowhere else for server data. The one
 * deliberate exception is authentication: AuthContext, LoginPage, SignUpPage
 * and VerifyEmailStep talk to `supabase.auth` and the 2FA RPCs directly,
 * because GoTrue's session lifecycle and the session-bound second factor are
 * not request/response operations and wrapping them would obscure a security
 * boundary rather than clarify it.
 *
 * Migration is incremental by design — see PHASE_NOTES in the report. Screens
 * not yet moved still call Supabase directly and continue to work.
 */
export { ApiError, DEFAULT_PAGE_SIZE } from './client'
export type { Page, PageRequest } from './client'

export { employeesApi, invitationFailureMessage } from './employees'
export type { EmployeeListItem, EmployeeQuery, DeleteEmployeeResult } from './employees'

export { profileApi } from './profile'
export type { ProfileDetailsInput } from './profile'

export { recognitionsApi } from './recognitions'
export type {
  FeedPage, FeedSort, TeamFeed, MyRecognitionsTab, SubmitRecognitionInput, SubmitResult, ApprovalAction,
  ApprovalQueueItem, ApprovalQueuePerson, NominationDecision,
} from './recognitions'

export { commentsApi } from './comments'
export type { RecognitionComment, CommentThread } from './comments'

export { storeApi } from './store'
export type { MyRedemption, RedemptionRequest, RedeemResult } from './store'

export { coinAdminApi } from './coinAdmin'
export type { CoinPolicy, AdminWalletRow } from './coinAdmin'

export { walletApi } from './wallet'
export type {
  ValueCoinActivity, WalletSummary, WalletMonth, SendResult,
  CoinDirection, ActivityFilter, CoinBalances, CoinLimits,
} from './wallet'

export { referenceApi } from './reference'
/* The range the reward validity CHECK allows (052), so the HR form can say
   what the rule is instead of letting the constraint say it. */
export {
  REWARD_VALIDITY_MIN, REWARD_VALIDITY_MAX, REWARD_VALIDITY_DEFAULT,
  STORE_CATEGORY_LABEL_MAX,
} from './reference'
export type {
  ActiveFilter, BehaviourWithValue, ScenarioWithContext, ProjectWithManager,
  ActiveProject, SelectableProject, ManagedProject, ManagedProjectMember,
} from './reference'

export { settingsApi } from './settings'
export type { ConfigValue } from './settings'

export { auditApi, DEFAULT_AUDIT_PAGE_SIZE } from './audit'
export type { AuditLogPage } from './audit'

export {
  reportsApi, REPORT_ROW_LIMIT, RECOGNITION_SOURCES, RECOGNITION_STATUSES, compactFilters,
} from './reports'
export type {
  ReportSubject, EmployeeReport, OrganizationReport, ScopedReport, ScopedReportEmployee,
  ReportFilters, ReportFilterOptions, RecognitionSource, ReportStatusFilter,
  ExtractRow, ExtractResult,
  ReportCoreValue, ReportTrend, RecognitionCounts, ReportInsight, ReportInsightResult,
} from './reports'

export { adminApi } from './admin'
export type { PrivilegedRole, RoleHolder, PromotionCandidate, SecurityEvent } from './admin'

export { analyticsApi } from './analytics'
export type {
  HrDashboard, TrendPoint, CoreValueDistribution, DailyLeader,
  Leader, CoreValueLeaders, LeaderBoardValue, JourneyValue,
  EmployeeDashboard, ManagerDashboard, TeamBadges, TeamBadgeMember, TeamBadgeStanding,
  BadgeDistribution, BadgeDistributionSummary,
} from './analytics'

export { supportApi, moderationApi, AlreadySettledError } from './support'
export type {
  SupportRequest, SupportRequestStatus, SupportIssueType, RecognitionCorrection,
} from './support'
