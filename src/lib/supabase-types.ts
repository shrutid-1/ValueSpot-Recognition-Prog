// Database types for the ValueSpot schema.
//
// NOTE: this file is maintained by hand and mirrors supabase/migrations/*.sql.
// `npm run supabase:types` regenerates it from a *local* Supabase instance and
// will overwrite these contents — only run it if you are running the stack
// locally, and re-check the Insert/Update optionality afterwards.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type UserRole = 'employee' | 'manager' | 'hr_admin' | 'super_admin'

export type NominationStatus =
  | 'draft'
  | 'pending'
  | 'clarification_requested'
  | 'approved'
  | 'rejected'
  /*
    Migration 034 — soft delete. A moderator removed it.

    Deliberately a status rather than a separate deleted flag: every feed,
    view, analytic and badge query in the product already selects on status,
    so a removed recognition drops out of all of them without any of those
    queries changing. Nothing lists 'removed' as a status it wants.
  */
  | 'removed'

export type RecognitionSource = 'peer' | 'manager' | 'hr' | 'leadership'

export type PeriodType = 'annual' | 'quarterly'

/** How a ledger row came to exist (048, extended by 050). */
export type ValueCoinTransactionKind =
  | 'signup_grant'       // the welcome coins, into earned
  | 'recognition_tip'    // a send: sender's budget out, recipient's earned in
  | 'monthly_allowance'  // the periodic top-up, into budget
  | 'allowance_expired'  // an unused budget forfeited at the reset
  | 'admin_adjustment'   // HR or a Super Admin moving a balance by hand
  | 'reward_redemption'  // earned coins spent in the Value Store (051)
  | 'reward_refund'      // a rejected redemption, returned in full (051)

/** Which of the two balances a ledger row moved (migration 050). */
export type ValueCoinAccount = 'budget' | 'earned'

/** Which shelf of the Value Store a reward sits on (migration 051). */
export type RewardCategory =
  | 'everyday' | 'experiences' | 'learning' | 'wellness' | 'recognition'

/** How a reward_assignments row came to exist (migration 051). */
export type RewardAssignmentOrigin = 'hr_assignment' | 'redemption'

/** Where a redemption has got to (migration 051). What the COLUMN holds. */
export type RedemptionStatus = 'pending' | 'approved' | 'rejected'

/**
 * What a redemption actually is right now (migration 052).
 *
 * 'expired' is never stored. redemption_effective_status() derives it by
 * comparing expires_at against the database clock at read time, so there is
 * no sweep to fall behind and no row that can sit in the wrong state. Only an
 * approved redemption can reach it.
 */
export type RedemptionLifecycleStatus = RedemptionStatus | 'expired'

export type NotificationType =
  | 'nomination_submitted'
  | 'approval_required'
  | 'clarification_requested'
  | 'nomination_approved'
  | 'nomination_rejected'
  | 'recognition_received'
  | 'team_recognition_published'
  | 'badge_unlocked'
  | 'monthly_report_ready'
  // Added by migration 034.
  | 'support_request_created'
  | 'support_request_resolved'
  | 'support_request_rejected'
  // Added by migration 046.
  | 'recognition_commented'
  // Added by migration 047.
  | 'comment_replied'
  // Added by migration 048.
  | 'value_coins_received'
  // Added by migration 051.
  | 'reward_requested'
  | 'reward_approved'
  | 'reward_rejected'

// ── Insert/Update helpers ───────────────────────────────────
// PostgREST accepts a row without any column the database can fill in itself.
// Modelling that here keeps inserts honest: required columns stay required,
// while generated, nullable and DEFAULT-ed columns become optional.

/** Columns the database always populates. */
type GeneratedColumn = 'id' | 'created_at' | 'updated_at'

/** Keys of `T` that accept null, and so may be omitted on insert. */
type NullableKeys<T> = { [K in keyof T]-?: null extends T[K] ? K : never }[keyof T]

/**
 * An insert payload for `Row`. `Defaulted` names the NOT NULL columns that
 * carry a DEFAULT in the schema and therefore need not be supplied.
 */
type InsertFor<Row, Defaulted extends keyof Row = never> =
  Omit<Row, Extract<GeneratedColumn | NullableKeys<Row> | Defaulted, keyof Row>> &
  Partial<Pick<Row, Extract<GeneratedColumn | NullableKeys<Row> | Defaulted, keyof Row>>>

/** An update payload: every column optional. */
type UpdateFor<Row> = Partial<Row>

