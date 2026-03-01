import { describe, test, expect, afterAll } from 'bun:test'
import { readYaml, writeYaml, readYamlOrDefault } from '../yaml'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

const testDir = join(import.meta.dir, '__fixtures__')

describe('YAML utilities', () => {
  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test('writeYaml and readYaml round-trip', () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'test.yaml')
    const data = {
      providers: {
        openai: {
          apiType: 'openai_chat_completions',
          baseUrl: 'https://api.openai.com',
          models: {
            'gpt-4o': { modelId: 'gpt-4o', maxContext: 128000 },
          },
        },
      },
    }

    writeYaml(filePath, data)
    const result = readYaml(filePath)
    expect(result).toEqual(data)
  })

  test('readYamlOrDefault returns default when file missing', () => {
    const result = readYamlOrDefault('/nonexistent/path.yaml', { fallback: true })
    expect(result).toEqual({ fallback: true })
  })

  test('readYamlOrDefault reads file when it exists', () => {
    mkdirSync(testDir, { recursive: true })
    const filePath = join(testDir, 'exists.yaml')
    writeYaml(filePath, { exists: true })
    const result = readYamlOrDefault(filePath, { exists: false })
    expect(result).toEqual({ exists: true })
  })
})
