import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import CoursePage from './pages/CoursePage'
import RankingsPage from './pages/RankingsPage'
import ExplorePage from './pages/ExplorePage'
import PlaceholderPage from './pages/PlaceholderPage'
import ProfessorPage from './pages/ProfessorPage'
import DepartmentPage from './pages/DepartmentPage'
import SchoolPage from './pages/SchoolPage'
import ErrorPage from './pages/ErrorPage'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/explore" element={<ExplorePage />} />
        <Route path="/rankings" element={<Navigate to="/rankings/classes" replace />} />
        <Route path="/rankings/:entity" element={<RankingsPage />} />
        <Route path="/courses/:courseCode" element={<CoursePage />} />
        <Route path="/professors/:id" element={<ProfessorPage />} />
        <Route path="/departments/:code" element={<DepartmentPage />} />
        <Route path="/schools/:code" element={<SchoolPage />} />
        <Route path="/privacy" element={<PlaceholderPage title="Privacy Policy" />} />
        <Route path="/terms" element={<PlaceholderPage title="Terms of Service" />} />
        <Route path="/contact" element={<PlaceholderPage title="Contact Support" />} />
        <Route path="/about" element={<PlaceholderPage title="About" />} />
        {/* Unknown URLs fall through to the error page. */}
        <Route path="*" element={<ErrorPage />} />
      </Route>
    </Routes>
  )
}

export default App
