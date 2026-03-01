/**
 * Simple API key authentication strategy.
 * Retrieves the API key from the secrets vault.
 */
export interface ApiKeyAuth {
  type: 'api_key'
  getKey(): string | undefined
}

export function createApiKeyAuth(secretsGet: (ref: string) => string | undefined, keyRef: string): ApiKeyAuth {
  return {
    type: 'api_key',
    getKey() {
      return secretsGet(keyRef)
    },
  }
}
