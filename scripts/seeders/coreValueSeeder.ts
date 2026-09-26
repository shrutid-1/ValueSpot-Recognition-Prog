import { SupabaseClient } from '@supabase/supabase-js'
import { logStep, logSuccess, logError, formatCounts } from './utils.js'

interface MockCoreValue {
  key: string
  name: string
  tone: string
  hex: string
  description: string
  scenario: string
  behaviours: string[]
}

interface MockData {
  coreValues: MockCoreValue[]
}

/**
 * Map mock core value keys to icons
 */
function getIconForValue(key: string): string {
  const iconMap: Record<string, string> = {
    adaptable: 'Zap',
    transparent: 'Eye',
    collaborative: 'Users',
    innovative: 'Lightbulb',
    accountable: 'CheckCircle',
  }
  return iconMap[key] || 'Star'
}

/**
 * Seed core values into the database
 */
export async function seedCoreValues(
  supabase: SupabaseClient,
  mockData: MockData
): Promise<Record<string, number>> {
  logStep('CORE_VALUES', 'Starting core values seeding...')

  const coreValues = mockData.coreValues || []

  if (coreValues.length === 0) {
    logStep('CORE_VALUES', 'No core values found in mock data')
    return formatCounts(0, 0, 0)
  }

  logStep('CORE_VALUES', `Found ${coreValues.length} core values to seed`)

  let inserted = 0
  const updated = 0
  let skipped = 0

  // Store core value IDs for behaviours seeding
  const coreValueMap = new Map<string, string>()

  for (let index = 0; index < coreValues.length; index++) {
    const cv = coreValues[index]
    try {
      // Check if core value already exists
      const { data: existing, error: selectError } = await supabase
        .from('core_values')
        .select('id, slug')
        .eq('slug', cv.key)
        .single()

      if (selectError && selectError.code !== 'PGRST116') {
        throw selectError
      }

      if (existing) {
        logStep('CORE_VALUES', `Skipped ${cv.name} (already exists)`)
        coreValueMap.set(cv.key, existing.id)
        skipped++
        continue
      }

      // Insert new core value
      const { data: insertedData, error: insertError } = await supabase
        .from('core_values')
        .insert({
          name: cv.name,
          slug: cv.key,
          definition: cv.description,
          icon: getIconForValue(cv.key),
          accent_color: cv.hex,
          display_order: index + 1,
          is_active: true,
        })
        .select('id')
        .single()

      if (insertError) {
        if (insertError.code === '23505') {
          // Unique constraint violation
          const { data: retryData } = await supabase
            .from('core_values')
            .select('id')
            .eq('slug', cv.key)
            .single()
          if (retryData) {
            coreValueMap.set(cv.key, retryData.id)
            skipped++
            continue
          }
        }
        throw insertError
      }

      if (insertedData) {
        coreValueMap.set(cv.key, insertedData.id)
        logStep('CORE_VALUES', `Inserted ${cv.name}`)
        inserted++
      }
    } catch (error) {
      logError('CORE_VALUES', `Failed to seed ${cv.name}`, error)
      throw error
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('CORE_VALUES', 'Core values seeding complete', counts)

  return counts
}

/**
 * Seed behaviours into the database
 * Behaviours are derived from coreValues[].behaviours array in mock data
 */
export async function seedBehaviours(
  supabase: SupabaseClient,
  mockData: MockData
): Promise<Record<string, number>> {
  logStep('BEHAVIOURS', 'Starting behaviours seeding...')

  const coreValues = mockData.coreValues || []
  let inserted = 0
  const updated = 0
  let skipped = 0

  // Build a map of core value slugs to IDs
  const { data: cvData, error: cvError } = await supabase
    .from('core_values')
    .select('id, slug')

  if (cvError) {
    logError('BEHAVIOURS', 'Failed to fetch core values', cvError)
    throw cvError
  }

  const coreValueMap = new Map(cvData.map((cv) => [cv.slug, cv.id]))

  // Process each core value's behaviours
  for (const cv of coreValues) {
    const coreValueId = coreValueMap.get(cv.key)
    if (!coreValueId) {
      logError('BEHAVIOURS', `Core value ${cv.key} not found in database`)
      continue
    }

    for (let index = 0; index < cv.behaviours.length; index++) {
      const behaviourName = cv.behaviours[index]

      try {
        // Check if behaviour already exists
        const { data: existing, error: selectError } = await supabase
          .from('behaviours')
          .select('id')
          .eq('core_value_id', coreValueId)
          .eq('name', behaviourName)
          .single()

        if (selectError && selectError.code !== 'PGRST116') {
          throw selectError
        }

        if (existing) {
          logStep('BEHAVIOURS', `Skipped ${behaviourName} for ${cv.name} (already exists)`)
          skipped++
          continue
        }

        // Insert new behaviour
        const { error: insertError } = await supabase.from('behaviours').insert({
          core_value_id: coreValueId,
          name: behaviourName,
          description: `${behaviourName} behaviour for ${cv.name}`,
          examples: [behaviourName],
          display_order: index + 1,
          is_active: true,
        })

        if (insertError) {
          if (insertError.code === '23505') {
            logStep('BEHAVIOURS', `Skipped ${behaviourName} (constraint violation)`)
            skipped++
          } else {
            throw insertError
          }
        } else {
          logStep('BEHAVIOURS', `Inserted ${behaviourName} for ${cv.name}`)
          inserted++
        }
      } catch (error) {
        logError('BEHAVIOURS', `Failed to seed behaviour ${behaviourName}`, error)
        throw error
      }
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('BEHAVIOURS', 'Behaviours seeding complete', counts)

  return counts
}

/**
 * Seed scenarios into the database
 * For MVP, create placeholder scenarios (1 per behaviour)
 */
export async function seedScenarios(
  supabase: SupabaseClient
): Promise<Record<string, number>> {
  logStep('SCENARIOS', 'Starting scenarios seeding...')

  let inserted = 0
  const updated = 0
  let skipped = 0

  // Fetch all behaviours
  const { data: behaviours, error: behaviourError } = await supabase
    .from('behaviours')
    .select('id, name, core_value_id')

  if (behaviourError) {
    logError('SCENARIOS', 'Failed to fetch behaviours', behaviourError)
    throw behaviourError
  }

  // For each behaviour, create a placeholder scenario
  for (const behaviour of behaviours || []) {
    try {
      // Check if scenario already exists
      const { data: existing, error: selectError } = await supabase
        .from('scenarios')
        .select('id')
        .eq('behaviour_id', behaviour.id)
        .single()

      if (selectError && selectError.code !== 'PGRST116') {
        throw selectError
      }

      if (existing) {
        logStep('SCENARIOS', `Skipped scenario for ${behaviour.name} (already exists)`)
        skipped++
        continue
      }

      // Insert placeholder scenario
      const { error: insertError } = await supabase.from('scenarios').insert({
        behaviour_id: behaviour.id,
        core_value_id: behaviour.core_value_id,
        name: `${behaviour.name} scenario`,
        description: `A situation where ${behaviour.name} was demonstrated`,
        examples: [behaviour.name],
        display_order: 1,
        is_active: true,
      })

      if (insertError) {
        if (insertError.code === '23505') {
          logStep('SCENARIOS', `Skipped ${behaviour.name} scenario (constraint violation)`)
          skipped++
        } else {
          throw insertError
        }
      } else {
        logStep('SCENARIOS', `Inserted scenario for ${behaviour.name}`)
        inserted++
      }
    } catch (error) {
      logError('SCENARIOS', `Failed to seed scenario for ${behaviour.name}`, error)
      throw error
    }
  }

  const counts = formatCounts(inserted, updated, skipped)
  logSuccess('SCENARIOS', 'Scenarios seeding complete', counts)

  return counts
}
