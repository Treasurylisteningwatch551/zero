import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ContextPanel, TraceSummaryCard } from './ContextPanel'

describe('TraceSummaryCard', () => {
  test('renders classifier request details from span metadata without throwing', () => {
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
            assistantMessageId: 'msg_assistant_1',
            classifierRequest: {
              system: 'strict classifier',
              prompt: '<instruction>research this deeply</instruction>',
              maxTokens: 200,
            },
          },
          children: [],
        }}
      />,
    )

    expect(html).toContain('classifier_request')
    expect(html).toContain('strict classifier')
  })

  test('keeps context panel height constrained', () => {
    const html = renderToStaticMarkup(
      <ContextPanel
        modelHistory={[]}
        toolCalls={[]}
        filesTouched={[]}
        totalTokens={0}
        selectedToolId={null}
      />,
    )

    expect(html).toContain('h-full min-h-0 overflow-y-auto')
  })

  test('keeps selected tool detail scrollable', () => {
    const html = renderToStaticMarkup(
      <ContextPanel
        modelHistory={[]}
        toolCalls={[
          {
            id: 'tool_1',
            name: 'bash',
            input: { command: 'echo test' },
            result: 'done',
            durationMs: 1250,
          },
        ]}
        filesTouched={[]}
        totalTokens={0}
        selectedToolId="tool_1"
      />,
    )

    expect(html).toContain('h-full min-h-0 overflow-y-auto')
    expect(html).toContain('max-h-[320px] overflow-y-auto')
    expect(html).toContain('DURATION')
    expect(html).toContain('1.3s')
  })

  test('renders cache summary and savings fields', () => {
    const html = renderToStaticMarkup(
      <ContextPanel
        modelHistory={[]}
        toolCalls={[]}
        filesTouched={[]}
        totalTokens={0}
        cacheWriteTokens={120}
        cacheReadTokens={480}
        effectiveInputTokens={960}
        cacheHitRate={0.5}
        cacheReadCost={0.02}
        cacheWriteCost={0.01}
        grossAvoidedInputCost={0.08}
        netSavings={0.07}
        selectedToolId={null}
      />,
    )

    expect(html).toContain('Cache')
    expect(html).toContain('Effective Input')
    expect(html).toContain('Net Savings')
    expect(html).toContain('+$0.070')
  })
})
