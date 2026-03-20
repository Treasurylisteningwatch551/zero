import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startZeroOS } from '../apps/server/src/main'

const E2E_PORT = '3101'

function createE2EDataDir(): string {
  const dataDir = mkdtempSync(join(tmpdir(), 'zero-e2e-'))
  const prodDir = join(process.cwd(), '.zero')

  for (const file of ['secrets.enc', 'config.yaml', 'fuse_list.yaml']) {
    const src = join(prodDir, file)
    if (existsSync(src)) {
      cpSync(src, join(dataDir, file))
    }
  }

  return dataDir
}

const dataDir = createE2EDataDir()
process.env.ZERO_DATA_DIR = dataDir
process.env.PORT = E2E_PORT

const zero = await startZeroOS({
  dataDir,
  skipProcessExit: true,
  onCoreReady: async (runtime) => {
    const { startWebServer } = await import('../apps/web/src/server')
    const web = startWebServer(runtime)
    console.log(`[ZeRo OS E2E] Web UI: http://127.0.0.1:${web.port}`)
    console.log(`[ZeRo OS E2E] ZERO_DATA_DIR: ${dataDir}`)
  },
})

let shuttingDown = false

async function shutdown(signal: string) {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`[ZeRo OS E2E] Shutting down on ${signal}...`)
  try {
    await zero.shutdown()
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
    process.exit(0)
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
