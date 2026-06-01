import express, { type Request, type Response } from 'express'
import cors from 'cors'

const app = express()
const PORT = process.env.PORT ?? 3000

app.use(cors())
app.use(express.json())

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' })
})

app.get('/api/hello', (_req: Request, res: Response) => {
  res.json({ message: 'Hello from the PlanYourBC backend!' })
})

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`)
})
