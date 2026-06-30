import { Outlet, useLocation } from 'react-router-dom'
import Navbar from './Navbar'
import Footer from './Footer'
import ErrorBoundary from './ErrorBoundary'

export default function Layout() {
  const location = useLocation()
  return (
    <>
      <Navbar />
      {/* Grows to fill the viewport so the footer stays pinned to the bottom. */}
      <div className="layout__main">
        {/* Key on the route so a navigation resets a tripped error boundary. */}
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </div>
      <Footer />
    </>
  )
}
