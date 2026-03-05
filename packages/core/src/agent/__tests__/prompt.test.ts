import { describe, test, expect } from 'bun:test'
import {
  buildSystemPrompt,
  buildRoleBlock,
  buildRulesBlock,
  buildToolRulesBlock,
  buildConstraintsBlock,
  buildIdentityBlock,
  buildMemoBlock,
  buildRetrievedMemoryBlock,
  buildSkillCatalog,
  buildDynamicContext,
  buildSkillReminder,
} from '../prompt'

const makeMemory = (overrides: Partial<import('@zero-os/shared').Memory> = {}): import('@zero-os/shared').Memory => ({
  id: 'mem_001',
  type: 'runbook' as const,
  title: 'Test Memory',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
  status: 'verified' as const,
  confidence: 0.92,
  tags: ['test'],
  related: [],
  content: 'Memory content here',
  ...overrides,
})

const makeTool = (name: string): import('@zero-os/shared').ToolDefinition => ({
  name,
  description: `${name} tool`,
  parameters: {},
})

const makeSkill = (name: string, description = 'A test skill.'): import('@zero-os/shared').SkillDefinition => ({
  name,
  description,
  allowedTools: ['bash'],
  content: `# ${name} Skill\n\nFull content here.`,
  sourcePath: `/path/to/skills/${name}/SKILL.md`,
})

describe('buildRoleBlock', () => {
  test('contains agent name and description in XML tags', () => {
    const result = buildRoleBlock('Coder', '负责编写和修改代码')

    expect(result).toContain('<role>')
    expect(result).toContain('</role>')
    expect(result).toContain('Coder')
    expect(result).toContain('负责编写和修改代码')
    expect(result).toContain('ZeRo OS')
  })

  test('includes workspace and project paths when provided', () => {
    const result = buildRoleBlock('Coder', '负责编写代码', '/workspace/coder', '/project')

    expect(result).toContain('/workspace/coder')
    expect(result).toContain('/project')
  })
})

describe('buildRulesBlock', () => {
  test('returns 6 rules in <rules> tags', () => {
    const result = buildRulesBlock()

    expect(result).toStartWith('<rules>')
    expect(result).toEndWith('</rules>')

    // Verify all 6 rules are present
    expect(result).toContain('执行操作前先说明意图')
    expect(result).toContain('工具调用失败时先读错误信息做诊断')
    expect(result).toContain('涉及不可逆操作')
    expect(result).toContain('遇到超出能力范围的问题时如实告知')
    expect(result).toContain('回复使用中文')
    expect(result).toContain('每完成一个阶段性目标后')

    // Count lines inside the tags (6 rules = 6 lines)
    const inner = result.replace('<rules>\n', '').replace('\n</rules>', '')
    const lines = inner.split('\n').filter(l => l.trim().length > 0)
    expect(lines.length).toBe(6)
  })
})

describe('buildToolRulesBlock', () => {
  test('generates rules only for available tools', () => {
    const tools = [makeTool('Read'), makeTool('Bash')]
    const result = buildToolRulesBlock(tools)

    expect(result).toContain('<tool_rules>')
    expect(result).toContain('</tool_rules>')
    expect(result).toContain('Read：优先使用 Read 查看文件内容')
    expect(result).toContain('Bash：命令在工作目录中执行')
    // Should not contain rules for tools not in the list
    expect(result).not.toContain('Write：')
    expect(result).not.toContain('Edit：')
    expect(result).not.toContain('Fetch：')
    expect(result).not.toContain('Task：')
  })

  test('returns empty tag when no matching tools', () => {
    const tools = [makeTool('UnknownTool')]
    const result = buildToolRulesBlock(tools)

    expect(result).toBe('<tool_rules>\n</tool_rules>')
  })
})

describe('buildConstraintsBlock', () => {
  test('wraps constraints in <constraints> tags', () => {
    const result = buildConstraintsBlock()

    expect(result).toContain('<constraints>')
    expect(result).toContain('</constraints>')
    expect(result).toContain('不得包含密钥值')
    expect(result).toContain('代码修改后必须通过至少一种验证')
    expect(result).toContain('单次回复不超过 2000 字')
  })
})

