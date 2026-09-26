/** React Query hooks, grouped by domain. Each calls src/lib/api, never Supabase. */
export {
  useEmployeeDirectory,
  useCreateEmployee, useUpdateEmployeeProfile, useSetEmployeeRole,
  useSetEmployeeActive, useSendInvitation, useDeleteEmployee,
} from './useEmployees'

export { useSaveMyProfile } from './useProfile'
export type { SaveMyProfileInput } from './useProfile'

export {
  useCoreValues, useCreateCoreValue, useUpdateCoreValue, useSetCoreValueActive,
  useBehaviours, useBehavioursWithValues, useCreateBehaviour, useUpdateBehaviour,
  useSetBehaviourActive,
  useScenarios, useScenariosWithContext, useCreateScenario, useUpdateScenario,
  useSetScenarioActive,
  useProjects, useProjectsWithManager, useManagedProjects, useCreateProject, useUpdateProject,
  useSetProjectActive, useDeleteProject, useEligibleProjectManagers, useSelectableProjects,
  useEmployeeProject, useSetEmployeeProject,
  useRewards, useCreateReward, useUpdateReward,
  useDepartments, useCreateDepartment, useUpdateDepartment, useSetDepartmentActive,
  useDeleteDepartment, useDepartmentMemberCount,
  useBadgeDefinitions,
} from './useReference'

export {
  useRecognitionFeed, useMyRecognitions, useApprovalQueue,
  useDecideApproval, useResubmitWithClarification, useTeamRecognitions,
} from './useRecognitions'

export {
  useCommentThread, useAddComment, useRemoveComment, useToggleCommentLike,
} from './useComments'

export {
  useWalletBalance, useWalletSummary, useWalletActivity, useSendValueCoins,
} from './useWallet'

export {
  useCoinPolicy, useSaveCoinPolicy, useAdminWallets, useAdjustWallet,
} from './useCoinAdmin'

export {
  useStoreRewards, useMyRedemptions, useRedeemReward,
  useRedemptionRequests, useDecideRedemption,
} from './useStore'

export {
  useReportSubjects, useEmployeeReport, useOrganizationReport, useReportInsights,
  useReportFilterOptions, useScopedReport,
} from './useReports'

export {
  useRoleHolders, usePromotionCandidates, useSetPrivilegedRole,
  useSignupDomains, useSetSignupDomains, useSecurityActivity,
} from './useAdmin'

export {
  useHrDashboard, useCoreValueLeaders, useEmployeeDashboard, useCoreValueJourney,
  useManagerDashboard, useTeamBadges, useBadgeDistribution,
} from './useAnalytics'

export {
  useAppConfig, useSetNumericConfig, useSetBadgeThresholds,
} from './useSettings'

export { useAuditLog, useClearAuditLog } from './useAudit'

export {
  useMySupportRequests, useCreateSupportRequest,
  useSupportQueue, useClaimSupportRequest,
  useResolveSupportRequest, useRejectSupportRequest,
  useEditRecognition, useRemoveRecognition,
} from './useSupport'
