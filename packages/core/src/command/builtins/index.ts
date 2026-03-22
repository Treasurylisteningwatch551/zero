import type { CommandRouter } from '../router'
import { modelCommand } from './model'
import { newSessionCommand } from './new-session'

export { newSessionCommand } from './new-session'
export { modelCommand } from './model'

export function registerBuiltinCommands(router: CommandRouter): void {
  router.register(newSessionCommand)
  router.register(modelCommand)
}
