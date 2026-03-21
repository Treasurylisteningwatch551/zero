import type { Message } from '@zero-os/shared'
import { generatePrefixedId } from '@zero-os/shared'
import type { AgentContext } from './agent'
import type { QueuedMessage } from './queue'

type AgentState = 'running' | 'completed' | 'failed' | 'closed'

interface ControlledAgent {
  run(
    context: AgentContext,
    userMessage: string,
    userImages?: Array<{ mediaType: string; data: string }>,
    onNewMessage?: (msg: Message) => void,
    onTextDelta?: (delta: string, meta: { role: 'assistant'; turnId: string }) => void,
    shouldInterrupt?: () => boolean,
    getQueuedMessages?: () => QueuedMessage[],
    requestLogMeta?: { turnIndex?: number },
  ): Promise<Message[]>
}

interface AgentEntry {
  id: string
  label: string
  role?: string
  depth: number
  state: AgentState
  startedAt: number
  endedAt?: number
  instruction: string
  agent?: ControlledAgent
  context?: AgentContext
  output?: string
  error?: string
  messageQueue: QueuedMessage[]
  interruptFlag: boolean
  waiters: Set<() => void>
}

export class AgentControl {
  private entries: Map<string, AgentEntry> = new Map()

  get activeAgentCount(): number {
    let count = 0
    for (const entry of this.entries.values()) {
      if (entry.state === 'running') count++
    }
    return count
  }

  spawn(
    agent: ControlledAgent,
    context: AgentContext,
    instruction: string,
    options?: {
      label?: string
      role?: string
      depth?: number
    },
  ): { agentId: string; label: string } | { error: string } {
    if (!agent || typeof agent.run !== 'function') {
      return { error: 'Invalid agent instance.' }
    }
    if (!context || typeof context !== 'object') {
      return { error: 'Invalid agent context.' }
    }
    if (typeof instruction !== 'string' || instruction.trim().length === 0) {
      return { error: 'Instruction is required.' }
    }

    const agentId = generatePrefixedId('agent')
    const label = options?.label?.trim() || `agent-${this.entries.size + 1}`
    const entry: AgentEntry = {
      id: agentId,
      label,
      role: options?.role?.trim() || undefined,
      depth: Math.max(1, options?.depth ?? 1),
      state: 'running',
      startedAt: Date.now(),
      instruction,
      agent,
      context,
      messageQueue: [],
      interruptFlag: false,
      waiters: new Set(),
    }

    this.entries.set(agentId, entry)
    void this.runEntry(entry)

    return { agentId, label }
  }

  async waitAny(
    ids: string[],
    timeoutMs?: number,
  ): Promise<{
    statuses: Record<string, { state: string; [key: string]: unknown }>
    timedOut: boolean
  }> {
    return this.wait(ids, timeoutMs, false)
  }

  async waitAll(
    ids: string[],
    timeoutMs?: number,
  ): Promise<{
    statuses: Record<string, { state: string; [key: string]: unknown }>
    timedOut: boolean
  }> {
    return this.wait(ids, timeoutMs, true)
  }

  getStatus(agentId: string): { state: string; [key: string]: unknown } | undefined {
    const entry = this.entries.get(agentId)
    return entry ? this.buildStatus(entry) : undefined
  }

  getOutput(agentId: string): string | undefined {
    return this.entries.get(agentId)?.output
  }

  sendInput(
    agentId: string,
    message: string,
    options?: { interrupt?: boolean },
  ): { success: boolean; error?: string } {
    const entry = this.entries.get(agentId)
    if (!entry) {
      return { success: false, error: `Sub-agent "${agentId}" was not found.` }
    }
    if (this.isTerminal(entry)) {
      return {
        success: false,
        error: `Sub-agent "${agentId}" is already in terminal state "${entry.state}".`,
      }
    }

    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      return { success: false, error: 'Message is required.' }
    }

    entry.messageQueue.push({
      content: trimmedMessage,
      timestamp: new Date().toISOString(),
    })
    if (options?.interrupt) {
      entry.interruptFlag = true
    }

