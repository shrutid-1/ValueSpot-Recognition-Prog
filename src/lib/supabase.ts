import { createClient } from '@supabase/supabase-js'
import type { Database } from './supabase-types'
// Where the session is kept depends on "Remember me" — see auth-storage.ts.
import { authStorage } from './auth-storage'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. ' +
    'Copy .env.example to .env and fill in your project values.'
  )
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    storage: authStorage,
  },
})
