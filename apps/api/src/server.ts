import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import { config } from 'dotenv'
import { registerRoutes } from './routes'

config()

const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
})

// Plugins
fastify.register(helmet)
fastify.register(cors, {
  origin: true,
  credentials: true,
})

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() }
})

// Register routes
fastify.register(registerRoutes)

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '3001', 10)
    await fastify.listen({ port, host: '0.0.0.0' })
    console.log(`✅ Server running on http://localhost:${port}`)
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }
}

start()
