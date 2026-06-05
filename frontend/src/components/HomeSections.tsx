import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  Brain,
  PenLine,
  Palette,
  Microscope,
  ScrollText,
  Users,
  Globe,
  ArrowRight,
  Search,
  BarChart3,
} from 'lucide-react'

// Each requirement card links to Explore pre-filtered by its core. `core` is the
// core_requirements.code value the Explore page filters on. "History" maps to
// "History I" since the filter takes a single code (the DB splits it into I/II).
const requirements = [
  { title: 'Theology Core', core: 'Theology', sub: '2 Courses Required', Icon: BookOpen },
  { title: 'Philosophy Core', core: 'Philosophy', sub: '2 Courses Required', Icon: Brain },
  { title: 'Writing', core: 'Writing', sub: 'First-Year Requirement', Icon: PenLine },
  { title: 'Arts', core: 'Arts', sub: '1 Course Required', Icon: Palette },
  { title: 'Natural Science', core: 'Natural Science', sub: '2 Courses Required', Icon: Microscope },
  { title: 'History', core: 'History I', sub: '2 Courses Required', Icon: ScrollText },
  { title: 'Social Science', core: 'Social Science', sub: '2 Courses Required', Icon: Users },
  { title: 'Cultural Diversity', core: 'Cultural Diversity', sub: '1 Course Required', Icon: Globe },
]

const explore = [
  {
    title: 'Easiest Core Classes',
    text: 'Find requirements that students report as manageable.',
    to: '/explore?core=__any__&sort=challenging&order=asc',
  },
  {
    title: 'Lightest Workload',
    text: 'Courses with fewer hours spent outside the classroom.',
    to: '/explore?sort=hours&order=asc',
  },
  {
    title: 'Highest Rated Courses',
    text: 'Discover the top-tier academic experiences at BC.',
    to: '/rankings/classes',
  },
  {
    title: 'Highest Rated Professors',
    text: "Learn from BC's most beloved and effective faculty.",
    to: '/rankings/professors',
  },
]

export default function HomeSections() {
  const navigate = useNavigate()

  return (
    <>
      <section className="section">
        <div className="container--fluid">
          <div className="home-head">
            <h2 className="section__title">I need to fulfill a requirement</h2>
            <span className="home-head__divider" />
            <button
              className="home-head__link"
              onClick={() => navigate('/explore?core=__any__')}
            >
              View All Cores <ArrowRight size={16} />
            </button>
          </div>

          <div className="req-grid">
            {requirements.map(({ title, core, sub, Icon }) => (
              <button
                key={title}
                className="card req-card"
                onClick={() => navigate('/explore?core=' + encodeURIComponent(core))}
              >
                <div className="card-icon req-card__icon">
                  <Icon size={22} />
                </div>
                <div className="req-card__title">{title}</div>
                <div className="req-card__sub">{sub}</div>
              </button>
            ))}
          </div>

          <h2 className="section__title section__title--explore">I want to explore</h2>
          <div className="explore-strip">
            {explore.map(({ title, text, to }) => (
              <button
                key={title}
                className="explore-card"
                onClick={() => navigate(to)}
              >
                <div className="explore-card__title">{title}</div>
                <div className="explore-card__text">{text}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="home-cta">
        <div className="container--fluid home-cta__grid">
          <div className="card home-cta__card">
            <h3 className="home-cta__title">Explore Classes</h3>
            <p className="home-cta__text">
              Find courses by Core requirement, department, rating, difficulty, and
              workload. Dig deep into syllabus data and student feedback.
            </p>
            <button
              className="home-cta__btn home-cta__btn--solid"
              onClick={() => navigate('/explore')}
            >
              Start Exploring <Search size={16} />
            </button>
          </div>

          <div className="card home-cta__card">
            <h3 className="home-cta__title">View Rankings</h3>
            <p className="home-cta__text">
              Browse top-rated classes, professors, departments, and schools across
              BC. See who is leading the way in academic excellence.
            </p>
            <button
              className="home-cta__btn home-cta__btn--outline"
              onClick={() => navigate('/rankings')}
            >
              See Rankings <BarChart3 size={16} />
            </button>
          </div>
        </div>
      </section>
    </>
  )
}
