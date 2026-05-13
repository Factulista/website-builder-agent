import { FastifyInstance } from 'fastify'
import { createProject, getProject } from '../services/supabase'
import { z } from 'zod'

const createProjectSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
})

export async function projectRoutes(fastify: FastifyInstance) {
  fastify.post('/projects', async (request, reply) => {
    const userId = 'user-123' // TODO: Get from auth token

    const body = createProjectSchema.parse(request.body)

    const project = await createProject(userId, body.name, body.slug)

    return reply.status(201).send(project)
  })

  fastify.get('/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string }

    const project = await getProject(id)

    return reply.send(project)
  })
}
