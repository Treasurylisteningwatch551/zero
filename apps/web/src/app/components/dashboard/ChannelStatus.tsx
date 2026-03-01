import { useState, useEffect } from 'react'
import { Plugs } from '@phosphor-icons/react'
import { apiFetch } from '../../lib/api'

interface Channel {
  name: string
  status: string
}

export function ChannelStatus() {
  const [channels, setChannels] = useState<Channel[]>([])

  useEffect(() => {
    apiFetch<{ channels: Channel[] }>('/api/channels/status')
      .then((res) => setChannels(res.channels))
      .catch(() => {})
  }, [])

  if (channels.length === 0) return null

  const hasOffline = channels.some((ch) => ch.status !== 'online')

  return (
    <div
      className={`card px-4 py-2.5 animate-fade-up flex items-center gap-3 ${
        hasOffline ? 'border border-red-400/30' : ''
      }`}
    >
      <Plugs
        size={16}
        weight="bold"
        className={hasOffline ? 'text-red-400' : 'text-[var(--color-text-disabled)]'}
      />
      <div className="flex items-center gap-4 flex-wrap">
        {channels.map((ch) => {
          const isOnline = ch.status === 'online'
          return (
            <div key={ch.name} className="flex items-center gap-1.5">
              <span
                className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-red-400'}`}
              />
              <span
                className={`text-[12px] font-mono ${
                  isOnline ? 'text-[var(--color-text-muted)]' : 'text-red-400'
                }`}
              >
                {ch.name}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
