import type { SystemConfig } from '@zero-os/shared'
import type { ProviderAdapter } from './adapters/base'
import { ModelRegistry, type ResolvedModel } from './registry'

export interface ModelSwitchResult {
  success: boolean
  model?: ResolvedModel
  message: string
}

/**
 * Model Router — decides which model handles each request.
 * Supports exact match, fuzzy match, and fallback chain.
 */
export class ModelRouter {
  private registry: ModelRegistry
  private currentModel: ResolvedModel | undefined
  private fallbackChain: string[]
  private defaultModel: string

  constructor(config: SystemConfig, secrets: Map<string, string>) {
    this.registry = new ModelRegistry(config, secrets)
    this.fallbackChain = config.fallbackChain
    this.defaultModel = config.defaultModel
  }

  /**
   * Initialize router with the default model.
   */
  init(): ModelSwitchResult {
    return this.switchModel(this.defaultModel)
  }

  /**
   * Get the current active model's adapter.
   */
  getAdapter(): ProviderAdapter {
    if (!this.currentModel) {
      throw new Error('No active model. Call init() or switchModel() first.')
    }
    return this.currentModel.adapter
  }

  /**
   * Get current model info.
   */
  getCurrentModel(): ResolvedModel | undefined {
    return this.currentModel
  }

  /**
   * Switch to a different model.
   * Tries exact match first, then fuzzy match.
   */
  switchModel(target: string): ModelSwitchResult {
    // 1. Exact match
    const exact = this.registry.resolve(target)
    if (exact) {
      this.currentModel = exact
      return {
        success: true,
        model: exact,
        message: `Switched to ${exact.modelName} (${exact.providerName})`,
      }
    }

    // 2. Fuzzy match
    const fuzzy = this.registry.fuzzySearch(target)
    if (fuzzy.length === 1) {
      this.currentModel = fuzzy[0]
      return {
        success: true,
        model: fuzzy[0],
        message: `Switched to ${fuzzy[0].modelName} (${fuzzy[0].providerName})`,
      }
    }

    if (fuzzy.length > 1) {
      const candidates = fuzzy.map((m) => `  - ${m.providerName}/${m.modelName}`).join('\n')
      return {
        success: false,
        message: `Multiple matches found:\n${candidates}\nPlease be more specific.`,
      }
    }

    // 3. No match
    const available = this.registry
      .listModels()
      .map((m) => `  - ${m.providerName}/${m.modelName}`)
      .join('\n')
    return {
      success: false,
      message: `Model "${target}" not found. Available models:\n${available}`,
    }
  }

  /**
   * Try fallback chain when current model is unavailable.
   */
  async fallback(): Promise<ModelSwitchResult> {
    for (const modelName of this.fallbackChain) {
      const resolved = this.registry.resolve(modelName)
      if (!resolved) continue

      const healthy = await resolved.adapter.healthCheck()
      if (healthy) {
        this.currentModel = resolved
        return {
          success: true,
          model: resolved,
          message: `Fell back to ${resolved.modelName} (${resolved.providerName})`,
        }
      }
    }

    return {
      success: false,
      message: 'All models in fallback chain are unavailable.',
    }
  }

  /**
   * Get the registry for direct model access.
   */
  getRegistry(): ModelRegistry {
    return this.registry
  }
}
