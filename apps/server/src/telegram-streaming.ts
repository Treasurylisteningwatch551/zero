export interface TelegramStreamFlusherConfig {
  minIntervalMs?: number
  now?: () => number
  getText: () => string
  sendInitial: (text: string) => Promise<number | null>
  edit: (messageId: number, text: string) => Promise<void>
}

/**
 * Maintain streaming flush state so forced final flush cannot be lost during in-flight edits.
 */
export function createTelegramStreamFlusher(config: TelegramStreamFlusherConfig) {
  const minIntervalMs = config.minIntervalMs ?? 350
  const now = config.now ?? Date.now

  let lastFlushedText = ''
  let lastFlushAt = 0
  let editedMessageId: number | null = null

  let running = false
  let pending = false
  let pendingForce = false
  const idleWaiters: Array<() => void> = []

  const resolveIdle = () => {
    if (running || pending) return
    const waiters = idleWaiters.splice(0, idleWaiters.length)
    for (const notify of waiters) {
      notify()
    }
  }

  const waitForIdle = (): Promise<void> => {
    if (!running && !pending) return Promise.resolve()
    return new Promise((resolve) => {
      idleWaiters.push(resolve)
    })
  }

  const flush = async (force = false): Promise<void> => {
    pending = true
    pendingForce = pendingForce || force

    if (running) {
      await waitForIdle()
      return
    }

    running = true
    try {
      while (pending) {
        const cycleForce = pendingForce
        pending = false
        pendingForce = false

        const text = config.getText()
        if (!text) continue

        const nowMs = now()
        if (!cycleForce && nowMs - lastFlushAt < minIntervalMs) continue
        if (!cycleForce && text === lastFlushedText) continue

        if (editedMessageId === null) {
          editedMessageId = await config.sendInitial(text)
        } else {
          await config.edit(editedMessageId, text)
        }

        lastFlushAt = now()
        lastFlushedText = text
      }
    } finally {
      running = false
      resolveIdle()
    }
  }

  return {
    flush,
    getLastFlushedText: () => lastFlushedText,
  }
}

export function reconcileTelegramFinalText(streamText: string, finalReply: string): string {
  if (!finalReply) return streamText
  return finalReply === streamText ? streamText : finalReply
}
