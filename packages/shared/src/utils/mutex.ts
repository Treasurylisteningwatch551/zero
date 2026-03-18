/**
 * In-memory mutex with owner tracking.
 * Used for instance-level resource locking (e.g., Browser tool).
 */
export class Mutex {
  private locked = false
  private queue: Array<{ resolve: () => void }> = []
  private owner: string | null = null
  private unlockListeners: Array<() => void> = []

  async acquire(ownerId: string): Promise<void> {
    if (!this.locked) {
      this.locked = true
      this.owner = ownerId
      return
    }
    return new Promise<void>((resolve) => {
      this.queue.push({ resolve })
    }).then(() => {
      this.owner = ownerId
    })
  }

  release(ownerId: string): void {
    if (this.owner !== ownerId) {
      throw new Error(`Mutex release denied: owned by "${this.owner}", caller is "${ownerId}"`)
    }
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      if (!next) {
        this.locked = false
        this.owner = null
        return
      }
      next.resolve()
    } else {
      this.locked = false
      this.owner = null
      this.notifyUnlockListeners()
    }
  }

  waitForUnlock(): Promise<void> {
    if (!this.locked) {
      return Promise.resolve()
    }

    return new Promise<void>((resolve) => {
      this.unlockListeners.push(resolve)
    })
  }

  isLocked(): boolean {
    return this.locked
  }

  getOwner(): string | null {
    return this.owner
  }

  private notifyUnlockListeners(): void {
    if (this.unlockListeners.length === 0) return
    const listeners = this.unlockListeners
    this.unlockListeners = []
    for (const listener of listeners) {
      listener()
    }
  }
}