    return { success: true }
  }

  getAgentInfo(
    agentId: string,
  ): { label: string; role?: string; status: { state: string } } | undefined {
    const entry = this.entries.get(agentId)
    if (!entry) return undefined
    return {
      label: entry.label,
      role: entry.role,
      status: { state: entry.state },
    }
  }

  close(agentId: string): { state: string; [key: string]: unknown } | undefined {
    const entry = this.entries.get(agentId)
    if (!entry) return undefined

    if (entry.state !== 'closed') {
      entry.state = 'closed'
      entry.endedAt ??= Date.now()
      entry.agent = undefined
      entry.context = undefined
      entry.instruction = ''
      entry.messageQueue = []
      entry.interruptFlag = false
      this.resolveWaiters(entry)
    }

    return this.buildStatus(entry)
  }

  listAgents(): Array<{
    id: string
    label: string
    role?: string
    status: { state: string }
    depth: number
    elapsedMs: number
  }> {
    return Array.from(this.entries.values()).map((entry) => ({
      id: entry.id,
      label: entry.label,
      role: entry.role,
      status: { state: entry.state },
      depth: entry.depth,
      elapsedMs: this.getElapsedMs(entry),
    }))
  }

  private async wait(
    ids: string[],
    timeoutMs: number | undefined,
    waitAll: boolean,
  ): Promise<{
    statuses: Record<string, { state: string; [key: string]: unknown }>
    timedOut: boolean
  }> {
    const requestedIds = [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))]
    if (requestedIds.length === 0) {
      return { statuses: {}, timedOut: false }
    }

    const knownEntries = requestedIds
      .map((id) => this.entries.get(id))
      .filter((entry): entry is AgentEntry => !!entry)

    const alreadySatisfied = waitAll
      ? knownEntries.every((entry) => this.isTerminal(entry))
      : knownEntries.some((entry) => this.isTerminal(entry))

    if (alreadySatisfied || knownEntries.length === 0) {
      return {
        statuses: this.buildStatuses(requestedIds),
        timedOut: false,
      }
    }

    const waitPromise = waitAll
      ? Promise.all(knownEntries.map((entry) => this.waitForTerminal(entry))).then(() => 'done')
      : Promise.race(knownEntries.map((entry) => this.waitForTerminal(entry))).then(() => 'done')

    let timedOut = false
    if (typeof timeoutMs === 'number' && timeoutMs >= 0) {
      const outcome = await Promise.race([
        waitPromise,
        new Promise<'timeout'>((resolve) => {
          setTimeout(() => resolve('timeout'), timeoutMs)
        }),
      ])
      timedOut = outcome === 'timeout'
    } else {
      await waitPromise
    }

    return {
      statuses: this.buildStatuses(requestedIds),
      timedOut,
    }
  }

  private waitForTerminal(entry: AgentEntry): Promise<void> {
    if (this.isTerminal(entry)) return Promise.resolve()

    return new Promise((resolve) => {
      entry.waiters.add(resolve)
    })
  }

  private async runEntry(entry: AgentEntry): Promise<void> {
    try {
      const messages = await entry.agent?.run(
        entry.context as AgentContext,
        entry.instruction,
        undefined,
        undefined,
        undefined,
        () => entry.interruptFlag,
        () => {
          const messages = [...entry.messageQueue]
          entry.messageQueue = []
          entry.interruptFlag = false
          return messages
        },
      )
      if (entry.state !== 'closed') {
        entry.output = this.extractOutput(messages ?? [])
        entry.state = 'completed'
        entry.endedAt = Date.now()
      }
    } catch (error) {
      if (entry.state !== 'closed') {
        entry.error = error instanceof Error ? error.message : String(error)
        entry.state = 'failed'
        entry.endedAt = Date.now()
      }
    } finally {
      entry.agent = undefined
      entry.context = undefined
      entry.instruction = ''
      entry.messageQueue = []
      entry.interruptFlag = false
      if (entry.state !== 'closed') {
        entry.endedAt ??= Date.now()
      }
      this.resolveWaiters(entry)
    }
  }

  private resolveWaiters(entry: AgentEntry): void {
    for (const resolve of entry.waiters) resolve()
    entry.waiters.clear()
  }

  private buildStatuses(ids: string[]): Record<string, { state: string; [key: string]: unknown }> {
    const statuses: Record<string, { state: string; [key: string]: unknown }> = {}
    for (const id of ids) {
      const entry = this.entries.get(id)
      statuses[id] = entry ? this.buildStatus(entry) : { state: 'not_found' }
    }
    return statuses
  }

  private buildStatus(entry: AgentEntry): { state: string; [key: string]: unknown } {
    const status: { state: string; [key: string]: unknown } = {
      state: entry.state,
      label: entry.label,
      depth: entry.depth,
      elapsedMs: this.getElapsedMs(entry),
    }
    if (entry.role) status.role = entry.role
    if (entry.output !== undefined) status.output = entry.output
    if (entry.error) status.error = entry.error
    return status
  }

  private getElapsedMs(entry: AgentEntry): number {
    return Math.max(0, (entry.endedAt ?? Date.now()) - entry.startedAt)
  }

  private isTerminal(entry: AgentEntry): boolean {
    return entry.state === 'completed' || entry.state === 'failed' || entry.state === 'closed'
  }

  private extractOutput(messages: Message[]): string {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant')
    if (!lastAssistant) return ''

    return lastAssistant.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  }
}