describe('buildIdentityBlock', () => {
  test('renders both global and agent sections', () => {
    const result = buildIdentityBlock('全局身份信息', '代理身份信息', 'Coder')

    expect(result).toContain('<identity>')
    expect(result).toContain('</identity>')
    expect(result).toContain('<global>')
    expect(result).toContain('全局身份信息')
    expect(result).toContain('</global>')
    expect(result).toContain('<agent name="Coder">')
    expect(result).toContain('代理身份信息')
    expect(result).toContain('</agent>')
  })

  test('handles empty global identity', () => {
    const result = buildIdentityBlock('', '代理身份信息', 'Coder')

    expect(result).toContain('<identity>')
    expect(result).toContain('</identity>')
    expect(result).not.toContain('<global>')
    expect(result).toContain('<agent name="Coder">')
    expect(result).toContain('代理身份信息')
  })

  test('handles empty agent identity', () => {
    const result = buildIdentityBlock('全局身份信息', '', 'Coder')

    expect(result).toContain('<identity>')
    expect(result).toContain('</identity>')
    expect(result).toContain('<global>')
    expect(result).toContain('全局身份信息')
    expect(result).not.toContain('<agent')
  })
})

describe('buildMemoBlock', () => {
  test('wraps memo in <memo> tags', () => {
    const result = buildMemoBlock('今天完成了核心模块的重构')

    expect(result).toContain('<memo>')
    expect(result).toContain('</memo>')
    expect(result).toContain('今天完成了核心模块的重构')
  })

  test('handles empty memo', () => {
    const result = buildMemoBlock('')

    expect(result).toBe('<memo>\n</memo>')
  })
})

describe('buildRetrievedMemoryBlock', () => {
  test('renders memories with metadata attributes', () => {
    const memories = [
      makeMemory(),
      makeMemory({
        id: 'mem_002',
        type: 'decision',
        title: 'Architecture Decision',
        confidence: 0.85,
        updatedAt: '2026-02-01T00:00:00Z',
        content: 'Decided to use Bun runtime',
      }),
    ]

    const result = buildRetrievedMemoryBlock(memories)

    expect(result).toContain('<retrieved_memories>')
    expect(result).toContain('</retrieved_memories>')

    // First memory
    expect(result).toContain('type="runbook"')
    expect(result).toContain('confidence="0.92"')
    expect(result).toContain('id="mem_001"')
    expect(result).toContain('updated="2026-01-15T00:00:00Z"')
    expect(result).toContain('标题：Test Memory')
    expect(result).toContain('Memory content here')

    // Second memory
    expect(result).toContain('type="decision"')
    expect(result).toContain('confidence="0.85"')
    expect(result).toContain('id="mem_002"')
    expect(result).toContain('标题：Architecture Decision')
    expect(result).toContain('Decided to use Bun runtime')
  })
})

describe('buildSkillCatalog', () => {
  test('renders skill metadata in <skill_catalog> tags', () => {
    const skills = [makeSkill('browser', '通过 agent-browser CLI 控制浏览器。\n触发词：浏览器、打开网页。')]
    const result = buildSkillCatalog(skills)

    expect(result).toContain('<skill_catalog>')
    expect(result).toContain('</skill_catalog>')
    expect(result).toContain('name="browser"')
    expect(result).toContain('path="/path/to/skills/browser/SKILL.md"')
    expect(result).toContain('agent-browser CLI')
    expect(result).toContain('使用 Read 工具读取其 SKILL.md')
  })

  test('does not include full skill content', () => {
    const skills = [makeSkill('browser')]
    const result = buildSkillCatalog(skills)

    expect(result).not.toContain('Full content here')
  })

  test('returns empty string for no skills', () => {
    expect(buildSkillCatalog([])).toBe('')
  })

  test('renders multiple skills', () => {
    const skills = [makeSkill('browser'), makeSkill('awiki')]
    const result = buildSkillCatalog(skills)

    expect(result).toContain('name="browser"')
    expect(result).toContain('name="awiki"')
  })
})

