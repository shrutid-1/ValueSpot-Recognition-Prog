import { v5 as uuidv5 } from 'uuid'
import { formatErrorForDisplay } from './errorFormatter.js'

/**
 * ValueSpot UUID v5 namespace for deterministic UUID generation
 * Ensures same mock ID always generates same UUID (idempotent)
 */
const VALUESPOT_NAMESPACE = '550e8400-e29b-41d4-a716-446655440000'

/**
 * Generate a deterministic UUID from mock ID and table name
 * Ensures idempotency: same input always produces same output
 */
export function generateDeterministicUUID(table: string, mockId: string): string {
  return uuidv5(`${table}:${mockId}`, VALUESPOT_NAMESPACE)
}

/**
 * Generate email from full name
 * "Amit Deshpande" → "amit.deshpande@touchcoresystems.com"
 */
export function generateEmail(fullName: string): string {
  const parts = fullName.toLowerCase().split(' ')
  return `${parts.join('.')}@touchcoresystems.com`
}

/**
 * Format log message with timestamp
 */
export function logStep(step: string, message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString()
  const dataStr = data ? ` ${JSON.stringify(data)}` : ''
  console.log(`[${timestamp}] ${step}: ${message}${dataStr}`)
}

/**
 * Format error log with proper error details extraction
 */
export function logError(step: string, message: string, error?: unknown): void {
  const timestamp = new Date().toISOString()

  if (error) {
    const formattedError = formatErrorForDisplay(error, message)
    console.error(`[${timestamp}] ❌ ${step}:`)
    console.error(formattedError)
  } else {
    console.error(`[${timestamp}] ❌ ${step}: ${message}`)
  }
}

/**
 * Format success log
 */
export function logSuccess(step: string, message: string, data?: Record<string, unknown>): void {
  const timestamp = new Date().toISOString()
  const dataStr = data ? ` ${JSON.stringify(data)}` : ''
  console.log(`[${timestamp}] ✅ ${step}: ${message}${dataStr}`)
}

/**
 * Map mock data date strings to timestamps
 * "Today" → now()
 * "Yesterday" → now() - 1 day
 * "2 days ago" → now() - 2 days
 * "Today, 10:24" → today at 10:24
 * "2 Aug" → 2 Aug at midnight
 */
export function parseRelativeDate(dateStr: string): Date {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (dateStr === 'Today' || dateStr.startsWith('Today,')) {
    if (dateStr.startsWith('Today,')) {
      const [hours, minutes] = dateStr
        .split(',')[1]
        ?.trim()
        .split(':')
        .map((x) => parseInt(x)) || [0, 0]
      return new Date(today.getFullYear(), today.getMonth(), today.getDate(), hours, minutes)
    }
    return today
  }

  if (dateStr === 'Yesterday') {
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    return yesterday
  }

  const daysMatch = dateStr.match(/(\d+)\s+days?\s+ago/)
  if (daysMatch) {
    const days = parseInt(daysMatch[1])
    const past = new Date(today)
    past.setDate(past.getDate() - days)
    return past
  }

  // Try to parse "2 Aug" format
  const monthDayMatch = dateStr.match(/(\d+)\s+([A-Za-z]+)/)
  if (monthDayMatch) {
    const day = parseInt(monthDayMatch[1])
    const monthStr = monthDayMatch[2]
    const months = [
      'Jan',
      'Feb',
      'Mar',
      'Apr',
      'May',
      'Jun',
      'Jul',
      'Aug',
      'Sep',
      'Oct',
      'Nov',
      'Dec',
    ]
    const month = months.indexOf(monthStr)
    if (month >= 0) {
      return new Date(now.getFullYear(), month, day)
    }
  }

  // Default to today
  return today
}

/**
 * Infer system role from job title
 * "Engineering Manager" → "manager"
 * Anything else → "employee"
 */
export function inferSystemRole(jobTitle: string): 'employee' | 'manager' {
  if (jobTitle.toLowerCase().includes('manager')) {
    return 'manager'
  }
  return 'employee'
}

/**
 * Create a deterministic idempotency key for nominations
 * Format: "nominator_id:nominee_id:core_value_id:timestamp_ms"
 */
export function generateNominationIdempotencyKey(
  nominatorId: string,
  nomineeId: string,
  coreValueId: string,
  timestamp: number
): string {
  return `${nominatorId}:${nomineeId}:${coreValueId}:${timestamp}`
}

/**
 * Retry logic for database operations
 */
export async function retry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (attempt === maxRetries) throw error
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
  }
  throw new Error('Max retries exceeded')
}

/**
 * Format counts for display
 */
export function formatCounts(
  inserted: number,
  updated: number,
  skipped: number
): Record<string, number> {
  return {
    inserted,
    updated,
    skipped,
  }
}
