import { SupabaseClient } from '@supabase/supabase-js'
import { logStep, logSuccess, logError, formatCounts } from './utils.js'

interface MockPerson {
  id: string
  name: string
  project: string
}

interface MockData {
  people: MockPerson[]
}

interface EmployeeMap {
  [mockId: string]: {
    id: string
    name: string
    email: string
  }
}

/**
 * Seed project members (link employees to projects)
 */
export async function seedProjectMembers(
  supabase: SupabaseClient,
  mockData: MockData,
  employeeMap: EmployeeMap
): Promise<Record<string, number>> {
  logStep('PROJECT_MEMBERS', 'Starting project members seeding...')

  let inserted = 0
  const updated = 0
  let skipped = 0

  // Fetch project map
  const { data: projects, error: projectError } = await supabase
    .from('projects')
    .select('id, name')

  if (projectError) {
    logError('PROJECT_MEMBERS', 'Failed to fetch projects', projectError)
    throw projectError
  }

  const projectMap = new Map(projects.map((p) => [p.name, p.id]))

  const joinedAt = new Date('2026-01-01')

  for (const person of mockData.people || []) {
    try {
      const employeeId = employeeMap[person.id]?.id
      const projectId = projectMap.get(person.project)

      if (!employeeId) {
        logStep('PROJECT_MEMBERS', `Skipped ${person.name} (not in employee map)`)
        skipped++
        continue
      }

      if (!projectId) {
        logError('PROJECT_MEMBERS', `Project ${person.project} not found for ${person.name}`)
        skipped++
        continue
      }

      // Check if project member record already exists
      const { data: existing, error: selectError } = await supabase
        .from('project_members')
        .select('id')
        .eq('project_id', projectId)
        .eq('employee_id', employeeId)
        .single()

      if (selectError && selectError.code !== 'PGRST116') {
        throw selectError
      }

      if (existing) {
        logStep('PROJECT_MEMBERS', `Skipped ${person.name} in ${person.project} (already member)`)
        skipped++
        continue
      }

      // Insert project member
      const { error: insertError } = await supabase.from('project_members').insert({
        project_id: projectId,
        employee_id: employeeId,
        joined_at: joinedAt,
        is_active: true,
      })

      if (insertError) {
        if (insertError.code === '23505') {
          logStep('PROJECT_MEMBERS', `Skipped ${person.name} (constraint violation)`)
          skipped++
        } else {
          throw insertError
        }
      } else {
        logStep('PROJECT_MEMBERS', `Added ${person.name} to ${person.project}`)
        inserted++
      }
    } catch (error) {
      logError('PROJECT_MEMBERS', `Failed to seed project member for ${person.name}`, error)
      throw error
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('PROJECT_MEMBERS', 'Project members seeding complete', counts)

  return counts
}
