import { readYaml, readYamlOrDefault } from '@zero-os/shared'
import type { SystemConfig, FuseRule } from '@zero-os/shared'
import { existsSync } from 'node:fs'

/**
 * Load ZeRo OS system configuration from .zero/config.yaml.
 */
export function loadConfig(configPath: string): SystemConfig {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`)
  }

  const raw = readYaml<Record<string, unknown>>(configPath)
  return normalizeConfig(raw)
}

/**
 * Normalize raw YAML config into SystemConfig type.
 */
function normalizeConfig(raw: Record<string, unknown>): SystemConfig {
  const providers: SystemConfig['providers'] = {}

  const rawProviders = (raw.providers ?? {}) as Record<string, Record<string, unknown>>
  for (const [name, p] of Object.entries(rawProviders)) {
    const rawAuth = (p.auth ?? {}) as Record<string, unknown>
    const rawModels = (p.models ?? {}) as Record<string, Record<string, unknown>>
    const models: SystemConfig['providers'][string]['models'] = {}

    for (const [mName, m] of Object.entries(rawModels)) {
      models[mName] = {
        modelId: (m.model_id as string) ?? mName,
        maxContext: (m.max_context as number) ?? 128000,
        maxOutput: (m.max_output as number) ?? 8192,
        capabilities: (m.capabilities as string[]) ?? [],
        tags: (m.tags as string[]) ?? [],
        pricing: m.pricing as SystemConfig['providers'][string]['models'][string]['pricing'],
      }
    }

    providers[name] = {
      apiType: (p.api_type as string) as SystemConfig['providers'][string]['apiType'],
      baseUrl: (p.base_url as string) ?? '',
      auth: {
        type: (rawAuth.type as string) as 'api_key' | 'oauth2',
        apiKeyRef: rawAuth.api_key_ref as string | undefined,
        oauthTokenRef: rawAuth.oauth_token_ref as string | undefined,
      },
      models,
    }
  }

  return {
    providers,
    defaultModel: (raw.default_model as string) ?? '',
    fallbackChain: (raw.fallback_chain as string[]) ?? [],
    schedules: (raw.schedules as SystemConfig['schedules']) ?? [],
    fuseList: (raw.fuse_list as FuseRule[]) ?? [],
  }
}

/**
 * Load fuse list from .zero/fuse_list.yaml.
 */
export function loadFuseList(fusePath: string): FuseRule[] {
  const raw = readYamlOrDefault<{ rules?: FuseRule[] }>(fusePath, { rules: [] })
  return raw.rules ?? []
}
