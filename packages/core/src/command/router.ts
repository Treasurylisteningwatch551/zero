import type { SessionSource } from '@zero-os/shared'
import type { Command, CommandContext, CommandResult } from './types'

export class CommandRouter {
  private commands: Command[] = []

  /** Register a command */
  register(cmd: Command): void {
    this.commands.push(cmd)
  }

  /** Try to handle content as a command. Returns null if not a command. */
  async handle(content: string, ctx: CommandContext): Promise<CommandResult | null> {
    const trimmed = content.trim()
    if (!trimmed.startsWith('/')) return null

    for (const cmd of this.commands) {
      if (cmd.sources && !cmd.sources.includes(ctx.source)) continue

      const args = cmd.parse(trimmed)
      if (args !== null) {
        return cmd.execute(args, ctx)
      }
    }

    // Unrecognized slash command - let it pass through to the session/AI
    return null
  }

  /** List all registered commands, optionally filtered by source */
  list(source?: SessionSource): Command[] {
    if (!source) return [...this.commands]
    return this.commands.filter((cmd) => !cmd.sources || cmd.sources.includes(source))
  }
}
