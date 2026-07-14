import { NavLink, Link, useLocation } from 'react-router-dom'
import { User } from 'lucide-react'
import SearchBar from './SearchBar'
import { useAuth } from '../lib/auth'

const links = [
  { to: '/explore', label: 'Explore Classes', end: false },
  { to: '/rankings', label: 'Rankings', end: false },
]

export default function Navbar() {
  // The homepage has its own large hero search, so skip the compact one there.
  const showSearch = useLocation().pathname !== '/'
  const { session } = useAuth()

  return (
    <nav className="navbar">
      <div className="container--fluid navbar__inner">
        <Link to="/" className="navbar__logo">
          Eagle Lens
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
        <Link
          to="/account"
          className="navbar__user"
          aria-label={session ? 'Account' : 'Sign in'}
        >
          <User size={19} />
        </Link>
      </div>
    </nav>
  )
}
