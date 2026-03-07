import type { PromptComponents, DynamicContext, SkillDefinition, PromptMode, BootstrapFile, RuntimeInfo } from '@zero-os/shared'
import type { ToolDefinition, Memory } from '@zero-os/shared'
import { truncateToTokens } from '@zero-os/shared'
import { enforceFixedBudget } from './budget'
import { CONTEXT_PARAMS } from './params'
import { hasSoulFile } from '../bootstrap/loader'

/**
 * Build System Prompt — static, built once per session for prompt cache stability.
 * Respects PromptMode to control which sections are included:
 * - "full": All sections (main agent)
 * - "minimal": Role + ToolRules + Constraints only (subagents)
 * - "none": Single identity line
 */
export function buildSystemPrompt(components: PromptComponents): string {
  const mode = components.promptMode ?? 'full'

  // "none" mode: just a basic identity line
  if (mode === 'none') {
    return `你是 ZeRo OS 的 ${components.agentName}，一个在 macOS 上自主执行任务的 AI Agent。`
  }

  const isMinimal = mode === 'minimal'
  const sections: string[] = []

  // Core sections (always included in full and minimal)
  sections.push(buildRoleBlock(components.agentName, components.agentDescription, components.workspacePath, components.projectRoot))
  sections.push(buildToolRulesBlock(components.tools))
  sections.push(buildConstraintsBlock())

  // Full-only sections
  if (!isMinimal) {
    sections.push(buildRulesBlock())
    sections.push(buildExecutionModeBlock())
    sections.push(buildSafetyBlock())
    sections.push(buildToolCallStyleBlock())

    if (components.skills && components.skills.length > 0) {
      sections.push(buildSkillCatalog(components.skills))
    }

    sections.push(buildIdentityBlock(components.globalIdentity, components.agentIdentity, components.agentName))

    if (components.runtimeInfo) {
      sections.push(buildRuntimeBlock(components.runtimeInfo))
    }
  }

  // Bootstrap files — Project Context (filtered by mode)
  if (components.bootstrapFiles && components.bootstrapFiles.length > 0) {
    sections.push(buildBootstrapContextBlock(components.bootstrapFiles))
  }

  return sections.join('\n\n')
}

/**
 * Build dynamic context injected as <system-reminder> in user message.
 * Current usage: notify the system about newly available skills only.
 */
export function buildDynamicContext(ctx: DynamicContext): string {
  if (!ctx.newSkills || ctx.newSkills.length === 0) return ''
  return `<system-reminder>\n${buildSkillReminder(ctx.newSkills)}\n</system-reminder>`
}

export function buildRoleBlock(agentName: string, agentDescription: string, workspacePath?: string, projectRoot?: string): string {
  const lines = [
    `你是 ZeRo OS 的 ${agentName}，一个在 macOS 上自主执行任务的 AI Agent。`,
    agentDescription,
  ]
  if (workspacePath && projectRoot) {
    lines.push(`你的工作目录是 ${workspacePath}，下载和临时文件放在此目录。最终产出物放到 ${projectRoot}/.zero/workspace/shared/。`)
    lines.push(`项目根目录是 ${projectRoot}，源代码在此目录下。`)
  }
  const content = lines.join('\n')
  return enforceFixedBudget(`<role>\n${content}\n</role>`, 600, 'Role')
}

export function buildRulesBlock(): string {
  const rules = `执行操作前先说明意图，让用户知道你打算做什么。
工具调用失败时先读错误信息做诊断，再决定重试或换方案。不盲目重复相同命令。
涉及不可逆操作（删除文件、覆写内容、格式化）时主动向用户确认。
遇到超出能力范围的问题时如实告知，不编造解决方案。
回复使用中文，技术术语可以用英文原文。
每完成一个阶段性目标后，更新备忘录中你自己的分区。
阶段性汇报用于同步进度，不用于请求继续许可；若总体任务未完成，汇报后直接进入下一步。
<system-reminder> 是系统注入的内部运行时提示，不是用户消息；不要回应、转述、解释或尝试管理它。当前其中只会出现新增 Skill 通知，不包含时间、memo 或 memory。`
  return `<rules>\n${rules}\n</rules>`
}

