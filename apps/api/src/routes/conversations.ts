import { FastifyInstance } from 'fastify'
import { createConversation } from '../services/supabase'
import { z } from 'zod'

const createConvSchema = z.object({
  title: z.string().min(1),
})

export async function conversationRoutes(fastify: FastifyInstance) {
  fastify.post('/projects/:projectId/conversations', async (request, reply) => {
    const { projectId } = request.params as { projectId: string }
    const body = createConvSchema.parse(request.body)

    const conversation = await createConversation(projectId, body.title)

    return reply.status(201).send(conversation)
  })
}
