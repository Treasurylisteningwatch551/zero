import { describe, test, expect } from 'bun:test'
import { TaskOrchestrator } from '../orchestrator'
import type { TaskNode, TaskResult } from '../orchestrator'

function makeNode(id: string, dependsOn: string[] = [], timeout = 5000): TaskNode {
  return {
    id,
    agentConfig: { name: id, agentInstruction: 'test' },
    instruction: `Do ${id}`,
    dependsOn,
    timeout,
  }
}

function successResult(nodeId: string, output = 'done', durationMs = 0): TaskResult {
  return { nodeId, success: true, output, durationMs }
}

describe('TaskOrchestrator', () => {
  const orch = new TaskOrchestrator()

  test('single task with no dependencies executes', async () => {
    const nodes = [makeNode('A')]
    const executor = async (node: TaskNode) => successResult(node.id)

    const results = await orch.execute(nodes, executor)

    expect(results.size).toBe(1)
    expect(results.get('A')!.success).toBe(true)
    expect(results.get('A')!.output).toBe('done')
  })

  test('independent tasks run in parallel', async () => {
    const nodes = [makeNode('A'), makeNode('B')]
    const executor = async (node: TaskNode) => {
      await new Promise((r) => setTimeout(r, 50))
      return successResult(node.id)
    }

    const start = Date.now()
    const results = await orch.execute(nodes, executor)
    const elapsed = Date.now() - start

    expect(results.size).toBe(2)
    expect(results.get('A')!.success).toBe(true)
    expect(results.get('B')!.success).toBe(true)
    // Both run concurrently so total should be ~50ms, not ~100ms
    expect(elapsed).toBeLessThan(90)
  })

  test('dependency ordering: B depends on A', async () => {
    const nodes = [makeNode('A'), makeNode('B', ['A'])]
    const order: string[] = []
    const executor = async (node: TaskNode) => {
      order.push(node.id)
      await new Promise((r) => setTimeout(r, 10))
      return successResult(node.id)
    }

    const results = await orch.execute(nodes, executor)

    expect(order).toEqual(['A', 'B'])
    expect(results.get('A')!.success).toBe(true)
    expect(results.get('B')!.success).toBe(true)
  })

  test('upstream results are passed to downstream executor', async () => {
    const nodes = [makeNode('A'), makeNode('B', ['A'])]
    let capturedUpstream: Map<string, TaskResult> | undefined

    const executor = async (node: TaskNode, upstream: Map<string, TaskResult>) => {
      if (node.id === 'B') {
        capturedUpstream = new Map(upstream)
      }
      return successResult(node.id, `output-${node.id}`)
    }

    await orch.execute(nodes, executor)

    expect(capturedUpstream).toBeDefined()
    expect(capturedUpstream!.has('A')).toBe(true)
    expect(capturedUpstream!.get('A')!.output).toBe('output-A')
  })

  test('upstream failure cancels downstream tasks', async () => {
    const nodes = [makeNode('A'), makeNode('B', ['A'])]
    const executor = async (node: TaskNode): Promise<TaskResult> => {
      return { nodeId: node.id, success: false, output: 'failed', durationMs: 0 }
    }

    const results = await orch.execute(nodes, executor)

    expect(results.get('A')!.success).toBe(false)
    expect(results.get('B')!.success).toBe(false)
    expect(results.get('B')!.output).toBe('Cancelled: upstream task failed')
  })

  test('circular dependency throws deadlock error', async () => {
    const nodes = [makeNode('A', ['B']), makeNode('B', ['A'])]
    const executor = async (node: TaskNode) => successResult(node.id)

    await expect(orch.execute(nodes, executor)).rejects.toThrow('Deadlock detected')
  })

  test('node timeout produces Task timeout error', async () => {
    const nodes = [makeNode('A', [], 50)]
    const executor = async (_node: TaskNode) => {
      await new Promise((r) => setTimeout(r, 200))
      return successResult('A')
    }

    const results = await orch.execute(nodes, executor)

    expect(results.get('A')!.success).toBe(false)
    expect(results.get('A')!.output).toBe('Task timeout')
  })

  test('executor throwing exception is caught', async () => {
    const nodes = [makeNode('A')]
    const executor = async (_node: TaskNode): Promise<TaskResult> => {
      throw new Error('executor crashed')
    }

    const results = await orch.execute(nodes, executor)

    expect(results.get('A')!.success).toBe(false)
    expect(results.get('A')!.output).toBe('executor crashed')
  })
})
