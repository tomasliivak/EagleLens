import { Component, type ReactNode } from 'react'
import ErrorPage from '../pages/ErrorPage'

type Props = { children: ReactNode }
type State = { hasError: boolean }

// Catches uncaught render errors anywhere in the page tree and shows ErrorPage
// instead of a blank screen. Reset by remounting — Layout keys it on the route,
// so navigating (e.g. the "Back to Home" link) clears the error state.
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    console.error('Unhandled error:', error)
  }

  render() {
    return this.state.hasError ? <ErrorPage /> : this.props.children
  }
}
