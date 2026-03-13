import { describe, expect, test } from 'bun:test'
import type { StreamEvent, TokenUsage } from '@zero-os/shared'
import { collectStream, consumeStream } from '../stream'

describe('collectStream', () => {
  test('aggregates text_delta events into a single TextBlock', async () => {
    async function* stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text_delta', data: { text: 'Hello' } }
      yield { type: 'text_delta', data: { text: ' world' } }
      yield { type: 'text_delta', data: { text: '!' } }
      yield { type: 'done', data: {} }
    }
    const result = await collectStream(stream())
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Hello world!' })
  })

  test('aggregates tool_use events into a ToolUseBlock', async () => {
    async function* stream(): AsyncIterable<StreamEvent> {
      yield { type: 'tool_use_start', data: { id: 'tool_1', name: 'read_file' } }
      yield { type: 'tool_use_delta', data: { arguments: '{"path":' } }
      yield { type: 'tool_use_delta', data: { arguments: '"/tmp/f.txt"}' } }
      yield { type: 'tool_use_end', data: {} }
      yield { type: 'done', data: {} }
    }
    const result = await collectStream(stream())
    expect(result.content).toHaveLength(1)
    expect(result.content[0]).toEqual({
      type: 'tool_use',
      id: 'tool_1',
      name: 'read_file',
      input: { path: '/tmp/f.txt' },
    })
  })

  test('handles interleaved text and tool_use events', async () => {
    async function* stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text_delta', data: { text: 'Let me read that file.' } }
      yield { type: 'tool_use_start', data: { id: 't1', name: 'read' } }
      yield { type: 'tool_use_delta', data: { arguments: '{"file":"a.ts"}' } }
      yield { type: 'tool_use_end', data: {} }
      yield { type: 'done', data: {} }
    }
    const result = await collectStream(stream())
    expect(result.content).toHaveLength(2)
    expect(result.content[0]).toEqual({ type: 'text', text: 'Let me read that file.' })
    expect(result.content[1]).toEqual({
      type: 'tool_use',
      id: 't1',
      name: 'read',
      input: { file: 'a.ts' },
    })
  })

  test('parses JSON arguments correctly', async () => {
    async function* stream(): AsyncIterable<StreamEvent> {
      yield { type: 'tool_use_start', data: { id: 't1', name: 'search' } }
      yield {
        type: 'tool_use_delta',
        data: { arguments: '{"query":"test","limit":10,"nested":{"a":true}}' },
      }
      yield { type: 'tool_use_end', data: {} }
      yield { type: 'done', data: {} }
    }
    const result = await collectStream(stream())
    expect(result.content[0]).toEqual({
      type: 'tool_use',
      id: 't1',
      name: 'search',
      input: { query: 'test', limit: 10, nested: { a: true } },
    })
  })

  test('extracts usage from done event', async () => {
    const usage: TokenUsage = { input: 100, output: 50 }
    async function* stream(): AsyncIterable<StreamEvent> {
      yield { type: 'text_delta', data: { text: 'Hi' } }
      yield { type: 'done', data: { usage } }
    }
    const result = await collectStream(stream())
    expect(result.usage).toEqual({ input: 100, output: 50 })
  })

  test('returns empty content for an empty stream', async () => {
    async function* stream(): AsyncIterable<StreamEvent> {}
    const result = await collectStream(stream())
    expect(result.content).toEqual([])
    expect(result.usage).toBeUndefined()
  })
})

describe('consumeStream', () => {
  test('calls onEvent for each event in order', async () => {
    const events: StreamEvent[] = [
      { type: 'text_delta', data: { text: 'A' } },
      { type: 'text_delta', data: { text: 'B' } },
      { type: 'done', data: {} },
    ]
    async function* stream(): AsyncIterable<StreamEvent> {
      for (const e of events) yield e
    }
    const received: StreamEvent[] = []
    await consumeStream(stream(), (e) => received.push(e))
    expect(received).toEqual(events)
  })
})
