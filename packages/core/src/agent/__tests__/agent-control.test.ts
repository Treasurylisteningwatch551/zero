import { describe, expect, test } from 'bun:test'
import type { Message } from '@zero-os/shared'
import { AgentControl } from '../agent-control'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function assistantMessage(text: string): Message {
  return {
    id: `msg_${Math.random().toString(36).slice(2)}`,
    sessionId: 'sess_test',
    role: 'assistant',
    messageType: 'message',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
  }
}

function createAgent(options?: {
  text?: string
  delayMs?: number
  error?: string
  onRun?: (instruction: string) => void
}) {
  return {
    async run(_context: unknown, instruction: string): Promise<Message[]> {
      options?.onRun?.(instruction)
      if (options?.delayMs) {
        await sleep(options.delayMs)
      }
      if (options?.error) {
        throw new Error(options.error)
      }
      return [assistantMessage(options?.text ?? 'done')]
    },
  }
}

function createQueuedAwareAgent(options?: {
  delayMs?: number
  onInterruptCheck?: (value: boolean) => void
  onQueuedMessages?: (messages: string[]) => void
}) {
  return {
    async run(
      _context: unknown,
      instruction: string,
      _userImages?: unknown,
      _onNewMessage?: unknown,
      _onTextDelta?: unknown,
      shouldInterrupt?: () => boolean,
      getQueuedMessages?: () => Array<{ content: string }>,
    ): Promise<Message[]> {
      if (options?.delayMs) {
        await sleep(options.delayMs)
      }

      const interrupted = shouldInterrupt?.() ?? false
      const queued = getQueuedMessages?.() ?? []
      const queuedTexts = queued.map((message) => message.content)

      options?.onInterruptCheck?.(interrupted)
      options?.onQueuedMessages?.(queuedTexts)

      return [
        assistantMessage(
          JSON.stringify({
            instruction,
            interrupted,
            queued: queuedTexts,
          }),
        ),
      ]
    },
  }
}

const agentContext = {
  systemPrompt: 'test',
  conversationHistory: [],
  tools: [],
}

