import { useNavigate } from 'react-router-dom'
import {
  BadgeCheck,
  TrendingUp,
  Landmark,
  GraduationCap,
  PlusSquare,
  MapPin,
  Gavel,
  ArrowRight,
} from 'lucide-react'

const schools = [
  { label: 'Carroll (CSOM)', Icon: GraduationCap },
  { label: 'Connell (CSON)', Icon: PlusSquare },
  { label: 'Lynch (LSEHD)', Icon: MapPin },
  { label: 'Law School', Icon: Gavel },
]

export default function QuickCategories() {
  const navigate = useNavigate()
  // TODO: each category should eventually filter the rankings page by its own
  // criteria. For now every box routes to the (blank) rankings page.
  const goToRankings = () => navigate('/rankings')

  return (
    <section className="section">
      <div className="container--fluid">
        <h2 className="section__title">Quick Categories</h2>

        <div className="cat-grid">
          {/* Core Requirements */}
          <div className="card core" onClick={goToRankings}>
            <div className="core__body">
              <div className="card-icon">
                <BadgeCheck size={26} />
              </div>
              <h3 className="core__title">Core Requirements</h3>
              <p className="core__text">
                Fulfill your university requirements with courses across Theology,
                Philosophy, History, and more.
              </p>
              <div className="core__tags">
                <span className="tag">Natural Science</span>
                <span className="tag">Cultural Diversity</span>
                <span className="tag">Fine Arts</span>
              </div>
            </div>
            <div className="core__img" />
          </div>

          {/* Popular Rankings */}
          <div className="card rankings-card" onClick={goToRankings}>
            <div className="card-icon">
              <TrendingUp size={26} />
            </div>
            <h3 className="rankings-card__title">Popular Rankings</h3>
            <p className="rankings-card__text">
              Discover the highest-rated professors and most sought-after electives
              this semester.
            </p>
            <button className="rankings-card__btn">
              View Top Lists
              <ArrowRight size={18} />
            </button>
          </div>
        </div>

        <div className="cat-grid__row2">
          {/* Arts & Sciences */}
          <div className="card arts" onClick={goToRankings}>
            <div className="card-icon">
              <Landmark size={26} />
            </div>
            <h3 className="arts__title">Arts &amp; Sciences</h3>
            <p className="arts__text">
              Explore the diverse offerings of BC's largest undergraduate college.
            </p>
            <div className="arts__avatars">
              <img
                src="https://i.pravatar.cc/64?img=12"
                alt=""
              />
              <img
                src="https://i.pravatar.cc/64?img=33"
                alt=""
              />
              <span className="more">+4</span>
            </div>
          </div>

          {/* Professional Schools */}
          <div className="card schools">
            <h3 className="schools__title">Professional Schools</h3>
            <div className="schools__grid">
              {schools.map(({ label, Icon }) => (
                <button
                  key={label}
                  className="school-chip"
                  onClick={goToRankings}
                >
                  <Icon size={18} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
