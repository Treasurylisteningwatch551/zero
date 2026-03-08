import { describe, expect, test } from 'bun:test'
import { resolveChannelSessionCandidate, type ChannelSessionCandidate } from './session-detail-helpers'

const candidates: ChannelSessionCandidate[] = [
  {
    id: 'sess_tg_2',
    source: 'telegram',
    channelId: 'room_2',
    status: 'active',
    updatedAt: '2026-03-08T00:00:03.000Z',
  },
  {
    id: 'sess_tg_1',
    source: 'telegram',
    channelId: 'room_1',
    status: 'idle',
    updatedAt: '2026-03-08T00:00:02.000Z',
  },
]

describe('resolveChannelSessionCandidate', () => {
  test('prefers matching channel id when present', () => {
    expect(resolveChannelSessionCandidate(candidates, 'room_1')?.id).toBe('sess_tg_1')
  })

  test('falls back to first candidate when channel id is missing', () => {
    expect(resolveChannelSessionCandidate(candidates)?.id).toBe('sess_tg_2')
  })

  test('falls back to first candidate when channel id does not match', () => {
    expect(resolveChannelSessionCandidate(candidates, 'room_404')?.id).toBe('sess_tg_2')
  })
})
