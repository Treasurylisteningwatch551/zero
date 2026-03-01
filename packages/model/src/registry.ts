import type { SystemConfig, ProviderConfig, ModelConfig, ApiType } from '@zero-os/shared'
import type { ProviderAdapter, AdapterConfig } from './adapters/base'
import { OpenAIChatAdapter } from './adapters/openai-chat'
import { AnthropicAdapter } from './adapters/anthropic'
import { OpenAIResponsesAdapter } from './adapters/openai-resp'

export interface ResolvedModel {
  providerName: string
  modelName: string
  modelConfig: ModelConfig
  providerConfig: ProviderConfig
  adapter: ProviderAdapter
}

/**
 * Model Registry - parses config and creates adapters on demand.
 */
export class ModelRegistry {
  private providers: Map<string, ProviderConfig> = new Map()
  private adapters: Map<string, ProviderAdapter> = new Map()
  private secrets: Map<string, string>

  constructor(config: SystemConfig, secrets: Map<string, string>) {
    this.secrets = secrets
    for (const [name, provider] of Object.entries(config.providers)) {
      this.providers.set(name, provider)
    }
  }

  /**
   * Resolve a model name to its full configuration and adapter.
   * Searches across all providers.
   */
  resolve(modelName: string): ResolvedModel | undefined {
    for (const [providerName, provider] of this.providers) {
      for (const [name, model] of Object.entries(provider.models)) {
        if (name === modelName || model.modelId === modelName) {
          const adapter = this.getOrCreateAdapter(providerName, provider, model)
          return {
            providerName,
            modelName: name,
            modelConfig: model,
            providerConfig: provider,
            adapter,
          }
        }
      }
    }
    return undefined
  }

  /**
   * Fuzzy search for models by keyword.
   * Matches against model name, model_id, and tags.
   */
  fuzzySearch(keyword: string): ResolvedModel[] {
    const results: ResolvedModel[] = []
    const lower = keyword.toLowerCase()

    for (const [providerName, provider] of this.providers) {
      for (const [name, model] of Object.entries(provider.models)) {
        const matches =
          name.toLowerCase().includes(lower) ||
          model.modelId.toLowerCase().includes(lower) ||
          model.tags.some((t) => t.toLowerCase().includes(lower))

        if (matches) {
          const adapter = this.getOrCreateAdapter(providerName, provider, model)
          results.push({
            providerName,
            modelName: name,
            modelConfig: model,
            providerConfig: provider,
            adapter,
          })
        }
      }
    }

    return results
  }

  /**
   * List all registered models.
   */
  listModels(): { providerName: string; modelName: string; modelId: string; tags: string[] }[] {
    const models: { providerName: string; modelName: string; modelId: string; tags: string[] }[] = []
    for (const [providerName, provider] of this.providers) {
      for (const [name, model] of Object.entries(provider.models)) {
        models.push({
          providerName,
          modelName: name,
          modelId: model.modelId,
          tags: model.tags,
        })
      }
    }
    return models
  }

  private getOrCreateAdapter(
    providerName: string,
    provider: ProviderConfig,
    model: ModelConfig
  ): ProviderAdapter {
    const key = `${providerName}:${model.modelId}`
    let adapter = this.adapters.get(key)
    if (adapter) return adapter

    const apiKey = provider.auth.apiKeyRef ? this.secrets.get(provider.auth.apiKeyRef) : undefined

    const config: AdapterConfig = {
      baseUrl: provider.baseUrl,
      auth: provider.auth,
      modelConfig: model,
      apiKey,
    }

    adapter = this.createAdapter(provider.apiType, config)
    this.adapters.set(key, adapter)
    return adapter
  }

  private createAdapter(apiType: ApiType, config: AdapterConfig): ProviderAdapter {
    switch (apiType) {
      case 'openai_chat_completions':
        return new OpenAIChatAdapter(config)
      case 'anthropic_messages':
        return new AnthropicAdapter(config)
      case 'openai_responses':
        return new OpenAIResponsesAdapter(config)
      default:
        throw new Error(`Unsupported API type: ${apiType}`)
    }
  }
}
