import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadConfig, loadFuseList } from '../loader'

describe('loadConfig', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'loader-test-'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('throws error when file not found', () => {
    const badPath = join(tmpDir, 'nonexistent.yaml')
    expect(() => loadConfig(badPath)).toThrow(`Config file not found: ${badPath}`)
  })

  test('valid config.yaml parses to SystemConfig', () => {
    const configPath = join(tmpDir, 'valid.yaml')
    writeFileSync(configPath, `
providers:
  openai:
    api_type: openai_chat_completions
    base_url: https://api.openai.com/v1
    auth:
      type: api_key
      api_key_ref: openai-key
    models:
      gpt4:
        model_id: gpt-4
        max_context: 128000
        max_output: 4096
        capabilities:
          - chat
          - tools
        tags:
          - primary
default_model: openai/gpt4
fallback_chain:
  - openai/gpt4
`)

    const config = loadConfig(configPath)

    expect(config.defaultModel).toBe('openai/gpt4')
    expect(config.fallbackChain).toEqual(['openai/gpt4'])
    expect(config.providers.openai).toBeDefined()
    expect(config.providers.openai.models.gpt4).toBeDefined()
    expect(config.providers.openai.models.gpt4.modelId).toBe('gpt-4')
  })

  test('snake_case fields map to camelCase', () => {
    const configPath = join(tmpDir, 'snake.yaml')
    writeFileSync(configPath, `
providers:
  test:
    api_type: anthropic_messages
    base_url: https://api.anthropic.com
    auth:
      type: api_key
      api_key_ref: ant-key
    models:
      claude:
        model_id: claude-3
        max_context: 200000
        max_output: 16384
        capabilities: []
        tags: []
default_model: test/claude
`)

    const config = loadConfig(configPath)
    const provider = config.providers.test

    expect(provider.apiType).toBe('anthropic_messages')
    expect(provider.baseUrl).toBe('https://api.anthropic.com')
    expect(provider.auth.apiKeyRef).toBe('ant-key')

    const model = provider.models.claude
    expect(model.modelId).toBe('claude-3')
    expect(model.maxContext).toBe(200000)
    expect(model.maxOutput).toBe(16384)
  })

  test('missing optional fields get defaults', () => {
    const configPath = join(tmpDir, 'minimal.yaml')
    writeFileSync(configPath, `
providers:
  p:
    api_type: openai_chat_completions
    models:
      m: {}
`)

    const config = loadConfig(configPath)

    expect(config.defaultModel).toBe('')
    expect(config.fallbackChain).toEqual([])
    expect(config.schedules).toEqual([])
    expect(config.fuseList).toEqual([])

    const model = config.providers.p.models.m
    expect(model.maxContext).toBe(128000)
    expect(model.maxOutput).toBe(8192)
    expect(model.capabilities).toEqual([])
    expect(model.tags).toEqual([])
  })

  test('parses channel configs with snake_case refs', () => {
    const configPath = join(tmpDir, 'channels.yaml')
    writeFileSync(configPath, `
providers: {}
channels:
  - name: feishu:ops
    type: feishu
    app_id_ref: feishu_ops_app_id
    app_secret_ref: feishu_ops_app_secret
    encrypt_key_ref: feishu_ops_encrypt_key
    verification_token_ref: feishu_ops_verification_token
    receive_notifications: true
  - name: telegram:alerts
    type: telegram
    bot_token_ref: telegram_alerts_bot_token
`)

    const config = loadConfig(configPath)

    expect(config.channels).toHaveLength(2)
    expect(config.channels?.[0]).toEqual({
      name: 'feishu:ops',
      type: 'feishu',
      enabled: true,
      receiveNotifications: true,
      appIdRef: 'feishu_ops_app_id',
      appSecretRef: 'feishu_ops_app_secret',
      encryptKeyRef: 'feishu_ops_encrypt_key',
      verificationTokenRef: 'feishu_ops_verification_token',
    })
    expect(config.channels?.[1]).toEqual({
      name: 'telegram:alerts',
      type: 'telegram',
      enabled: true,
      receiveNotifications: false,
      botTokenRef: 'telegram_alerts_bot_token',
    })
  })
})

describe('loadFuseList', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'fuse-test-'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  test('empty rules returns empty array', () => {
    const fusePath = join(tmpDir, 'empty.yaml')
    writeFileSync(fusePath, 'rules: []\n')

    const rules = loadFuseList(fusePath)
    expect(rules).toEqual([])
  })

  test('parses rules correctly', () => {
    const fusePath = join(tmpDir, 'rules.yaml')
    writeFileSync(fusePath, `
rules:
  - pattern: "rm -rf /"
    description: "Prevent destructive commands"
  - pattern: "DROP TABLE"
    description: "Block SQL drops"
`)

    const rules = loadFuseList(fusePath)
    expect(rules).toHaveLength(2)
    expect(rules[0].pattern).toBe('rm -rf /')
    expect(rules[0].description).toBe('Prevent destructive commands')
    expect(rules[1].pattern).toBe('DROP TABLE')
    expect(rules[1].description).toBe('Block SQL drops')
  })
})
