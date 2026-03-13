export interface ChannelSessionCandidate {
  id: string
  source: string
  channelName?: string
  channelId: string
  status: string
  updatedAt: string
  summary?: string
}

export function resolveChannelSessionCandidate(
  candidates: ChannelSessionCandidate[],
  preferredChannelId?: string,
  preferredChannelName?: string,
) {
  if (preferredChannelId && preferredChannelName) {
    const preferred = candidates.find(
      (candidate) =>
        candidate.channelId === preferredChannelId &&
        candidate.channelName === preferredChannelName,
    )
    if (preferred) return preferred
  }

  if (preferredChannelId) {
    const preferred = candidates.find((candidate) => candidate.channelId === preferredChannelId)
    if (preferred) return preferred
  }

  return candidates[0] ?? null
}
