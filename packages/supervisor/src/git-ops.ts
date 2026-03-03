import simpleGit, { type SimpleGit } from 'simple-git'

const TAG_PREFIX = 'zero-stable-'

/**
 * Git operations utility for auto-commit, tagging, and rollback.
 */
export class GitOps {
  private git: SimpleGit

  constructor(workDir: string) {
    this.git = simpleGit(workDir)
  }

  /**
   * Stage all changes, commit with message, and create a stable tag.
   * Returns the tag name (e.g. "zero-stable-20260303T120000").
   */
  async commitAndTag(message: string): Promise<string> {
    await this.git.add('-A')
    await this.git.commit(message)

    const tag = `${TAG_PREFIX}${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`
    await this.git.addTag(tag)
    return tag
  }

  /**
   * Get the most recent zero-stable-* tag, or null if none exist.
   */
  async getLastStableTag(): Promise<string | null> {
    const tags = await this.git.tags()
    const stableTags = tags.all
      .filter((t) => t.startsWith(TAG_PREFIX))
      .sort()
      .reverse()
    return stableTags[0] ?? null
  }

  /**
   * Hard-reset the working tree to a given tag.
   */
  async rollbackToTag(tag: string): Promise<void> {
    await this.git.reset(['--hard', tag])
  }
}
