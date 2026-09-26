import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { Toaster } from '@/components/ui/toaster'
import { queryClient } from '@/lib/query'
import { router } from './router'

/**
 * QueryClientProvider sits OUTSIDE AuthProvider on purpose.
 *
 * Authentication is not server state. The session lifecycle, the emailed
 * second factor and the employee profile are AuthContext's job, and caching
 * them would put a security-relevant value behind a stale-time — precisely
 * the mistake React Query makes easy. React Query handles the data a signed-in
 * session then goes on to read; AuthContext decides whether there is one.
 */
export function AppProviders() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
          <Toaster />
        </AuthProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
