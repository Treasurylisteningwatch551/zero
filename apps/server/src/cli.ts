import { join } from 'node:path'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { generateMasterKey, setMasterKey, getMasterKey, Vault } from '@zero-os/secrets'
import { DEFAULT_TEMPLATES } from '@zero-os/core'
import { startZeroOS } from './main'
import { rebuildWebBundle } from './web-build'

const ZERO_DIR = join(process.cwd(), '.zero')
const SECRETS_PATH = join(ZERO_DIR, 'secrets.enc')

const command = process.argv[2]

switch (command) {
  case 'init':
    await init()
    break
  case 'start':
    await start()
    break
  case 'secret':
    await secret()
    break
  case 'status':
    await status()
    break
  case 'restart':
    await restart()
    break
  default:
    printHelp()
    break
}

async function init() {
  console.log('[ZeRo OS] Initializing...\n')

  // 1. Generate master key
  let masterKey: Buffer
  try {
    masterKey = await getMasterKey()
    console.log('  Master key: already exists in Keychain')
  } catch {
    masterKey = generateMasterKey()
    await setMasterKey(masterKey)
    console.log('  Master key: generated and stored in Keychain')
  }

  // 2. Create empty vault if not exists
  const vault = new Vault(masterKey, SECRETS_PATH)
  if (!existsSync(SECRETS_PATH)) {
    vault.save()
    console.log('  Secrets vault: created (.zero/secrets.enc)')
  } else {
    vault.load()
    console.log(`  Secrets vault: loaded (${vault.keys().length} keys)`)
  }

  // 3. Prompt for API key if not set
  const apiKeyRef = 'openai_codex_api_key'
  if (!vault.get(apiKeyRef)) {
    const apiKey = process.argv[3]
    if (apiKey) {
      vault.set(apiKeyRef, apiKey)
      console.log(`  API key: stored as "${apiKeyRef}"`)
    } else {
      console.log(`\n  ⚠  No API key found. Run:`)
      console.log(`     bun zero init <your-api-key>`)
      console.log(`     or:`)
      console.log(`     bun zero secret set openai_codex_api_key <your-api-key>`)
    }
  } else {
    console.log(`  API key: "${apiKeyRef}" already configured`)
  }

  // 4. Create default bootstrap files for "zero" agent
  const agentWorkspace = join(ZERO_DIR, 'workspace', 'zero')
  mkdirSync(agentWorkspace, { recursive: true })

  for (const [name, template] of Object.entries(DEFAULT_TEMPLATES)) {
    const filePath = join(agentWorkspace, name)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, template)
      console.log(`  Bootstrap: created ${name}`)
    } else {
      console.log(`  Bootstrap: ${name} already exists`)
    }
  }

  console.log('\n[ZeRo OS] Init complete. Run `bun zero start` to launch.')
}

async function start() {
  // Pre-flight check
  if (!existsSync(join(ZERO_DIR, 'config.yaml'))) {
    console.error('[ZeRo OS] Error: .zero/config.yaml not found. Run `bun zero init` first.')
    process.exit(1)
  }

  const zero = await startZeroOS()

  // Start the web API server
  const { startWebServer } = await import('../../web/src/server')
  const web = startWebServer(zero)
  console.log(`[ZeRo OS] Web UI: http://localhost:${web.port}`)

  process.on('SIGINT', () => zero.shutdown())
  process.on('SIGTERM', () => zero.shutdown())
}

async function secret() {
  const action = process.argv[3]
  const key = process.argv[4]
  const value = process.argv[5]

  let masterKey: Buffer
  try {
    masterKey = await getMasterKey()
  } catch {
    console.error('[ZeRo OS] No master key found. Run `bun zero init` first.')
    process.exit(1)
  }

  const vault = new Vault(masterKey, SECRETS_PATH)
  vault.load()

  switch (action) {
    case 'set':
      if (!key || !value) {
        console.error('Usage: bun zero secret set <key> <value>')
        process.exit(1)
      }
      vault.set(key, value)
      console.log(`Secret "${key}" stored.`)
      break

    case 'list':
      const keys = vault.keys()
      if (keys.length === 0) {
        console.log('No secrets stored.')
      } else {
        console.log('Stored secrets:')
        for (const k of keys) {
          console.log(`  - ${k}`)
        }
      }
      break

    case 'delete':
      if (!key) {
        console.error('Usage: bun zero secret delete <key>')
        process.exit(1)
      }
      vault.delete(key)
      console.log(`Secret "${key}" deleted.`)
      break

    default:
      console.log('Usage:')
      console.log('  bun zero secret set <key> <value>')
      console.log('  bun zero secret list')
      console.log('  bun zero secret delete <key>')
      break
  }
}

async function status() {
  console.log('[ZeRo OS] Status\n')

  // Config
  const configExists = existsSync(join(ZERO_DIR, 'config.yaml'))
  console.log(`  Config:    ${configExists ? '✓ found' : '✗ missing'}`)

  // Secrets
  const secretsExist = existsSync(SECRETS_PATH)
  console.log(`  Secrets:   ${secretsExist ? '✓ found' : '✗ missing'}`)

  // Master key
  try {
    await getMasterKey()
    console.log('  Keychain:  ✓ master key found')
  } catch {
    console.log('  Keychain:  ✗ no master key')
  }

  // API Key
  if (secretsExist) {
    try {
      const masterKey = await getMasterKey()
      const vault = new Vault(masterKey, SECRETS_PATH)
      vault.load()
      const hasApiKey = vault.get('openai_codex_api_key')
      console.log(`  API Key:   ${hasApiKey ? '✓ configured' : '✗ not set'}`)
      console.log(`  Keys:      ${vault.keys().length} total`)
    } catch {
      console.log('  API Key:   ? cannot read vault')
    }
  }

  // Logs dir
  const logsExist = existsSync(join(ZERO_DIR, 'logs'))
  console.log(`  Logs:      ${logsExist ? '✓ found' : '✗ missing'}`)

  // Web build
  const webBuild = existsSync(join(process.cwd(), 'apps/web/dist'))
  console.log(`  Web Build: ${webBuild ? '✓ built' : '○ not built (run bun run build:web)'}`)
}

async function restart() {
  const heartbeatPath = join(ZERO_DIR, 'heartbeat.json')
  if (!existsSync(heartbeatPath)) {
    console.error('[ZeRo OS] No heartbeat file found. Is the server running?')
    process.exit(1)
  }

  console.log('[ZeRo OS] Rebuilding web UI before restart...')
  const build = rebuildWebBundle()
  if (!build.ok) {
    console.error('[ZeRo OS] Web rebuild failed:', build.error)
    process.exit(1)
  }

  try {
    const data = JSON.parse(readFileSync(heartbeatPath, 'utf-8'))
    const pid = data.pid as number
    process.kill(pid, 'SIGTERM')
    console.log(`[ZeRo OS] Sent SIGTERM to PID ${pid}. Supervisor will restart the process.`)
  } catch (err) {
    console.error('[ZeRo OS] Failed to restart:', err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

function printHelp() {
  console.log(`
ZeRo OS CLI

Usage:
  bun zero <command>

Commands:
  init [api-key]     Initialize ZeRo OS (Keychain, vault, directories)
  start              Start ZeRo OS (server + web UI)
  restart            Graceful restart (requires Supervisor running)
  secret set <k> <v> Store a secret in the vault
  secret list        List all stored secret keys
  secret delete <k>  Delete a secret
  status             Show system status

Examples:
  bun zero init sk-your-api-key-here
  bun zero start
  bun zero restart
  bun zero secret set openai_codex_api_key sk-xxx
  bun zero status
`)
}
