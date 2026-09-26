import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        /*
          A small, deliberate vendor split — three buckets, not a rule per
          package.

          This does not reduce first-load bytes: React, the Supabase client and
          the router are all genuinely needed before anything renders. What it
          buys is CACHE STABILITY. Application code changes on every deploy
          while these dependencies change a few times a year, so separating
          them means a returning user re-downloads the app chunk alone instead
          of ~700 KB of unchanged library code.

          Route chunks and the already-deferred xlsx/recharts splits are
          untouched — Rollup keeps its own dynamic-import boundaries.
        */
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('react-router')) return 'vendor-router'
          if (id.includes('@supabase') || id.includes('@tanstack')) return 'vendor-data'
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('/scheduler/')) {
            return 'vendor-react'
          }
        },
      },
    },
  },
})
