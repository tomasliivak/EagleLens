import { NavLink, Link, useLocation } from 'react-router-dom'
import { Bell, UserCircle2 } from 'lucide-react'
import SearchBar from './SearchBar'

const links = [
  { to: '/', label: 'Browse', end: true },
  { to: '/rankings', label: 'Rankings', end: false },
  { to: '/my-plan', label: 'My Plan', end: false },
]

export default function Navbar() {
  // The homepage has its own large hero search, so skip the compact one there.
  const showSearch = useLocation().pathname !== '/'

  return (
    <nav className="navbar">
      <div className="container--fluid navbar__inner">
        <Link to="/" className="navbar__logo">
          PlanUrBC
        </Link>
        <div className="navbar__links">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                'navbar__link' + (isActive ? ' active' : '')
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>
        {showSearch && <SearchBar variant="nav" />}
        <div className="navbar__actions">
          <Bell size={22} />
          <UserCircle2 size={24} />
        </div>
      </div>
    </nav>
  )
}
