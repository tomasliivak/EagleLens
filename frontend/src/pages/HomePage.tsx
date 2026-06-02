import SearchBar from '../components/SearchBar'
import QuickCategories from '../components/QuickCategories'

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="container">
          <h1 className="hero__title">Find your next favorite class</h1>
          <SearchBar />
        </div>
      </section>
      <QuickCategories />
    </>
  )
}
