import { FastifyInstance } from 'fastify'
import { createMessage, createAgentRun, updateAgentRun } from '../services/supabase'
import { saveFile } from '../services/storage'
import { orchestrate, executeAgents } from '../agents/orchestrator'
import { z } from 'zod'

const createMessageSchema = z.object({
  content: z.string().min(1),
})

export async function messageRoutes(fastify: FastifyInstance) {
  fastify.post('/conversations/:convId/messages', async (request, reply) => {
    const { convId } = request.params as { convId: string }
    const body = createMessageSchema.parse(request.body)

    const userId = 'user-123' // TODO: Get from auth token
    const projectId = 'project-123' // TODO: Get from conversation

    // Save user message
    await createMessage(convId, 'user', body.content)

    // Create agent run
    const agentRun = await createAgentRun(convId, projectId, userId, body.content)

    // Return 202 Accepted with stream URL
    return reply.status(202).send({
      message_id: `msg_${Date.now()}`,
      agent_run_id: agentRun.id,
      stream_url: `/runs/${agentRun.id}/stream`,
    })
  })

  // SSE Stream endpoint
  fastify.get('/runs/:runId/stream', async (request, reply) => {
    const { runId } = request.params as { runId: string }

    reply.header('Content-Type', 'text/event-stream')
    reply.header('Connection', 'keep-alive')
    reply.header('Cache-Control', 'no-cache')

    try {
      const projectState = {} // TODO: Get from DB

      // Simulate orchestrator working
      reply.raw.write(`data: ${JSON.stringify({ type: 'orchestrator_analyzing' })}\n\n`)

      // Simulated agent execution
      const agents = ['content', 'html', 'seo']
      for (const agent of agents) {
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'agent_started', agent })}\n\n`
        )
        await new Promise((resolve) => setTimeout(resolve, 1000))
        reply.raw.write(
          `data: ${JSON.stringify({ type: 'agent_complete', agent })}\n\n`
        )
      }

      reply.raw.write(`data: ${JSON.stringify({ type: 'run_complete' })}\n\n`)
      reply.raw.end()

      // Update agent run status
      await updateAgentRun(runId, { status: 'complete', seo_score: 92 })
    } catch (error) {
      reply.raw.write(`data: ${JSON.stringify({ type: 'error', error: String(error) })}\n\n`)
      reply.raw.end()
    }
  })
}
