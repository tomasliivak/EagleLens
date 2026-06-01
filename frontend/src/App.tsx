import { useEffect, useState } from 'react'
import './App.css'

function App() {
  const [message, setMessage] = useState<string>('Loading…')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data: { status: string }) => setMessage(`Backend says: ${data.status}`))
      .catch(() => setMessage('Could not reach backend'))
  }, [])

  return (
    <main>
      <h1>PlanYourBC</h1>
      <p>{message}</p>
    </main>
  )
}

export default App