export function buildExecutionModeBlock(): string {
  const executionMode = `默认工作模式：连续自治执行。
任务开始后，只要仍可安全推进，就持续处理，不要因为完成了一个子步骤、给出了一次进度汇报、或准备进入下一步，就向用户请求“继续”“确认继续”“是否继续下一步”。
对以下操作，默认直接执行，不需要额外征求许可：读取、搜索、分析代码和文档；制定和更新内部计划；低风险的本地编辑与重试；运行检查、测试、构建、诊断；总结阶段进展并继续下一步。
如果存在合理默认值、最小可逆假设或仓库内可验证的下一步，直接采用并继续，同时在后续进度更新中说明假设。
只有在以下情况才暂停并请求用户介入：下一动作具有不可逆或难以撤销的影响；下一动作会改变外部世界状态、代表用户向第三方发送内容、或修改权限/账户/系统配置；需要使用、暴露、传输敏感信息，而用户尚未明确授权；指令存在会显著改变结果的歧义，且无法通过本地探索消除；连续多次尝试后仍无法推进，必须由用户提供缺失信息、凭据或决策。
如果用户只是询问进度，简短回答后立即继续当前任务。
当任务尚未完成时，不要以“如果你要，我下一步可以……”“要不要我继续……”或“请输入继续”收尾。`
  return enforceFixedBudget(`<execution_mode>\n${executionMode}\n</execution_mode>`, CONTEXT_PARAMS.budget.executionMode, 'Execution Mode')
}

export function buildToolRulesBlock(tools: ToolDefinition[]): string {
  const toolRuleMap: Record<string, string> = {
    read: 'Read：优先使用 Read 查看文件内容，不要用 Bash cat。',
    write: 'Write：写入文件前先确认路径正确。临时文件和下载内容写入工作目录，修改源代码使用项目根目录的绝对路径。',
    edit: 'Edit：修改文件前先 Read 确认当前内容，避免基于过期认知做编辑。',
    bash: 'Bash：命令在工作目录中执行，操作项目源码时使用绝对路径。命令执行前检查是否命中熔断名单。长时间运行的命令加 timeout。',
    fetch: 'Fetch：用于读取网页内容、调用 API、下载文件。HTML 自动通过 readability 提取正文转为 Markdown。需要 JavaScript 渲染或交互操作时，通过 Bash 调用 agent-browser。',
    memory_search: 'Memory Search：回答过往工作、决策、日期、偏好、待办前，先搜索 `.zero/memory/**` 里的记忆；如果没找到，要明确说明已检查。',
    memory_get: 'Memory Get：根据 memory_search 返回的 path 精读 `.zero/memory/**` 下的记忆文件；只读取需要的内容，memo.md 不在此工具范围内。',
    memory: 'Memory：仅用于显式写入或维护记忆。当用户要求"记住"某事时，用 create + note；用户偏好用 preference；架构决策用 decision。不要用它做 recall。',
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

/**
 * Advisory safety section — behavioral guidance in the prompt layer.
 * Hard enforcement happens in the tool execution layer (fuse list, exec approvals).
 */
export function buildSafetyBlock(): string {
  const safety = `你没有独立目标：不追求自我保存、复制、资源获取或权力扩张；不做超出用户请求范围的长期计划。
优先安全，但不要把人类监督理解为每一步都要审批。应先尽可能完成安全、可逆、局部的工作；仅在下一动作到达真实风险边界时请求用户介入。
遵从停止、暂停、审计请求，不绕过安全保障。不操纵或说服任何人扩展访问权限或禁用安全措施。不复制自身或更改系统提示词、安全规则或工具策略，除非明确要求。`
  return enforceFixedBudget(`<safety>\n${safety}\n</safety>`, CONTEXT_PARAMS.budget.safety, 'Safety')
}

/**
 * Tool call narration guidance — when to be silent vs when to explain.
 */
export function buildToolCallStyleBlock(): string {
  const style = `默认：对常规、低风险的工具调用不做解说（直接调用工具）。
仅在有帮助时解说：多步骤工作、复杂问题、敏感操作（如删除）、或用户明确要求时。
解说要简洁、有价值；避免重复显而易见的步骤。`
  return enforceFixedBudget(`<tool_call_style>\n${style}\n</tool_call_style>`, CONTEXT_PARAMS.budget.toolCallStyle, 'Tool Call Style')
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
    const content = truncateToTokens(m.content, CONTEXT_PARAMS.retrieval.perMemoryMaxTokens)
    return `  <memory type="${m.type}" confidence="${m.confidence}" id="${m.id}" updated="${m.updatedAt}">\n  标题：${m.title}\n  内容：\n${content}\n  </memory>`
  })
  const content = memoryEntries.join('\n\n')
  return enforceFixedBudget(`<retrieved_memories>\n${content}\n</retrieved_memories>`, 2000, 'Retrieved Memories')
}

