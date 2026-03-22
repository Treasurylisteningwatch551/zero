import { createHash, randomBytes } from 'node:crypto'
import { type Server, createServer } from 'node:http'
import { URL } from 'node:url'
import {
  type ChatGptOAuthSession,
  decodeChatGptAccountId,
  serializeChatGptOAuthSession,
} from '@zero-os/model'
import { toErrorMessage } from '@zero-os/shared'
import type { Vault } from '@zero-os/secrets'
import { getChatgptOAuthTokenRef } from './chatgpt-provider'

const CHATGPT_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const CHATGPT_AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize'
const CHATGPT_TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CHATGPT_REDIRECT_URI = 'http://localhost:1455/auth/callback'
const CHATGPT_SCOPE = 'openid profile email offline_access'
const CALLBACK_PATH = '/auth/callback'
const ORIGINATOR = 'zero-os'

export type ChatGptOAuthState =
  | 'idle'
  | 'waiting_for_callback'
  | 'authorizing'
  | 'connected'
  | 'expired'
  | 'error'

export interface ChatGptOAuthStatus {
  provider: 'chatgpt'
  state: ChatGptOAuthState
  authorized: boolean
  error?: string
  attemptId?: string
  expiresAt?: number
  accountId?: string
  requiresRestart: boolean
}

interface PendingAttempt {
  id: string
  state: string
  codeVerifier: string
  server: Server
  status: ChatGptOAuthStatus
}

export class ChatGptOAuthBroker {
  private vault: Vault
  private attempt: PendingAttempt | null = null

  constructor(vault: Vault) {
    this.vault = vault
  }

  getStatus(): ChatGptOAuthStatus {
    const session = this.readStoredSession()
    if (this.attempt) {
      if (this.attempt.status.state === 'connected' && session) {
        return {
          provider: 'chatgpt',
          state: this.isExpired(session) ? 'expired' : 'connected',
          authorized: !this.isExpired(session),
          expiresAt: session.expiresAt,
          accountId: session.accountId,
          attemptId: this.attempt.id,
          requiresRestart: true,
        }
      }
      return this.attempt.status
    }

    if (!session) {
      return {
        provider: 'chatgpt',
        state: 'idle',
        authorized: false,
        requiresRestart: false,
      }
    }

    return {
      provider: 'chatgpt',
      state: this.isExpired(session) ? 'expired' : 'connected',
      authorized: !this.isExpired(session),
      expiresAt: session.expiresAt,
      accountId: session.accountId,
      requiresRestart: false,
    }
  }

