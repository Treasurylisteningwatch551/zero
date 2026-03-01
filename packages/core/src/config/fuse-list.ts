import type { FuseRule } from '@zero-os/shared'

/**
 * Check if a command matches any fuse list rule.
 * Returns the matching rule if found, undefined otherwise.
 */
export function checkFuseList(command: string, rules: FuseRule[]): FuseRule | undefined {
  for (const rule of rules) {
    if (command.includes(rule.pattern)) {
      return rule
    }
  }
  return undefined
}

/**
 * FuseListChecker wraps the fuse list for stateful checking.
 */
export class FuseListChecker {
  private rules: FuseRule[]

  constructor(rules: FuseRule[]) {
    this.rules = rules
  }

  /**
   * Check a command against the fuse list.
   * Throws if the command is blocked.
   */
  check(command: string): void {
    const match = checkFuseList(command, this.rules)
    if (match) {
      throw new FuseError(command, match)
    }
  }

  /**
   * Add a new rule to the fuse list.
   */
  addRule(rule: FuseRule): void {
    this.rules.push(rule)
  }

  /**
   * Get all rules.
   */
  getRules(): FuseRule[] {
    return [...this.rules]
  }
}

export class FuseError extends Error {
  public readonly command: string
  public readonly rule: FuseRule

  constructor(command: string, rule: FuseRule) {
    super(`Command blocked by fuse list: "${rule.pattern}" - ${rule.description}`)
    this.name = 'FuseError'
    this.command = command
    this.rule = rule
  }
}
