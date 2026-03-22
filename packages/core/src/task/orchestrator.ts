import { toErrorMessage } from '@zero-os/shared'
import type { AgentConfig } from '../agent/agent'

export interface TaskNode {
  id: string
  agentConfig: AgentConfig
  instruction: string
  dependsOn: string[]
  timeout: number
}

export interface TaskResult {
  nodeId: string
  success: boolean
  output: string
  durationMs: number
}

/**
 * Task orchestrator — manages SubAgent dependency graph and execution.
 */
export class TaskOrchestrator {
  /**
   * Execute a task graph, respecting dependencies.
   * Tasks with no dependencies run concurrently.
   */
  async execute(
    nodes: TaskNode[],
    executor: (node: TaskNode, upstreamResults: Map<string, TaskResult>) => Promise<TaskResult>,
  ): Promise<Map<string, TaskResult>> {
    const results = new Map<string, TaskResult>()
    const pending = new Set(nodes.map((n) => n.id))
    const failed = new Set<string>()

    while (pending.size > 0) {
      // Find ready nodes (dependencies satisfied, not downstream of failed)
      const ready = nodes.filter(
        (n) =>
          pending.has(n.id) &&
          n.dependsOn.every((dep) => results.has(dep)) &&
          !n.dependsOn.some((dep) => failed.has(dep)),
      )

      // Check for deadlock
      if (ready.length === 0) {
        // Cancel remaining nodes that depend on failed tasks
        for (const id of pending) {
          const node = nodes.find((n) => n.id === id)
          if (node?.dependsOn.some((dep) => failed.has(dep))) {
            results.set(id, {
              nodeId: id,
              success: false,
              output: 'Cancelled: upstream task failed',
              durationMs: 0,
            })
            pending.delete(id)
          }
        }

        if (pending.size > 0) {
          throw new Error(
            `Deadlock detected: ${pending.size} tasks waiting with unresolvable dependencies`,
          )
        }
        break
      }

      // Execute ready nodes concurrently
      const executions = ready.map(async (node) => {
        const startTime = Date.now()
        try {
          const result = await Promise.race([
            executor(node, results),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Task timeout')), node.timeout),
            ),
          ])
          results.set(node.id, result)
          if (!result.success) {
            failed.add(node.id)
          }
        } catch (error) {
          const errorMsg = toErrorMessage(error)
          results.set(node.id, {
            nodeId: node.id,
            success: false,
            output: errorMsg,
            durationMs: Date.now() - startTime,
          })
          failed.add(node.id)
        }
        pending.delete(node.id)
      })

      await Promise.allSettled(executions)
    }

    return results
  }
}