describe('buildDynamicContext', () => {
  test('includes currentTime', () => {
    const result = buildDynamicContext({
      currentTime: '2026-03-05T12:00:00Z',
      memo: '',
      retrievedMemories: [],
    })

    expect(result).toContain('<system-reminder>')
    expect(result).toContain('</system-reminder>')
    expect(result).toContain('当前时间：2026-03-05T12:00:00Z')
  })

  test('includes memo when non-empty', () => {
    const result = buildDynamicContext({
      currentTime: '2026-03-05T12:00:00Z',
      memo: '备忘内容',
      retrievedMemories: [],
    })

    expect(result).toContain('<memo>')
    expect(result).toContain('备忘内容')
    expect(result).toContain('</memo>')
  })

  test('omits memo when empty', () => {
    const result = buildDynamicContext({
      currentTime: '2026-03-05T12:00:00Z',
      memo: '',
      retrievedMemories: [],
    })

    expect(result).not.toContain('<memo>')
  })

  test('includes retrieved memories when present', () => {
    const result = buildDynamicContext({
      currentTime: '2026-03-05T12:00:00Z',
      memo: '',
      retrievedMemories: [makeMemory()],
    })

    expect(result).toContain('<retrieved_memories>')
    expect(result).toContain('Test Memory')
  })

  test('includes new skills when present', () => {
    const result = buildDynamicContext({
      currentTime: '2026-03-05T12:00:00Z',
      memo: '',
      retrievedMemories: [],
      newSkills: [makeSkill('awiki')],
    })

    expect(result).toContain('<new_skills>')
    expect(result).toContain('name="awiki"')
    expect(result).toContain('SKILL.md')
  })

  test('omits new_skills when undefined', () => {
    const result = buildDynamicContext({
      currentTime: '2026-03-05T12:00:00Z',
      memo: '',
      retrievedMemories: [],
    })

    expect(result).not.toContain('<new_skills>')
  })
})

describe('buildSkillReminder', () => {
  test('renders new skill notification', () => {
    const skills = [makeSkill('awiki', '搜索和查询 wiki 内容。')]
    const result = buildSkillReminder(skills)

    expect(result).toContain('<new_skills>')
    expect(result).toContain('</new_skills>')
    expect(result).toContain('name="awiki"')
    expect(result).toContain('path="/path/to/skills/awiki/SKILL.md"')
    expect(result).toContain('Read 工具读取 SKILL.md')
  })
})

describe('buildSystemPrompt', () => {
  test('assembles static sections without dynamic content', () => {
    const result = buildSystemPrompt({
      agentName: 'Coder',
      agentDescription: '负责编写代码',
      tools: [makeTool('Read'), makeTool('Write')],
      globalIdentity: '全局身份',
      agentIdentity: '代理身份',
    })

    expect(result).toContain('<role>')
    expect(result).toContain('<rules>')
    expect(result).toContain('<tool_rules>')
    expect(result).toContain('<constraints>')
    expect(result).toContain('<identity>')
    // Should NOT contain dynamic content
    expect(result).not.toContain('<memo>')
    expect(result).not.toContain('<retrieved_memories>')
    expect(result).not.toContain('<system-reminder>')
  })

  test('includes skill_catalog when skills provided', () => {
    const result = buildSystemPrompt({
      agentName: 'Coder',
      agentDescription: '负责编写代码',
      tools: [makeTool('Read')],
      skills: [makeSkill('browser')],
      globalIdentity: '全局身份',
      agentIdentity: '代理身份',
    })

    expect(result).toContain('<skill_catalog>')
    expect(result).toContain('name="browser"')
    expect(result).not.toContain('Full content here')
  })

  test('omits skill_catalog when no skills', () => {
    const result = buildSystemPrompt({
      agentName: 'Coder',
      agentDescription: '负责编写代码',
      tools: [makeTool('Read')],
      globalIdentity: '',
      agentIdentity: '',
    })

    expect(result).not.toContain('<skill_catalog>')
  })
})
