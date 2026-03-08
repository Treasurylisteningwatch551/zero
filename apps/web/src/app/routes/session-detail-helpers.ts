export interface ChannelSessionCandidate {
  id: string
  source: string
  channelId: string
  status: string
  updatedAt: string
  summary?: string
}

export function resolveChannelSessionCandidate(
  candidates: ChannelSessionCandidate[],
  preferredChannelId?: string,
) {
  if (preferredChannelId) {
    const preferred = candidates.find((candidate) => candidate.channelId === preferredChannelId)
    if (preferred) return preferred
  }

  return candidates[0] ?? null
}
