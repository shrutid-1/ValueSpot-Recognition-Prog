import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { seedDepartments } from './departmentSeeder.js'
import { seedCoreValues, seedBehaviours, seedScenarios } from './coreValueSeeder.js'
import { seedProjects } from './projectSeeder.js'
import { seedEmployees, backfillManagerRelationships } from './employeeSeeder.js'
import type { EmployeeMap } from './employeeSeeder.js'
import { seedProjectMembers } from './projectMemberSeeder.js'
import { seedNominations, seedAppreciations } from './nominationSeeder.js'
import { logStep, logSuccess, logError } from './utils.js'
import { formatError } from './errorFormatter.js'

import type { MockData, SeededNomination } from './mockDataTypes.js'

interface StepError {
  step: string
  message: string
  code?: string
  details?: string
  hint?: string
}

interface SeedResult {
  success: boolean
  startTime: Date
  endTime: Date
  duration: number
  steps: Record<string, Record<string, number>>
  errors: StepError[]
  failedStep?: string
}

/**
 * Main seeding service orchestrating all seeders in dependency order
 */
export class SeedService {
  private supabase: SupabaseClient
  private supabaseUrl: string
  private mockData: MockData
  private result: SeedResult

  constructor(supabase: SupabaseClient, mockData: MockData, supabaseUrl = '') {
    this.supabase = supabase
    this.supabaseUrl = supabaseUrl
    this.mockData = mockData
    this.result = {
      success: false,
      startTime: new Date(),
      endTime: new Date(),
      duration: 0,
      steps: {},
      errors: [],
    }
  }

