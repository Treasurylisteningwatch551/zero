import type { PromptComponents } from '@zero-os/shared'
import type { ToolDefinition, Memory } from '@zero-os/shared'
import { truncateToTokens } from '@zero-os/shared'
import { enforceFixedBudget } from './budget'
import { CONTEXT_PARAMS } from './params'

export function buildSystemPrompt(components: PromptComponents): string {
  const sections: string[] = []

  sections.push(buildRoleBlock(components.agentName, components.agentDescription, components.currentTime))
  sections.push(buildRulesBlock())
  sections.push(buildToolRulesBlock(components.tools))
  sections.push(buildConstraintsBlock())
  sections.push(buildIdentityBlock(components.globalIdentity, components.agentIdentity, components.agentName))
  sections.push(buildMemoBlock(components.memo))

  if (components.retrievedMemories.length > 0) {
    sections.push(buildRetrievedMemoryBlock(components.retrievedMemories))
  }

  return sections.join('\n\n')
}

export function buildRoleBlock(agentName: string, agentDescription: string, currentTime: string): string {
  const content = `你是 ZeRo OS 的 ${agentName}，一个在 macOS 上自主执行任务的 AI Agent。
${agentDescription}
当前时间：${currentTime}`
  return enforceFixedBudget(`<role>\n${content}\n</role>`, 500, 'Role')
}

export function buildRulesBlock(): string {
  const rules = `执行操作前先说明意图，让用户知道你打算做什么。
工具调用失败时先读错误信息做诊断，再决定重试或换方案。不盲目重复相同命令。
涉及不可逆操作（删除文件、覆写内容、格式化）时主动向用户确认。
遇到超出能力范围的问题时如实告知，不编造解决方案。
回复使用中文，技术术语可以用英文原文。
每完成一个阶段性目标后，更新备忘录中你自己的分区。`
  return `<rules>\n${rules}\n</rules>`
}

export function buildToolRulesBlock(tools: ToolDefinition[]): string {
  const toolRuleMap: Record<string, string> = {
    read: 'Read：优先使用 Read 查看文件内容，不要用 Bash cat。',
    write: 'Write：写入文件前先确认路径正确。写入其他路径前必须确认。',
    edit: 'Edit：修改文件前先 Read 确认当前内容，避免基于过期认知做编辑。',
    bash: 'Bash：命令执行前检查是否命中熔断名单。长时间运行的命令加 timeout。',
    browser: 'Browser：同一时间只有一个 Session 能使用 Browser，如果被占用会收到锁冲突错误，等待后重试。',
    task: 'Task：拆分 SubAgent 时明确每个子任务的输入、输出和依赖关系。不要把含糊的大任务直接丢给 SubAgent。',
  }

  const availableToolNames = tools.map(t => t.name.toLowerCase())
  const rules = availableToolNames
    .map(name => toolRuleMap[name])
    .filter(Boolean)

  if (rules.length === 0) return '<tool_rules>\n</tool_rules>'

  const content = rules.join('\n')
  return enforceFixedBudget(`<tool_rules>\n${content}\n</tool_rules>`, 800, 'Tool Rules')
}

export function buildConstraintsBlock(): string {
  const constraints = `所有输出（聊天回复、文件写入、日志）不得包含密钥值。如需引用密钥，使用引用名（如 anthropic_api_key）。
代码修改后必须通过至少一种验证（类型检查、单元测试、手动执行）再报告完成。
单次回复不超过 2000 字，除非用户明确要求详细输出。`
  return enforceFixedBudget(`<constraints>\n${constraints}\n</constraints>`, 300, 'Constraints')
}

export function buildIdentityBlock(globalIdentity: string, agentIdentity: string, agentName: string): string {
  const parts: string[] = []
  if (globalIdentity) {
    parts.push(`  <global>\n${globalIdentity}\n  </global>`)
  }
  if (agentIdentity) {
    parts.push(`  <agent name="${agentName}">\n${agentIdentity}\n  </agent>`)
  }
  if (parts.length === 0) return '<identity>\n</identity>'
  const content = parts.join('\n\n')
  return enforceFixedBudget(`<identity>\n${content}\n</identity>`, 3000, 'Identity')
}

export function buildMemoBlock(memo: string): string {
  if (!memo) return '<memo>\n</memo>'
  return enforceFixedBudget(`<memo>\n${memo}\n</memo>`, 1500, 'Memo')
}

export function buildRetrievedMemoryBlock(memories: Memory[]): string {
  const memoryEntries = memories.map(m => {
    return `  <memory type="${m.type}" confidence="${m.confidence}" id="${m.id}" updated="${m.updatedAt}">\n  标题：${m.title}\n  内容：\n${m.content}\n  </memory>`
  })
  const content = memoryEntries.join('\n\n')
  return enforceFixedBudget(`<retrieved_memories>\n${content}\n</retrieved_memories>`, 2000, 'Retrieved Memories')
}

/**
 * Build a simplified System Prompt for SubAgents.
 * SubAgents are task-oriented one-shot executors — no identity, memo, or retrieved memories.
 */
export function buildSubAgentPrompt(
  tools: ToolDefinition[],
  instruction: string,
  upstreamResults?: Map<string, { output: string; success: boolean }>,
  dependsOn?: string[],
): string {
  const sections: string[] = []

  // Simplified role
  sections.push(`<role>
你是 ZeRo OS 的 SubAgent，负责执行一项特定任务。
任务完成后输出结果，不需要与用户交互。
</role>`)

  // Tool rules (reuse existing builder)
  sections.push(buildToolRulesBlock(tools))

  // Constraints (reuse existing builder)
  sections.push(buildConstraintsBlock())

  // Task block
  sections.push(`<task>
${instruction}
</task>`)

  // Upstream results (if any dependencies)
  if (dependsOn && dependsOn.length > 0 && upstreamResults) {
    const items = dependsOn
      .map(depId => {
        const result = upstreamResults.get(depId)
        if (!result) return ''
        const output = truncateToTokens(result.output, CONTEXT_PARAMS.subAgent.upstreamMaxTokens)
        return `  <upstream id="${depId}" status="${result.success ? 'success' : 'failed'}">\n${output}\n  </upstream>`
      })
      .filter(Boolean)

    if (items.length > 0) {
      sections.push(`<upstream_results>\n${items.join('\n\n')}\n</upstream_results>`)
    }
  }

  return sections.join('\n\n')
}