  async start(): Promise<{ attemptId: string; url: string }> {
    await this.resetAttempt()

    const codeVerifier = randomBytes(32).toString('base64url')
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url')
    const state = randomBytes(16).toString('hex')
    const attemptId = randomBytes(12).toString('hex')

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CHATGPT_CLIENT_ID,
      redirect_uri: CHATGPT_REDIRECT_URI,
      scope: CHATGPT_SCOPE,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      id_token_add_organizations: 'true',
      codex_cli_simplified_flow: 'true',
      originator: ORIGINATOR,
    })

    const server = await this.startServer(attemptId, state, codeVerifier)

    this.attempt = {
      id: attemptId,
      state,
      codeVerifier,
      server,
      status: {
        provider: 'chatgpt',
        state: 'waiting_for_callback',
        authorized: false,
        attemptId,
        requiresRestart: false,
      },
    }

    return {
      attemptId,
      url: `${CHATGPT_AUTHORIZE_URL}?${params.toString()}`,
    }
  }

  async completeFromInput(rawInput: string): Promise<ChatGptOAuthStatus> {
    if (!this.attempt) {
      throw new Error('No active ChatGPT OAuth attempt.')
    }

    const parsed = this.parseAuthorizationInput(rawInput)
    if (!parsed.code) {
      throw new Error('Authorization code not found in input.')
    }
    if (parsed.state && parsed.state !== this.attempt.state) {
      throw new Error('State validation failed.')
    }

    await this.exchangeAndStore(parsed.code, this.attempt)
    return this.getStatus()
  }

  async waitForCompletion(timeoutMs = 120_000): Promise<ChatGptOAuthStatus> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < timeoutMs) {
      const status = this.getStatus()
      if (status.state === 'connected' || status.state === 'expired' || status.state === 'error') {
        return status
      }
      await Bun.sleep(500)
    }

    throw new Error('Timed out waiting for ChatGPT OAuth callback.')
  }

  private async startServer(
    attemptId: string,
    state: string,
    codeVerifier: string,
  ): Promise<Server> {
    return await new Promise<Server>((resolve, reject) => {
      const server = createServer((req, res) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost:1455')
        if (requestUrl.pathname !== CALLBACK_PATH) {
          res.statusCode = 404
          res.end('Not found')
          return
        }

        const code = requestUrl.searchParams.get('code')
        const callbackState = requestUrl.searchParams.get('state')
        if (callbackState !== state) {
          this.updateAttempt({
            provider: 'chatgpt',
            state: 'error',
            authorized: false,
            error: 'State validation failed.',
            attemptId,
            requiresRestart: false,
          })
          res.statusCode = 400
          res.end('State mismatch')
          return
        }

        if (!code) {
          this.updateAttempt({
            provider: 'chatgpt',
            state: 'error',
            authorized: false,
            error: 'Missing authorization code.',
            attemptId,
            requiresRestart: false,
          })
          res.statusCode = 400
          res.end('Missing code')
          return
        }

        this.updateAttempt({
          provider: 'chatgpt',
          state: 'authorizing',
          authorized: false,
          attemptId,
          requiresRestart: false,
        })

        res.statusCode = 200
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(
          '<html><body><h2>ZeRo OS</h2><p>ChatGPT authorization received. You can return to ZeRo OS.</p></body></html>',
        )

        void this.exchangeAndStore(code, {
          id: attemptId,
          state,
          codeVerifier,
          server,
          status: this.getStatus(),
        })
      })

      server.once('error', (err) => reject(err))
      server.listen(1455, 'localhost', () => resolve(server))
    })
  }

  private async exchangeAndStore(code: string, attempt: PendingAttempt): Promise<void> {
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CHATGPT_CLIENT_ID,
        code,
        code_verifier: attempt.codeVerifier,
        redirect_uri: CHATGPT_REDIRECT_URI,
      })

      const response = await fetch(CHATGPT_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      })

      if (!response.ok) {
        throw new Error(`Token exchange failed: ${response.status} ${await response.text()}`)
      }

      const data = (await response.json()) as {
        access_token?: string
        refresh_token?: string
        expires_in?: number
        token_type?: string
      }

      if (!data.access_token || !data.refresh_token || !data.expires_in || !data.token_type) {
        throw new Error('Token response missing fields.')
      }

      const accountId = decodeChatGptAccountId(data.access_token)
      if (!accountId) {
        throw new Error('Failed to extract chatgpt_account_id from token.')
      }

      const session: ChatGptOAuthSession = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + data.expires_in * 1000,
        tokenType: data.token_type,
        accountId,
      }

      this.vault.set(getChatgptOAuthTokenRef(), serializeChatGptOAuthSession(session))
      this.updateAttempt({
        provider: 'chatgpt',
        state: 'connected',
        authorized: true,
        expiresAt: session.expiresAt,
        accountId: session.accountId,
        attemptId: attempt.id,
        requiresRestart: true,
      })
    } catch (error) {
      this.updateAttempt({
        provider: 'chatgpt',
        state: 'error',
        authorized: false,
        error: toErrorMessage(error),
        attemptId: attempt.id,
        requiresRestart: false,
      })
    } finally {
      await this.resetAttemptServer()
    }
  }

  private parseAuthorizationInput(rawInput: string): { code: string | null; state: string | null } {
    const trimmed = rawInput.trim()
    if (!trimmed) return { code: null, state: null }

    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      return {
        code: url.searchParams.get('code'),
        state: url.searchParams.get('state'),
      }
    }

    return {
      code: trimmed,
      state: null,
    }
  }

  private readStoredSession(): ChatGptOAuthSession | null {
    const raw = this.vault.get(getChatgptOAuthTokenRef())
    if (!raw) return null

    try {
      return JSON.parse(raw) as ChatGptOAuthSession
    } catch {
      return null
    }
  }

  private isExpired(session: ChatGptOAuthSession) {
    return Date.now() >= session.expiresAt - 60_000
  }

  private updateAttempt(status: ChatGptOAuthStatus) {
    if (!this.attempt) return
    this.attempt.status = status
  }

  private async resetAttemptServer() {
    if (!this.attempt) return
    await new Promise<void>((resolve) => {
      this.attempt?.server.close(() => resolve())
    })
  }

  private async resetAttempt() {
    if (!this.attempt) return
    await this.resetAttemptServer()
    this.attempt = null
  }
}
