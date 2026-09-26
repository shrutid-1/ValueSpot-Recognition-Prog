#!/usr/bin/env node

/**
 * ValueSpot Mock Data Seeding CLI
 *
 * ⚠️  SECURITY NOTE: This script uses SUPABASE_SERVICE_ROLE_KEY to bypass RLS
 * and insert mock data. The service role key must NEVER be exposed to the frontend.
 *
 * Usage:
 *   npm run seed
 *
 * Environment Variables Required:
 *   VITE_SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY - Service role key (for seeding only, NOT frontend)
 */

import * as fs from 'fs'
import * as path from 'path'
import { runSeeding } from './seedService.js'

async function main() {
  try {
    // Load environment variables from .env
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

    // Get Supabase credentials
    const supabaseUrl = process.env.VITE_SUPABASE_URL
    const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl) {
      console.error('❌ Missing required environment variable: VITE_SUPABASE_URL')
      console.error('   Please add it to your .env file')
      process.exit(1)
    }

    if (!supabaseServiceRoleKey) {
      console.error('❌ Missing required environment variable: SUPABASE_SERVICE_ROLE_KEY')
      console.error('\n   ℹ️  The service role key is needed to bypass RLS and seed mock data.')
      console.error('   ℹ️  This key must NEVER be exposed in frontend code.')
      console.error('\n   To obtain the service role key:')
      console.error('   1. Go to https://app.supabase.com')
      console.error('   2. Select your project')
      console.error('   3. Click "Settings" (bottom left)')
      console.error('   4. Click "API" in the left sidebar')
      console.error('   5. Copy the "service_role key" (NOT the anon key)')
      console.error('   6. Add to .env: SUPABASE_SERVICE_ROLE_KEY=your_key_here')
      console.error('\n   ⚠️  IMPORTANT: Never commit SUPABASE_SERVICE_ROLE_KEY to git!')
      process.exit(1)
    }

    console.log('✅ Supabase project URL loaded')
    console.log('✅ Service role key loaded (for seeding only)')

    // Load mock data
    const mockDataPath = path.resolve(
      process.cwd(),
      'src/data/valuespot-mock-data.json'
    )
    if (!fs.existsSync(mockDataPath)) {
      console.error(`❌ Mock data file not found: ${mockDataPath}`)
      process.exit(1)
    }

    const mockDataContent = fs.readFileSync(mockDataPath, 'utf-8')
    const mockData = JSON.parse(mockDataContent)

    console.log(`✅ Mock data loaded: ${mockDataPath}`)

    // Run seeding
    console.log('\n🌱 Starting seeding process...\n')

    const result = await runSeeding(supabaseUrl, supabaseServiceRoleKey, mockData)

    // Display detailed results before exiting
    if (!result.success && result.errors.length > 0) {
      console.log('\n⚠️  DETAILED ERROR INFORMATION:')
      console.log('='.repeat(60))
      for (const err of result.errors) {
        console.log(`\nFailed Step: ${err.step}`)
        console.log(`Error: ${err.message}`)
        if (err.code) console.log(`Code: ${err.code}`)
        if (err.details) console.log(`Details: ${err.details}`)
        if (err.hint) console.log(`Hint: ${err.hint}`)
      }
      console.log('='.repeat(60))
    }

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`❌ Fatal error: ${message}`)
    if (error instanceof Error && error.stack) {
      console.error('Stack trace:', error.stack)
    }
    process.exit(1)
  }
}

main()
