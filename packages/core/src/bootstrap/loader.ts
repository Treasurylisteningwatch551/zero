import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BootstrapFile, PromptMode } from '@zero-os/shared'
import {
  BOOTSTRAP_FILE_NAMES,
  type BootstrapFileName,
  DEFAULT_TEMPLATES,
  MINIMAL_BOOTSTRAP_ALLOWLIST,
} from './templates'

/** Per-file character limit to prevent token explosion */
const MAX_CHARS_PER_FILE = 20_000
/** Total character limit across all bootstrap files */
const MAX_TOTAL_CHARS = 150_000

/**
 * Load bootstrap files from the agent workspace directory.
 * Falls back to default templates when files don't exist on disk.
 *
 * @param workspacePath - The agent workspace directory (e.g. .zero/workspace/zero/)
 * @param promptMode - Controls which files are loaded (full=all, minimal=TOOLS only)
 * @returns Array of BootstrapFile with truncated content
 */
export function loadBootstrapFiles(
  workspacePath: string,
  promptMode: PromptMode = 'full',
): BootstrapFile[] {
  if (promptMode === 'none') return []

  const files: BootstrapFile[] = []
  let totalChars = 0

  for (const name of BOOTSTRAP_FILE_NAMES) {
    // Filter files for minimal mode
    if (promptMode === 'minimal' && !MINIMAL_BOOTSTRAP_ALLOWLIST.has(name)) {
      continue
    }

    const filePath = join(workspacePath, name)
    let content = loadFileContent(filePath, name)

    // Enforce per-file size limit
    if (content.length > MAX_CHARS_PER_FILE) {
      content = `${content.slice(0, MAX_CHARS_PER_FILE)}\n\n[${name} truncated: ${content.length} chars exceeded ${MAX_CHARS_PER_FILE} limit]`
    }

    // Enforce total size limit
    if (totalChars + content.length > MAX_TOTAL_CHARS) {
      const remaining = MAX_TOTAL_CHARS - totalChars
      if (remaining <= 0) break
      content = `${content.slice(0, remaining)}\n\n[${name} truncated: total bootstrap size limit reached]`
    }

    totalChars += content.length
    files.push({ name, path: filePath, content })
  }

  return files
}

/**
 * Read file content from disk or return default template.
 */
function loadFileContent(filePath: string, name: BootstrapFileName): string {
  if (existsSync(filePath)) {
    return readFileSync(filePath, 'utf-8')
  }
  return DEFAULT_TEMPLATES[name] ?? ''
}

/**
 * Check if a SOUL.md file exists in the bootstrap files.
 * When present, the prompt should instruct the agent to embody its persona.
 */
export function hasSoulFile(files: BootstrapFile[]): boolean {
  return files.some((f) => f.name === 'SOUL.md' && f.content.trim().length > 0)
}
