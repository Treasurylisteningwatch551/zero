import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { OAuth2Client } from '../auth/oauth'
import type { OAuthConfig, OAuthTokens } from '../auth/oauth'

const testConfig: OAuthConfig = {
  authorizationUrl: 'https://auth.example.com/authorize',
  tokenUrl: 'https://auth.example.com/token',
  clientId: 'test-client-id',
  clientSecret: 'test-secret',
  scopes: ['read', 'write'],
  redirectUri: 'http://localhost:3000/callback',
}

describe('OAuth2Client', () => {
  test('getAuthorizationUrl generates URL with all required params', () => {
    const client = new OAuth2Client(testConfig)
    const { url } = client.getAuthorizationUrl()
    const parsed = new URL(url)
    expect(parsed.origin + parsed.pathname).toBe(testConfig.authorizationUrl)
    expect(parsed.searchParams.get('response_type')).toBe('code')
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id')
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://localhost:3000/callback')
    expect(parsed.searchParams.get('scope')).toBe('read write')
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256')
    expect(parsed.searchParams.get('code_challenge')).toBeTruthy()
  })

  test('PKCE code_challenge is SHA256 of codeVerifier', () => {
    const client = new OAuth2Client(testConfig)
    const { url, codeVerifier } = client.getAuthorizationUrl()
    const expectedChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('code_challenge')).toBe(expectedChallenge)
  })

  test('includes state parameter when provided', () => {
    const client = new OAuth2Client(testConfig)
    const { url } = client.getAuthorizationUrl('my-state-123')
    const parsed = new URL(url)
    expect(parsed.searchParams.get('state')).toBe('my-state-123')
  })

  test('omits state parameter when not provided', () => {
    const client = new OAuth2Client(testConfig)
    const { url } = client.getAuthorizationUrl()
    const parsed = new URL(url)
    expect(parsed.searchParams.has('state')).toBe(false)
  })

  test('codeVerifier is stored and returned', () => {
    const client = new OAuth2Client(testConfig)
    const { codeVerifier } = client.getAuthorizationUrl()
    expect(typeof codeVerifier).toBe('string')
    expect(codeVerifier.length).toBeGreaterThan(0)
  })

  test('isAuthenticated returns false when no tokens set', () => {
    const client = new OAuth2Client(testConfig)
    expect(client.isAuthenticated()).toBe(false)
  })

  test('isAuthenticated returns true with valid future token', () => {
    const client = new OAuth2Client(testConfig)
    const tokens: OAuthTokens = {
      accessToken: 'access-123',
      tokenType: 'Bearer',
      expiresAt: Date.now() + 3600_000,
    }
    client.setTokens(tokens)
    expect(client.isAuthenticated()).toBe(true)
  })

  test('isAuthenticated returns false with expired token', () => {
    const client = new OAuth2Client(testConfig)
    const tokens: OAuthTokens = {
      accessToken: 'access-expired',
      tokenType: 'Bearer',
      expiresAt: Date.now() - 1000,
    }
    client.setTokens(tokens)
    expect(client.isAuthenticated()).toBe(false)
  })

  test('setTokens/getTokens roundtrip preserves all fields', () => {
    const client = new OAuth2Client(testConfig)
    expect(client.getTokens()).toBeNull()
    const tokens: OAuthTokens = {
      accessToken: 'at-abc',
      refreshToken: 'rt-xyz',
      expiresAt: 1700000000000,
      tokenType: 'Bearer',
      scope: 'read write',
    }
    client.setTokens(tokens)
    expect(client.getTokens()).toEqual(tokens)
  })
})
