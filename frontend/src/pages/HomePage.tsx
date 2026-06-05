import SearchBar from '../components/SearchBar'
import HomeSections from '../components/HomeSections'

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1 className="hero__title">Find better classes at BC.</h1>
          <p className="hero__subtitle">
            Search courses, professors, departments, and schools to compare
            ratings, workload, and difficulty.
          </p>
          <SearchBar />
        </div>
      </section>
      <HomeSections />
    </>
  )
}
