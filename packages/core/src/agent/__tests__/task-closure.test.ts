import { describe, expect, test } from 'bun:test'
import type { ContentBlock } from '@zero-os/shared'
import {
  buildTaskClosureDecisionPrompt,
  extractAssistantTail,
  extractAssistantText,
  hasAssistantText,
  parseTaskClosureDecision,
  stripAssistantTrimFrom,
} from '../task-closure'

describe('parseTaskClosureDecision', () => {
  test('parses valid JSON surrounded by extra text', () => {
    expect(
      parseTaskClosureDecision(
        'result: {"action":"continue","reason":"后续仍必要","trimFrom":"如果你愿意"}'
      )
    ).toEqual({
      action: 'continue',
      reason: '后续仍必要',
      trimFrom: '如果你愿意',
    })
  })

  test('rejects continue decisions without trimFrom', () => {
    expect(
      parseTaskClosureDecision('{"action":"continue","reason":"后续仍必要","trimFrom":""}')
    ).toBeNull()
  })
})

describe('assistant text helpers', () => {
  test('extractAssistantText joins all text blocks', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: '第一段' },
      { type: 'tool_result', toolUseId: 'tool_1', content: 'ignored' },
      { type: 'text', text: '第二段' },
    ]

    expect(extractAssistantText(content)).toBe('第一段第二段')
  })

  test('extractAssistantTail uses the last text block', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: '前文' },
      { type: 'text', text: 'abcdef' },
    ]

    expect(extractAssistantTail(content, 3)).toBe('def')
  })

  test('stripAssistantTrimFrom trims only the last matching text block', () => {
    const content: ContentBlock[] = [
      { type: 'text', text: '保留段落' },
      { type: 'text', text: '结论。\n\n如果你愿意，我可以继续查证。' },
    ]

    expect(stripAssistantTrimFrom(content, '如果你愿意，我可以继续查证。')).toEqual([
      { type: 'text', text: '保留段落' },
      { type: 'text', text: '结论。' },
    ])
  })

  test('hasAssistantText ignores whitespace-only text blocks', () => {
    expect(hasAssistantText([{ type: 'text', text: '   ' }])).toBe(false)
    expect(hasAssistantText([{ type: 'text', text: '有内容' }])).toBe(true)
  })
})


test('buildTaskClosureDecisionPrompt includes research-depth guidance', () => {
  const prompt = buildTaskClosureDecisionPrompt(
    '看看这个链接, 然后把可能相关的信息也分析下',
    '这里是一版初步结论',
    '如果你愿意，我可以继续查更多相关信息',
    {
      isResearchTask: true,
      wantsDepth: true,
      externalLookupCount: 1,
      externalSourceDomains: ['reddit.com'],
      coverageHint: 'depth_requested_but_multi_source_not_reached',
      toolCallSummary: [],
    },
  )

  expect(prompt).toContain('研究/分析类任务额外规则')
  expect(prompt).toContain('多源交叉验证')
  expect(prompt).toContain('external_lookup_count=1')
  expect(prompt).toContain('coverage_hint=depth_requested_but_multi_source_not_reached')
})

test('buildTaskClosureDecisionPrompt includes tool call summary', () => {
  const prompt = buildTaskClosureDecisionPrompt(
    '2分钟后提醒我',
    '已设置好，2分钟后会提醒你',
    '已设置好，2分钟后会提醒你',
    {
      isResearchTask: false,
      wantsDepth: false,
      externalLookupCount: 0,
      externalSourceDomains: [],
      coverageHint: 'general',
      toolCallSummary: ['schedule:create → success (Created schedule "reminder-2min")'],
    },
  )

  expect(prompt).toContain('<tool_calls_this_turn>')
  expect(prompt).toContain('schedule:create → success')
})

test('buildTaskClosureDecisionPrompt renders none when no tool calls', () => {
  const prompt = buildTaskClosureDecisionPrompt(
    '你好',
    '你好！',
    '你好！',
    {
      isResearchTask: false,
      wantsDepth: false,
      externalLookupCount: 0,
      externalSourceDomains: [],
      coverageHint: 'general',
      toolCallSummary: [],
    },
  )

  expect(prompt).toContain('<tool_calls_this_turn>\nnone\n</tool_calls_this_turn>')
})
