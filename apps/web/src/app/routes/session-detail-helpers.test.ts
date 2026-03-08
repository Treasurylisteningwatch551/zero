import { describe, expect, test } from 'bun:test'
import { resolveChannelSessionCandidate, type ChannelSessionCandidate } from './session-detail-helpers'

const candidates: ChannelSessionCandidate[] = [
  {
    id: 'sess_tg',
    source: 'telegram',
    channelId: 'room_1',
    status: 'active',
    updatedAt: '2026-03-08T00:00:03.000Z',
  },
  {
    id: 'sess_fs',
    source: 'feishu',
    channelId: 'room_1',
    status: 'idle',
    updatedAt: '2026-03-08T00:00:02.000Z',
  },
]

describe('resolveChannelSessionCandidate', () => {
  test('prefers matching source when present', () => {
    expect(resolveChannelSessionCandidate(candidates, 'feishu')?.id).toBe('sess_fs')
  })

  test('falls back to first candidate when source is missing', () => {
    expect(resolveChannelSessionCandidate(candidates)?.id).toBe('sess_tg')
  })

  test('falls back to first candidate when source does not match', () => {
    expect(resolveChannelSessionCandidate(candidates, 'web')?.id).toBe('sess_tg')
  })
})
