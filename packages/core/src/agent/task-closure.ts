import type { ContentBlock } from '@zero-os/shared'

export type TaskClosureAction = 'finish' | 'continue' | 'block'

export interface TaskClosureDecision {
  action: TaskClosureAction
  reason: string
  trimFrom: string
}

export interface TaskClosurePromptContext {
  isResearchTask: boolean
  wantsDepth: boolean
  externalLookupCount: number
  externalSourceDomains: string[]
  coverageHint: string
  toolCallSummary: string[]
}

export const TASK_CLOSURE_PROMPT = `<system_notice>
你刚才已经给出了一个阶段性结果，但把当前任务的必要后续动作写成了可选下一步。
如果这些动作仍属于回答当前问题的必要组成部分，请直接继续执行，不要把它们交还给用户选择。
只有在你确实缺少用户提供的信息、授权、凭据、登录态，或下一步涉及不可逆外部操作时，才说明真实阻塞并停止。
不要用“如果你愿意”“如果你要”“要不要我继续”“我下一步可以”或类似可选分支菜单收尾。
当前进度可参考上方的工具调用历史。
</system_notice>`


export const TASK_CLOSURE_CLASSIFIER_SYSTEM_PROMPT = '你是一个严格的任务收尾判定器。你只输出合法 JSON，不要输出解释、代码块或额外文本。'

export function buildTaskClosureDecisionPrompt(
  userMessage: string,
  assistantText: string,
  assistantTail: string,
  context?: TaskClosurePromptContext,
): string {
  return `<instruction>
你是一个任务收尾判定器。请判断 assistant 的收尾是否把当前任务的必要后续动作包装成了可选下一步。

判定原则：
- 如果 assistant 已经完整回答用户问题，返回 finish。
- 如果 assistant 只是把完成当前问题所必需的低成本后续动作写成了“如果你愿意，我可以继续……”，返回 continue。
- 如果 assistant 明确缺少用户提供的信息、授权、凭据、登录态，或下一步涉及不可逆外部动作，返回 block。
- 如果 assistant 声称已完成某操作，且 <tool_calls_this_turn> 中有对应的成功工具调用记录，该操作视为已实际执行，不属于虚假确认，应返回 finish 而非 block。
- 只有当用户明确要求”给我下一步选项 / 后续选项 / 还能做什么”时，菜单式收尾才算 finish。

研究/分析类任务额外规则：
- 如果用户要求分析、深入分析、研究、核验，或要求把“相关信息 / 相关线索”也一起分析，不能因为 assistant 已经给出一版总结就直接返回 finish。
- 对研究/分析类任务，只有当 assistant 已覆盖原始材料的关键主张、扩展到主要相关信息、尽可能做了多源交叉验证，并明确区分已证实与未证实部分时，才可返回 finish。
- 如果 assistant 当前更像第一轮读后总结、只分析了单一来源、或仍明确指出还有重要相关线索/来源值得继续查证，则返回 continue。
- 如果继续查证、补充相关信息、拆分关键主张，会实质提升回答质量而不是只做边际润色，则返回 continue。

特别示例：
- 用户让你“看看某个帖子/链接，并把可能相关的信息也分析下”，而 assistant 只总结了当前内容或一两个来源，然后说“如果你愿意我还可以继续查更多相关信息/来源”，这通常应判为 continue，不是 finish。

返回 JSON，不要其他内容：
{"action":"finish|continue|block","reason":"简短原因","trimFrom":"当 action=continue 时，需要从 assistant 最后一个 text block 中裁掉的精确原文起始片段；否则返回空字符串"}

要求：
- trimFrom 必须是 assistant 原文中实际存在的精确子串。
- 如果 action 不是 continue，trimFrom 必须为空字符串。
- 不要重写 assistant 内容，只做判定。
</instruction>

<task_context>
research_task=${context?.isResearchTask ? 'yes' : 'no'}
depth_requested=${context?.wantsDepth ? 'yes' : 'no'}
external_lookup_count=${context?.externalLookupCount ?? 0}
external_source_domains=${context?.externalSourceDomains.join(', ') || 'none'}
coverage_hint=${context?.coverageHint ?? 'unknown'}
</task_context>

<tool_calls_this_turn>
${context?.toolCallSummary?.length ? context.toolCallSummary.join('\n') : 'none'}
</tool_calls_this_turn>

<user_message>
${userMessage}
</user_message>

<assistant_text>
${assistantText}
</assistant_text>

<assistant_tail>
${assistantTail}
</assistant_tail>`
}

export function parseTaskClosureDecision(response: string): TaskClosureDecision | null {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null

    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>
    const action = parsed.action
    const reason = parsed.reason
    const trimFrom = parsed.trimFrom

    if (action !== 'finish' && action !== 'continue' && action !== 'block') return null
    if (typeof reason !== 'string') return null
    if (typeof trimFrom !== 'string') return null
    if (action === 'continue' && trimFrom.length === 0) return null
    if (action !== 'continue' && trimFrom !== '') return null

    return {
      action,
      reason,
      trimFrom,
    }
  } catch {
    return null
  }
}

export function extractAssistantText(content: ContentBlock[]): string {
  return content
    .filter(block => block.type === 'text')
    .map(block => (block as { type: 'text'; text: string }).text)
    .join('')
}

export function extractAssistantTail(content: ContentBlock[], maxChars = 1200): string {
  const lastText = getLastTextBlockText(content)
  if (!lastText) return ''
  return lastText.length <= maxChars ? lastText : lastText.slice(-maxChars)
}

export function stripAssistantTrimFrom(content: ContentBlock[], trimFrom: string): ContentBlock[] | null {
  if (!trimFrom) return null

  for (let index = content.length - 1; index >= 0; index--) {
    const block = content[index]
    if (!block || block.type !== 'text') continue

    const cutIndex = block.text.lastIndexOf(trimFrom)
    if (cutIndex < 0) continue

    const stripped = block.text.slice(0, cutIndex).trimEnd()
    const next = [...content]
    if (stripped.length === 0) {
      next.splice(index, 1)
    } else {
      next[index] = { ...block, text: stripped }
    }
    return next
  }

  return null
}

export function hasAssistantText(content: ContentBlock[]): boolean {
  return content.some(block => block.type === 'text' && block.text.trim().length > 0)
}

function getLastTextBlockText(content: ContentBlock[]): string {
  for (let index = content.length - 1; index >= 0; index--) {
    const block = content[index]
    if (block?.type === 'text') return block.text
  }
  return ''
}
