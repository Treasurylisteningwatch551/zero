import { join } from 'node:path'
import { migrateSessionLayout } from '../../../../packages/observe/src/session-layout-migration'

const logsDir = join(process.cwd(), '.zero', 'logs')
const result = migrateSessionLayout(logsDir)

console.log('[ZeRo OS] Session layout migration complete')
console.log(JSON.stringify({ logsDir, ...result }, null, 2))