export interface Database {
  public: {
    Tables: {
      departments: {
        Row: {
          id: string
          name: string
          description: string | null
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: InsertFor<Database['public']['Tables']['departments']['Row'], 'is_active'>
        Update: UpdateFor<Database['public']['Tables']['departments']['Row']>
        Relationships: []
      }
      employees: {
        Row: {
          id: string
          auth_user_id: string | null
          employee_id: string
          full_name: string
          email: string
          role: UserRole
          department_id: string | null
          manager_id: string | null
          avatar_url: string | null
          /** Profile banner image (054). */
          cover_url: string | null
          /** Job title — descriptive only, grants nothing. Access is `role`. (054) */
          designation: string | null
          location: string | null
          /** Profile skill chips. NOT NULL, defaults to an empty array (054). */
          skills: string[]
          is_active: boolean
          joined_at: string | null
          created_at: string
          updated_at: string
        }
        // employee_id is filled by the assign_employee_id trigger (migration 010)
        // when HR invites someone by email without supplying a Company ID.
        Insert: InsertFor<
          Database['public']['Tables']['employees']['Row'],
          'is_active' | 'employee_id' | 'skills'
        >
        Update: UpdateFor<Database['public']['Tables']['employees']['Row']>
        Relationships: [
          {
            foreignKeyName: 'employees_department_id_fkey'
            columns: ['department_id']
            isOneToOne: false
            referencedRelation: 'departments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employees_manager_id_fkey'
            columns: ['manager_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      projects: {
        Row: {
          id: string
          name: string
          description: string | null
          project_code: string | null
          manager_id: string | null
          is_active: boolean
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: InsertFor<Database['public']['Tables']['projects']['Row'], 'is_active'>
        Update: UpdateFor<Database['public']['Tables']['projects']['Row']>
        Relationships: [
          {
            foreignKeyName: 'projects_manager_id_fkey'
            columns: ['manager_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      project_members: {
        Row: {
          id: string
          project_id: string
          employee_id: string
          joined_at: string
          left_at: string | null
          is_active: boolean
          created_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['project_members']['Row'],
          'joined_at' | 'is_active'
        >
        Update: UpdateFor<Database['public']['Tables']['project_members']['Row']>
        Relationships: [
          {
            foreignKeyName: 'project_members_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'project_members_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      core_values: {
        Row: {
          id: string
          name: string
          slug: string
          definition: string
          icon: string
          accent_color: string
          display_order: number
          is_active: boolean
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['core_values']['Row'],
          'icon' | 'accent_color' | 'display_order' | 'is_active'
        >
        Update: UpdateFor<Database['public']['Tables']['core_values']['Row']>
        Relationships: []
      }
      behaviours: {
        Row: {
          id: string
          core_value_id: string
          name: string
          description: string | null
          examples: string[] | null
          display_order: number
          is_active: boolean
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['behaviours']['Row'],
          'display_order' | 'is_active'
        >
        Update: UpdateFor<Database['public']['Tables']['behaviours']['Row']>
        Relationships: [
          {
            foreignKeyName: 'behaviours_core_value_id_fkey'
            columns: ['core_value_id']
            isOneToOne: false
            referencedRelation: 'core_values'
            referencedColumns: ['id']
          },
        ]
      }
      scenarios: {
        Row: {
          id: string
          behaviour_id: string
          core_value_id: string
          name: string
          description: string | null
          examples: string[] | null
          display_order: number
          is_active: boolean
          archived_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['scenarios']['Row'],
          'display_order' | 'is_active'
        >
        Update: UpdateFor<Database['public']['Tables']['scenarios']['Row']>
        Relationships: [
          {
            foreignKeyName: 'scenarios_behaviour_id_fkey'
            columns: ['behaviour_id']
            isOneToOne: false
            referencedRelation: 'behaviours'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'scenarios_core_value_id_fkey'
            columns: ['core_value_id']
            isOneToOne: false
            referencedRelation: 'core_values'
            referencedColumns: ['id']
          },
        ]
      }
      nominations: {
        Row: {
          id: string
          nominator_id: string
          nominee_id: string
          core_value_id: string
          behaviour_id: string | null
          scenario_id: string | null
          what_happened: string
          what_impact: string
          project_id: string | null
          snapshot_nominator_dept: string | null
          snapshot_nominee_dept: string | null
          snapshot_nominee_manager_id: string | null
          snapshot_core_value_name: string
          snapshot_behaviour_name: string | null
          snapshot_scenario_name: string | null
          snapshot_project_name: string | null
          recognition_source: RecognitionSource
          status: NominationStatus
          assigned_approver_id: string | null
          escalation_level: number
          approved_by_id: string | null
          approved_at: string | null
          rejected_by_id: string | null
          rejected_at: string | null
          rejection_reason: string | null
          clarification_requested_at: string | null
          clarification_note: string | null
          clarification_responded_at: string | null
          /*
            Who decided, and in which role — added by migration 042.

            clarification_requested_by_id closes the gap that made clarification
            the one action with no recorded actor. The three *_by_role columns
            are SNAPSHOTS of the role held at the moment of the decision, so
            "Approved by Manager — John Doe" keeps saying Manager after John
            becomes an HR Admin. Null on decisions made before 042.
          */
          clarification_requested_by_id: string | null
          approved_by_role: UserRole | null
          rejected_by_role: UserRole | null
          clarification_requested_by_role: UserRole | null
          published_at: string | null
          idempotency_key: string | null
          submitted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['nominations']['Row'],
          'status' | 'escalation_level'
        >
        Update: UpdateFor<Database['public']['Tables']['nominations']['Row']>
        Relationships: [
          {
            foreignKeyName: 'nominations_nominator_id_fkey'
            columns: ['nominator_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nominations_nominee_id_fkey'
            columns: ['nominee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nominations_assigned_approver_id_fkey'
            columns: ['assigned_approver_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nominations_approved_by_id_fkey'
            columns: ['approved_by_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nominations_rejected_by_id_fkey'
            columns: ['rejected_by_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nominations_core_value_id_fkey'
            columns: ['core_value_id']
            isOneToOne: false
            referencedRelation: 'core_values'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nominations_behaviour_id_fkey'
            columns: ['behaviour_id']
            isOneToOne: false
            referencedRelation: 'behaviours'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nominations_scenario_id_fkey'
            columns: ['scenario_id']
            isOneToOne: false
            referencedRelation: 'scenarios'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nominations_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'projects'
            referencedColumns: ['id']
          },
        ]
      }
      nomination_appreciations: {
        Row: {
          id: string
          nomination_id: string
          employee_id: string
          created_at: string
        }
        Insert: InsertFor<Database['public']['Tables']['nomination_appreciations']['Row']>
        Update: never
        Relationships: [
          {
            foreignKeyName: 'nomination_appreciations_nomination_id_fkey'
            columns: ['nomination_id']
            isOneToOne: false
            referencedRelation: 'nominations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nomination_appreciations_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      /** Migration 046. The conversation under an approved recognition. */
      nomination_comments: {
        Row: {
          id: string
          nomination_id: string
          author_id: string
          body: string
          created_at: string
          /**
           * Migration 047. Null for a comment, set for a reply to one.
           *
           * Exactly two levels: a trigger refuses an insert whose parent is
           * itself a reply, so this is never a chain.
           */
          parent_comment_id: string | null
        }
        Insert: InsertFor<Database['public']['Tables']['nomination_comments']['Row']>
        // No UPDATE policy exists (046) — a comment is not editable.
        Update: never
        Relationships: [
          {
            foreignKeyName: 'nomination_comments_nomination_id_fkey'
            columns: ['nomination_id']
            isOneToOne: false
            referencedRelation: 'nominations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nomination_comments_author_id_fkey'
            columns: ['author_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nomination_comments_parent_comment_id_fkey'
            columns: ['parent_comment_id']
            isOneToOne: false
            referencedRelation: 'nomination_comments'
            referencedColumns: ['id']
          },
        ]
      }
      /**
       * Migration 048. One balance per employee.
       *
       * Written only by send_value_coins() and open_value_coin_wallet();
       * there is no write policy, so Insert and Update are unreachable.
       */
      value_coin_wallets: {
        Row: {
          employee_id: string
          /** Coins colleagues sent. Never resets, never spendable (050). */
          earned_balance: number
          /** The recognition budget. Tops up each period, may be forfeited. */
          budget_balance: number
          /** The period this budget belongs to. */
          budget_period_start: string | null
          /** When the one-time starting grant was made. */
          granted_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'value_coin_wallets_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: true
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      /** Migration 048. Append-only ledger behind the balances. */
      value_coin_transactions: {
        Row: {
          id: string
          /** Null for the welcome grant: it comes from the organisation. */
          sender_id: string | null
          recipient_id: string
          amount: number
          nomination_id: string | null
          kind: ValueCoinTransactionKind
          /** Which way the coins went, for rows with a single party (050). */
          effect: 'credit' | 'debit'
          /** Which balance moved (050). */
          account: ValueCoinAccount
          note: string | null
          created_at: string
        }
        Insert: never
        Update: never
        Relationships: [
          {
            foreignKeyName: 'value_coin_transactions_sender_id_fkey'
            columns: ['sender_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'value_coin_transactions_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'value_coin_transactions_nomination_id_fkey'
            columns: ['nomination_id']
            isOneToOne: false
            referencedRelation: 'nominations'
            referencedColumns: ['id']
          },
        ]
      }
      /** Migration 047. One person, one comment, liked or not. */
      nomination_comment_likes: {
        Row: {
          id: string
          comment_id: string
          employee_id: string
          created_at: string
        }
        Insert: InsertFor<Database['public']['Tables']['nomination_comment_likes']['Row']>
        // A like has nothing to change; there is no UPDATE policy (047).
        Update: never
        Relationships: [
          {
            foreignKeyName: 'nomination_comment_likes_comment_id_fkey'
            columns: ['comment_id']
            isOneToOne: false
            referencedRelation: 'nomination_comments'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'nomination_comment_likes_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      badge_definitions: {
        Row: {
          id: string
          level: number
          name: string
          description: string
          minimum_count: number
          maximum_count: number | null
          icon: string
          accent_color: string
          display_order: number
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['badge_definitions']['Row'],
          'icon' | 'accent_color' | 'display_order' | 'is_active'
        >
        Update: UpdateFor<Database['public']['Tables']['badge_definitions']['Row']>
        Relationships: []
      }
      employee_value_badges: {
        Row: {
          id: string
          employee_id: string
          core_value_id: string
          period_type: PeriodType
          period_start: string
          period_end: string
          recognition_count: number
          unique_recognizer_count: number
          badge_level: number | null
          last_updated: string
          created_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['employee_value_badges']['Row'],
          'recognition_count' | 'unique_recognizer_count' | 'last_updated'
        >
        Update: UpdateFor<Database['public']['Tables']['employee_value_badges']['Row']>
        Relationships: [
          {
            foreignKeyName: 'employee_value_badges_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'employee_value_badges_core_value_id_fkey'
            columns: ['core_value_id']
            isOneToOne: false
            referencedRelation: 'core_values'
            referencedColumns: ['id']
          },
        ]
      }
      badge_history: {
        Row: {
          id: string
          employee_id: string
          core_value_id: string
          previous_level: number | null
          new_level: number
          recognition_count: number
          achieved_at: string
          period_type: PeriodType
          period_start: string
          period_end: string
        }
        Insert: InsertFor<Database['public']['Tables']['badge_history']['Row'], 'achieved_at'>
        Update: never
        Relationships: [
          {
            foreignKeyName: 'badge_history_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'badge_history_core_value_id_fkey'
            columns: ['core_value_id']
            isOneToOne: false
            referencedRelation: 'core_values'
            referencedColumns: ['id']
          },
        ]
      }
      notifications: {
        Row: {
          id: string
          recipient_id: string
          type: NotificationType
          title: string
          body: string
          related_id: string | null
          related_type: string | null
          is_read: boolean
          read_at: string | null
          created_at: string
        }
        Insert: InsertFor<Database['public']['Tables']['notifications']['Row'], 'is_read'>
        Update: UpdateFor<Database['public']['Tables']['notifications']['Row']>
        Relationships: [
          {
            foreignKeyName: 'notifications_recipient_id_fkey'
            columns: ['recipient_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      recognition_support_requests: {
        Row: {
          id: string
          nomination_id: string
          requester_id: string
          issue_type: 'core_value' | 'behaviour' | 'scenario' | 'story' | 'impact' | 'project' | 'other'
          description: string
          /** Optional when a proposal is set (migration 060). */
          requested_change: string | null
          /*
            The Core Value > Behaviour > Scenario the requester wants (060).
            Read together: a null core value means no change to the chain was
            asked for; otherwise a null scenario means "none of the listed".
          */
          proposed_core_value_id: string | null
          proposed_behaviour_id: string | null
          proposed_scenario_id: string | null
          status: 'open' | 'in_progress' | 'resolved' | 'rejected'
          resolved_by_id: string | null
          /** Snapshot of the resolver's role when they acted — not a live join. */
          resolved_by_role: UserRole | null
          resolved_at: string | null
          resolution_note: string | null
          created_at: string
          updated_at: string
        }
        /*
          Insert and Update are declared for completeness of the generated
          shape only. The table has NO insert or update policy (migration 034):
          every write goes through a SECURITY DEFINER function, so a direct
          PostgREST write is refused whatever these types permit.
        */
        Insert: InsertFor<
          Database['public']['Tables']['recognition_support_requests']['Row'],
          'status'
        >
        Update: UpdateFor<Database['public']['Tables']['recognition_support_requests']['Row']>
        Relationships: [
          {
            foreignKeyName: 'recognition_support_requests_nomination_id_fkey'
            columns: ['nomination_id']
            isOneToOne: false
            referencedRelation: 'nominations'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recognition_support_requests_requester_id_fkey'
            columns: ['requester_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recognition_support_requests_resolved_by_id_fkey'
            columns: ['resolved_by_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recognition_support_requests_proposed_core_value_id_fkey'
            columns: ['proposed_core_value_id']
            isOneToOne: false
            referencedRelation: 'core_values'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recognition_support_requests_proposed_behaviour_id_fkey'
            columns: ['proposed_behaviour_id']
            isOneToOne: false
            referencedRelation: 'behaviours'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'recognition_support_requests_proposed_scenario_id_fkey'
            columns: ['proposed_scenario_id']
            isOneToOne: false
            referencedRelation: 'scenarios'
            referencedColumns: ['id']
          },
        ]
      }
      audit_logs: {
        Row: {
          id: string
          actor_id: string | null
          actor_email: string | null
          action: string
          entity_type: string
          entity_id: string | null
          previous_value: Json | null
          new_value: Json | null
          ip_address: string | null
          created_at: string
        }
        Insert: InsertFor<Database['public']['Tables']['audit_logs']['Row']>
        Update: never
        Relationships: [
          {
            foreignKeyName: 'audit_logs_actor_id_fkey'
            columns: ['actor_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      app_config: {
        Row: {
          key: string
          value: Json
          description: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: InsertFor<Database['public']['Tables']['app_config']['Row']>
        Update: UpdateFor<Database['public']['Tables']['app_config']['Row']>
        Relationships: [
          {
            foreignKeyName: 'app_config_updated_by_fkey'
            columns: ['updated_by']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
      rewards: {
        Row: {
          id: string
          name: string
          description: string | null
          frequency: string | null
          eligibility_criteria: string | null
          value_description: string | null
          /** Migration 051. What it costs in the Value Store. 0 = unpriced. */
          coin_price: number
          /** Migration 051. Which shelf of the store it sits on. */
          category: RewardCategory
          /**
           * Migration 052. Days an approved redemption stays usable, counted
           * from fulfilment. 1-365, enforced by a CHECK. Changing it affects
           * future redemptions only — existing ones carry their own snapshot.
           */
          redemption_validity_days: number
          requires_approval: boolean
          is_active: boolean
          created_at: string
          updated_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['rewards']['Row'],
          'requires_approval' | 'is_active' | 'redemption_validity_days'
        >
        Update: UpdateFor<Database['public']['Tables']['rewards']['Row']>
        Relationships: []
      }
      reward_assignments: {
        Row: {
          id: string
          reward_id: string
          employee_id: string
          assigned_by: string
          nomination_id: string | null
          notes: string | null
          /** Migration 051. 'redemption' when the employee raised it. */
          origin: RewardAssignmentOrigin
          status: RedemptionStatus
          /** The price PAID, copied at redemption. Null for an HR hand-out. */
          coin_cost: number | null
          /** What the reward was called at the time. */
          reward_name_snapshot: string | null
          decided_by_id: string | null
          decided_at: string | null
          decision_reason: string | null
          fulfilled_at: string | null
          /**
           * Migration 052. rewards.redemption_validity_days as it stood when
           * this was redeemed. NULL on rows predating 052 and on HR hand-outs.
           */
          validity_days_snapshot: number | null
          /**
           * Migration 052. Set at FULFILMENT, not at redemption — so it is
           * NULL while a request is pending and a pending request cannot
           * lapse while HR takes its time.
           */
          expires_at: string | null
          assigned_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['reward_assignments']['Row'],
          'assigned_at'
        >
        Update: never
        Relationships: [
          {
            foreignKeyName: 'reward_assignments_reward_id_fkey'
            columns: ['reward_id']
            isOneToOne: false
            referencedRelation: 'rewards'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reward_assignments_employee_id_fkey'
            columns: ['employee_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reward_assignments_assigned_by_fkey'
            columns: ['assigned_by']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reward_assignments_nomination_id_fkey'
            columns: ['nomination_id']
            isOneToOne: false
            referencedRelation: 'nominations'
            referencedColumns: ['id']
          },
        ]
      }
      reciprocal_recognition_flags: {
        Row: {
          id: string
          employee_a_id: string
          employee_b_id: string
          count: number
          last_flagged_at: string
          is_reviewed: boolean
          reviewed_by_id: string | null
          reviewed_at: string | null
          notes: string | null
          created_at: string
        }
        Insert: InsertFor<
          Database['public']['Tables']['reciprocal_recognition_flags']['Row'],
          'count' | 'last_flagged_at' | 'is_reviewed'
        >
        Update: UpdateFor<Database['public']['Tables']['reciprocal_recognition_flags']['Row']>
        Relationships: [
          {
            foreignKeyName: 'reciprocal_flags_employee_a_id_fkey'
            columns: ['employee_a_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reciprocal_flags_employee_b_id_fkey'
            columns: ['employee_b_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'reciprocal_flags_reviewed_by_id_fkey'
            columns: ['reviewed_by_id']
            isOneToOne: false
            referencedRelation: 'employees'
            referencedColumns: ['id']
          },
        ]
      }
    }
    Views: {
      /**
       * Migration 049. A Value Coin movement with the recognition behind it,
       * scoped to the calling employee and signed from their side.
       */
      v_value_coin_activity: {
        Row: {
          id: string
          created_at: string
          amount: number
          kind: ValueCoinTransactionKind
          note: string | null
          nomination_id: string | null
          account: ValueCoinAccount
          direction: 'in' | 'out'
          counterparty_id: string | null
          counterparty_name: string | null
          counterparty_avatar: string | null
          core_value_name: string | null
          project_name: string | null
          nominee_name: string | null
          nominator_name: string | null
        }
        Relationships: []
      }
      v_recognition_feed: {
        Row: {
          id: string
          approved_at: string | null
          published_at: string | null
          what_happened: string
          what_impact: string
          recognition_source: RecognitionSource
          nominator_id: string
          nominator_name: string
          nominator_avatar: string | null
          nominee_id: string
          nominee_name: string
          nominee_avatar: string | null
          core_value_id: string
          core_value_name: string
          core_value_color: string
          core_value_icon: string
          behaviour_name: string | null
          scenario_name: string | null
          project_name: string | null
          project_id: string | null
          appreciation_count: number
          /** Migration 046. */
          comment_count: number
          /** Migration 048. Value Coins sent on this recognition, in total. */
          value_coins_received: number
        }
        Relationships: []
      }
    }
    Functions: {
      /**
       * Advisory eligibility check used by the signup form (migration 011).
       * Returns { status, expected_role }. The on_auth_user_created trigger is
       * the actual enforcement — this only improves the message quality.
       */
      check_signup_eligibility: {
        Args: { p_email: string; p_full_name: string }
        Returns: Json
      }
      /**
       * Whether any employee records exist, so the signup form can explain the
       * founding-administrator case on a brand-new system (migration 011).
       */
      auth_setup_status: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Links the signed-in auth user to their employee record, creating one if
       * nobody invited them (migrations 011-013).
       *
       * Identity comes from auth.uid() and the JWT email claim, never from an
       * argument. p_access_code is a vestigial parameter kept only so a browser
       * still running a pre-018 bundle does not fail with "function does not
       * exist" mid-deploy; the database ignores it.
       */
      /**
       * p_require_invited_role (migration 026) is a RESTRICTION, not a grant.
       * The Manager and HR setup pages pass the role their invitation is for,
       * and the call is refused unless an employee record already says exactly
       * that. The role written still comes from the record — passing a higher
       * value cannot produce a higher role, only a refusal.
       */
      claim_employee_account: {
        Args: {
          p_access_code?: string | null
          p_require_invited_role?: 'manager' | 'hr_admin' | null
        }
        Returns: Json
      }
      /**
       * Migration 028. Twelve months of approved-recognition counts in one
       * round trip, replacing a twelve-query loop. SECURITY INVOKER, so RLS
       * still decides which rows are counted.
       */
      recognition_monthly_trend: {
        Args: { p_months?: number; p_timezone?: string }
        Returns: Json
      }
      /**
       * Migration 027. Sends the invitation email through Brevo. Takes only an
       * employee id — the destination path and the role in the message are
       * derived from the stored employees.role inside the function, so the
       * browser cannot influence either.
       */
      send_employee_invitation: {
        Args: { p_employee_id: string }
        Returns: Json
      }
      invitation_delivery_status: {
        Args: { p_employee_id: string }
        Returns: Json
      }
      /**
       * Migration 031. The newly registered person names their OWN department,
       * once, at the end of account creation. There is no employee-id argument
       * — the row is resolved from the session — and the write is skipped if a
       * department is already set, so it fills HR's gaps and never overwrites
       * HR's answer.
       */
      set_own_department: {
        Args: { p_department_id: string }
        Returns: Json
      }
      /*
        Migration 054 — the caller's own profile. Both resolve the row from
        auth.uid(); neither takes an employee id.
      */
      update_my_profile: {
        Args: {
          p_full_name: string
          p_designation: string | null
          p_location: string | null
          p_skills: string[]
        }
        Returns: Json
      }
      set_my_profile_image: {
        Args: { p_kind: 'avatar' | 'cover'; p_url: string | null }
        Returns: Json
      }
      /*
        Migration 034 — recognition moderation and support requests.

        Every one of these re-derives the caller's role from the `employees`
        table and refuses on its own. Being callable from TypeScript is not
        being permitted to call it.
      */
      can_moderate_recognitions: {
        Args: Record<string, never>
        Returns: boolean
      }
      moderate_recognition: {
        Args: {
          p_nomination_id: string
          p_core_value_id?: string
          p_behaviour_id?: string
          p_scenario_id?: string
          p_what_happened?: string
          p_what_impact?: string
          p_project_id?: string
          p_clear_behaviour?: boolean
          p_clear_scenario?: boolean
          p_clear_project?: boolean
        }
        Returns: Json
      }
      remove_recognition: {
        Args: { p_nomination_id: string; p_reason?: string }
        Returns: Json
      }
      create_support_request: {
        Args: {
          p_nomination_id: string
          p_description: string
          p_requested_change?: string
          p_proposed_core_value_id?: string
          p_proposed_behaviour_id?: string
          p_proposed_scenario_id?: string
          /** Only for the previous app build; derived by the database since 060. */
          p_issue_type?: string
        }
        Returns: Json
      }
      resolve_support_request: {
        Args: {
          p_request_id: string
          p_resolution_note?: string
          p_core_value_id?: string
          p_behaviour_id?: string
          p_scenario_id?: string
          p_what_happened?: string
          p_what_impact?: string
          p_project_id?: string
          p_clear_behaviour?: boolean
          p_clear_scenario?: boolean
          p_clear_project?: boolean
        }
        Returns: Json
      }
      reject_support_request: {
        Args: { p_request_id: string; p_reason: string }
        Returns: Json
      }
      claim_support_request: {
        Args: { p_request_id: string }
        Returns: Json
      }
      /**
       * Migration 033. Removes a department and detaches anyone in it, in one
       * transaction. SECURITY INVOKER — the caller's own RLS decides, so this
       * grants nothing HR did not already have.
       */
      delete_department: {
        Args: { p_department_id: string }
        Returns: Json
      }
      /**
       * Migration 032. Active department names for the create-account form,
       * which runs before there is a session to read the table with. Callable
       * by anon deliberately; returns id and name only.
       */
      signup_departments: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Active project names for the create-account form (migration 038).
       * Readable by anon, because the caller has no account yet. With
       * p_for_manager, only projects that have no Project Manager.
       */
      signup_projects: {
        Args: { p_for_manager?: boolean }
        Returns: Json
      }
      /**
       * Active projects run by the CALLING manager, each with its active
       * members (migration 040). Takes no arguments: the manager comes from
       * the session. SECURITY INVOKER, so RLS still decides.
       */
      managed_projects: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * The recognitions the CALLER may review (migration 042).
       *
       * Takes no arguments on purpose: a Manager is scoped to what was routed
       * to them, HR and Super Admin see the organisation, and which of those
       * applies is read from the session — so there is nothing in the request
       * to point at somebody else's queue.
       */
      recognition_approval_queue: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Record the project chosen during account creation (migration 038).
       * Writes projects.manager_id for a Manager and project_members for
       * everyone else, choosing by the caller's own role rather than by any
       * argument. Never displaces an assignment HR has already made.
       */
      set_own_project: {
        Args: { p_project_id: string }
        Returns: Json
      }
      /**
       * The only supported way to change an employee's role (migration 016).
       * A trigger rejects a direct write to employees.role from a browser
       * session, so this is not merely the preferred path — it is the only one.
       */
      set_employee_role: {
        Args: { p_employee_id: string; p_role: 'employee' | 'manager' | 'hr_admin' | 'super_admin' }
        Returns: Json
      }
      /** Current super admins, for handover and last-admin warnings (016). */
      list_administrators: {
        Args: Record<string, never>
        Returns: Json
      }
      /** Current HR admins, for the Access & roles screen (migration 017). */
      list_hr_administrators: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Audit events that changed who can administer the system (017).
       * A filtered read of audit_logs, not a second audit trail.
       */
      list_security_activity: {
        Args: { p_limit?: number }
        Returns: Json
      }
      /**
       * Deletes every audit log entry and records the clearing as the first
       * new one (055). Super Admin only. Returns { status, removed }.
       */
      clear_audit_log: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Requests a six-digit code for the CURRENT session (migration 021).
       * Takes no arguments: it acts on auth.uid() and the JWT's session_id, and
       * refuses any session whose `amr` does not already contain `password`.
       */
      request_login_code: {
        Args: Record<string, never>
        Returns: Json
      }
      /** Verifies the code against this session and marks it verified (021). */
      verify_login_code: {
        Args: { p_code: string }
        Returns: Json
      }
      /** Whether this session has cleared the second step (021). */
      session_status: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Did the email provider actually accept the last code? (024)
       *
       * pg_net is asynchronous, so request_login_code() returns "ok" meaning
       * queued, not delivered. This reports what the provider answered, so the
       * code screen can say a message was refused instead of leaving someone
       * waiting for an email that was never sent. Returns a status code and a
       * category — never the provider's response body.
       */
      login_code_delivery_status: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Clears the caller's second-factor verification on logout (023).
       *
       * signOut() revokes the refresh token, but the access token already in
       * the browser stays valid until it expires. Deleting the verification
       * row makes 022's policies refuse that token immediately instead of
       * waiting out its lifetime. Acts only on the caller's own rows.
       */
      revoke_login_verification: {
        Args: { p_all_sessions?: boolean }
        Returns: Json
      }
      /** Email domains permitted to self-register (migration 014). */
      get_signup_domains: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Replaces the self-registration domain allowlist (migration 014).
       * An empty array means unrestricted. Normalisation and validation happen
       * in the database, so the caller may pass what the user typed.
       */
      set_signup_domains: {
        Args: { p_domains: string[] }
        Returns: Json
      }
      /**
       * Opens the caller's Value Coin wallet if it is not open yet, granting
       * the configured starting balance exactly once, and returns the balance
       * either way (migration 048).
       *
       * Takes no employee id on purpose: the employee is read from the
       * session, so this cannot be aimed at somebody else's wallet.
       */
      ensure_my_value_coin_wallet: {
        Args: Record<string, never>
        Returns: Json
      }
      /**
       * Every employee's balances, for HR and a Super Admin (migration 050).
       * The role is re-derived from `employees`, not read off the JWT.
       */
      admin_list_value_coin_wallets: {
        Args: { p_search?: string | null; p_limit?: number }
        Returns: Json
      }
      /**
       * Move one employee's budget or earned balance by a DELTA, with a
       * required reason, recorded in the ledger and the audit log (050).
       */
      /**
       * Spend earned Value Coins on a reward (migration 051).
       *
       * Takes only the reward id: the employee is the session's, and the
       * price, the active flag and whether approval is needed are all read
       * from `rewards` inside the function. Returns
       * { redemption_id, status, coin_cost, reward_name, earned } plus, from
       * 052, { validity_days, expires_at } — the term read off the reward and
       * the expiry, which is null until somebody approves it.
       */
      redeem_reward: {
        Args: { p_reward_id: string }
        Returns: Json
      }
      /**
       * Approve or reject a pending redemption (051). Rejecting refunds the
       * cost RECORDED ON THE REQUEST, as its own ledger row. HR/Super Admin
       * only, re-derived from `employees`.
       */
      decide_reward_redemption: {
        Args: { p_redemption_id: string; p_action: 'approve' | 'reject'; p_reason?: string | null }
        Returns: Json
      }
      /**
       * The organisation's redemptions, for HR and a Super Admin (051).
       * Since 052 each row also carries effective_status, expires_at,
       * validity_days_snapshot and expires_soon, and p_status accepts
       * 'expired' — which selects on the DERIVED status, since no row is
       * ever stored that way.
       */
      list_reward_redemptions: {
        Args: { p_status?: string; p_limit?: number }
        Returns: Json
      }
      /**
       * The caller's own redemptions (052). No employee argument: `me` is
       * the session's, inside the function. An RPC rather than a select so
       * that 'expired' is decided by the database's clock, never a laptop's.
       */
      list_my_redemptions: {
        Args: { p_limit?: number }
        Returns: Json
      }
      /**
       * The status a redemption actually has now (052). Exposed for SQL
       * callers; the browser never needs it, because every list that
       * returns a redemption has already applied it.
       */
      redemption_effective_status: {
        Args: { p_status: string; p_expires_at: string | null }
        Returns: string
      }
      admin_adjust_value_coin_wallet: {
        Args: {
          p_employee_id: string
          p_account: ValueCoinAccount
          p_delta: number
          p_reason: string
        }
        Returns: Json
      }
      /**
       * Moves Value Coins from the caller to the nominee of an approved
       * recognition (migration 048). Returns
       * { transaction_id, amount, balance }, where balance is the SENDER's
       * remaining balance read inside the same lock as the debit.
       *
       * There is no sender argument. It is the session's employee.
       */
      /**
       * The whole Value Wallet in one call (migration 049): balance, this
       * month, lifetime totals, how many recognitions have earned coins, and
       * a six-month received/given series with zeroes for quiet months.
       */
      value_coin_summary: {
        Args: Record<string, never>
        Returns: Json
      }
      send_value_coins: {
        Args: {
          p_recipient_id: string
          p_amount: number
          p_nomination_id: string
          p_note?: string | null
        }
        Returns: Json
      }
    }
    Enums: Record<string, never>
  }
}