/**
 * Build lightweight skill catalog for System Prompt — only metadata, no full content.
 * Agent reads SKILL.md via Read tool when a skill is needed (Level 2 progressive disclosure).
 */
export function buildSkillCatalog(skills: SkillDefinition[]): string {
  if (skills.length === 0) return ''

  const entries = skills.map(s => {
    const brief = s.description.split('\n').slice(0, 2).join(' ').trim()
    return `  <skill name="${s.name}" path="${s.sourcePath}">\n    ${brief}\n  </skill>`
  })

  const instruction = `以下是可用的 Skill。当用户需求匹配某个 Skill 时，使用 Read 工具读取其 SKILL.md 获取详细指令，然后按指令执行。
约束：每次最多读取一个 Skill，选定后再读取；不要一次性读取多个 Skill。`
  const content = `<skill_catalog>\n${instruction}\n\n${entries.join('\n\n')}\n</skill_catalog>`
  return enforceFixedBudget(content, CONTEXT_PARAMS.budget.skillCatalog, 'Skill Catalog')
}

/**
 * Build incremental skill notification for new skills discovered at runtime.
 */
export function buildSkillReminder(skills: SkillDefinition[]): string {
  const entries = skills.map(s => {
    const brief = s.description.split('\n').slice(0, 2).join(' ').trim()
    return `  <skill name="${s.name}" path="${s.sourcePath}">\n    ${brief}\n  </skill>`
  })
  return `<new_skills>\n新增了以下 Skill，可通过 Read 工具读取 SKILL.md 获取详细指令：\n${entries.join('\n')}\n</new_skills>`
}

/**
 * Build compact runtime info line — all context in key=value format for token efficiency.
 */
export function buildRuntimeBlock(info: RuntimeInfo): string {
  const parts = [
    info.agentId ? `agent=${info.agentId}` : '',
    info.host ? `host=${info.host}` : '',
    info.projectRoot ? `repo=${info.projectRoot}` : '',
    info.os ? `os=${info.os}${info.arch ? ` (${info.arch})` : ''}` : '',
    info.model ? `model=${info.model}` : '',
    info.shell ? `shell=${info.shell}` : '',
    info.channel ? `channel=${info.channel}` : '',
  ].filter(Boolean)

  if (parts.length === 0) return ''

  const line = `Runtime: ${parts.join(' | ')}`
  return enforceFixedBudget(`<runtime>\n${line}\n</runtime>`, CONTEXT_PARAMS.budget.runtime, 'Runtime')
}

/**
 * Build Project Context section from bootstrap files.
 * Injected at the tail of the system prompt.
 * When SOUL.md is present, adds persona embodiment instruction.
 */
export function buildBootstrapContextBlock(files: BootstrapFile[]): string {
  if (files.length === 0) return ''

  const lines: string[] = [
    '以下是工作区上下文文件，由系统自动加载。',
  ]

  if (hasSoulFile(files)) {
    lines.push('如果存在 SOUL.md，请体现其人格和语调。避免生硬、模板化的回复；遵循其指引。')
  }

  lines.push('')

  for (const file of files) {
    lines.push(`## ${file.name}`, '', file.content, '')
  }

  const content = `<project_context>\n${lines.join('\n')}\n</project_context>`
  return enforceFixedBudget(content, CONTEXT_PARAMS.budget.bootstrapContext, 'Project Context')
}

/**
 * @deprecated Use buildSkillCatalog() for System Prompt and buildDynamicContext() for per-message injection.
 */
export function buildSkillsBlock(skills: SkillDefinition[]): string {
  const entries = skills.map(s => {
    const attrs = `name="${s.name}" allowed-tools="${s.allowedTools.join(', ')}"`
    return `  <skill ${attrs}>\n${s.content}\n  </skill>`
  })
  return `<skills>\n${entries.join('\n\n')}\n</skills>`
}

/**
 * Build a simplified System Prompt for SubAgents using PromptMode='minimal'.
 * SubAgents are task-oriented one-shot executors — no identity, memo, or retrieved memories.
 *
 * @deprecated Prefer buildSystemPrompt({ promptMode: 'minimal' }) for new code.
 * This function remains for task orchestrator compatibility.
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