describe('AgentControl', () => {
  test('spawn returns agent id and label', () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent(), agentContext, 'do work', { label: 'worker-1' })

    expect('agentId' in result).toBe(true)
    if (!('agentId' in result)) {
      throw new Error('expected spawn success')
    }
    expect(result.agentId).toMatch(/^agent_/)
    expect(result.label).toBe('worker-1')
  })

  test('activeAgentCount increments for running agents', () => {
    const control = new AgentControl()
    control.spawn(createAgent({ delayMs: 20 }), agentContext, 'do work')
    expect(control.activeAgentCount).toBe(1)
  })

  test('spawn rejects invalid agent instances', () => {
    const control = new AgentControl()
    const result = control.spawn({} as never, agentContext, 'do work')

    expect(result).toEqual({ error: 'Invalid agent instance.' })
  })

  test('spawn rejects empty instruction', () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent(), agentContext, '   ')

    expect(result).toEqual({ error: 'Instruction is required.' })
  })

  test('completed agents transition to completed state', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ text: 'complete' }), agentContext, 'finish')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    await control.waitAll([result.agentId], 100)

    expect(control.getStatus(result.agentId)?.state).toBe('completed')
  })

  test('getOutput returns assistant text after completion', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ text: 'final output' }), agentContext, 'finish')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    await control.waitAll([result.agentId], 100)

    expect(control.getOutput(result.agentId)).toBe('final output')
  })

  test('getOutput is undefined while agent is still running', () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ delayMs: 20 }), agentContext, 'finish')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    expect(control.getOutput(result.agentId)).toBeUndefined()
  })

  test('failed agents expose failed status and error', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ error: 'boom' }), agentContext, 'fail')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    await control.waitAll([result.agentId], 100)

    expect(control.getStatus(result.agentId)?.state).toBe('failed')
    expect(control.getStatus(result.agentId)?.error).toBe('boom')
  })

  test('getAgentInfo returns label role and status', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent(), agentContext, 'finish', {
      label: 'researcher',
      role: 'explorer',
    })
    if (!('agentId' in result)) throw new Error('expected spawn success')

    await control.waitAll([result.agentId], 100)

    expect(control.getAgentInfo(result.agentId)).toEqual({
      label: 'researcher',
      role: 'explorer',
      status: { state: 'completed' },
    })
  })

  test('listAgents includes depth and elapsedMs', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ delayMs: 5 }), agentContext, 'finish', {
      label: 'worker',
      depth: 3,
    })
    if (!('agentId' in result)) throw new Error('expected spawn success')

    await control.waitAll([result.agentId], 100)

    expect(control.listAgents()).toEqual([
      {
        id: result.agentId,
        label: 'worker',
        role: undefined,
        status: { state: 'completed' },
        depth: 3,
        elapsedMs: expect.any(Number),
      },
    ])
  })

  test('waitAny resolves when one agent finishes', async () => {
    const control = new AgentControl()
    const fast = control.spawn(createAgent({ delayMs: 5, text: 'fast' }), agentContext, 'fast')
    const slow = control.spawn(createAgent({ delayMs: 50, text: 'slow' }), agentContext, 'slow')
    if (!('agentId' in fast) || !('agentId' in slow)) throw new Error('expected spawn success')

    const result = await control.waitAny([fast.agentId, slow.agentId], 100)

    expect(result.timedOut).toBe(false)
    expect(result.statuses[fast.agentId]?.state).toBe('completed')
  })

  test('waitAll waits for all requested agents', async () => {
    const control = new AgentControl()
    const a = control.spawn(createAgent({ delayMs: 5 }), agentContext, 'a')
    const b = control.spawn(createAgent({ delayMs: 10 }), agentContext, 'b')
    if (!('agentId' in a) || !('agentId' in b)) throw new Error('expected spawn success')

    const result = await control.waitAll([a.agentId, b.agentId], 100)

    expect(result.timedOut).toBe(false)
    expect(result.statuses[a.agentId]?.state).toBe('completed')
    expect(result.statuses[b.agentId]?.state).toBe('completed')
  })

  test('waitAny reports timeout when nothing finishes in time', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ delayMs: 50 }), agentContext, 'wait')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    const waitResult = await control.waitAny([result.agentId], 5)

    expect(waitResult.timedOut).toBe(true)
    expect(waitResult.statuses[result.agentId]?.state).toBe('running')
  })

  test('waitAll reports timeout when not all agents finish in time', async () => {
    const control = new AgentControl()
    const fast = control.spawn(createAgent({ delayMs: 5 }), agentContext, 'fast')
    const slow = control.spawn(createAgent({ delayMs: 50 }), agentContext, 'slow')
    if (!('agentId' in fast) || !('agentId' in slow)) throw new Error('expected spawn success')

    const result = await control.waitAll([fast.agentId, slow.agentId], 10)

    expect(result.timedOut).toBe(true)
    expect(result.statuses[fast.agentId]?.state).toBe('completed')
    expect(result.statuses[slow.agentId]?.state).toBe('running')
  })

  test('wait responses include not_found for unknown ids', async () => {
    const control = new AgentControl()
    const result = await control.waitAny(['missing-agent'], 1)

    expect(result.timedOut).toBe(false)
    expect(result.statuses['missing-agent']).toEqual({ state: 'not_found' })
  })

  test('close marks an agent closed', () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ delayMs: 30 }), agentContext, 'close me')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    const status = control.close(result.agentId)
    expect(status?.state).toBe('closed')
  })

  test('close decreases activeAgentCount', () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ delayMs: 30 }), agentContext, 'close me')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    control.close(result.agentId)

    expect(control.activeAgentCount).toBe(0)
  })

  test('close returns undefined for unknown ids', () => {
    const control = new AgentControl()
    expect(control.close('missing-agent')).toBeUndefined()
  })

  test('closed agents are not overwritten by later completion', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ delayMs: 20, text: 'late output' }), agentContext, 'work')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    control.close(result.agentId)
    await sleep(30)

    expect(control.getStatus(result.agentId)?.state).toBe('closed')
    expect(control.getOutput(result.agentId)).toBeUndefined()
  })

  test('spawn passes instruction through to the controlled agent', async () => {
    const control = new AgentControl()
    let seenInstruction = ''
    const result = control.spawn(
      createAgent({
        onRun: (instruction) => {
          seenInstruction = instruction
        },
      }),
      agentContext,
      'inspect repository',
    )
    if (!('agentId' in result)) throw new Error('expected spawn success')

    await control.waitAll([result.agentId], 100)

    expect(seenInstruction).toBe('inspect repository')
  })

  test('sendInput to a running agent succeeds', () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ delayMs: 20 }), agentContext, 'work')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    expect(control.sendInput(result.agentId, 'status update')).toEqual({ success: true })
  })

  test('sendInput to a completed agent fails', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ text: 'done' }), agentContext, 'work')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    await control.waitAll([result.agentId], 100)

    expect(control.sendInput(result.agentId, 'follow up')).toEqual({
      success: false,
      error: `Sub-agent "${result.agentId}" is already in terminal state "completed".`,
    })
  })

  test('sendInput to a failed agent fails', async () => {
    const control = new AgentControl()
    const result = control.spawn(createAgent({ error: 'boom' }), agentContext, 'work')
    if (!('agentId' in result)) throw new Error('expected spawn success')

    await control.waitAll([result.agentId], 100)

    expect(control.sendInput(result.agentId, 'follow up')).toEqual({
      success: false,
      error: `Sub-agent "${result.agentId}" is already in terminal state "failed".`,
    })
  })

  test('sendInput to unknown agent fails', () => {
    const control = new AgentControl()
    expect(control.sendInput('missing-agent', 'hello')).toEqual({
      success: false,
      error: 'Sub-agent "missing-agent" was not found.',
    })
  })

  test('queued messages are delivered to the agent', async () => {
    const control = new AgentControl()
    let queuedMessages: string[] = []
    const result = control.spawn(
      createQueuedAwareAgent({
        delayMs: 20,
        onQueuedMessages: (messages) => {
          queuedMessages = messages
        },
      }),
      agentContext,
      'work',
    )
    if (!('agentId' in result)) throw new Error('expected spawn success')

    expect(control.sendInput(result.agentId, 'first update')).toEqual({ success: true })
    expect(control.sendInput(result.agentId, 'second update')).toEqual({ success: true })

    await control.waitAll([result.agentId], 100)

    expect(queuedMessages).toEqual(['first update', 'second update'])
  })

  test('interrupt flag is set when interrupt=true', async () => {
    const control = new AgentControl()
    let interrupted = false
    const result = control.spawn(
      createQueuedAwareAgent({
        delayMs: 20,
        onInterruptCheck: (value) => {
          interrupted = value
        },
      }),
      agentContext,
      'work',
    )
    if (!('agentId' in result)) throw new Error('expected spawn success')

    expect(control.sendInput(result.agentId, 'urgent update', { interrupt: true })).toEqual({
      success: true,
    })

    await control.waitAll([result.agentId], 100)

    expect(interrupted).toBe(true)
  })
})
