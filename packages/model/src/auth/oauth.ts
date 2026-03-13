import { createHash, randomBytes } from 'node:crypto'

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  tokenType: string
  scope?: string
}

export interface OAuthConfig {
  authorizationUrl: string
  tokenUrl: string
  clientId: string
  clientSecret?: string
  scopes: string[]
  redirectUri: string
}

/**
 * OAuth 2.0 + PKCE authentication for OpenAI/ChatGPT-style APIs.
 */
export class OAuth2Client {
  private config: OAuthConfig
  private tokens: OAuthTokens | null = null
  private codeVerifier: string | null = null

  constructor(config: OAuthConfig) {
    this.config = config
  }

  /**
   * Generate the authorization URL for user redirect.
   * Uses PKCE (Proof Key for Code Exchange) for enhanced security.
   */
  getAuthorizationUrl(state?: string): { url: string; codeVerifier: string } {
    this.codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(this.codeVerifier).digest('base64url')

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    if (state) params.set('state', state)

    return {
      url: `${this.config.authorizationUrl}?${params.toString()}`,
      codeVerifier: this.codeVerifier,
    }
  }

  /**
   * Exchange authorization code for access tokens.
   */
  async exchangeCode(code: string, codeVerifier?: string): Promise<OAuthTokens> {
    const verifier = codeVerifier ?? this.codeVerifier
    if (!verifier) {
      throw new Error('No code verifier available. Call getAuthorizationUrl() first.')
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.redirectUri,
      client_id: this.config.clientId,
      code_verifier: verifier,
    })

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret)
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Token exchange failed: ${response.status} ${error}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      token_type: string
      scope?: string
    }

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: data.token_type,
      scope: data.scope,
    }

    return this.tokens
  }

  /**
   * Refresh the access token using the refresh token.
   */
  async refreshAccessToken(): Promise<OAuthTokens> {
    if (!this.tokens?.refreshToken) {
      throw new Error('No refresh token available')
    }

    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.tokens.refreshToken,
      client_id: this.config.clientId,
    })

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret)
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
      token_type: string
    }

    this.tokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? this.tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: data.token_type,
    }

    return this.tokens
  }

  /**
   * Get a valid access token, refreshing if necessary.
   */
  async getAccessToken(): Promise<string> {
    let tokens = this.tokens
    if (!tokens) {
      throw new Error('Not authenticated. Complete the OAuth flow first.')
    }

    // Refresh if expired or expiring within 60 seconds
    if (Date.now() >= tokens.expiresAt - 60_000) {
      tokens = await this.refreshAccessToken()
    }

    return tokens.accessToken
  }

  /**
   * Check if the client has valid tokens.
   */
  isAuthenticated(): boolean {
    return this.tokens !== null && Date.now() < this.tokens.expiresAt
  }

  /**
   * Set tokens directly (e.g., from persisted storage).
   */
  setTokens(tokens: OAuthTokens): void {
    this.tokens = tokens
  }

  /**
   * Get current tokens for persistence.
   */
  getTokens(): OAuthTokens | null {
    return this.tokens
  }
}
