/**
 * Error Formatter for Supabase/PostgREST Errors
 *
 * Properly extracts and formats:
 * - Supabase/PostgREST API errors
 * - PostgreSQL constraint violations
 * - JavaScript Error objects
 * - Unknown error objects
 */

interface FormattedError {
  message: string
  code?: string
  details?: string
  hint?: string
  statusCode?: number
  raw?: string
}

/**
 * Safely convert error to string without [object Object]
 */
function safeErrorToString(error: unknown): string {
  if (error === null || error === undefined) {
    return 'Unknown error (null or undefined)'
  }

  // JavaScript Error object
  if (error instanceof Error) {
    return error.message
  }

  // String
  if (typeof error === 'string') {
    return error
  }

  // Number or boolean
  if (typeof error === 'number' || typeof error === 'boolean') {
    return String(error)
  }

  // Object - try to stringify safely
  try {
    return JSON.stringify(error, null, 2)
  } catch (stringifyError) {
    // Handle circular references or non-serializable objects
    try {
      // Create a safe version with only own properties
      const safe: Record<string, unknown> = {}
      for (const key in error as Record<string, unknown>) {
        try {
          safe[key] = (error as Record<string, unknown>)[key]
        } catch {
          safe[key] = '[Unable to access property]'
        }
      }
      return JSON.stringify(safe, null, 2)
    } catch {
      return '[Error object not serializable]'
    }
  }
}

/**
 * Extract Supabase/PostgREST error details
 */
function extractSupabaseError(error: unknown): Partial<FormattedError> {
  const result: Partial<FormattedError> = {}

  if (typeof error !== 'object' || error === null) return result

  // Supabase/PostgREST error shape: { message, code, details, hint, statusCode }
  const err = error as Record<string, unknown>
  if (typeof err.message === 'string') result.message = err.message
  if (typeof err.code === 'string') result.code = err.code
  if (typeof err.details === 'string') result.details = err.details
  if (typeof err.hint === 'string') result.hint = err.hint
  if (typeof err.statusCode === 'number') result.statusCode = err.statusCode

  return result
}

/**
 * Map PostgreSQL error codes to user-friendly descriptions
 */
function describePostgresError(code?: string): string | undefined {
  const pgErrors: Record<string, string> = {
    '23501': 'Foreign key constraint violation - referenced record not found',
    '23502': 'Not null constraint violation',
    '23503': 'Foreign key constraint violation - cannot delete or update parent record',
    '23505': 'Unique constraint violation - duplicate value',
    '23514': 'Check constraint violation',
    '42P01': 'Undefined table',
    '42703': 'Undefined column',
    '42704': 'Undefined object',
    '08006': 'Connection failure',
    '57P03': 'Cannot execute queries during recovery',
  }
  return code ? pgErrors[code] : undefined
}

/**
 * Format error for display with proper details
 *
 * @param error - The error to format (can be any type)
 * @param context - Optional context about where the error occurred
 * @returns Formatted error object with message, code, details, etc.
 */
export function formatError(error: unknown, context?: string): FormattedError {
  const result: FormattedError = { message: '' }

  // Try to extract Supabase-specific error details
  const supabaseDetails = extractSupabaseError(error)
  Object.assign(result, supabaseDetails)

  // If no message extracted, use safe string conversion
  if (!result.message) {
    result.message = safeErrorToString(error)
  }

  // Add PostgreSQL error description if code exists
  if (result.code) {
    const pgDescription = describePostgresError(result.code)
    if (pgDescription && !result.details) {
      result.details = pgDescription
    }
  }

  // Add context if provided
  if (context) {
    result.raw = `${context}: ${result.message}`
  }

  return result
}

/**
 * Format error for console display
 */
export function formatErrorForDisplay(error: unknown, context?: string): string {
  const formatted = formatError(error, context)
  const lines: string[] = []

  if (formatted.message) {
    lines.push(`Error message: ${formatted.message}`)
  }

  if (formatted.code) {
    lines.push(`Error code: ${formatted.code}`)
  }

  if (formatted.details) {
    lines.push(`Details: ${formatted.details}`)
  }

  if (formatted.hint) {
    lines.push(`Hint: ${formatted.hint}`)
  }

  if (formatted.statusCode) {
    lines.push(`Status code: ${formatted.statusCode}`)
  }

  return lines.join('\n')
}

/**
 * Format error for JSON/structured logging
 */
export function formatErrorForLogging(error: unknown, context?: string): object {
  const formatted = formatError(error, context)
  return {
    message: formatted.message,
    ...(formatted.code && { code: formatted.code }),
    ...(formatted.details && { details: formatted.details }),
    ...(formatted.hint && { hint: formatted.hint }),
    ...(formatted.statusCode && { statusCode: formatted.statusCode }),
  }
}

/**
 * Extract the most important error information (for summary display)
 */
export function extractErrorSummary(error: unknown): { message: string; code?: string } {
  const formatted = formatError(error)
  return {
    message: formatted.message,
    ...(formatted.code && { code: formatted.code }),
  }
}

/**
 * Validate that error is a real error (not a false positive)
 */
export function isRealError(error: unknown): boolean {
  if (error === null || error === undefined) {
    return false
  }

  if (error instanceof Error && error.message === '') {
    return false
  }

  return true
}

/**
 * Get error type name for logging
 */
export function getErrorTypeName(error: unknown): string {
  if (error === null) return 'null'
  if (error === undefined) return 'undefined'
  if (error instanceof Error) return error.constructor.name
  if (typeof error === 'object') {
    return (error as { constructor?: { name?: string } }).constructor?.name ?? 'Object'
  }
  return typeof error
}
