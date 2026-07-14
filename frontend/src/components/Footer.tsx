import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container--fluid footer__inner">
        <div>
          <div className="footer__brand">Eagle Lens</div>
          <div className="footer__copy">© 2026 Eagle Lens</div>
        </div>
        <div className="footer__right">
          <div className="footer__links">
            <Link to="/privacy" className="footer__link">
              Privacy Policy
            </Link>
            <Link to="/terms" className="footer__link">
              Terms of Service
            </Link>
          </div>
          <div className="footer__disclaimer">
            Eagle Lens is an independent student-built service and is not affiliated
            with, endorsed by, or sponsored by Boston College. Boston College and
            related marks are the property of their respective owners.
          </div>
        </div>
      </div>
    </footer>
  )
}
