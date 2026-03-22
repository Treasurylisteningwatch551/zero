import { describe, expect, test } from 'bun:test'
import type { ChannelCapabilities, SessionSource } from '@zero-os/shared'
import type { SessionManager } from '../../session/manager'
import { modelCommand } from '../builtins/model'
import { newSessionCommand } from '../builtins/new-session'
import type { CommandContext } from '../types'

interface MockSession {
  data: {
    currentModel: string
  }
  switchModel(target: string): Promise<{ success: boolean; message: string }>
  initAgent(config: { name: string; agentInstruction: string }): void
  setChannelCapabilities(capabilities: ChannelCapabilities): void
  listModels(): string[]
}

function createContext(
  sessionManager: SessionManager,
  source: SessionSource = 'telegram',
): CommandContext {
  return {
    source,
    channelName: `${source}:ops`,
    chatId: 'chat-1',
    senderId: 'user-1',
    sessionManager,
    agentConfig: {
      name: 'zero-agent',
      agentInstruction: 'You are ZeRo OS, be concise and accurate.',
    },
    channelCapabilities: {
      streaming: true,
      inlineImages: true,
    },
    reply: async () => {},
  }
}

describe('builtin commands', () => {
  test('/new creates a new session and returns a reply', async () => {
    const initCalls: Array<{ name: string; agentInstruction: string }> = []
    const capabilityCalls: ChannelCapabilities[] = []
    const mockSession: MockSession = {
      data: { currentModel: 'openai-codex/gpt-5.3-codex-medium' },
      switchModel: async () => ({ success: true, message: 'ok' }),
      initAgent: (config) => {
        initCalls.push(config)
      },
      setChannelCapabilities: (capabilities) => {
        capabilityCalls.push(capabilities)
      },
      listModels: () => [],
    }

    const startCalls: Array<[SessionSource, string, { channelName?: string }]> = []
    const sessionManager = {
      startNewForChannel: (
        source: SessionSource,
        chatId: string,
        options: { channelName?: string },
      ) => {
        startCalls.push([source, chatId, options])
        return { session: mockSession, previousSessionId: 'sess_old' }
      },
    } as unknown as SessionManager

    const ctx = createContext(sessionManager)
    const result = await newSessionCommand.execute({}, ctx)

    expect(startCalls).toEqual([['telegram', 'chat-1', { channelName: 'telegram:ops' }]])
    expect(initCalls).toEqual([
      {
        name: 'zero-agent',
        agentInstruction: 'You are ZeRo OS, be concise and accurate.',
      },
    ])
    expect(capabilityCalls).toEqual([{ streaming: true, inlineImages: true }])
    expect(result).toEqual({
      handled: true,
      reply: 'New conversation started with model: openai-codex/gpt-5.3-codex-medium',
    })
  })

  test('/new <model> switches model for the new session', async () => {
    const switchCalls: string[] = []
    const mockSession: MockSession = {
      data: { currentModel: 'openai-codex/gpt-5.3-codex-medium' },
      switchModel: async (target: string) => {
        switchCalls.push(target)
        mockSession.data.currentModel = `openai-codex/${target}`
        return { success: true, message: `Switched to ${target}` }
      },
      initAgent: () => {},
      setChannelCapabilities: () => {},
      listModels: () => [],
    }

    const sessionManager = {
      startNewForChannel: () => ({ session: mockSession }),
    } as unknown as SessionManager

    const ctx = createContext(sessionManager)
    const result = await newSessionCommand.execute({ modelArg: 'gpt-5.4-medium' }, ctx)

    expect(switchCalls).toEqual(['gpt-5.4-medium'])
    expect(result).toEqual({
      handled: true,
      reply: 'New conversation started with model: openai-codex/gpt-5.4-medium',
    })
  })

  test('/model with no args returns current model', async () => {
    const mockSession: MockSession = {
      data: { currentModel: 'openai-codex/gpt-5.3-codex-medium' },
      switchModel: async () => ({ success: true, message: 'ok' }),
      initAgent: () => {},
      setChannelCapabilities: () => {},
      listModels: () => [],
    }

    const sessionManager = {
      getOrCreateForChannel: () => ({ session: mockSession, isNew: false }),
    } as unknown as SessionManager

    const result = await modelCommand.execute({}, createContext(sessionManager, 'web'))

    expect(result).toEqual({
      handled: true,
      reply: 'Current model: openai-codex/gpt-5.3-codex-medium',
    })
  })

  test('/model list returns available models', async () => {
    const mockSession: MockSession = {
      data: { currentModel: 'openai-codex/gpt-5.3-codex-medium' },
      switchModel: async () => ({ success: true, message: 'ok' }),
      initAgent: () => {},
      setChannelCapabilities: () => {},
      listModels: () => ['openai-codex/gpt-5.3-codex-medium', 'openai-codex/gpt-5.4-medium'],
    }

    const sessionManager = {
      getOrCreateForChannel: () => ({ session: mockSession, isNew: false }),
    } as unknown as SessionManager

    const result = await modelCommand.execute(
      { target: 'list' },
      createContext(sessionManager, 'feishu'),
    )

    expect(result).toEqual({
      handled: true,
      reply:
        'Available models:\n- openai-codex/gpt-5.3-codex-medium\n- openai-codex/gpt-5.4-medium',
    })
  })

  test('/model <target> switches model', async () => {
    const switchCalls: string[] = []
    const mockSession: MockSession = {
      data: { currentModel: 'openai-codex/gpt-5.3-codex-medium' },
      switchModel: async (target: string) => {
        switchCalls.push(target)
        return { success: true, message: `Switched model to: ${target}` }
      },
      initAgent: () => {},
      setChannelCapabilities: () => {},
      listModels: () => [],
    }

    const sessionManager = {
      getOrCreateForChannel: () => ({ session: mockSession, isNew: false }),
    } as unknown as SessionManager

    const result = await modelCommand.execute(
      { target: 'gpt-4' },
      createContext(sessionManager, 'telegram'),
    )

    expect(switchCalls).toEqual(['gpt-4'])
    expect(result).toEqual({ handled: true, reply: 'Switched model to: gpt-4' })
  })

  test('parsers support @bot suffix and case-insensitive command names', () => {
    expect(newSessionCommand.parse('/NEW@ZeroBot')).toEqual({})
    expect(newSessionCommand.parse('/NeW@ZeroBot gpt-4')).toEqual({ modelArg: 'gpt-4' })
    expect(modelCommand.parse('/MoDeL@ZeroBot')).toEqual({})
    expect(modelCommand.parse('/MODEL@ZeroBot list')).toEqual({ target: 'list' })
  })
})
