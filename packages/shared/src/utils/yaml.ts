import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import YAML from 'yaml'

/**
 * Read and parse a YAML file.
 */
export function readYaml<T = unknown>(filePath: string): T {
  const content = readFileSync(filePath, 'utf-8')
  return YAML.parse(content) as T
}

/**
 * Write data to a YAML file.
 */
export function writeYaml(filePath: string, data: unknown): void {
  const content = YAML.stringify(data, { lineWidth: 120 })
  writeFileSync(filePath, content, 'utf-8')
}

/**
 * Read YAML file if it exists, otherwise return default value.
 */
export function readYamlOrDefault<T>(filePath: string, defaultValue: T): T {
  if (!existsSync(filePath)) return defaultValue
  return readYaml<T>(filePath)
}
