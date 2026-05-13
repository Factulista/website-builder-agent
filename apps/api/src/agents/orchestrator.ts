import { callClaude } from '../services/claude'
import { contentAgent } from './content'
import { htmlAgent } from './html'
import { seoAgent } from './seo'

export interface AgentPlan {
  intent: string
  agents: string[]
  context: Record<string, any>
}

export async function orchestrate(
  userMessage: string,
  projectState: any
): Promise<AgentPlan> {
  const systemPrompt = `You are an orchestrator for website generation agents.
Analyze the user's request and create a plan for which agents to call and in what order.

Return a JSON object with:
{
  "intent": "what the user wants to do",
  "agents": ["agent_name", ...],
  "context": {...relevant context...}
}`

  const response = await callClaude('claude-opus-4-7', systemPrompt, userMessage)

  try {
    return JSON.parse(response)
  } catch {
    return {
      intent: userMessage,
      agents: ['content', 'html', 'seo'],
      context: { projectState },
    }
  }
}

export async function* executeAgents(
  plan: AgentPlan,
  userMessage: string,
  projectState: any
) {
  let outputs: Record<string, any> = {}

  for (const agentName of plan.agents) {
    yield {
      type: 'agent_started',
      agent: agentName,
      task: `Running ${agentName} agent`,
    }

    try {
      if (agentName === 'content') {
        const result = await contentAgent(userMessage, projectState)
        outputs.content = result
        yield {
          type: 'agent_complete',
          agent: agentName,
          output: result,
        }
      } else if (agentName === 'html') {
        const result = await htmlAgent(userMessage, outputs.content || {}, projectState)
        outputs.html = result
        yield {
          type: 'agent_complete',
          agent: agentName,
          output: result,
        }
      } else if (agentName === 'seo') {
        const result = await seoAgent(outputs.html || '', projectState)
        outputs.seo = result
        yield {
          type: 'agent_complete',
          agent: agentName,
          output: result,
        }
      }
    } catch (error) {
      yield {
        type: 'agent_error',
        agent: agentName,
        error: String(error),
      }
    }
  }

  return outputs
}
