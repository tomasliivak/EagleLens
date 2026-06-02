import { Link } from 'react-router-dom'

const footerLinks = [
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/terms', label: 'Terms of Service' },
  { to: '/contact', label: 'Contact Support' },
  { to: '/about', label: 'About' },
]

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container--fluid footer__inner">
        <div>
          <div className="footer__brand">PlanUrBC</div>
          <div className="footer__copy">© 2026 PlanUrBC</div>
        </div>
        <div className="footer__links">
          {footerLinks.map((l) => (
            <Link key={l.to} to={l.to}>
              {l.label}
            </Link>
          ))}
        </div>
      </div>
      <div className="container--fluid footer__disclaimer">
        PlanUrBC is an independent student-built service and is not affiliated
        with, endorsed by, or sponsored by Boston College. Boston College and
        related marks are the property of their respective owners.
      </div>
    </footer>
  )
}
