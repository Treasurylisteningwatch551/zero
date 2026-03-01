import { describe, test, expect } from 'bun:test'
import { OpenAIChatAdapter } from '../adapters/openai-chat'
import { collectStream } from '../stream'
import type { Message } from '@zero-os/shared'
import { generateId, now } from '@zero-os/shared'

const API_KEY = 'sk-c6c02cbd0c25473f97f9be0da6070f6d'
const BASE_URL = 'https://www.right.codes/codex'
const MODEL_ID = 'gpt-5.3-codex-medium'

const adapter = new OpenAIChatAdapter({
  baseUrl: BASE_URL,
  auth: { type: 'api_key', apiKeyRef: 'test' },
  modelConfig: {
    modelId: MODEL_ID,
    maxContext: 400000,
    maxOutput: 128000,
    capabilities: ['tools', 'vision', 'reasoning'],
    tags: ['powerful', 'coding'],
  },
  apiKey: API_KEY,
})

function makeMessage(role: 'user' | 'assistant', text: string): Message {
  return {
    id: generateId(),
    sessionId: 'test',
    role,
    messageType: 'message',
    content: [{ type: 'text', text }],
    createdAt: now(),
  }
}

describe('OpenAI Chat Completions Adapter (Real API)', () => {
  test('complete returns a valid response', async () => {
    const response = await adapter.complete({
      messages: [makeMessage('user', 'Say "hello world" and nothing else.')],
      stream: false,
      maxTokens: 50,
    })

    expect(response.id).toBeDefined()
    expect(response.content.length).toBeGreaterThan(0)
    expect(response.content[0].type).toBe('text')
    expect(response.stopReason).toBeDefined()
    expect(response.usage.input).toBeGreaterThan(0)
    expect(response.usage.output).toBeGreaterThan(0)
  }, 30000)

  test('streaming returns text deltas', async () => {
    const stream = adapter.stream({
      messages: [makeMessage('user', 'Count from 1 to 5.')],
      stream: true,
      maxTokens: 100,
    })

    const result = await collectStream(stream)
    expect(result.content.length).toBeGreaterThan(0)
    expect(result.content[0].type).toBe('text')
    const text = (result.content[0] as { text: string }).text
    expect(text).toContain('1')
    expect(text).toContain('5')
  }, 30000)

  test('complete with system prompt', async () => {
    const response = await adapter.complete({
      messages: [makeMessage('user', 'What language should I use?')],
      system: 'You are a Python expert. Always recommend Python.',
      stream: false,
      maxTokens: 100,
    })

    const text = (response.content[0] as { text: string }).text.toLowerCase()
    expect(text).toContain('python')
  }, 30000)

  test('healthCheck returns true for valid endpoint', async () => {
    const healthy = await adapter.healthCheck()
    expect(healthy).toBe(true)
  }, 30000)
})
