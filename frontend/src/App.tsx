import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import CoursePage from './pages/CoursePage'
import RankingsPage from './pages/RankingsPage'
import MyPlanPage from './pages/MyPlanPage'
import PlaceholderPage from './pages/PlaceholderPage'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/rankings" element={<RankingsPage />} />
        <Route path="/my-plan" element={<MyPlanPage />} />
        <Route path="/courses/:courseCode" element={<CoursePage />} />
        <Route path="/privacy" element={<PlaceholderPage title="Privacy Policy" />} />
        <Route path="/terms" element={<PlaceholderPage title="Terms of Service" />} />
        <Route path="/contact" element={<PlaceholderPage title="Contact Support" />} />
        <Route path="/about" element={<PlaceholderPage title="About" />} />
      </Route>
    </Routes>
  )
}

export default App
