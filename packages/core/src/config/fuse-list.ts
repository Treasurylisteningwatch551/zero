import type { FuseRule } from '@zero-os/shared'

function isWordChar(ch: string): boolean {
  const c = ch.charCodeAt(0)
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95
}

function isPathContinuation(ch: string): boolean {
  if (isWordChar(ch)) return true
  const c = ch.charCodeAt(0)
  return c === 46 || c === 126 || c === 45 // . ~ -
}

/**
 * Boundary-aware pattern matching.
 * - Leading: if pattern starts with word char, preceding char must not be word char.
 * - Trailing `/`: next char must not be a path-continuation char (prevents `/` matching `/tmp`).
 * - Trailing word char: next char must not be word char.
 */
function matchesPattern(command: string, pattern: string): boolean {
  if (pattern.length === 0) return false

  const checkLeading = isWordChar(pattern[0])
  const patternEnd = pattern[pattern.length - 1]
  const trailingSlash = patternEnd === '/'
  const trailingWord = !trailingSlash && isWordChar(patternEnd)

  let startIdx = 0
  while (startIdx <= command.length - pattern.length) {
    const idx = command.indexOf(pattern, startIdx)
    if (idx === -1) return false

    if (checkLeading && idx > 0 && isWordChar(command[idx - 1])) {
      startIdx = idx + 1
      continue
    }

    const endIdx = idx + pattern.length
    if (endIdx < command.length) {
      const charAfter = command[endIdx]
      if (trailingSlash && isPathContinuation(charAfter)) {
        startIdx = idx + 1
        continue
      }
      if (trailingWord && isWordChar(charAfter)) {
        startIdx = idx + 1
        continue
      }
    }

    return true
  }

  return false
}

/**
 * Check if a command matches any fuse list rule.
 * Returns the matching rule if found, undefined otherwise.
 */
export function checkFuseList(command: string, rules: FuseRule[]): FuseRule | undefined {
  for (const rule of rules) {
    if (matchesPattern(command, rule.pattern)) {
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
