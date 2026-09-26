import React from 'react'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info)
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback

      return (
        <div
          className="flex flex-col items-center justify-center text-center"
          style={{ minHeight: 300, padding: 48 }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid var(--color-divider)',
              color: 'var(--color-accent-700)',
              marginBottom: 16,
            }}
          >
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <h2
            className="font-condensed"
            style={{ fontSize: 20, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              fontSize: 14,
              color: 'var(--color-neutral-600)',
              maxWidth: 380,
              lineHeight: 1.55,
              marginBottom: 20,
            }}
          >
            An unexpected error occurred. Refresh the page or contact support if the problem persists.
          </p>
          <button
            className="vs-btn vs-btn-primary relative"
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
          >
            <i className="corner tl" />
            <i className="corner tr" />
            <i className="corner bl" />
            <i className="corner br" />
            Reload Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
