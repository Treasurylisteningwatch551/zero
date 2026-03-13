import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallbackLabel?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="card p-6 border-red-400/30 bg-red-400/[0.05]">
          <h3 className="text-[14px] font-semibold text-red-400 mb-2">
            {this.props.fallbackLabel ?? 'Something went wrong'}
          </h3>
          <p className="text-[12px] text-[var(--color-text-muted)] mb-4 font-mono">
            {this.state.error?.message ?? 'Unknown error'}
          </p>
          <button
            type="button"
            onClick={this.handleRetry}
            className="px-3 py-1.5 rounded-md text-[12px] bg-red-400/10 text-red-400 hover:bg-red-400/20 transition-colors"
          >
            Retry
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
