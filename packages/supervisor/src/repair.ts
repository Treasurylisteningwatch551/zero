export type RepairStatus = 'idle' | 'diagnosing' | 'repairing' | 'verifying' | 'success' | 'failed'

export interface RepairAttempt {
  timestamp: string
  status: RepairStatus
  diagnosis: string
  action: string
  result: string
}

/**
 * Self-repair engine — diagnose, repair, verify flow.
 */
export class RepairEngine {
  private maxAttempts: number
  private attempts: RepairAttempt[] = []
  private status: RepairStatus = 'idle'

  constructor(maxAttempts: number = 5) {
    this.maxAttempts = maxAttempts
  }

  getStatus(): RepairStatus {
    return this.status
  }

  getAttempts(): RepairAttempt[] {
    return [...this.attempts]
  }

  getAttemptCount(): number {
    return this.attempts.length
  }

  shouldFuse(): boolean {
    const recentFails = this.attempts.filter((a) => a.status === 'failed').length
    return recentFails >= this.maxAttempts
  }

  /**
   * Run a repair cycle: diagnose → repair → verify.
   */
  async runRepairCycle(
    diagnose: () => Promise<string>,
    repair: (diagnosis: string) => Promise<string>,
    verify: () => Promise<boolean>
  ): Promise<RepairAttempt> {
    this.status = 'diagnosing'
    let diagnosis: string
    try {
      diagnosis = await diagnose()
    } catch (e) {
      diagnosis = `Diagnosis failed: ${e}`
    }

    this.status = 'repairing'
    let action: string
    try {
      action = await repair(diagnosis)
    } catch (e) {
      action = `Repair failed: ${e}`
    }

    this.status = 'verifying'
    let success: boolean
    try {
      success = await verify()
    } catch {
      success = false
    }

    const attempt: RepairAttempt = {
      timestamp: new Date().toISOString(),
      status: success ? 'success' : 'failed',
      diagnosis,
      action,
      result: success ? 'Verification passed' : 'Verification failed',
    }

    this.attempts.push(attempt)
    this.status = success ? 'success' : 'failed'

    return attempt
  }

  reset(): void {
    this.attempts = []
    this.status = 'idle'
  }
}
