import { FastifyInstance } from 'fastify'
import { projectRoutes } from './projects'
import { conversationRoutes } from './conversations'
import { messageRoutes } from './messages'

export async function registerRoutes(fastify: FastifyInstance) {
  await projectRoutes(fastify)
  await conversationRoutes(fastify)
  await messageRoutes(fastify)
}
