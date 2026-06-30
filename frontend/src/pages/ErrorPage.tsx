import { Link } from 'react-router-dom'

// Shown for unknown routes (catch-all in App.tsx) and any uncaught render error
// (caught by components/ErrorBoundary).
export default function ErrorPage() {
  return (
    <main className="page">
      <div className="container">
        <h1 className="page__heading">Something went wrong</h1>
        <p className="page__sub">
          We hit an unexpected error, or the page you're looking for doesn't exist.
        </p>
        <Link to="/" className="home-cta__btn home-cta__btn--solid">
          Back to Home
        </Link>
      </div>
    </main>
  )
}
