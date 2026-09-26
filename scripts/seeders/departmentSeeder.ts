import { SupabaseClient } from '@supabase/supabase-js'
import { logStep, logSuccess, logError, formatCounts } from './utils.js'

interface MockData {
  people: Array<{ dept: string }>
  departments?: Array<{ name: string; pct: number }>
}

/**
 * Extract unique department names from mock data
 */
function extractDepartments(mockData: MockData): string[] {
  const depts = new Set<string>()

  // From people[].dept
  mockData.people.forEach((person) => {
    depts.add(person.dept)
  })

  // From departments[] analytics (if present)
  if (mockData.departments) {
    mockData.departments.forEach((dept) => {
      depts.add(dept.name)
    })
  }

  return Array.from(depts).sort()
}

/**
 * Seed departments into the database
 * Uses UPSERT to be safe for re-running
 */
export async function seedDepartments(
  supabase: SupabaseClient,
  mockData: MockData
): Promise<Record<string, number>> {
  logStep('DEPARTMENTS', 'Starting department seeding...')

  const departments = extractDepartments(mockData)

  if (departments.length === 0) {
    logStep('DEPARTMENTS', 'No departments found in mock data')
    return formatCounts(0, 0, 0)
  }

  logStep('DEPARTMENTS', `Found ${departments.length} departments to seed`)

  let inserted = 0
  const updated = 0
  let skipped = 0

  for (const deptName of departments) {
    try {
      // Check if department already exists
      const { data: existing, error: selectError } = await supabase
        .from('departments')
        .select('id, name')
        .eq('name', deptName)
        .single()

      if (selectError && selectError.code !== 'PGRST116') {
        // PGRST116 = no rows found (expected)
        throw selectError
      }

      if (existing) {
        // Department exists; skip
        logStep('DEPARTMENTS', `Skipped ${deptName} (already exists)`)
        skipped++
        continue
      }

      // Insert new department
      const { error: insertError } = await supabase.from('departments').insert({
        name: deptName,
        description: `${deptName} department`,
        is_active: true,
      })

      if (insertError) {
        // Handle unique constraint violation (race condition; another process inserted it)
        if (insertError.code === '23505') {
          logStep('DEPARTMENTS', `Skipped ${deptName} (constraint violation; already exists)`)
          skipped++
        } else {
          throw insertError
        }
      } else {
        logStep('DEPARTMENTS', `Inserted ${deptName}`)
        inserted++
      }
    } catch (error) {
      logError('DEPARTMENTS', `Failed to seed ${deptName}`, error)
      throw error
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('DEPARTMENTS', 'Department seeding complete', counts)

  return counts
}