  /**
   * Execute full seeding process in dependency order
   */
  async seed(): Promise<SeedResult> {
    const startTime = Date.now()

    try {
      logStep('SEED_SERVICE', '🚀 Starting ValueSpot data seeding...')
      logStep('SEED_SERVICE', `Seeding timestamp: ${new Date().toISOString()}`)

      // Helper function to execute step with error handling
      const executeStep = async (
        stepName: string,
        operation: () => Promise<Record<string, number>>
      ): Promise<boolean> => {
        try {
          const result = await operation()
          this.result.steps[stepName] = result
          return true
        } catch (error) {
          const formatted = formatError(error)
          this.result.failedStep = stepName
          this.result.errors.push({
            step: stepName,
            message: formatted.message,
            code: formatted.code,
            details: formatted.details,
            hint: formatted.hint,
          })
          logError('SEED_SERVICE', `Failed at step: ${stepName}`, error)
          return false
        }
      }

      // Step 1: Departments (no dependencies)
      if (!(await executeStep('departments', () => seedDepartments(this.supabase, this.mockData)))) {
        throw new Error('Seeding failed at departments step')
      }

      // Step 2: Core Values (no dependencies)
      if (!(await executeStep('core_values', () => seedCoreValues(this.supabase, this.mockData)))) {
        throw new Error('Seeding failed at core_values step')
      }

      // Step 3: Behaviours (depends on core_values)
      if (!(await executeStep('behaviours', () => seedBehaviours(this.supabase, this.mockData)))) {
        throw new Error('Seeding failed at behaviours step')
      }

      // Step 4: Scenarios (depends on behaviours)
      if (!(await executeStep('scenarios', () => seedScenarios(this.supabase)))) {
        throw new Error('Seeding failed at scenarios step')
      }

      // Step 5: Projects (no dependencies)
      if (!(await executeStep('projects', () => seedProjects(this.supabase, this.mockData)))) {
        throw new Error('Seeding failed at projects step')
      }

      // Step 6: Employees (depends on departments)
      let employeeMap: EmployeeMap = {}
      if (
        !(await executeStep('employees', async () => {
          employeeMap = await seedEmployees(this.supabase, this.mockData)
          return {
            inserted: Object.keys(employeeMap).length,
            updated: 0,
            skipped: 0,
          }
        }))
      ) {
        throw new Error('Seeding failed at employees step')
      }

      // Step 7: Backfill Manager Relationships (depends on employees)
      if (
        !(await executeStep('manager_backfill', () =>
          backfillManagerRelationships(this.supabase, this.mockData, employeeMap)
        ))
      ) {
        throw new Error('Seeding failed at manager_backfill step')
      }

      // Step 8: Project Members (depends on projects, employees)
      if (
        !(await executeStep('project_members', () =>
          seedProjectMembers(this.supabase, this.mockData, employeeMap)
        ))
      ) {
        throw new Error('Seeding failed at project_members step')
      }

      // Step 9: Nominations (depends on employees, core_values, behaviours, projects)
      let nominations: SeededNomination[] = []
      if (
        !(await executeStep('nominations', async () => {
          // Split the carried nomination rows off the reported counts, so the
          // step result stays a plain count map.
          const { _nominations, ...counts } =
            await seedNominations(this.supabase, this.mockData, employeeMap)
          nominations = _nominations ?? []
          return counts
        }))
      ) {
        throw new Error('Seeding failed at nominations step')
      }

      // Step 10: Appreciations (depends on nominations, employees)
      if (
        !(await executeStep('appreciations', () => seedAppreciations(this.supabase, nominations, employeeMap)))
      ) {
        throw new Error('Seeding failed at appreciations step')
      }

      // Step 11: Calculate Badges (optional, via Edge Function if available)
      logStep('SEED_SERVICE', 'Attempting badge calculation via Edge Function...')
      try {
        const supabaseUrl = this.supabaseUrl
        const { data: sessionData } = await this.supabase.auth.getSession()
        const token = sessionData?.session?.access_token

        if (!token) {
          logStep('SEED_SERVICE', `Badge calculation skipped (no auth token available)`)
        } else {
          const response = await fetch(`${supabaseUrl}/functions/v1/calculate-badges`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ force: true }),
          })

          if (response.ok) {
            const badgeResult = await response.json() as {
              badges_created?: number
              badges_updated?: number
              processed?: number
            }
            this.result.steps['badges'] = {
              inserted: badgeResult.badges_created ?? 0,
              updated: badgeResult.badges_updated ?? 0,
              skipped: 0,
            }
            logSuccess('SEED_SERVICE', 'Badge calculation complete', badgeResult)
          } else {
            logStep('SEED_SERVICE', `Badge calculation skipped (Edge Function returned ${response.status})`)
          }
        }
      } catch (error) {
        const formatted = formatError(error)
        logStep('SEED_SERVICE', `Badge calculation skipped: ${formatted.message}`)
      }

      this.result.success = true
      this.result.endTime = new Date()
      this.result.duration = Date.now() - startTime

      logSuccess('SEED_SERVICE', '✅ Seeding complete!', {
        duration: `${this.result.duration}ms`,
        steps: Object.keys(this.result.steps).length,
      })

      this.printSummary()

      return this.result
    } catch (error) {
      this.result.success = false
      this.result.endTime = new Date()
      this.result.duration = Date.now() - startTime

      const formatted = formatError(error)
      if (this.result.errors.length === 0) {
        this.result.errors.push({
          step: 'SEED_SERVICE',
          message: formatted.message,
          code: formatted.code,
          details: formatted.details,
          hint: formatted.hint,
        })
      }

      logError('SEED_SERVICE', `❌ Seeding failed: ${formatted.message}`, error)

      this.printSummary()

      return this.result
    }
  }

  /**
   * Print summary of seeding results with detailed error information
   */
  private printSummary(): void {
    console.log('\n' + '='.repeat(60))
    console.log('SEEDING SUMMARY')
    console.log('='.repeat(60))

    for (const [step, counts] of Object.entries(this.result.steps)) {
      const { inserted, updated, skipped } = counts
      console.log(
        `  ${step.padEnd(20)} │ ✏️  ${inserted} inserted, 🔄 ${updated} updated, ⏭️  ${skipped} skipped`
      )
    }

    console.log('='.repeat(60))
    console.log(`Status: ${this.result.success ? '✅ SUCCESS' : '❌ FAILED'}`)
    console.log(`Duration: ${this.result.duration}ms`)

    if (this.result.failedStep) {
      console.log(`\nFailed step: ${this.result.failedStep}`)
    }

    if (this.result.errors.length > 0) {
      console.log('\nErrors:')
      for (const err of this.result.errors) {
        console.log(`\n  Step: ${err.step}`)
        console.log(`  Message: ${err.message}`)
        if (err.code) console.log(`  Code: ${err.code}`)
        if (err.details) console.log(`  Details: ${err.details}`)
        if (err.hint) console.log(`  Hint: ${err.hint}`)
      }
    }

    console.log('='.repeat(60) + '\n')
  }

  /**
   * Get detailed step results
   */
  getStepResults(step: string): Record<string, number> | undefined {
    return this.result.steps[step]
  }

  /**
   * Get all results
   */
  getResults(): SeedResult {
    return this.result
  }
}

/**
 * Convenience function to create seed service and execute
 * @param supabaseUrl - Supabase project URL
 * @param supabaseKey - Supabase API key (service role for seeding, anon for regular use)
 * @param mockData - Mock data to seed
 */
export async function runSeeding(
  supabaseUrl: string,
  supabaseKey: string,
  mockData: MockData
): Promise<SeedResult> {
  const supabase = createClient(supabaseUrl, supabaseKey)

  // Test connection
  try {
    const { error } = await supabase.from('departments').select('id').limit(1)
    if (error) {
      throw error
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to connect to Supabase: ${message}`)
  }

  const seedService = new SeedService(supabase, mockData, supabaseUrl)
  return seedService.seed()
}
