#!/usr/bin/env node

/**
 * ValueSpot Seeding Verification Script
 *
 * Verifies that seeded data is correctly present in the database
 * Runs after seeding completes
 *
 * Usage:
 *   npm run seed:verify
 *
 * Environment Variables:
 *   VITE_SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (for bypassing RLS, optional)
 */

import * as fs from 'fs'
import * as path from 'path'
import { createClient } from '@supabase/supabase-js'

interface VerificationResult {
  step: string
  expected: number
  actual: number
  status: 'PASS' | 'FAIL' | 'WARN'
  message: string
}

const results: VerificationResult[] = []

function logResult(
  step: string,
  expected: number,
  actual: number,
  message: string
): void {
  const status = actual >= expected ? 'PASS' : 'FAIL'
  const icon = status === 'PASS' ? '✅' : '❌'

  results.push({ step, expected, actual, status, message })
  console.log(`${icon} ${step}: ${actual}/${expected} ${message}`)
}

async function main() {
  try {
    // Load environment
    const envPath = path.resolve(process.cwd(), '.env')
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8')
      envContent.split('\n').forEach((line) => {
        const [key, value] = line.split('=')
        if (key && value && !line.trim().startsWith('#')) {
          process.env[key.trim()] = value.trim().replace(/^["']|["']$/g, '')
        }
      })
    }

    const supabaseUrl = process.env.VITE_SUPABASE_URL
    // Prefer service role key (for full access), fall back to anon key
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY

    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ Missing Supabase credentials in .env')
      console.error('   VITE_SUPABASE_URL:', supabaseUrl ? '✅' : '❌ missing')
      console.error('   SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY:', supabaseKey ? '✅' : '❌ missing')
      process.exit(1)
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    console.log('🔍 Verifying seeded data...\n')

    // 1. Check departments
    const { count: deptCount, error: deptError } = await supabase
      .from('departments')
      .select('*', { count: 'exact', head: true })
    if (deptError) throw deptError
    logResult('Departments', 6, deptCount || 0, 'departments seeded')

    // 2. Check core values
    const { count: cvCount, error: cvError } = await supabase
      .from('core_values')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
    if (cvError) throw cvError
    logResult('Core Values', 5, cvCount || 0, 'core values seeded')

    // 3. Check behaviours
    const { count: bhCount, error: bhError } = await supabase
      .from('behaviours')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
    if (bhError) throw bhError
    logResult('Behaviours', 25, bhCount || 0, 'behaviours seeded')

    // 4. Check scenarios
    const { count: scCount, error: scError } = await supabase
      .from('scenarios')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
    if (scError) throw scError
    logResult('Scenarios', 25, scCount || 0, 'scenarios seeded')

    // 5. Check projects
    const { count: prjCount, error: prjError } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
    if (prjError) throw prjError
    logResult('Projects', 3, prjCount || 0, 'projects seeded')

    // 6. Check employees
    const { count: empCount, error: empError } = await supabase
      .from('employees')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
    if (empError) throw empError
    logResult('Employees', 9, empCount || 0, 'employees seeded')

    // 7. Check project members
    const { count: pmCount, error: pmError } = await supabase
      .from('project_members')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true)
    if (pmError) throw pmError
    logResult('Project Members', 9, pmCount || 0, 'project members linked')

    // 8. Check nominations
    const { count: nomCount, error: nomError } = await supabase
      .from('nominations')
      .select('*', { count: 'exact', head: true })
    if (nomError) throw nomError
    logResult('Nominations', 16, nomCount || 0, 'nominations seeded')

    // 9. Check approved nominations (should be 6 feed + 3 received + approvals, varies)
    const { count: approvedCount, error: approvedError } = await supabase
      .from('nominations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'approved')
    if (approvedError) throw approvedError
    logResult('Approved Nominations', 9, approvedCount || 0, 'approved recognitions')

    // 10. Check appreciations
    const { count: appCount, error: appError } = await supabase
      .from('nomination_appreciations')
      .select('*', { count: 'exact', head: true })
    if (appError) throw appError
    logResult('Appreciations', 50, appCount || 0, 'appreciation reactions')

    // 11. Check FK integrity - nominations with valid FK references
    const { data: nomData, error: nomFkError } = await supabase
      .from('nominations')
      .select('id')
      .not('nominator_id', 'is', null)
      .not('nominee_id', 'is', null)
      .not('core_value_id', 'is', null)

    if (nomFkError) throw nomFkError
    logResult('FK Integrity', nomCount || 0, nomData?.length || 0, 'nominations with valid FKs')

    // 12. Check recognition feed view
    const { data: feedData, error: feedError } = await supabase
      .from('v_recognition_feed')
      .select('id')

    if (feedError && feedError.code !== 'PGRST116') {
      console.log('⚠️  Recognition Feed View: View may not exist yet')
    } else if (feedData) {
      logResult('Feed View', 1, feedData.length > 0 ? 1 : 0, 'feed view returns data')
    }

    // 13. Check badge definitions (should already exist)
    const { count: bdCount, error: bdError } = await supabase
      .from('badge_definitions')
      .select('*', { count: 'exact', head: true })
    if (bdError) throw bdError
    logResult('Badge Definitions', 5, bdCount || 0, 'badge levels defined')

    // 14. Check app config
    const { count: cfgCount, error: cfgError } = await supabase
      .from('app_config')
      .select('*', { count: 'exact', head: true })
    if (cfgError) throw cfgError
    logResult('App Config', 5, cfgCount || 0, 'system configuration loaded')

    console.log('\n' + '='.repeat(60))
    console.log('VERIFICATION SUMMARY')
    console.log('='.repeat(60))

    const passed = results.filter((r) => r.status === 'PASS').length
    const failed = results.filter((r) => r.status === 'FAIL').length
    const warned = results.filter((r) => r.status === 'WARN').length

    console.log(`✅ Passed: ${passed}/${results.length}`)
    if (failed > 0) console.log(`❌ Failed: ${failed}/${results.length}`)
    if (warned > 0) console.log(`⚠️  Warned: ${warned}/${results.length}`)

    console.log('='.repeat(60))

    if (failed > 0) {
      console.log('\nFailed checks:')
      results
        .filter((r) => r.status === 'FAIL')
        .forEach((r) => {
          console.log(`  - ${r.step}: expected ${r.expected}, got ${r.actual}`)
        })
      process.exit(1)
    } else {
      console.log('\n✅ All verifications passed!')
      process.exit(0)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`\n❌ Verification failed: ${message}`)
    console.error(error)
    process.exit(1)
  }
}

main()
