import { SupabaseClient } from '@supabase/supabase-js'
import { logStep, logSuccess, logError, formatCounts } from './utils.js'

interface MockData {
  people: Array<{ project: string }>
}

/**
 * Extract unique project names from mock data
 */
function extractProjects(mockData: MockData): string[] {
  const projects = new Set<string>()

  mockData.people.forEach((person) => {
    projects.add(person.project)
  })

  return Array.from(projects).sort()
}

/**
 * Generate project code from project name
 * "ABC Client" → "ABC"
 * "Helix Portal" → "HELIX"
 */
function generateProjectCode(projectName: string): string {
  // Take first letters of each word and uppercase
  const code = projectName
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()

  // Fallback if no words
  return code || projectName.substring(0, 5).toUpperCase()
}

/**
 * Seed projects into the database
 */
export async function seedProjects(
  supabase: SupabaseClient,
  mockData: MockData
): Promise<Record<string, number>> {
  logStep('PROJECTS', 'Starting projects seeding...')

  const projects = extractProjects(mockData)

  if (projects.length === 0) {
    logStep('PROJECTS', 'No projects found in mock data')
    return formatCounts(0, 0, 0)
  }

  logStep('PROJECTS', `Found ${projects.length} projects to seed`)

  let inserted = 0
  const updated = 0
  let skipped = 0

  for (const projectName of projects) {
    try {
      const projectCode = generateProjectCode(projectName)

      // Check if project already exists
      const { data: existing, error: selectError } = await supabase
        .from('projects')
        .select('id, project_code')
        .eq('project_code', projectCode)
        .single()

      if (selectError && selectError.code !== 'PGRST116') {
        throw selectError
      }

      if (existing) {
        logStep('PROJECTS', `Skipped ${projectName} (already exists)`)
        skipped++
        continue
      }

      // Insert new project
      const { error: insertError } = await supabase.from('projects').insert({
        name: projectName,
        description: `${projectName} project`,
        project_code: projectCode,
        manager_id: null, // No manager in mock data
        is_active: true,
      })

      if (insertError) {
        if (insertError.code === '23505') {
          logStep('PROJECTS', `Skipped ${projectName} (constraint violation)`)
          skipped++
        } else {
          throw insertError
        }
      } else {
        logStep('PROJECTS', `Inserted ${projectName}`)
        inserted++
      }
    } catch (error) {
      logError('PROJECTS', `Failed to seed ${projectName}`, error)
      throw error
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('PROJECTS', 'Projects seeding complete', counts)

  return counts
}
