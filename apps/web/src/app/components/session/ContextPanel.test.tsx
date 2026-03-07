import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { TraceSummaryCard } from './ContextPanel'

describe('TraceSummaryCard', () => {
  test('renders assistant preview from span metadata without throwing', () => {
    const html = renderToStaticMarkup(
      <TraceSummaryCard
        span={{
          id: 'span_1',
          sessionId: 'sess_1',
          name: 'task_closure_decision',
          startTime: '2026-03-08T00:00:00.000Z',
          endTime: '2026-03-08T00:00:01.000Z',
          durationMs: 1000,
          status: 'success',
          metadata: {
            action: 'continue',
            reason: 'still researching',
            assistantMessagePreview: 'latest assistant message',
            assistantMessageId: 'msg_assistant_1',
            userMessagePreview: 'research this deeply',
          },
          children: [],
        }}
      />,
    )

    expect(html).toContain('assistant_message')
    expect(html).toContain('latest assistant message')
  })
})
