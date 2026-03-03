/**
 * Centralized tuning parameters for the context engineering system.
 * All magic numbers are collected here for easy experimentation.
 */
export const CONTEXT_PARAMS = {
  /** System Prompt fixed budget allocations (tokens) */
  budget: {
    role: 500,
    toolRules: 800,
    constraints: 300,
    identity: 3000,
    memo: 1500,
    retrievedMemory: 2000,
  },

  /** Conversation compression */
  compression: {
    /** Trigger compression when conversation tokens reach this ratio of budget */
    threshold: 0.85,
    /** After compression, retained section gets this ratio of conversation budget */
    retainRatio: 0.70,
    /** Minimum recent turns to retain after compression */
    minRetainTurns: 4,
    /** Maximum tokens for the compression summary */
    summaryMaxTokens: 800,
  },

  /** Per-tool output token limits */
  toolOutput: {
    read: 8000,
    write: 500,
    edit: 1000,
    bash: 4000,
    browser: 4000,
    task: 2000,
    /** Default limit for unknown tools */
    default: 4000,
    /** Head portion ratio when truncating */
    headRatio: 0.6,
    /** Tail portion ratio when truncating */
    tailRatio: 0.2,
  },

  /** Historical tool output progressive reduction */
  history: {
    /** Turns 0..N: full tool output preserved */
    fullRetainTurns: 3,
    /** Turns N+1..M: tool output truncated to summary */
    summaryRetainTurns: 8,
    /** Summary truncation length (chars) */
    summaryMaxChars: 200,
  },

  /** Memory retrieval */
  retrieval: {
    topN: 5,
    confidenceThreshold: 0.6,
    maxQueries: 3,
    perMemoryMaxTokens: 400,
  },

  /** SubAgent context */
  subAgent: {
    upstreamMaxTokens: 2000,
  },

  /** Queued message injection */
  queue: {
    maxContinuationRetries: 2,
    maxRetainMessages: 5,
  },
} as const
