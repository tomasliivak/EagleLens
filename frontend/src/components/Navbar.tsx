import { NavLink, Link, useLocation } from 'react-router-dom'
import SearchBar from './SearchBar'

const links = [
  { to: '/explore', label: 'Explore Classes', end: false },
  { to: '/rankings', label: 'Rankings', end: false },
]

export default function Navbar() {
  // The homepage has its own large hero search, so skip the compact one there.
  const showSearch = useLocation().pathname !== '/'

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
      </div>
    </nav>
  )
}
