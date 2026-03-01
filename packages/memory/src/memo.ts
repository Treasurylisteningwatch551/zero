import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { withLock } from '@zero-os/shared'

/**
 * Memo manager — async collaboration protocol between AI and humans.
 */
export class MemoManager {
  private filePath: string

  constructor(filePath: string) {
    this.filePath = filePath
  }

  /**
   * Read the full memo content.
   */
  read(): string {
    if (!existsSync(this.filePath)) {
      return '# Memo\n\n## Goals\n\n## Needs User Action\n'
    }
    return readFileSync(this.filePath, 'utf-8')
  }

  /**
   * Write the full memo content (replaces entirely).
   */
  async write(content: string): Promise<void> {
    await withLock(this.filePath, async () => {
      writeFileSync(this.filePath, content, 'utf-8')
    })
  }

  /**
   * Update a specific agent's section in the memo.
   */
  async updateAgentSection(agentName: string, status: string, plan: string): Promise<void> {
    await withLock(this.filePath, async () => {
      let content = this.read()
      const sectionHeader = `### ${agentName}`
      const sectionRegex = new RegExp(
        `### ${escapeRegExp(agentName)}\\n[\\s\\S]*?(?=###|$)`,
        'g'
      )

      const newSection = `### ${agentName}\n**In Progress**: ${status}\n**Plan**: ${plan}\n\n`

      if (content.includes(sectionHeader)) {
        content = content.replace(sectionRegex, newSection)
      } else {
        content = content.trimEnd() + '\n\n' + newSection
      }

      writeFileSync(this.filePath, content, 'utf-8')
    })
  }

  /**
   * Add an item to the "Needs User Action" section.
   */
  async addUserAction(item: string): Promise<void> {
    await withLock(this.filePath, async () => {
      let content = this.read()
      const marker = '## Needs User Action'

      if (content.includes(marker)) {
        content = content.replace(marker, `${marker}\n- ${item}`)
      } else {
        content += `\n\n## Needs User Action\n- ${item}\n`
      }

      writeFileSync(this.filePath, content, 'utf-8')
    })
  }

  /**
   * Add a goal to the "Goals" section.
   */
  async addGoal(goal: string): Promise<void> {
    await withLock(this.filePath, async () => {
      let content = this.read()
      const marker = '## Goals'

      if (content.includes(marker)) {
        content = content.replace(marker, `${marker}\n- ${goal}`)
      } else {
        content += `\n\n## Goals\n- ${goal}\n`
      }

      writeFileSync(this.filePath, content, 'utf-8')
    })
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
