import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  ModelConfig,
  AuthConfig,
} from '@zero-os/shared'

export { type CompletionRequest, type CompletionResponse, type StreamEvent }

/**
 * Unified provider adapter interface.
 * All provider adapters must implement this interface.
 */
export interface ProviderAdapter {
  readonly apiType: string

  /**
   * Send a completion request and return the full response.
   */
  complete(req: CompletionRequest): Promise<CompletionResponse>

  /**
   * Send a streaming completion request.
   */
  stream(req: CompletionRequest): AsyncIterable<StreamEvent>

  /**
   * Check if the API endpoint is reachable.
   */
  healthCheck(): Promise<boolean>
}

/**
 * Configuration needed to create an adapter.
 */
export interface AdapterConfig {
  baseUrl: string
  auth: AuthConfig
  modelConfig: ModelConfig
  apiKey?: string
  oauthToken?: string
}
