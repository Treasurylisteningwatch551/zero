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
  preferredSource?: string,
) {
  if (preferredSource) {
    const preferred = candidates.find((candidate) => candidate.source === preferredSource)
    if (preferred) return preferred
  }

  return candidates[0] ?? null
}
